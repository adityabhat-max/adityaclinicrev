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

/** Insert or update center targets for a month. Requires INSERT/UPDATE on sales_dash.targets. */
export async function saveTargets(month: string, targets: Partial<Record<CenterId, number>>): Promise<void> {
  const db = sql();
  const centers = await db<{ center_id: string; zenoti_name: string }[]>`select center_id, zenoti_name from sales_dash.centers`;
  await db.begin(async (tx) => {
    for (const [id, value] of Object.entries(targets) as [CenterId, number][]) {
      const zen = CENTERS.find((c) => c.id === id)?.zenoti.toLowerCase();
      const centerId = centers.find((c) => c.zenoti_name.toLowerCase() === zen)?.center_id;
      if (!centerId) throw new Error(`Center ${id} not found in sales_dash.centers`);
      await tx`
        insert into sales_dash.targets (month, center_id, sold_by, target)
        values (${month}::date, ${centerId}, null, ${value})
        on conflict (month, center_id) where center_id is not null
        do update set target = excluded.target`;
    }
  });
}

export async function fetchFreshness(): Promise<unknown> {
  const rows = await sql()`select * from sales_dash.v_freshness`;
  return rows[0] ?? null;
}
