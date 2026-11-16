/**
 * Centers in the exact order of the "Daily Report" tab.
 * `zenoti` is the Center Name as it appears in Zenoti / sales_dash.collections.center_name.
 * `target` is the Daily Report "Target" column (the official monthly targets).
 */
export type CenterId =
  | "VV" | "GK" | "MUM" | "DLF" | "KM" | "ND" | "BLR" | "PPB" | "MOH"
  | "SURAT" | "HYD" | "BSSN" | "SEXT" | "M3M" | "GM" | "LUH" | "KKDM" | "CTP";

export interface Center {
  id: CenterId;
  name: string;   // display name on the report
  zenoti: string; // Zenoti center_name
  target: number; // monthly target (INR)
}

export const CENTERS: Center[] = [
  { id: "VV",    name: "Vasant Vihar",               zenoti: "Vasant Vihar, New Delhi",    target: 17_500_000 },
  { id: "GK",    name: "Greater Kailash",            zenoti: "Greater Kailash, New Delhi", target: 14_500_000 },
  { id: "MUM",   name: "Santacruz, Mumbai",          zenoti: "Santacruz, Mumbai",          target: 7_500_000 },
  { id: "DLF",   name: "Gurgaon - (DLF)",            zenoti: "Gurgaon - (DLF)",            target: 6_800_000 },
  { id: "KM",    name: "Khan Market",                zenoti: "Khan Market, New Delhi",     target: 4_700_000 },
  { id: "ND",    name: "Noida",                      zenoti: "Noida",                      target: 4_500_000 },
  { id: "BLR",   name: "Bangalore",                  zenoti: "Bangalore",                  target: 4_500_000 },
  { id: "PPB",   name: "Punjabi Bagh",               zenoti: "Punjabi Bagh, New Delhi",    target: 3_200_000 },
  { id: "MOH",   name: "Mohali",                     zenoti: "Mohali, Punjab",             target: 2_100_000 },
  { id: "SURAT", name: "Surat",                      zenoti: "Surat",                      target: 1_800_000 },
  { id: "HYD",   name: "Hyderabad",                  zenoti: "Hyderabad",                  target: 1_500_000 },
  { id: "BSSN",  name: "Bangalore (Sadashiva)",      zenoti: "Bangalore (Sadashiva)",      target: 1_800_000 },
  { id: "SEXT",  name: "South Extension, New Delhi", zenoti: "South Extension, New Delhi", target: 1_100_000 },
  { id: "M3M",   name: "Gurgaon - (M3M)",            zenoti: "Gurgaon -(M3M)",             target: 2_100_000 },
  { id: "GM",    name: "Gurgaon -(Galleria)",        zenoti: "Gurgaon -(Galleria)",        target: 1_900_000 },
  { id: "LUH",   name: "Ludhiana, Punjab",           zenoti: "Ludhiana, Punjab",           target: 1_000_000 },
  { id: "KKDM",  name: "Karkardooma",                zenoti: "Karkardooma,New Delhi",      target: 2_100_000 },
  { id: "CTP",   name: "Chhatarpur",                 zenoti: "Chhatarpur,New Delhi",       target: 1_100_000 },
];

export const CENTER_BY_ID = Object.fromEntries(CENTERS.map((c) => [c.id, c])) as Record<CenterId, Center>;
