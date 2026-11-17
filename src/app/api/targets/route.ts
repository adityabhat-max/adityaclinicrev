import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/lib/auth";
import { fetchTargets, submitTargetsOnce, TargetsLockedError } from "@/lib/db";
import { CENTERS, type CenterId } from "@/lib/centers";
import { editableMonths } from "@/lib/dates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

async function admin(req: NextRequest) {
  const s = await verifySession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!s) return NextResponse.json({ error: "Not logged in" }, { status: 401 });
  if (s.role !== "admin") return NextResponse.json({ error: "Only the admin can manage targets" }, { status: 403 });
  return null;
}

/** GET ?month=YYYY-MM → saved targets (locked) or the Daily Report defaults (still open). */
export async function GET(req: NextRequest) {
  const denied = await admin(req);
  if (denied) return denied;
  const month = req.nextUrl.searchParams.get("month") ?? "";
  if (!MONTH.test(month)) return NextResponse.json({ error: "Invalid month" }, { status: 400 });
  try {
    const saved = await fetchTargets(`${month}-01`);
    const locked = Object.keys(saved).length > 0;
    const targets = Object.fromEntries(CENTERS.map((c) => [c.id, saved[c.id] ?? c.target]));
    return NextResponse.json({ month, locked, editable: !locked && editableMonths().includes(month), targets });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Could not load targets" }, { status: 500 });
  }
}

/** POST { month: "YYYY-MM", targets: { VV: 17500000, ... all 18 centers } } — once per month. */
export async function POST(req: NextRequest) {
  const denied = await admin(req);
  if (denied) return denied;

  const body = (await req.json().catch(() => null)) as { month?: string; targets?: Record<string, unknown> } | null;
  if (!body?.month || !MONTH.test(body.month) || !body.targets || typeof body.targets !== "object")
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  if (!editableMonths().includes(body.month))
    return NextResponse.json({ error: "Targets can only be submitted for this month or next month" }, { status: 400 });

  const clean = {} as Record<CenterId, number>;
  for (const c of CENTERS) {
    const n = Number(body.targets[c.id]);
    if (!Number.isFinite(n) || n < 0 || n > 10_000_000_000)
      return NextResponse.json({ error: `Enter a valid target for ${c.name}` }, { status: 400 });
    clean[c.id] = Math.round(n);
  }

  try {
    await submitTargetsOnce(`${body.month}-01`, clean);
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof TargetsLockedError)
      return NextResponse.json({ error: "Targets for this month were already submitted and are locked" }, { status: 409 });
    console.error(e);
    const msg = e instanceof Error && /permission denied/i.test(e.message)
      ? "The database login is not allowed to add targets yet (grant INSERT on sales_dash.targets)."
      : "Could not save targets";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
