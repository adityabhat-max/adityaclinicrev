import { describe, expect, it } from "vitest";
import { buildReport, type SaleRow, type SplitLine } from "./report";
import { FIXED, SHEET } from "./compat";
import { defaultPeriods, yesterdayFor, mergeRanges, editableMonths } from "./dates";

const NOV = { from: "2026-11-01", to: "2026-11-16" };
const OCT = { from: "2026-10-01", to: "2026-10-16" };
const Y = "2026-11-15";
const row = (p: Partial<SaleRow>): SaleRow =>
  ({ item_type: "Service", sale_date: "2026-11-05", center_name: "Noida", sold_by: null, collected: 0, ...p });
const run = (rows: SaleRow[], compat = SHEET) =>
  buildReport({ rows, current: NOV, comparison: OCT, yesterday: Y, compat });
const line = (r: ReturnType<typeof run>, id: string) => r.centers.find((c) => c.id === id)!;

describe("dates", () => {
  it("defaults to 1st→today vs 1st→same day last month", () => {
    expect(defaultPeriods("2026-11-16")).toEqual({ current: NOV, comparison: OCT });
  });
  it("clamps to the end of a shorter previous month", () => {
    expect(defaultPeriods("2026-03-31").comparison).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(defaultPeriods("2026-01-10").comparison).toEqual({ from: "2025-12-01", to: "2025-12-10" });
  });
  it("yesterday = today-1, or the range end when the range is in the past", () => {
    expect(yesterdayFor("2026-11-16", "2026-11-16")).toBe("2026-11-15");
    expect(yesterdayFor("2026-10-31", "2026-11-16")).toBe("2026-10-31");
  });
  it("admin can submit targets for the present month only", () => {
    expect(editableMonths("2026-11-17")).toEqual(["2026-11"]);
    expect(editableMonths("2026-12-31")).toEqual(["2026-12"]);
  });
  it("merges overlapping ranges", () => {
    expect(mergeRanges([NOV, OCT, { from: "2026-11-15", to: "2026-11-15" }])).toEqual([OCT, NOV]);
  });
});

describe("attribution", () => {
  it("credits rostered owners to their roster center, wherever the invoice was raised", () => {
    const r = run([row({ sold_by: "priyanka a - (blr)", center_name: "Bangalore (Sadashiva)", collected: 100 })]);
    expect(line(r, "BLR").current).toBe(100);
    expect(line(r, "BSSN").current).toBe(0);
  });
  it("credits unknown sellers (No Sales Owner) to the invoice center", () => {
    const r = run([row({ sold_by: "Someone New", center_name: "Noida", collected: 50 })]);
    expect(line(r, "ND").current).toBe(50);
  });
  it("keeps products out of achieved and in the product column", () => {
    const r = run([row({ item_type: "Product", center_name: "Noida", collected: 70 })]);
    expect(line(r, "ND").current).toBe(0);
    expect(line(r, "ND").product).toBe(70);
  });
  it("computes %, difference, 80% and deficit", () => {
    const r = run([row({ sold_by: "Nidhi Soni (ND)", collected: 450_000 }),
                   row({ sold_by: "Nidhi Soni (ND)", sale_date: "2026-10-03", collected: 100_000 })]);
    const nd = line(r, "ND");
    expect(nd.achievedPct).toBeCloseTo(0.1);
    expect(nd.difference).toBe(350_000);
    expect(nd.deficit80).toBe(4_500_000 * 0.8 - 450_000);
  });
});

describe("sheet quirks (reproduced by default, fixed with FIXED)", () => {
  const oct = (p: Partial<SaleRow>) => row({ sale_date: "2026-10-05", ...p });

  it("Karkardooma comparison includes Ludhiana", () => {
    const rows = [oct({ sold_by: "Neetu Singh (LUH)", collected: 93_000 }),
                  oct({ sold_by: "Durgesh Choudhary - (KKDM)", collected: 32_300 })];
    expect(line(run(rows), "KKDM").comparison).toBe(125_300);
    expect(line(run(rows, FIXED), "KKDM").comparison).toBe(32_300);
  });
  it("Bagu Bai's comparison sales are dropped", () => {
    const rows = [oct({ sold_by: "Bagu Bai Kokare (BSSN)", collected: 10 })];
    expect(line(run(rows), "BSSN").comparison).toBe(0);
    expect(line(run(rows, FIXED), "BSSN").comparison).toBe(10);
  });
  it("comparison excludes Gift card for owners but not for No Sales Owner", () => {
    const rows = [oct({ item_type: "Gift card", sold_by: "Nidhi Soni (ND)", collected: 5 }),
                  oct({ item_type: "Gift card", sold_by: "x", center_name: "Noida", collected: 7 })];
    expect(line(run(rows), "ND").comparison).toBe(7);
    expect(line(run(rows, FIXED), "ND").comparison).toBe(12);
  });
  it("Chhatarpur comparison is blank", () => {
    expect(line(run([]), "CTP").comparison).toBeNull();
  });
  it("M3M yesterday uses Mohali's No-Sales-Owner figure", () => {
    const rows = [row({ sale_date: Y, center_name: "Mohali, Punjab", sold_by: "x", collected: 9 }),
                  row({ sale_date: Y, center_name: "Gurgaon -(M3M)", sold_by: "x", collected: 4 })];
    expect(line(run(rows), "M3M").yesterday).toBe(9);
    expect(line(run(rows), "MOH").yesterday).toBe(9);
    expect(line(run(rows, FIXED), "M3M").yesterday).toBe(4);
  });
  it("only the first 12 centers (A→Z) get No-Sales-Owner current sales", () => {
    const names = ["Bangalore", "Bangalore (Sadashiva)", "Chhatarpur,New Delhi", "Greater Kailash, New Delhi",
      "Gurgaon - (DLF)", "Gurgaon -(Galleria)", "Gurgaon -(M3M)", "Hyderabad", "Karkardooma,New Delhi",
      "Khan Market, New Delhi", "Ludhiana, Punjab", "Mohali, Punjab", "Noida"];
    const rows = names.map((n) => row({ center_name: n, sold_by: "x", collected: 1 }));
    expect(line(run(rows), "MOH").current).toBe(1);   // 12th
    expect(line(run(rows), "ND").current).toBe(0);    // 13th — dropped like the sheet
    expect(line(run(rows, FIXED), "ND").current).toBe(1);
  });
});

describe("data rules matching the sheet's Zenoti export", () => {
  it("skips internal refunds and package transfers (whole row)", () => {
    const rows = [
      row({ sold_by: "Mansi Gupta - (DLF)", item_type: "Package", collected: -100_000, payment_type: "Custom - Refund - Internal" }),
      row({ sold_by: null, item_type: "Pre-paid card", center_name: "Gurgaon - (DLF)", collected: 100_000, payment_type: "Custom - Refund - Internal" }),
      row({ sold_by: "Vanita Pasbola - (VV)", item_type: "Package", collected: 190_000, payment_type: "Cash, Custom - Package Transfer" }),
      row({ sold_by: "Mansi Gupta - (DLF)", item_type: "Package", collected: 5_000, payment_type: "Card" }),
    ];
    expect(line(run(rows), "DLF").current).toBe(5_000);
    expect(line(run(rows), "VV").current).toBe(0);
  });
  it("drops blank-seller rows (sheet) but counts them as No Sales Owner when fixed", () => {
    const rows = [row({ sold_by: null, center_name: "Noida", collected: 40 })];
    expect(line(run(rows), "ND").current).toBe(0);
    expect(line(run(rows, FIXED), "ND").current).toBe(40);
  });
  it("zero-value No-Sales-Owner rows don't take one of the 12 slots", () => {
    const names = ["Bangalore", "Bangalore (Sadashiva)", "Chhatarpur,New Delhi", "Greater Kailash, New Delhi",
      "Gurgaon - (DLF)", "Gurgaon -(Galleria)", "Gurgaon -(M3M)", "Hyderabad", "Karkardooma,New Delhi",
      "Khan Market, New Delhi", "Ludhiana, Punjab", "Mohali, Punjab"];
    const rows = [...names.map((n) => row({ center_name: n, sold_by: "x", collected: 0 })),
                  row({ center_name: "Noida", sold_by: "x", collected: 9 })];
    expect(line(run(rows), "ND").current).toBe(9);
  });
});

describe("filters", () => {
  it("owner filter shows only that owner's sales", () => {
    const rows = [row({ sold_by: "Nidhi Soni (ND)", collected: 10 }), row({ sold_by: "x", collected: 99 })];
    const r = buildReport({ rows, current: NOV, comparison: OCT, yesterday: Y, owners: ["Nidhi Soni (ND)"] });
    expect(line(r, "ND").current).toBe(10);
  });
  it("center filter limits rows and totals", () => {
    const r = buildReport({ rows: [row({ sold_by: "x", collected: 5 })], current: NOV, comparison: OCT,
      yesterday: Y, centers: ["ND"] });
    expect(r.centers).toHaveLength(1);
    expect(r.total.target).toBe(4_500_000);
  });
});

describe("cross-branch 50/50 splits", () => {
  // Invoice at Vasant Vihar sold by a VV person; the client's home branch is Khan Market.
  const sale = row({ sold_by: "Vanita Pasbola - (VV)", center_name: "Vasant Vihar, New Delhi", collected: 100_000 });
  const split = (p: Partial<SplitLine> = {}): SplitLine =>
    ({ ...sale, split_id: 1, to_center: "KM", to_person: "Meena Sharma - (KM)", ...p });
  const runS = (rows: SaleRow[], splits: SplitLine[], extra = {}) =>
    buildReport({ rows, current: NOV, comparison: OCT, yesterday: Y, compat: SHEET, splits, ...extra });

  it("changes nothing when there are no splits", () => {
    expect(JSON.stringify(runS([sale], []))).toBe(JSON.stringify(run([sale])));
  });
  it("moves exactly half from the seller to the home-branch person; grand total unchanged", () => {
    const r = runS([sale], [split()]);
    expect(line(r, "VV").current).toBe(50_000);
    expect(line(r, "KM").current).toBe(50_000);
    expect(line(r, "VV").owners.find((o) => o.name.startsWith("Vanita"))!.current).toBe(50_000);
    expect(line(r, "KM").owners.find((o) => o.name.startsWith("Meena"))!.current).toBe(50_000);
    expect(r.total.current).toBe(run([sale]).total.current);
  });
  it("splits each payment on its own date (a last-month part payment lands in comparison)", () => {
    const old = { ...sale, sale_date: "2026-10-05", collected: 40_000 };
    const r = runS([sale, old], [split(), split({ sale_date: "2026-10-05", collected: 40_000 })]);
    expect(line(r, "KM").comparison).toBe(20_000);
    expect(line(r, "VV").comparison).toBe(20_000);
  });
  it("splits products too", () => {
    const p = { ...sale, item_type: "Product", collected: 2_000 };
    const r = runS([p], [split({ item_type: "Product", collected: 2_000 })]);
    expect(line(r, "KM").product).toBe(1_000);
    expect(line(r, "VV").product).toBe(1_000);
  });
  it("ignores internal refund/transfer lines", () => {
    const r = runS([sale], [split({ payment_type: "Custom - Refund - Internal", collected: -50_000 })]);
    expect(JSON.stringify(r)).toBe(JSON.stringify(runS([sale], [])));
  });
  it("takes the half off the branch when the seller isn't on the roster", () => {
    const walkIn = row({ sold_by: "Someone New", center_name: "Vasant Vihar, New Delhi", collected: 10_000 });
    const r = runS([walkIn], [split({ sold_by: "Someone New", collected: 10_000 })]);
    expect(line(r, "VV").splitAdjustment.current).toBe(-5_000);
    expect(line(r, "KM").current).toBe(5_000);
  });
});
