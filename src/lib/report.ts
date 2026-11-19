import { CENTERS, type CenterId } from "./centers";
import { ROSTER } from "./roster";
import { SHEET, type Compat } from "./compat";
import { inRange, type ISODate, type Range } from "./dates";

/** One row of sales_dash.collections (= one row of the sheet's "Sale Dump"). */
export interface SaleRow {
  item_type: string;
  sale_date: ISODate;   // payment date
  center_name: string;  // Zenoti center name
  sold_by: string | null;
  collected: number;
  payment_type?: string | null;
  /** Set when rows are pre-grouped in SQL: true = internal adjustment (see below). */
  internal?: boolean;
  /** Set when rows are pre-grouped in SQL: how many underlying rows had a non-zero amount. */
  nonzero?: number;
}

/**
 * Internal adjustments are not new money and are absent from the sheet's Zenoti export:
 * a package refunded into a pre-paid card ("Custom - Refund - Internal": a minus line on the
 * original seller + a plus pre-paid line with no seller) and package transfers between guests.
 * The whole row is skipped, even when it also carries another payment method.
 * The same pattern is used in SQL (case-insensitive) when rows are grouped in the database.
 */
export const INTERNAL_PATTERN = "custom - refund - internal|custom - package transfer";
const INTERNAL_RE = new RegExp(INTERNAL_PATTERN, "i");
export const isInternalAdjustment = (paymentType: string | null | undefined) => INTERNAL_RE.test(paymentType ?? "");

export interface ReportInput {
  rows: SaleRow[];
  current: Range;
  comparison: Range;
  yesterday: ISODate;
  compat?: Compat;
  roster?: Record<CenterId, string[]>;
  /** Limit to these centers (totals recompute). */
  centers?: CenterId[];
  /** Limit to these sales owners (only their own sales; No-Sales-Owner excluded). */
  owners?: string[];
  /** Targets saved for the month; centers missing here use the Daily Report default. */
  targets?: Partial<Record<CenterId, number>>;
  /** Cross-branch 50/50 splits (payment lines of split invoices). Empty/absent = report exactly as before. */
  splits?: SplitLine[];
}

/**
 * One payment line of an invoice that was split 50/50. The client was billed at `to_center`, but the seller
 * (the client's primary employee) is on another clinic's roster, so the line is credited to the seller's clinic.
 * Half of it is taken from the seller and given to `to_person` at `to_center` (the billing clinic).
 * Products, internal lines and lines sold by someone from `to_center` itself are not split.
 */
export interface SplitLine extends SaleRow {
  split_id: number;
  to_center: CenterId;
  to_person: string;
}

/** The share of a split invoice that goes to the person at the billing clinic. */
export const SPLIT_SHARE = 0.5;

export interface Figures { current: number; comparison: number | null; yesterday: number; product: number }

export interface OwnerLine extends Figures { name: string; center: CenterId }

export interface CenterLine extends Figures {
  id: CenterId; sno: number; name: string; target: number;
  achievedPct: number | null; difference: number; target80: number; deficit80: number;
  owners: OwnerLine[]; noSalesOwner: Figures;
  /** Cross-branch split amounts not tied to a rostered person (all zero when there are no splits). */
  splitAdjustment: Figures;
}

export interface Report { centers: CenterLine[]; total: Omit<CenterLine, "id" | "sno" | "name" | "owners" | "noSalesOwner" | "splitAdjustment"> }

const key = (s: string | null | undefined) => (s ?? "").toLowerCase(); // SUMIFS/MATCH are case-insensitive
const CURRENT_TYPES = new Set(["package", "pre-paid card", "service", "gift card"]);
/** Item types a cross-branch split applies to (products are never split). */
export const isSplittableType = (itemType: string | null | undefined) => CURRENT_TYPES.has(key(itemType));
const PRODUCT = "product";
const sortAZ = (a: string, b: string) => a.localeCompare(b, "en", { sensitivity: "base" });

export function buildReport(input: ReportInput): Report {
  const compat = input.compat ?? SHEET;
  const roster = input.roster ?? ROSTER;
  const ownerFilter = input.owners?.length ? new Set(input.owners.map(key)) : null;

  const ownerCenter = new Map<string, CenterId>();
  for (const [cid, names] of Object.entries(roster) as [CenterId, string[]][])
    for (const n of names) if (!ownerCenter.has(key(n))) ownerCenter.set(key(n), cid);

  const cmpOwnerTypes = new Set(CURRENT_TYPES);
  if (compat.comparisonOwnersExcludeGiftCard) cmpOwnerTypes.delete("gift card");

  // ---- accumulate ----
  const z = (): Figures => ({ current: 0, comparison: 0, yesterday: 0, product: 0 });
  const byOwner = new Map<string, Figures>();          // key(name) → figures
  const nso = new Map<string, Figures>();              // key(zenoti center) → figures
  const productByCenter = new Map<string, number>();   // key(zenoti center) → product (all sellers)
  const productByOwner = new Map<string, number>();
  const nsoCurrentCenters = new Map<string, string>(); // key → display spelling (for A→Z truncation)
  const productCenters = new Map<string, string>();

  for (const r of input.rows) {
    if (r.internal ?? isInternalAdjustment(r.payment_type)) continue;
    const type = key(r.item_type);
    const amt = Number(r.collected) || 0;
    // A row "has a value" if any underlying sale line was non-zero (zero lines don't create a pivot row in the sheet).
    const hasValue = (r.nonzero ?? (amt !== 0 ? 1 : 0)) > 0;
    const isCur = inRange(r.sale_date, input.current);
    const isCmp = inRange(r.sale_date, input.comparison);
    const isY = r.sale_date === input.yesterday;
    const owner = key(r.sold_by);
    const isOwner = ownerCenter.has(owner);
    const ck = key(r.center_name);

    if (type === PRODUCT) {
      if (isCur) {
        productByCenter.set(ck, (productByCenter.get(ck) ?? 0) + amt);
        if (hasValue) productCenters.set(ck, r.center_name);
        if (isOwner) productByOwner.set(owner, (productByOwner.get(owner) ?? 0) + amt);
      }
      continue;
    }
    if (!CURRENT_TYPES.has(type)) continue;
    if (!isOwner && owner.trim() === "" && compat.blankSellerDropped) continue;

    const f = isOwner ? (byOwner.get(owner) ?? byOwner.set(owner, z()).get(owner)!)
                      : (nso.get(ck) ?? nso.set(ck, z()).get(ck)!);
    if (isCur) f.current += amt;
    if (isY) f.yesterday += amt;
    if (isCmp && (!isOwner || cmpOwnerTypes.has(type))) f.comparison! += amt;
    // zero-value rows (e.g. package redemptions) don't create a pivot row in the sheet
    if (!isOwner && isCur && hasValue) nsoCurrentCenters.set(ck, r.center_name);
  }

  const firstN = (m: Map<string, string>, n: number | null) =>
    n == null ? null : new Set([...m.entries()].sort((a, b) => sortAZ(a[1], b[1])).slice(0, n).map(([k]) => k));
  const nsoAllowed = firstN(nsoCurrentCenters, compat.nsoCurrentMaxCenters);
  const productAllowed = firstN(productCenters, compat.productMaxCenters);
  const excludedCmp = new Set(compat.comparisonExcludedOwners.map(key));

  // ---- per center ----
  const raw = new Map<CenterId, { owners: OwnerLine[]; nso: Figures; product: number }>();
  for (const c of CENTERS) {
    const owners: OwnerLine[] = (roster[c.id] ?? [])
      .filter((n) => ownerCenter.get(key(n)) === c.id && (!ownerFilter || ownerFilter.has(key(n))))
      .map((name) => {
        const f = byOwner.get(key(name)) ?? z();
        return {
          name, center: c.id, current: f.current, yesterday: f.yesterday,
          comparison: excludedCmp.has(key(name)) ? 0 : f.comparison,
          product: productByOwner.get(key(name)) ?? 0,
        };
      });

    const ck = key(c.zenoti);
    const n = nso.get(ck) ?? z();
    const yFrom = compat.yesterdayNsoBorrowed[c.id];
    const nsoLine: Figures = ownerFilter ? z() : {
      current: !nsoAllowed || nsoAllowed.has(ck) ? n.current : 0,
      comparison: compat.comparisonNoNso.includes(c.id) ? 0 : n.comparison,
      yesterday: compat.yesterdayNoNso.includes(c.id) ? 0
        : yFrom ? (nso.get(key(CENTERS.find((x) => x.id === yFrom)!.zenoti))?.yesterday ?? 0) : n.yesterday,
      product: 0,
    };

    const product = ownerFilter
      ? owners.reduce((s, o) => s + o.product, 0)
      : compat.productZero.includes(c.id) || (productAllowed && !productAllowed.has(ck)) ? 0
      : productByCenter.get(ck) ?? 0;

    raw.set(c.id, { owners, nso: nsoLine, product });
  }

  // ---- cross-branch 50/50 splits ----
  // Applied AFTER everything above, as plain ± amounts (the sheet's quirks don't touch them).
  // With no splits every delta is 0, so all figures stay exactly as before.
  const split = new Map<CenterId, Figures>(CENTERS.map((c) => [c.id, z()]));   // not tied to a rostered person
  const ownerDelta = new Map<string, Figures>();                                // key(person) → ±
  const addTo = (f: Figures, d: Figures, sign: 1 | -1) => {
    f.current += sign * d.current; f.yesterday += sign * d.yesterday; f.product += sign * d.product;
    f.comparison = (f.comparison ?? 0) + sign * (d.comparison ?? 0);
  };
  for (const s of input.splits ?? []) {
    if (s.internal ?? isInternalAdjustment(s.payment_type)) continue;
    const type = key(s.item_type);
    if (!CURRENT_TYPES.has(type)) continue; // products are never split
    const seller = key(s.sold_by);
    const sellerHome = ownerCenter.get(seller);
    // only lines sold by a rostered person from ANOTHER clinic than the billing clinic are split
    if (!sellerHome || sellerHome === s.to_center) continue;
    const half = (Number(s.collected) || 0) * SPLIT_SHARE;
    if (!half) continue;
    const to = key(s.to_person);
    const d = z();
    if (inRange(s.sale_date, input.current)) d.current = half;
    // comparison follows the same rules as the people's own comparison figures
    if (inRange(s.sale_date, input.comparison) && cmpOwnerTypes.has(type) && !excludedCmp.has(seller) && !excludedCmp.has(to))
      d.comparison = half;
    if (s.sale_date === input.yesterday) d.yesterday = half;
    if (!d.current && !d.comparison && !d.yesterday) continue;

    // take half from the seller (credited at their own clinic) …
    addTo(ownerDelta.get(seller) ?? ownerDelta.set(seller, z()).get(seller)!, d, -1);
    // … and give it to the chosen person at the clinic that billed the invoice
    if (ownerCenter.get(to) === s.to_center) addTo(ownerDelta.get(to) ?? ownerDelta.set(to, z()).get(to)!, d, 1);
    else addTo(split.get(s.to_center)!, d, 1);
  }
  if (ownerDelta.size || [...split.values()].some((f) => f.current || f.comparison || f.yesterday || f.product)) {
    for (const c of CENTERS) {
      const r = raw.get(c.id)!;
      let productDelta = 0;
      r.owners = r.owners.map((o) => {
        const d = ownerDelta.get(key(o.name));
        if (!d) return o;
        productDelta += d.product;
        return { ...o, current: o.current + d.current, yesterday: o.yesterday + d.yesterday,
          product: o.product + d.product, comparison: (o.comparison ?? 0) + (d.comparison ?? 0) };
      });
      const sa = split.get(c.id)!;
      if (ownerFilter) {
        // a sales-owner filter shows only those people's own lines (same formula as above, on the adjusted rows)
        split.set(c.id, z());
        r.product = r.owners.reduce((s, o) => s + o.product, 0);
      } else r.product += productDelta + sa.product;
    }
  }

  const sum = (xs: Figures[], k: keyof Figures) => xs.reduce((s, x) => s + (x[k] ?? 0), 0);
  const comparisonOf = (id: CenterId): number | null => {
    if (compat.comparisonBlank.includes(id)) return null;
    const r = raw.get(id)!;
    let v = sum(r.owners, "comparison") + (r.nso.comparison ?? 0) + (split.get(id)!.comparison ?? 0);
    if (id === "KKDM" && compat.karkardoomaComparisonIncludesLudhiana) v += comparisonOf("LUH") ?? 0;
    return v;
  };

  const lines: CenterLine[] = CENTERS.map((c, i) => {
    const r = raw.get(c.id)!;
    const sa = split.get(c.id)!;
    const current = sum(r.owners, "current") + r.nso.current + sa.current;
    const comparison = comparisonOf(c.id);
    const target = input.targets?.[c.id] ?? c.target;
    return {
      id: c.id, sno: i + 1, name: c.name, target,
      current, comparison,
      yesterday: sum(r.owners, "yesterday") + r.nso.yesterday + sa.yesterday,
      product: r.product,
      achievedPct: target ? current / target : null,
      difference: current - (comparison ?? 0),
      target80: target * 0.8,
      deficit80: target * 0.8 - current,
      owners: r.owners, noSalesOwner: r.nso, splitAdjustment: sa,
    };
  });

  const shown = input.centers?.length ? lines.filter((l) => input.centers!.includes(l.id)) : lines;
  const t = (k: "current" | "yesterday" | "product" | "target" | "difference" | "target80" | "deficit80") =>
    shown.reduce((s, l) => s + l[k], 0);
  const target = t("target");
  return {
    centers: shown,
    total: {
      target, current: t("current"), yesterday: t("yesterday"), product: t("product"),
      comparison: shown.reduce((s, l) => s + (l.comparison ?? 0), 0),
      achievedPct: target ? t("current") / target : null,
      difference: t("difference"), target80: t("target80"), deficit80: t("deficit80"),
    },
  };
}
