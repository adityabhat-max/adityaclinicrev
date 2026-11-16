/**
 * Compare the engine against numbers copied from the Google Sheet "Daily Report".
 * Usage: npx tsx scripts/reconcile.ts
 * Snapshot: sheet as read on 2026-11-16 (Sale Dump = 1–15 Nov, comparison = 1–15 Aug).
 */
import { readFileSync } from "node:fs";
import postgres from "postgres";
import { buildReport, type SaleRow } from "../src/lib/report";
import { compatFromEnv } from "../src/lib/compat";
import { mergeRanges, type Range } from "../src/lib/dates";
import type { CenterId } from "../src/lib/centers";

const SHEET: Record<CenterId, { current: number; comparison: number | null; yesterday: number; product: number }> = {
  VV:    { current: 5362231, comparison: 6128417, yesterday: 819084, product: 216344 },
  GK:    { current: 3420535, comparison: 4963694, yesterday: 338225, product: 131242 },
  MUM:   { current: 2076657, comparison: 1502758, yesterday: 42998,  product: 12088 },
  DLF:   { current: 1430328, comparison: 1504664, yesterday: 47300,  product: 6358 },
  KM:    { current: 1112384, comparison: 1593888, yesterday: 65000,  product: 1259 },
  ND:    { current: 1614043, comparison: 2049875, yesterday: 97745,  product: 6077 },
  BLR:   { current: 2335600, comparison: 1470220, yesterday: 274000, product: 63946 },
  PPB:   { current: 580720,  comparison: 841118,  yesterday: 53000,  product: 4607 },
  MOH:   { current: 564700,  comparison: 337800,  yesterday: 110000, product: 799 },
  SURAT: { current: 482969,  comparison: 284574,  yesterday: 8733,   product: 0 },
  HYD:   { current: 531620,  comparison: 343797,  yesterday: 190000, product: 2598 },
  BSSN:  { current: 198418,  comparison: 803611,  yesterday: 0,      product: 0 },
  SEXT:  { current: 157500,  comparison: 392400,  yesterday: 0,      product: 7794 },
  M3M:   { current: 829896,  comparison: 559100,  yesterday: 110000, product: 4921 },
  GM:    { current: 165299,  comparison: 370577,  yesterday: 0,      product: 0 },
  LUH:   { current: 81000,   comparison: 93000,   yesterday: 0,      product: 4600 },
  KKDM:  { current: 718600,  comparison: 125300,  yesterday: 0,      product: 17423 },
  CTP:   { current: 71000,   comparison: null,    yesterday: 0,      product: 0 },
};

const env = readFileSync(".env.local", "utf8");
const url = env.split(/\r?\n/).find((l) => l.startsWith("DATABASE_URL="))!.slice(13).trim();
const sql = postgres(url, { prepare: false, max: 1, ssl: "require" });

async function fetchRows(ranges: Range[]): Promise<SaleRow[]> {
  const out: SaleRow[] = [];
  for (const r of mergeRanges(ranges))
    out.push(...(await sql<SaleRow[]>`select item_type, sale_date::text as sale_date, center_name, sold_by,
      coalesce(collected,0)::float8 as collected, payment_type from sales_dash.collections
      where sale_date between ${r.from}::date and ${r.to}::date`));
  return out;
}

const current = { from: "2026-11-01", to: "2026-11-15" };
const comparison = { from: "2026-08-01", to: "2026-08-15" };
const yesterday = "2026-11-15";

async function main() {
const rows = await fetchRows([current, comparison]);
const rep = buildReport({ rows, current, comparison, yesterday, compat: compatFromEnv() });
await sql.end();

const fmt = (n: number | null) => (n == null ? "—" : Math.round(n).toLocaleString("en-US"));
const cols = ["comparison", "current", "yesterday", "product"] as const;
for (const col of cols) {
  console.log(`\n=== ${col.toUpperCase()} ===`);
  let ok = 0;
  for (const c of rep.centers) {
    const want = SHEET[c.id][col];
    const got = c[col];
    const diff = Math.round((got ?? 0) - (want ?? 0));
    if (Math.abs(diff) < 1) ok++;
    else console.log(`${c.name.padEnd(28)} sheet ${fmt(want).padStart(11)}  db ${fmt(got).padStart(11)}  diff ${fmt(diff)}`);
  }
  console.log(`${ok}/${rep.centers.length} centers match`);
}
}
main().catch((e) => { console.error(e); process.exit(1); });
