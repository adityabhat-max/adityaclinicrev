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
}

export interface Figures { current: number; comparison: number | null; yesterday: number; product: number }

export interface OwnerLine extends Figures { name: string; center: CenterId }

export interface CenterLine extends Figures {
  id: CenterId; sno: number; name: string; target: number;
  achievedPct: number | null; difference: number; target80: number; deficit80: number;
  owners: OwnerLine[]; noSalesOwner: Figures;
}

export interface Report { centers: CenterLine[]; total: Omit<CenterLine, "id" | "sno" | "name" | "owners" | "noSalesOwner"> }

const key = (s: string | null | undefined) => (s ?? "").toLowerCase(); // SUMIFS/MATCH are case-insensitive
const CURRENT_TYPES = new Set(["package", "pre-paid card", "service", "gift card"]);
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

  const sum = (xs: Figures[], k: keyof Figures) => xs.reduce((s, x) => s + (x[k] ?? 0), 0);
  const comparisonOf = (id: CenterId): number | null => {
    if (compat.comparisonBlank.includes(id)) return null;
    const r = raw.get(id)!;
    let v = sum(r.owners, "comparison") + (r.nso.comparison ?? 0);
    if (id === "KKDM" && compat.karkardoomaComparisonIncludesLudhiana) v += comparisonOf("LUH") ?? 0;
    return v;
  };

  const lines: CenterLine[] = CENTERS.map((c, i) => {
    const r = raw.get(c.id)!;
    const current = sum(r.owners, "current") + r.nso.current;
    const comparison = comparisonOf(c.id);
    const target = input.targets?.[c.id] ?? c.target;
    return {
      id: c.id, sno: i + 1, name: c.name, target,
      current, comparison,
      yesterday: sum(r.owners, "yesterday") + r.nso.yesterday,
      product: r.product,
      achievedPct: target ? current / target : null,
      difference: current - (comparison ?? 0),
      target80: target * 0.8,
      deficit80: target * 0.8 - current,
      owners: r.owners, noSalesOwner: r.nso,
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
