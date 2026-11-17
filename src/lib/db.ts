import "server-only";
import postgres from "postgres";
import { mergeRanges, type Range } from "./dates";
import type { SaleRow } from "./report";
import { CENTERS, type CenterId } from "./centers";

// Direct Postgres connection: sales_dash is not exposed through the Supabase REST API.
// Use a read-only role and the transaction pooler (port 6543) on Vercel.
const globalForSql = globalThis as unknown as { sql?: ReturnType<typeof postgres> };

function sql() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");
  globalForSql.sql ??= postgres(process.env.DATABASE_URL, { prepare: false, max: 3, ssl: "require" });
  return globalForSql.sql;
}

/** Rows of sales_dash.collections whose payment date falls in any of the ranges. */
export async function fetchSales(ranges: Range[]): Promise<SaleRow[]> {
  const db = sql();
  const out: SaleRow[] = [];
  for (const r of mergeRanges(ranges)) {
    // sale_date is a `date` column (payment date, already in IST).
    const rows = await db<SaleRow[]>`
      select item_type,
             sale_date::date::text as sale_date,
             center_name,
             sold_by,
             coalesce(collected, 0)::float8 as collected,
             payment_type
      from sales_dash.collections
      where sale_date between ${r.from}::date and ${r.to}::date`;
    out.push(...rows);
  }
  return out;
}

/** Center targets saved for a month ("YYYY-MM-01"), keyed by our CenterId. Missing centers = not saved. */
export async function fetchTargets(month: string): Promise<Partial<Record<CenterId, number>>> {
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
  } catch (e) {
    if (e instanceof TargetsLockedError) throw e;
    if (e instanceof Error && /duplicate key|unique/i.test(e.message)) throw new TargetsLockedError("Targets for this month were already submitted");
    if (e instanceof Error && /target_submissions.*does not exist|relation .* does not exist/i.test(e.message))
      throw new SetupMissingError("sales_dash.target_submissions has not been created yet");
    throw e;
  }
}

export async function fetchFreshness(): Promise<unknown> {
  const rows = await sql()`select * from sales_dash.v_freshness`;
  return rows[0] ?? null;
}
