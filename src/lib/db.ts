import "server-only";
import postgres from "postgres";
import { mergeRanges, type Range } from "./dates";
import { INTERNAL_PATTERN, type SaleRow, type SplitLine } from "./report";
import { CENTERS, type CenterId } from "./centers";
import { personKey } from "./targets";

// Direct Postgres connection: sales_dash is not exposed through the Supabase REST API.
// Use the transaction pooler (port 6543); run the functions in Mumbai (vercel.json) next to the database.
const g = globalThis as unknown as { sql?: ReturnType<typeof postgres>; cache?: Map<string, { at: number; p: Promise<unknown> }> };

function sql() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");
  g.sql ??= postgres(process.env.DATABASE_URL, {
    prepare: false, max: 4, ssl: "require", connect_timeout: 10,
    // Supabase's pooler silently drops idle connections; a query sent on a dropped one hangs.
    // Close our idle connections first, and never keep one longer than 5 minutes.
    idle_timeout: 20, max_lifetime: 300,
  });
  return g.sql;
}

/**
 * Run a read query; if it hasn't answered within QUERY_TIMEOUT_MS (normal is well under 1 s), the
 * connection is assumed dead (e.g. after the serverless function was frozen): throw the client away
 * and try once more on a fresh connection, instead of making the user wait.
 */
const QUERY_TIMEOUT_MS = 6000;
class QueryTimeout extends Error {}
async function read<T>(fn: (db: ReturnType<typeof postgres>) => Promise<T>): Promise<T> {
  const attempt = () => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, rej) => { timer = setTimeout(() => rej(new QueryTimeout()), QUERY_TIMEOUT_MS); });
    return Promise.race([fn(sql()), timeout]).finally(() => clearTimeout(timer));
  };
  try {
    return await attempt();
  } catch (e) {
    if (!(e instanceof QueryTimeout)) throw e;
    console.warn("DB query timed out — reconnecting and retrying once");
    const old = g.sql;
    g.sql = undefined;
    old?.end({ timeout: 0 }).catch(() => {});
    return attempt();
  }
}

/**
 * Short-lived in-memory cache per server instance. Zenoti syncs every 30 min, so reusing a result for
 * 60 s hides nothing, but makes filter changes (center / sales owner) instant instead of re-querying.
 */
const TTL_MS = 60_000;
function cached<T>(key: string, fn: () => Promise<T>): Promise<T> {
  g.cache ??= new Map();
  const hit = g.cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.p as Promise<T>;
  const p = fn();
  g.cache.set(key, { at: Date.now(), p });
  p.catch(() => g.cache?.delete(key));
  if (g.cache.size > 200) g.cache.delete(g.cache.keys().next().value as string);
  return p;
}
export function clearCache(prefix: string) {
  for (const k of g.cache?.keys() ?? []) if (k.startsWith(prefix)) g.cache!.delete(k);
}

/**
 * Sales of sales_dash.collections whose payment date falls in any of the ranges — one query, with
 * identical rows (same day, item type, center, seller, internal-adjustment flag) summed in the database.
 * `nonzero` keeps how many underlying lines were non-zero, so the engine gives the same results as raw rows.
 */
export function fetchSales(ranges: Range[]): Promise<SaleRow[]> {
  const merged = mergeRanges(ranges);
  return cached(`sales:${merged.map((r) => `${r.from}_${r.to}`).join(",")}`, () => read(async (db) => {
    const where = merged
      .map((r) => db`(sale_date between ${r.from}::date and ${r.to}::date)`)
      .reduce((acc, f) => db`${acc} or ${f}`);
    // sale_date is a `date` column (payment date, already in IST).
    return db<SaleRow[]>`
      select sale_date::text as sale_date,
             item_type,
             center_name,
             sold_by,
             (coalesce(payment_type, '') ~* ${INTERNAL_PATTERN}) as internal,
             sum(coalesce(collected, 0))::float8 as collected,
             (count(*) filter (where coalesce(collected, 0) <> 0))::int as nonzero
      from sales_dash.collections
      where ${where}
      group by 1, 2, 3, 4, 5`;
  }));
}

/** Center targets saved for a month ("YYYY-MM-01"), keyed by our CenterId. Missing centers = not saved. */
export function fetchTargets(month: string, opts: { fresh?: boolean } = {}): Promise<Partial<Record<CenterId, number>>> {
  return opts.fresh ? fetchTargetsUncached(month) : cached(`targets:${month}`, () => fetchTargetsUncached(month));
}

async function fetchTargetsUncached(month: string): Promise<Partial<Record<CenterId, number>>> {
  const rows = await read((db) => db<{ zenoti_name: string; target: number }[]>`
    select c.zenoti_name, t.target::float8 as target
    from sales_dash.targets t join sales_dash.centers c using (center_id)
    where t.month = ${month}::date and t.sold_by is null`);
  const out: Partial<Record<CenterId, number>> = {};
  for (const r of rows) {
    const c = CENTERS.find((x) => x.zenoti.toLowerCase() === r.zenoti_name.toLowerCase());
    if (c) out[c.id] = r.target;
  }
  return out;
}

/** Sales-person targets saved for a month, keyed by personKey(name). */
export function fetchPersonTargets(month: string, opts: { fresh?: boolean } = {}): Promise<Record<string, number>> {
  const run = async () => {
    const rows = await read((db) => db<{ sold_by: string; target: number }[]>`
      select sold_by, target::float8 as target from sales_dash.targets where month = ${month}::date and sold_by is not null`);
    return Object.fromEntries(rows.map((r) => [personKey(r.sold_by), r.target]));
  };
  return opts.fresh ? run() : cached(`targets:people:${month}`, run);
}

/** Saved center targets for every month from `from` to `to` ("YYYY-MM-01"), keyed "YYYY-MM" → CenterId → target. */
export async function fetchTargetsBetween(from: string, to: string): Promise<Record<string, Partial<Record<CenterId, number>>>> {
  const rows = await read((db) => db<{ m: string; zenoti_name: string; target: number }[]>`
    select to_char(t.month, 'YYYY-MM') as m, c.zenoti_name, t.target::float8 as target
    from sales_dash.targets t join sales_dash.centers c using (center_id)
    where t.month between ${from}::date and ${to}::date and t.sold_by is null`);
  const out: Record<string, Partial<Record<CenterId, number>>> = {};
  for (const r of rows) {
    const c = CENTERS.find((x) => x.zenoti.toLowerCase() === r.zenoti_name.toLowerCase());
    if (c) (out[r.m] ??= {})[c.id] = r.target;
  }
  return out;
}

/** Months ("YYYY-MM") that have any saved targets, newest first. */
export async function fetchTargetMonths(): Promise<string[]> {
  const rows = await read((db) => db<{ m: string }[]>`
    select distinct to_char(month, 'YYYY-MM') as m from sales_dash.targets order by 1 desc`);
  return rows.map((r) => r.m);
}

export class TargetsLockedError extends Error {}
export class SetupMissingError extends Error {}
/** The database still only accepts people listed in sales_dash.sales_owners (foreign key). */
export class PeopleCheckError extends Error {}

export interface Submission { submitted_by: string; submitted_at: string }

/** Who submitted a month's targets and when (sales_dash.target_submissions). null = no record. */
export async function fetchSubmission(month: string): Promise<Submission | null> {
  try {
    const rows = await read((db) => db<Submission[]>`
      select submitted_by, submitted_at::text as submitted_at from sales_dash.target_submissions where month = ${month}::date`);
    return rows[0] ?? null;
  } catch (e) {
    if (e instanceof Error && /does not exist/i.test(e.message)) return null; // table not created yet
    throw e;
  }
}

/**
 * Submit center AND sales-person targets for a month — ONE time only, together, recording who and when.
 * The submission row (primary key = month) and plain INSERTs into sales_dash.targets (unique per
 * month+center and month+person) make a second submission fail and roll back. Give the app's DB role
 * INSERT but not UPDATE/DELETE so the database itself enforces the lock; the owner changes targets in Supabase.
 */
export async function submitTargetsOnce(
  month: string, targets: Record<CenterId, number>, people: Record<string, number>, submittedBy: string,
): Promise<void> {
  const db = sql();
  const centers = await db<{ center_id: string; zenoti_name: string }[]>`select center_id, zenoti_name from sales_dash.centers`;
  try {
    await db.begin(async (tx) => {
      const [{ n }] = await tx<{ n: number }[]>`
        select count(*)::int n from sales_dash.targets where month = ${month}::date`;
      if (n > 0) throw new TargetsLockedError("Targets for this month were already submitted");
      await tx`insert into sales_dash.target_submissions (month, submitted_by, submitted_at) values (${month}::date, ${submittedBy}, now())`;
      for (const [id, value] of Object.entries(targets) as [CenterId, number][]) {
        const zen = CENTERS.find((c) => c.id === id)?.zenoti.toLowerCase();
        const centerId = centers.find((c) => c.zenoti_name.toLowerCase() === zen)?.center_id;
        if (!centerId) throw new Error(`Center ${id} not found in sales_dash.centers`);
        await tx`insert into sales_dash.targets (month, center_id, sold_by, target) values (${month}::date, ${centerId}, null, ${value})`;
      }
      for (const [name, value] of Object.entries(people))
        await tx`insert into sales_dash.targets (month, center_id, sold_by, target) values (${month}::date, null, ${name}, ${value})`;
    });
    clearCache("targets:");
  } catch (e) {
    if (e instanceof TargetsLockedError) throw e;
    if (e instanceof Error && /targets_sold_by_fkey|foreign key.*sold_by/i.test(e.message))
      throw new PeopleCheckError("sales_dash.targets still requires people to be in sales_dash.sales_owners");
    if (e instanceof Error && /duplicate key|unique/i.test(e.message)) throw new TargetsLockedError("Targets for this month were already submitted");
    if (e instanceof Error && /target_submissions.*does not exist|relation .* does not exist/i.test(e.message))
      throw new SetupMissingError("sales_dash.target_submissions has not been created yet");
    throw e;
  }
}

// ---------------------------------------------------------------- cross-branch 50/50 splits

const missingTable = (e: unknown) => e instanceof Error && /invoice_splits.*does not exist|relation .* does not exist/i.test(e.message);
const centerIdByZenoti = (name: string) => CENTERS.find((c) => c.zenoti.toLowerCase() === name.toLowerCase())?.id;

/**
 * Payment lines (in the given date ranges) of invoices with an ACTIVE split, grouped like fetchSales.
 * Returns [] when no split exists — or the splits table hasn't been created yet — so the report is unchanged.
 */
export function fetchSplitLines(ranges: Range[]): Promise<SplitLine[]> {
  const merged = mergeRanges(ranges);
  return cached(`splits:${merged.map((r) => `${r.from}_${r.to}`).join(",")}`, async () => {
    try {
      const rows = await read((db) => {
        const where = merged
          .map((r) => db`(c.sale_date between ${r.from}::date and ${r.to}::date)`)
          .reduce((acc, f) => db`${acc} or ${f}`);
        return db<(SaleRow & { split_id: number; to_center_name: string; to_person: string; from_seller: string | null })[]>`
          select s.id::int as split_id, ce.zenoti_name as to_center_name, s.to_person, s.from_seller,
                 c.sale_date::text as sale_date, c.item_type, c.center_name, c.sold_by,
                 (coalesce(c.payment_type, '') ~* ${INTERNAL_PATTERN}) as internal,
                 sum(coalesce(c.collected, 0))::float8 as collected
          from sales_dash.invoice_splits s
          join sales_dash.centers ce on ce.center_id = s.to_center_id
          join sales_dash.collections c on c.invoice_no = s.invoice_no
          where s.cancelled_at is null and (${where})
          group by 1, 2, 3, 4, 5, 6, 7, 8, 9`;
      });
      return rows.flatMap((r) => {
        const to = centerIdByZenoti(r.to_center_name);
        return to ? [{ ...r, to_center: to }] : [];
      });
    } catch (e) {
      if (missingTable(e)) return [];
      throw e;
    }
  });
}

export interface InvoiceLine {
  sale_date: string; item_type: string; item_name: string | null; center_name: string; sold_by: string | null;
  guest_name: string | null; payment_type: string | null; collected: number; internal: boolean;
}

/** Every payment line of one invoice (case-insensitive invoice number). */
export async function lookupInvoice(invoiceNo: string): Promise<InvoiceLine[]> {
  return read((db) => db<InvoiceLine[]>`
    select sale_date::text as sale_date, item_type, item_name, center_name, sold_by, guest_name, payment_type,
           coalesce(collected, 0)::float8 as collected, (coalesce(payment_type, '') ~* ${INTERNAL_PATTERN}) as internal
    from sales_dash.collections where upper(invoice_no) = upper(${invoiceNo})
    order by sale_date, item_type`);
}

export interface SplitRecord {
  id: number; invoice_no: string; client_name: string | null; from_center: string; from_seller: string | null;
  to_center_id: string; to_center_name: string; to_person: string; invoice_total: number; note: string | null;
  created_by: string; created_at: string; cancelled_by: string | null; cancelled_at: string | null; cancel_reason: string | null;
}

/** The full split log, newest first. null = the table hasn't been created yet. */
export async function listSplits(): Promise<SplitRecord[] | null> {
  try {
    return await read((db) => db<SplitRecord[]>`
      select s.id::int as id, s.invoice_no, s.client_name, s.from_center, s.from_seller, s.to_center_id,
             ce.zenoti_name as to_center_name, s.to_person, s.invoice_total::float8 as invoice_total, s.note,
             s.created_by, s.created_at::text as created_at, s.cancelled_by, s.cancelled_at::text as cancelled_at, s.cancel_reason
      from sales_dash.invoice_splits s join sales_dash.centers ce on ce.center_id = s.to_center_id
      order by s.created_at desc, s.id desc`);
  } catch (e) {
    if (missingTable(e)) return null;
    throw e;
  }
}

/** The active split of an invoice, if any. */
export async function activeSplitFor(invoiceNo: string): Promise<SplitRecord | null> {
  const all = await listSplits();
  return all?.find((s) => !s.cancelled_at && s.invoice_no.toUpperCase() === invoiceNo.toUpperCase()) ?? null;
}

export class AlreadySplitError extends Error {}

export interface NewSplit {
  invoice_no: string; client_name: string | null; from_center: string; from_seller: string | null;
  to_center: CenterId; to_person: string; invoice_total: number; note: string | null;
}

/** Record a split (insert only). The unique index allows one active split per invoice. */
export async function addSplit(s: NewSplit, createdBy: string): Promise<void> {
  const db = sql();
  const zen = CENTERS.find((c) => c.id === s.to_center)!.zenoti;
  try {
    const [center] = await db<{ center_id: string }[]>`
      select center_id from sales_dash.centers where lower(zenoti_name) = lower(${zen})`;
    if (!center) throw new Error(`Center ${s.to_center} not found in sales_dash.centers`);
    await db`
      insert into sales_dash.invoice_splits
        (invoice_no, client_name, from_center, from_seller, to_center_id, to_person, share, invoice_total, note, created_by)
      values (${s.invoice_no}, ${s.client_name}, ${s.from_center}, ${s.from_seller}, ${center.center_id}, ${s.to_person},
              0.5, ${s.invoice_total}, ${s.note}, ${createdBy})`;
    clearCache("splits:");
  } catch (e) {
    if (e instanceof Error && /duplicate key|unique/i.test(e.message)) throw new AlreadySplitError("This invoice is already split");
    if (missingTable(e)) throw new SetupMissingError("sales_dash.invoice_splits has not been created yet");
    throw e;
  }
}

/** Cancel an active split — it stays in the log with who, when and why. Returns false if it wasn't active. */
export async function cancelSplit(id: number, cancelledBy: string, reason: string): Promise<boolean> {
  try {
    const rows = await sql()`
      update sales_dash.invoice_splits set cancelled_by = ${cancelledBy}, cancelled_at = now(), cancel_reason = ${reason}
      where id = ${id} and cancelled_at is null returning id`;
    clearCache("splits:");
    return rows.length > 0;
  } catch (e) {
    if (missingTable(e)) throw new SetupMissingError("sales_dash.invoice_splits has not been created yet");
    throw e;
  }
}

export function fetchFreshness(): Promise<unknown> {
  return cached("freshness", async () => (await read((db) => db`select * from sales_dash.v_freshness`))[0] ?? null);
}
