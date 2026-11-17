import "server-only";
import postgres from "postgres";
import { mergeRanges, type Range } from "./dates";
import { INTERNAL_PATTERN, type SaleRow } from "./report";
import { CENTERS, type CenterId } from "./centers";

// Direct Postgres connection: sales_dash is not exposed through the Supabase REST API.
// Use the transaction pooler (port 6543); run the functions in Mumbai (vercel.json) next to the database.
const g = globalThis as unknown as { sql?: ReturnType<typeof postgres>; cache?: Map<string, { at: number; p: Promise<unknown> }> };

function sql() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");
  g.sql ??= postgres(process.env.DATABASE_URL, { prepare: false, max: 3, ssl: "require", connect_timeout: 15 });
  return g.sql;
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
  return cached(`sales:${merged.map((r) => `${r.from}_${r.to}`).join(",")}`, async () => {
    const db = sql();
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
  });
}

/** Center targets saved for a month ("YYYY-MM-01"), keyed by our CenterId. Missing centers = not saved. */
export function fetchTargets(month: string, opts: { fresh?: boolean } = {}): Promise<Partial<Record<CenterId, number>>> {
  return opts.fresh ? fetchTargetsUncached(month) : cached(`targets:${month}`, () => fetchTargetsUncached(month));
}

async function fetchTargetsUncached(month: string): Promise<Partial<Record<CenterId, number>>> {
  const rows = await sql()<{ zenoti_name: string; target: number }[]>`
    select c.zenoti_name, t.target::float8 as target
    from sales_dash.targets t join sales_dash.centers c using (center_id)
    where t.month = ${month}::date and t.sold_by is null`;
  const out: Partial<Record<CenterId, number>> = {};
  for (const r of rows) {
    const c = CENTERS.find((x) => x.zenoti.toLowerCase() === r.zenoti_name.toLowerCase());
    if (c) out[c.id] = r.target;
  }
  return out;
}

export class TargetsLockedError extends Error {}
export class SetupMissingError extends Error {}

export interface Submission { submitted_by: string; submitted_at: string }

/** Who submitted a month's targets and when (sales_dash.target_submissions). null = no record. */
export async function fetchSubmission(month: string): Promise<Submission | null> {
  try {
    const rows = await sql()<Submission[]>`
      select submitted_by, submitted_at::text as submitted_at from sales_dash.target_submissions where month = ${month}::date`;
    return rows[0] ?? null;
  } catch (e) {
    if (e instanceof Error && /does not exist/i.test(e.message)) return null; // table not created yet
    throw e;
  }
}

/**
 * Submit center targets for a month — ONE time only, recording who and when.
 * The submission row (primary key = month) and plain INSERTs into sales_dash.targets (unique per
 * month+center) make a second submission fail and roll back. Give the app's DB role INSERT but not
 * UPDATE/DELETE so the database itself enforces the lock; the owner changes targets in Supabase.
 */
export async function submitTargetsOnce(month: string, targets: Record<CenterId, number>, submittedBy: string): Promise<void> {
  const db = sql();
  const centers = await db<{ center_id: string; zenoti_name: string }[]>`select center_id, zenoti_name from sales_dash.centers`;
  try {
    await db.begin(async (tx) => {
      const [{ n }] = await tx<{ n: number }[]>`
        select count(*)::int n from sales_dash.targets where month = ${month}::date and center_id is not null and sold_by is null`;
      if (n > 0) throw new TargetsLockedError("Targets for this month were already submitted");
      await tx`insert into sales_dash.target_submissions (month, submitted_by, submitted_at) values (${month}::date, ${submittedBy}, now())`;
      for (const [id, value] of Object.entries(targets) as [CenterId, number][]) {
        const zen = CENTERS.find((c) => c.id === id)?.zenoti.toLowerCase();
        const centerId = centers.find((c) => c.zenoti_name.toLowerCase() === zen)?.center_id;
        if (!centerId) throw new Error(`Center ${id} not found in sales_dash.centers`);
        await tx`insert into sales_dash.targets (month, center_id, sold_by, target) values (${month}::date, ${centerId}, null, ${value})`;
      }
    });
    clearCache("targets:");
  } catch (e) {
    if (e instanceof TargetsLockedError) throw e;
    if (e instanceof Error && /duplicate key|unique/i.test(e.message)) throw new TargetsLockedError("Targets for this month were already submitted");
    if (e instanceof Error && /target_submissions.*does not exist|relation .* does not exist/i.test(e.message))
      throw new SetupMissingError("sales_dash.target_submissions has not been created yet");
    throw e;
  }
}

export function fetchFreshness(): Promise<unknown> {
  return cached("freshness", async () => (await sql()`select * from sales_dash.v_freshness`)[0] ?? null);
}
