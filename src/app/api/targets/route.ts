import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/lib/auth";
import {
  fetchPersonTargets, fetchSubmission, fetchTargetMonths, fetchTargets, PeopleCheckError, SetupMissingError, submitTargetsOnce, TargetsLockedError,
} from "@/lib/db";
import { CENTERS, type CenterId } from "@/lib/centers";
import { editableMonths } from "@/lib/dates";
import { personKey, planErrors, previousMonth, rosterPeople } from "@/lib/targets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const MAX = 10_000_000_000;

async function admin(req: NextRequest) {
  const s = await verifySession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!s) return { denied: NextResponse.json({ error: "Not logged in" }, { status: 401 }) };
  if (s.role !== "admin") return { denied: NextResponse.json({ error: "Only the admin can manage targets" }, { status: 403 }) };
  return { session: s };
}

/**
 * GET ?month=YYYY-MM → center + sales-person targets.
 * Locked: the saved values. Open: Daily Report center targets, and last month's saved person targets as a starting point.
 */
export async function GET(req: NextRequest) {
  const { denied } = await admin(req);
  if (denied) return denied;
  const month = req.nextUrl.searchParams.get("month") ?? "";
  if (!MONTH.test(month)) return NextResponse.json({ error: "Invalid month" }, { status: 400 });
  try {
    const m = `${month}-01`;
    const [saved, savedPeople, submission, savedMonths] = await Promise.all([
      fetchTargets(m, { fresh: true }), fetchPersonTargets(m, { fresh: true }), fetchSubmission(m), fetchTargetMonths(),
    ]);
    // Month picker: the present month (the only editable one) + every earlier month with saved targets (view only).
    const present = editableMonths()[0];
    const months = [present, ...savedMonths.filter((x) => x < present)];
    const locked = Object.keys(saved).length > 0 || Object.keys(savedPeople).length > 0 || !!submission;
    if (!locked && month !== present)
      return NextResponse.json({ error: "No targets were saved for that month" }, { status: 404 });
    const source: Record<string, number> = locked
      ? savedPeople
      : await fetchPersonTargets(previousMonth(m), { fresh: true }).catch(() => ({}));
    const targets = Object.fromEntries(CENTERS.map((c) => [c.id, saved[c.id] ?? c.target]));
    // null = no value (not saved / nothing to copy from last month)
    const people = Object.fromEntries(rosterPeople().map((p) => [p.name, source[personKey(p.name)] ?? null]));
    return NextResponse.json({
      month, months, locked, editable: !locked && month === present, targets, people,
      hasPeople: Object.keys(savedPeople).length > 0,
      roster: rosterPeople(),
      submittedBy: submission?.submitted_by ?? null, submittedAt: submission?.submitted_at ?? null,
    });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Could not load targets" }, { status: 500 });
  }
}

/**
 * POST { month: "YYYY-MM", targets: { VV: 17500000, ... all 18 centers }, people: { "<roster name>": 1000000, ... everyone } }
 * Once, for the present month only. Each center's people must add up to exactly its center target.
 */
export async function POST(req: NextRequest) {
  const { denied, session } = await admin(req);
  if (denied) return denied;

  const body = (await req.json().catch(() => null)) as
    { month?: string; targets?: Record<string, unknown>; people?: Record<string, unknown> } | null;
  if (!body?.month || !MONTH.test(body.month) || !body.targets || typeof body.targets !== "object"
      || !body.people || typeof body.people !== "object")
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  if (!editableMonths().includes(body.month))
    return NextResponse.json({ error: "Targets can only be submitted for the present month" }, { status: 400 });

  const valid = (v: unknown) => {
    if (v === null || v === undefined || String(v).trim() === "") return null;
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 && n <= MAX ? Math.round(n) : null;
  };

  const clean = {} as Record<CenterId, number>;
  for (const c of CENTERS) {
    const n = valid(body.targets[c.id]);
    if (n === null) return NextResponse.json({ error: `Enter a valid target for ${c.name}` }, { status: 400 });
    clean[c.id] = n;
  }
  const people: Record<string, number> = {};
  for (const p of rosterPeople()) {
    const n = valid(body.people[p.name]);
    if (n === null) return NextResponse.json({ error: `Enter a valid target for ${p.name} (0 is allowed)` }, { status: 400 });
    people[p.name] = n;
  }
  const errs = planErrors(clean, people);
  if (errs.length) return NextResponse.json({ error: `People targets must add up to each center target. ${errs.join("; ")}` }, { status: 400 });

  try {
    await submitTargetsOnce(`${body.month}-01`, clean, people, session!.email);
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof TargetsLockedError)
      return NextResponse.json({ error: "Targets for this month were already submitted and are locked" }, { status: 409 });
    if (e instanceof SetupMissingError)
      return NextResponse.json({ error: "Target submissions are not set up in the database yet (sales_dash.target_submissions)." }, { status: 500 });
    if (e instanceof PeopleCheckError)
      return NextResponse.json({ error: "The database still only accepts people from sales_dash.sales_owners. Run the one-line SQL from the README (drop targets_sold_by_fkey) and submit again. Nothing was saved." }, { status: 500 });
    console.error(e);
    const msg = e instanceof Error && /permission denied/i.test(e.message)
      ? "The database login is not allowed to add targets yet (grant INSERT on sales_dash.targets)."
      : "Could not save targets";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
