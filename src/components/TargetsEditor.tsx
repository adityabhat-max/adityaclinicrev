"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Tabs from "./Tabs";
import { useStickyTable } from "./useStickyTable";
import YearTargets from "./YearTargets";
import ThemeToggle from "./ThemeToggle";
import { CENTERS, type CenterId } from "@/lib/centers";
import { monthLabel } from "@/lib/dates";
import { planErrors, type RosterPerson } from "@/lib/targets";
import type { Role } from "@/lib/auth";

interface MonthData {
  month: string; months: string[]; locked: boolean; editable: boolean; targets: Record<CenterId, number>;
  people: Record<string, number | null>; hasPeople: boolean; roster: RosterPerson[];
  submittedBy: string | null; submittedAt: string | null;
}

const when = (ts: string) =>
  new Date(ts.replace(" ", "T")).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" });

const inr = (n: number) => `${n < 0 ? "-" : ""}₹${Math.round(Math.abs(n)).toLocaleString("en-US")}`;
const num = (v: string | undefined) => Number(String(v ?? "").replace(/,/g, ""));
const blank = (v: string | undefined) => String(v ?? "").trim() === "";
const okNum = (v: string | undefined) => !blank(v) && Number.isFinite(num(v)) && num(v) >= 0;

export default function TargetsEditor({ user, months }: { user: { name: string; role: Role }; months: string[] }) {
  const present = months[0]; // the only month that can ever be edited
  const month = present; // the form below is for the present month only; earlier months are in the year table
  const [refreshKey, setRefreshKey] = useState(0);
  const [data, setData] = useState<MonthData | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});   // center id → value
  const [pdraft, setPdraft] = useState<Record<string, string>>({}); // person name → value
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");

  const load = useCallback(async (m: string) => {
    setLoading(true); setError(""); setDone("");
    const res = await fetch(`/api/targets?month=${m}`, { cache: "no-store" });
    if (res.status === 401) { window.location.href = "/login"; return; }
    const j = await res.json().catch(() => ({}));
    setLoading(false);
    if (!res.ok) { setError(j.error ?? "Could not load targets"); setData(null); return; }
    const d = j as MonthData;
    setData(d);
    setDraft(Object.fromEntries(CENTERS.map((c) => [c.id, String(Math.round(d.targets[c.id] ?? 0))])));
    setPdraft(Object.fromEntries(d.roster.map((p) => [p.name, d.people[p.name] == null ? "" : String(Math.round(d.people[p.name]!))])));
  }, []);

  useEffect(() => { load(month); }, [month, load]);

  const tableRef = useRef<HTMLDivElement>(null);
  useStickyTable(tableRef, !!data && !loading);

  const editable = !!data?.editable;
  const showPeople = editable || !!data?.hasPeople; // past months without people targets: centers only
  const isPast = month < present;
  const centerVal = (id: CenterId) => (editable ? num(draft[id]) || 0 : data?.targets[id] ?? 0);
  const personVal = (name: string) => (editable ? num(pdraft[name]) || 0 : data?.people[name] ?? 0);
  const roster = useMemo(() => data?.roster ?? [], [data]);
  const peopleOf = (id: CenterId) => roster.filter((p) => p.center === id);
  const peopleSum = (id: CenterId) => peopleOf(id).reduce((s, p) => s + personVal(p.name), 0);

  const total = CENTERS.reduce((s, c) => s + centerVal(c.id), 0);
  const peopleTotal = roster.reduce((s, p) => s + personVal(p.name), 0);
  const mismatched = CENTERS.filter((c) => Math.round(peopleSum(c.id)) !== Math.round(centerVal(c.id))).length;
  const missing = roster.filter((p) => !okNum(pdraft[p.name])).length;
  const label = monthLabel(`${month}-01`);

  async function submit() {
    const targets = {} as Record<CenterId, number>;
    for (const c of CENTERS) {
      if (!okNum(draft[c.id])) { setError(`Enter a valid target for ${c.name}`); return; }
      targets[c.id] = Math.round(num(draft[c.id]));
    }
    const people: Record<string, number> = {};
    for (const p of roster) {
      if (!okNum(pdraft[p.name])) { setError(`Enter a target for ${p.name} (0 is allowed)`); return; }
      people[p.name] = Math.round(num(pdraft[p.name]));
    }
    const errs = planErrors(targets, people, roster);
    if (errs.length) { setError(`People targets must add up to each center target. ${errs.join("; ")}`); return; }

    const ok = window.confirm(
      `Submit targets for ${label}?\n\nCenters total: ${inr(total)}\nSales people: ${roster.length}\n\n`
      + "After submitting, center AND sales-person targets are locked and cannot be changed — not even by the admin.");
    if (!ok) return;
    setSaving(true); setError("");
    const res = await fetch("/api/targets", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ month, targets, people }),
    });
    const j = await res.json().catch(() => ({}));
    setSaving(false);
    if (!res.ok) { setError(j.error ?? "Could not save targets"); if (res.status === 409) load(month); return; }
    await load(month);
    setRefreshKey((k) => k + 1); // year table picks up the submitted month
    setDone(`Targets for ${label} submitted and locked.`);
  }

  const logout = async () => { await fetch("/api/auth/logout", { method: "POST" }); window.location.href = "/login"; };

  const input = (value: string, onChange: (v: string) => void, aria: string, bad = false) => (
    <input className={`targetInput${bad ? " bad" : ""}`} inputMode="numeric" value={value} placeholder="0"
      onChange={(e) => onChange(e.target.value)} aria-label={aria} />
  );

  return (
    <main>
      <header className="top">
        <h1>Monthly Targets</h1>
        <span className="muted topRight"><ThemeToggle /><button type="button" className="link" onClick={logout}>Log out</button></span>
      </header>

      <section className="filters">
        <div className="monthTag">Editable month<b>{label}</b></div>
        <Tabs active="targets" role={user.role} />
      </section>

      <p className="status">
        <span className="who">{user.name} <span className={`badge ${user.role}`}>{user.role.toUpperCase()}</span></span>
      </p>

      <YearTargets refreshKey={refreshKey} />

      <h2 className="formTitle">{label} — {data?.editable ? "submit targets (one time)" : "submitted targets"}</h2>
      {loading && <p className="muted">Loading…</p>}
      {error && <p className="error">{error}</p>}
      {done && <p className="pos">{done}</p>}

      {data && !loading && (
        <>
          <p className={data.locked ? "lockNote" : "openNote"}>
            {isPast && !data.submittedAt
              ? <>🔒 {label} is a past month — targets are view only. To change them, contact the dashboard owner.</>
              : data.locked
              ? <>🔒 Targets for {label} are locked
                  {data.submittedAt ? <> — submitted by <b>{data.submittedBy}</b> on <b>{when(data.submittedAt)}</b></> : " (set in the database)"}.
                  {" "}To change them, contact the dashboard owner.</>
              : <>Targets for {label} have not been submitted yet. Center targets start from the Daily Report (Google Sheet);
                  sales-person targets start from last month where saved. Each center&apos;s people must add up to exactly
                  the center target. You can submit once — after that centers and people are locked.</>}
          </p>

          <div className="tableWrap targetsTable" ref={tableRef}>
            <table>
              <thead>
                <tr><th>S.No.</th><th className="l">{showPeople ? "Center / Sales person" : "Center"}</th><th>Target ({label})</th>
                  {showPeople && <><th>People total</th><th>Check</th></>}</tr>
              </thead>
              <tbody>
                {CENTERS.map((c, i) => {
                  const diff = peopleSum(c.id) - centerVal(c.id);
                  const matches = Math.round(diff) === 0;
                  return (
                    <Fragment key={c.id}>
                      <tr className="centerRow">
                        <td>{i + 1}</td>
                        <td className="l"><b>{c.name}</b></td>
                        <td>{editable
                          ? input(draft[c.id] ?? "", (v) => setDraft((d) => ({ ...d, [c.id]: v })), `Target for ${c.name}`, !okNum(draft[c.id]))
                          : inr(centerVal(c.id))}</td>
                        {showPeople && <>
                          <td>{inr(peopleSum(c.id))}</td>
                          <td className={matches ? "pos" : "neg"}>
                            {matches ? "✓ adds up" : diff < 0 ? `${inr(-diff)} short` : `${inr(diff)} over`}
                          </td>
                        </>}
                      </tr>
                      {showPeople && peopleOf(c.id).map((p) => (
                        <tr key={p.name} className="sub">
                          <td></td>
                          <td className="l person">{p.name}</td>
                          <td>{editable
                            ? input(pdraft[p.name] ?? "", (v) => setPdraft((d) => ({ ...d, [p.name]: v })), `Target for ${p.name}`, !okNum(pdraft[p.name]))
                            : data.people[p.name] == null ? "—" : inr(data.people[p.name]!)}</td>
                          <td></td><td></td>
                        </tr>
                      ))}
                    </Fragment>
                  );
                })}
              </tbody>
              <tfoot>
                <tr><td colSpan={2} className="l">TOTAL</td><td>{inr(total)}</td>
                  {showPeople && <><td>{inr(peopleTotal)}</td>
                    <td className={mismatched ? "neg" : "pos"}>{mismatched ? `${mismatched} center(s) off` : "✓ all add up"}</td></>}</tr>
              </tfoot>
            </table>
          </div>

          {editable && (
            <div className="adminBar">
              <button type="button" className="primary" onClick={submit} disabled={saving || mismatched > 0 || missing > 0}>
                {saving ? "Submitting…" : `Submit targets for ${label}`}
              </button>
              <span className="muted">
                {missing > 0 ? `${missing} sales person(s) still need a target (0 is allowed). `
                  : mismatched > 0 ? `${mismatched} center(s) don't add up yet. ` : ""}
                One-time submission — centers and people cannot be edited afterwards.
              </span>
            </div>
          )}
        </>
      )}
    </main>
  );
}
