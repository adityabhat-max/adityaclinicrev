/** All dates are ISO "YYYY-MM-DD" strings in India time (Asia/Kolkata). */
export type ISODate = string;
export interface Range { from: ISODate; to: ISODate }

export function todayIST(now: Date = new Date()): ISODate {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(now);
}

const parts = (d: ISODate) => d.split("-").map(Number) as [number, number, number];
const fmt = (y: number, m: number, d: number) =>
  `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

export const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

export function addDays(d: ISODate, n: number): ISODate {
  const [y, m, day] = parts(d);
  const t = new Date(Date.UTC(y, m - 1, day + n));
  return fmt(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

/** Default: 1st→today of this month vs 1st→same day of last month (clamped to month end). */
export function defaultPeriods(today: ISODate = todayIST()): { current: Range; comparison: Range } {
  const [y, m, d] = parts(today);
  const py = m === 1 ? y - 1 : y;
  const pm = m === 1 ? 12 : m - 1;
  return {
    current: { from: fmt(y, m, 1), to: today },
    comparison: { from: fmt(py, pm, 1), to: fmt(py, pm, Math.min(d, daysInMonth(py, pm))) },
  };
}

/** Sheet "Yesterday" = TODAY()-1. If the chosen range ends in the past, use its last day. */
export function yesterdayFor(currentTo: ISODate, today: ISODate = todayIST()): ISODate {
  return currentTo >= today ? addDays(today, -1) : currentTo;
}

export const inRange = (d: ISODate, r: Range) => d >= r.from && d <= r.to;

/** Months ("YYYY-MM") the admin may submit targets for: this month and next month (India time). */
export function editableMonths(today: ISODate = todayIST()): string[] {
  const [y, m] = parts(today);
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  return [`${y}-${String(m).padStart(2, "0")}`, `${ny}-${String(nm).padStart(2, "0")}`];
}

/** Merge overlapping/adjacent ranges so each day is fetched once. */
export function mergeRanges(ranges: Range[]): Range[] {
  const sorted = [...ranges].sort((a, b) => a.from.localeCompare(b.from));
  const out: Range[] = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && r.from <= addDays(last.to, 1)) {
      if (r.to > last.to) last.to = r.to;
    } else out.push({ ...r });
  }
  return out;
}

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "Nov - 26" */
export const monthLabel = (d: ISODate) => { const [y, m] = parts(d); return `${MON[m - 1]} - ${String(y).slice(2)}`; };
/** "15,Nov,2026" — same as the sheet's TEXT(TODAY()-1,"DD,MMM,YYYY") */
export const dayLabel = (d: ISODate) => { const [y, m, day] = parts(d); return `${String(day).padStart(2, "0")},${MON[m - 1]},${y}`; };
export const rangeLabel = (r: Range) =>
  r.from.slice(0, 7) === r.to.slice(0, 7) && r.from.endsWith("-01") ? monthLabel(r.from) : `${r.from} → ${r.to}`;
