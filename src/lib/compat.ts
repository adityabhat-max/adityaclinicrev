import type { CenterId } from "./centers";

/**
 * Sheet quirks that CHANGE the numbers. Per the business decision they are reproduced
 * by default so the dashboard matches the Google Sheet. Set SHEET_COMPAT=off (or pass
 * `FIXED` to the engine) to get the corrected logic.
 */
export interface Compat {
  /** Dashboad!E110 = SUM(E106:E109) also adds Ludhiana's total into Karkardooma's comparison. */
  karkardoomaComparisonIncludesLudhiana: boolean;
  /** Dashboad!E38 is blank: Bagu Bai Kokare's comparison-period sales are not counted. */
  comparisonExcludedOwners: string[];
  /** Comparison owner pivot filters out Gift card (current period and NSO rows include it). */
  comparisonOwnersExcludeGiftCard: boolean;
  /** No "No Sales Owner" formula in the comparison column for these centers. */
  comparisonNoNso: CenterId[];
  /** Chhatarpur has no comparison formula at all (shown blank / 0). */
  comparisonBlank: CenterId[];
  /** Dashboad!I96: M3M's No-Sales-Owner yesterday reads Mohali's figure. */
  yesterdayNsoBorrowed: Partial<Record<CenterId, CenterId>>;
  /** I88/I105/I109 look up a Sold By literally named "No Sales Owner" → always 0. */
  yesterdayNoNso: CenterId[];
  /** Daily Report hard-codes product sales to 0 for these centers. */
  productZero: CenterId[];
  /** 'No Sales Owner'!C:D copies only Pivot!S4:T16 → only the first 12 centers (A→Z) with NSO sales count. */
  nsoCurrentMaxCenters: number | null;
  /** VLOOKUP into 'Product Incentive'!A70:D85 → only the first 15 centers (A→Z) with product sales count. */
  productMaxCenters: number | null;
  /** Sale Dump "Check" = MATCH(Sold By, Dashboad!C:C): a blank Sold By matches an empty cell, so the row is
   *  neither an owner nor "No Sales Owner" and is dropped from every column except Product. */
  blankSellerDropped: boolean;
}

export const SHEET: Compat = {
  karkardoomaComparisonIncludesLudhiana: true,
  comparisonExcludedOwners: ["Bagu Bai Kokare (BSSN)"],
  comparisonOwnersExcludeGiftCard: true,
  comparisonNoNso: ["M3M", "GM", "LUH", "KKDM"],
  comparisonBlank: ["CTP"],
  yesterdayNsoBorrowed: { M3M: "MOH" },
  yesterdayNoNso: ["SEXT", "LUH", "KKDM"],
  productZero: ["SURAT", "CTP"],
  nsoCurrentMaxCenters: 12,
  productMaxCenters: 15,
  blankSellerDropped: true,
};

export const FIXED: Compat = {
  karkardoomaComparisonIncludesLudhiana: false,
  comparisonExcludedOwners: [],
  comparisonOwnersExcludeGiftCard: false,
  comparisonNoNso: [],
  comparisonBlank: [],
  yesterdayNsoBorrowed: {},
  yesterdayNoNso: [],
  productZero: [],
  nsoCurrentMaxCenters: null,
  productMaxCenters: null,
  blankSellerDropped: false,
};

export function compatFromEnv(): Compat {
  return process.env.SHEET_COMPAT === "off" ? FIXED : SHEET;
}
