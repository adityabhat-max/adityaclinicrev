import type { CenterId } from "./centers";

/**
 * Sales-owner roster, copied verbatim from the sheet's `Dashboad!B:C` column.
 * Names must match Zenoti "Sold By" exactly (matching is case-insensitive, like SUMIFS/MATCH).
 * Anyone NOT on this list is "No Sales Owner" and is credited to the invoice's center instead.
 * A rostered person's sales are credited to their roster center, wherever the invoice was raised.
 *
 * TODO: role (sales manager / executive) per person — waiting on the roles Excel.
 */
export const ROSTER: Record<CenterId, string[]> = {
  BLR:   ["Priyanka A - (BLR)", "Kaniksha N - (BLR)", "Safeen Malik - (BLR)", "Vasudha Devraj", "Ashwini G"],
  GK:    ["Dipanshi Arora - (GK)", "Sakshi Chhabra - (GK)", "Priyanka Sharma", "Gudiya - (GK)", "Tanya Gambhir - (GK)",
          "Sangeeta Sales Manager - (GK)", "Amrita Yadav - (GK)"],
  DLF:   ["Neelesh Malviya - (DLF)", "Dolly Rani - (DLF)", "Mansi Gupta - (DLF)", "Mandeep Kaur - (DLF)"],
  BSSN:  ["Bagu Bai Kokare (BSSN)", "Zakia Begum S - (BSSN)", "Ruchita Amit Singh - (BSSN)", "Alfina Rani C (BSSN)"],
  HYD:   ["Hymavathi pullepu (HYD)", "Kothapally Anusha (HYD)", "Gouri Mitra (HYD)", "Bantu Shashikanth (HYD)"],
  KM:    ["Meena Sharma - (KM)", "Pallavi .(KM)", "Tresa Massey (KM)", "Dr Soni Ali - (KM)"],
  ND:    ["Nidhi Soni (ND)", "Sumit Kumar Pandey (ND)", "Leena Arora (ND)", "Gunjan Rana (ND)", "Shalu Bharti (ND)"],
  MUM:   ["Mitali Sethia (MUM)", "Preeti Vishwakarma (MUM)", "Aashiya Sabir Hussain (MUM)", "Mehjabeen Javed Shaikh (MUM)"],
  VV:    ["Mansi Garg - (VV)", "Suman Raj - (VV)", "Shivani Bhandari - (VV)", "Kanak Gupta - (VV)", "Vanita Pasbola - (VV)",
          "Shilpa Dehran - (VV)", "Shama Bano (VV)", "Merupula Vanisha (VV)"],
  SURAT: ["Shraddha Merchant (SURAT)"],
  PPB:   ["Barkha Bajaj  (PPB)", "Akshay Panwar (PPB)"], // double space is in the sheet — kept on purpose
  SEXT:  ["Farhana Khan - (SEXT)"],
  MOH:   ["Achint Mehrotra", "Vinay Kumari Rana (MOH)"],
  M3M:   ["Nuzhat Parween (M3M)", "Nandini Kataria (M3M)"],
  GM:    ["Pratyush Kumar Singh (GM)", "Nahida Parveen - (GM)"],
  LUH:   ["Neetu Singh (LUH)", "Pallavi Narang (LUH)", "Ankit Mishra (HYD)"], // listed under Ludhiana in the sheet
  KKDM:  ["Durgesh Choudhary - (KKDM)"],
  CTP:   ["Dr Soni Ali - (CTP)"],
};
