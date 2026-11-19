import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/lib/auth";
import {
  activeSplitFor, addSplit, AlreadySplitError, cancelSplit, listSplits, lookupInvoice, SetupMissingError, type InvoiceLine,
} from "@/lib/db";
import { CENTERS, type CenterId } from "@/lib/centers";
import { splitWindowStart } from "@/lib/dates";
import { personKey, rosterPeople } from "@/lib/targets";
import { isSplittableType, SPLIT_SHARE } from "@/lib/report";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NOT_SET_UP = "Splits are not set up in the database yet (sales_dash.invoice_splits). Run the setup SQL from the README.";
const zen = (name: string) => CENTERS.find((c) => c.zenoti.toLowerCase() === name.toLowerCase());

/** A person's own clinic from the roster (null = not on the roster). */
const homeOf = (seller: string | null) => {
  const k = personKey(seller ?? "");
  return k ? rosterPeople().find((p) => personKey(p.name) === k)?.center ?? null : null;
};

/**
 * What a split of this invoice would look like — or why it can't be split.
 * Split = the lines (packages, services, pre-paid cards, gift cards — not products) sold by a person from ANOTHER
 * clinic than the one that billed the invoice. Half stays with that seller, half goes to a person at the billing clinic.
 */
async function inspect(invoiceNo: string) {
  const lines = await lookupInvoice(invoiceNo);
  if (!lines.length) return { error: `Invoice ${invoiceNo} was not found in the Zenoti data.` };
  const centers = [...new Set(lines.map((l) => l.center_name))];
  const center = zen(centers[0]);
  const first = lines.map((l) => l.sale_date).sort()[0];
  const splitLine = (l: InvoiceLine) => {
    const h = homeOf(l.sold_by);
    return !l.internal && isSplittableType(l.item_type) && !!h && h !== center?.id;
  };
  const splitLines = lines.filter(splitLine);
  const total = splitLines.reduce((s, l) => s + l.collected, 0);
  const sellers = [...new Set(splitLines.map((l) => l.sold_by!.trim()))];
  const info = {
    invoiceNo: invoiceNo.toUpperCase(), centerName: centers[0], centerId: center?.id ?? null,
    client: lines.find((l) => l.guest_name)?.guest_name ?? null,
    sellers: sellers.map((n) => ({ name: n, center: homeOf(n)! })),
    total, half: total * SPLIT_SHARE, firstPayment: first,
    lines: lines.map((l) => ({ ...l, split: splitLine(l) })),
  };
  const ownSellers = [...new Set(lines.filter((l) => !l.internal && isSplittableType(l.item_type) && l.sold_by?.trim())
    .map((l) => l.sold_by!.trim()))];
  const windowStart = splitWindowStart();
  let problem: string | null = null;
  if (centers.length > 1) problem = "This invoice has payments at more than one branch, so it can't be split here.";
  else if (!center) problem = `The invoice branch (${centers[0]}) is not one of the dashboard's centers.`;
  else if (first < windowStart) problem = `This invoice was paid on ${first}. Only invoices paid on or after ${windowStart} (this month or last month) can be split.`;
  else if (!splitLines.length) problem = ownSellers.length
    ? `Not a cross-branch invoice — the seller (${ownSellers.join(", ")}) is not from another clinic's sales team, so there is nothing to split.`
    : "This invoice has no package, service, pre-paid card or gift card sold by a person from another clinic (products are not split).";
  else if (sellers.length > 1) problem = `This invoice has more than one seller from other clinics (${sellers.join(", ")}), so it can't be split here.`;
  else if (total === 0) problem = "This invoice has no amount to split.";
  else {
    const existing = await activeSplitFor(info.invoiceNo).catch(() => null);
    if (existing) problem = `This invoice is already split with ${existing.to_person} (${existing.to_center_name}), added by ${existing.created_by}.`;
  }
  return { info, problem };
}

/** GET → the split log (any logged-in user). */
export async function GET(req: NextRequest) {
  const s = await verifySession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!s) return NextResponse.json({ error: "Not logged in" }, { status: 401 });
  try {
    const splits = await listSplits();
    return NextResponse.json({ setup: splits !== null, splits: splits ?? [], windowStart: splitWindowStart(), canEdit: s.role === "admin" });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Could not load splits" }, { status: 500 });
  }
}

/**
 * POST (admin only)
 *   { action: "lookup", invoiceNo }
 *   { action: "add", invoiceNo, toPerson, note? }   (toPerson = a person at the billing clinic)
 *   { action: "cancel", id, reason }
 */
export async function POST(req: NextRequest) {
  const s = await verifySession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!s) return NextResponse.json({ error: "Not logged in" }, { status: 401 });
  if (s.role !== "admin") return NextResponse.json({ error: "Only the admin can add or cancel splits" }, { status: 403 });

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const action = body?.action;
  try {
    if (action === "lookup" || action === "add") {
      const invoiceNo = String(body?.invoiceNo ?? "").trim();
      if (!/^[A-Za-z0-9\-_/]{3,40}$/.test(invoiceNo)) return NextResponse.json({ error: "Enter a valid invoice number" }, { status: 400 });
      const { info, problem, error } = await inspect(invoiceNo);
      if (error) return NextResponse.json({ error }, { status: 404 });
      if (action === "lookup") return NextResponse.json({ info, problem });
      if (problem) return NextResponse.json({ error: problem }, { status: 400 });

      // the other half always goes to a person at the clinic that billed the invoice
      const toCenter = info!.centerId as CenterId;
      const toPerson = String(body?.toPerson ?? "");
      if (!rosterPeople().some((p) => p.center === toCenter && p.name === toPerson))
        return NextResponse.json({ error: "Choose a sales person from the clinic that billed the invoice" }, { status: 400 });
      const note = String(body?.note ?? "").trim().slice(0, 300) || null;

      await addSplit({
        invoice_no: info!.invoiceNo, client_name: info!.client, from_center: info!.centerName,
        from_seller: info!.sellers.map((x) => x.name).join(", ") || null, to_center: toCenter, to_person: toPerson,
        invoice_total: info!.total, note,
      }, s.email);
      return NextResponse.json({ ok: true });
    }

    if (action === "cancel") {
      const id = Number(body?.id);
      const reason = String(body?.reason ?? "").trim().slice(0, 300);
      if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "Invalid split" }, { status: 400 });
      if (!reason) return NextResponse.json({ error: "Enter a reason for cancelling" }, { status: 400 });
      const split = (await listSplits())?.find((x) => x.id === id);
      if (!split || split.cancelled_at) return NextResponse.json({ error: "This split is not active" }, { status: 409 });
      const lines = await lookupInvoice(split.invoice_no);
      const first = lines.map((l) => l.sale_date).sort()[0];
      if (first && first < splitWindowStart())
        return NextResponse.json({ error: "This split is older than last month and can no longer be cancelled here." }, { status: 400 });
      const ok = await cancelSplit(id, s.email, reason);
      return ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "This split is not active" }, { status: 409 });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (e) {
    if (e instanceof AlreadySplitError) return NextResponse.json({ error: "This invoice is already split" }, { status: 409 });
    if (e instanceof SetupMissingError) return NextResponse.json({ error: NOT_SET_UP }, { status: 500 });
    console.error(e);
    const msg = e instanceof Error && /permission denied/i.test(e.message)
      ? "The database login is not allowed to record splits yet (run the grants from the README)." : "Something went wrong";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
