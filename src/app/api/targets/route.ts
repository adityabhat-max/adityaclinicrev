import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/lib/auth";
import { saveTargets } from "@/lib/db";
import { CENTERS, type CenterId } from "@/lib/centers";

export const runtime = "nodejs";

/** Admin only: save center targets for a month. Body: { month: "YYYY-MM", targets: { VV: 17500000, ... } } */
export async function PUT(req: NextRequest) {
  const session = await verifySession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!session) return NextResponse.json({ error: "Not logged in" }, { status: 401 });
  if (session.role !== "admin") return NextResponse.json({ error: "Only the admin can change targets" }, { status: 403 });

  const body = (await req.json().catch(() => null)) as { month?: string; targets?: Record<string, unknown> } | null;
  if (!body?.month || !/^\d{4}-(0[1-9]|1[0-2])$/.test(body.month) || !body.targets || typeof body.targets !== "object")
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  const ids = new Set(CENTERS.map((c) => c.id));
  const clean: Partial<Record<CenterId, number>> = {};
  for (const [id, raw] of Object.entries(body.targets)) {
    const n = Number(raw);
    if (!ids.has(id as CenterId) || !Number.isFinite(n) || n < 0 || n > 10_000_000_000)
      return NextResponse.json({ error: `Invalid target for ${id}` }, { status: 400 });
    clean[id as CenterId] = Math.round(n);
  }

  try {
    await saveTargets(`${body.month}-01`, clean);
    return NextResponse.json({ ok: true, saved: Object.keys(clean).length });
  } catch (e) {
    console.error(e);
    const msg = e instanceof Error && /permission denied/i.test(e.message)
      ? "The database login is not allowed to change targets yet (grant INSERT, UPDATE on sales_dash.targets)."
      : "Could not save targets";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
