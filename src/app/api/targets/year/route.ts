import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/lib/auth";
import { fetchTargetsBetween } from "@/lib/db";
import { CENTERS } from "@/lib/centers";
import { editableMonths } from "@/lib/dates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET → center targets for every month of the present year up to the present month (view only).
 * The present month shows its saved targets, or — if not submitted yet — the Daily Report defaults (`submitted: false`).
 * Months/centers with nothing saved come back as null.
 */
export async function GET(req: NextRequest) {
  const s = await verifySession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!s) return NextResponse.json({ error: "Not logged in" }, { status: 401 });
  if (s.role !== "admin") return NextResponse.json({ error: "Only the admin can manage targets" }, { status: 403 });

  const present = editableMonths()[0]; // "YYYY-MM"
  const [year, mm] = present.split("-").map(Number);
  const months = Array.from({ length: mm }, (_, i) => `${year}-${String(i + 1).padStart(2, "0")}`);
  try {
    const saved = await fetchTargetsBetween(`${months[0]}-01`, `${present}-01`);
    const submitted = Object.keys(saved[present] ?? {}).length > 0;
    const targets = Object.fromEntries(months.map((m) => [m, Object.fromEntries(CENTERS.map((c) => [
      c.id, saved[m]?.[c.id] ?? (m === present && !submitted ? c.target : null),
    ]))]));
    return NextResponse.json({ year, present, months, submitted, targets });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Could not load targets" }, { status: 500 });
  }
}
