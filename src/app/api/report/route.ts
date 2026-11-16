import { NextResponse, type NextRequest } from "next/server";
import { buildReport } from "@/lib/report";
import { compatFromEnv } from "@/lib/compat";
import { defaultPeriods, todayIST, yesterdayFor, type Range } from "@/lib/dates";
import { fetchFreshness, fetchSales, fetchTargets } from "@/lib/db";
import type { CenterId } from "@/lib/centers";

export const dynamic = "force-dynamic";

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const pick = (v: string | null, fallback: string) => (v && ISO.test(v) ? v : fallback);
const list = (v: string | null) => (v ? v.split(",").map((s) => s.trim()).filter(Boolean) : []);

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const today = todayIST();
  const d = defaultPeriods(today);
  const current: Range = { from: pick(q.get("curFrom"), d.current.from), to: pick(q.get("curTo"), d.current.to) };
  const comparison: Range = { from: pick(q.get("cmpFrom"), d.comparison.from), to: pick(q.get("cmpTo"), d.comparison.to) };
  const yesterday = yesterdayFor(current.to, today);
  const targetMonth = `${current.from.slice(0, 7)}-01`; // targets are monthly: month of the current period's start

  try {
    const [rows, freshness, targets] = await Promise.all([
      fetchSales([current, comparison, { from: yesterday, to: yesterday }]),
      fetchFreshness().catch(() => null),
      fetchTargets(targetMonth).catch(() => ({})),
    ]);
    const report = buildReport({
      rows, current, comparison, yesterday, compat: compatFromEnv(), targets,
      centers: list(q.get("centers")) as CenterId[],
      owners: list(q.get("owners")),
    });
    return NextResponse.json({
      current, comparison, yesterday, generatedAt: new Date().toISOString(), freshness, report,
      targetMonth, savedTargets: Object.keys(targets).length,
    });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Could not load sales data" }, { status: 500 });
  }
}
