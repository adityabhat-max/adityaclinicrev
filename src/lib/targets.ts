import { CENTERS, type CenterId } from "./centers";
import { ROSTER } from "./roster";

/** Same matching as the report (Zenoti "Sold By" is matched case-insensitively). */
export const personKey = (name: string) => name.toLowerCase();

export interface RosterPerson { center: CenterId; name: string }

/** Every roster person once, under the center the report credits them to (the first center listing them). */
export function rosterPeople(roster: Record<CenterId, string[]> = ROSTER): RosterPerson[] {
  const seen = new Set<string>();
  const out: RosterPerson[] = [];
  for (const [center, names] of Object.entries(roster) as [CenterId, string[]][])
    for (const name of names) {
      if (seen.has(personKey(name))) continue;
      seen.add(personKey(name));
      out.push({ center, name });
    }
  return out;
}

const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-US")}`;

/** Sum of a center's people targets (missing people count as 0). */
export function peopleTotal(center: CenterId, people: Record<string, number>, list = rosterPeople()): number {
  return list.filter((p) => p.center === center).reduce((s, p) => s + (people[p.name] ?? 0), 0);
}

/**
 * Each center's people targets must add up to exactly the center target.
 * Returns one message per center that doesn't (empty = OK). Values are whole rupees.
 */
export function planErrors(centers: Record<CenterId, number>, people: Record<string, number>, list = rosterPeople()): string[] {
  const errs: string[] = [];
  for (const c of CENTERS) {
    const sum = peopleTotal(c.id, people, list);
    if (sum !== centers[c.id])
      errs.push(`${c.name}: people add up to ${inr(sum)}, center target is ${inr(centers[c.id])} (${sum < centers[c.id] ? `${inr(centers[c.id] - sum)} short` : `${inr(sum - centers[c.id])} over`})`);
  }
  return errs;
}

/** "YYYY-MM-01" of the month before. */
export function previousMonth(month: string): string {
  const [y, m] = month.slice(0, 7).split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 2, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`;
}
