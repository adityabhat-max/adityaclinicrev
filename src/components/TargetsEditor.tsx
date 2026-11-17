"use client";

import { useCallback, useEffect, useState } from "react";
import Tabs from "./Tabs";
import { CENTERS, type CenterId } from "@/lib/centers";
import { monthLabel } from "@/lib/dates";
import type { Role } from "@/lib/auth";

interface MonthData {
  month: string; locked: boolean; editable: boolean; targets: Record<CenterId, number>;
  submittedBy: string | null; submittedAt: string | null;
}

const when = (ts: string) =>
  new Date(ts.replace(" ", "T")).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" });

const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-US")}`;

export default function TargetsEditor({ user, months }: { user: { name: string; role: Role }; months: string[] }) {
  const month = months[0]; // only the present month
  const [data, setData] = useState<MonthData | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
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
    setData(j as MonthData);
    setDraft(Object.fromEntries(CENTERS.map((c) => [c.id, String(Math.round((j as MonthData).targets[c.id] ?? 0))])));
  }, []);

  useEffect(() => { load(month); }, [month, load]);

  const num = (v: string | undefined) => Number(String(v ?? "").replace(/,/g, ""));
  const total = CENTERS.reduce((s, c) => s + (data?.editable ? num(draft[c.id]) || 0 : data?.targets[c.id] ?? 0), 0);
  const label = monthLabel(`${month}-01`);

  async function submit() {
    const targets: Record<string, number> = {};
    for (const c of CENTERS) {
      const n = num(draft[c.id]);
      if (!Number.isFinite(n) || n < 0 || String(draft[c.id] ?? "").trim() === "") { setError(`Enter a valid target for ${c.name}`); return; }
      targets[c.id] = n;
    }
    const ok = window.confirm(
      `Submit targets for ${label}?\n\nTotal: ${inr(total)}\n\nAfter submitting, these targets are locked and cannot be changed — not even by the admin.`);
    if (!ok) return;
    setSaving(true); setError("");
    const res = await fetch("/api/targets", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ month, targets }),
    });
    const j = await res.json().catch(() => ({}));
    setSaving(false);
    if (!res.ok) { setError(j.error ?? "Could not save targets"); if (res.status === 409) load(month); return; }
    await load(month);
    setDone(`Targets for ${label} submitted and locked.`);
  }

  const logout = async () => { await fetch("/api/auth/logout", { method: "POST" }); window.location.href = "/login"; };

  return (
    <main>
      <header className="top">
        <h1>Monthly Targets</h1>
        <span className="muted topRight"><button type="button" className="link" onClick={logout}>Log out</button></span>
      </header>

      <section className="filters">
        <div className="monthTag">Month<b>{label}</b></div>
        <Tabs active="targets" role={user.role} />
      </section>

      <p className="status">
        <span className="who">{user.name} <span className={`badge ${user.role}`}>{user.role.toUpperCase()}</span></span>
      </p>

      {loading && <p className="muted">Loading…</p>}
      {error && <p className="error">{error}</p>}
      {done && <p className="pos">{done}</p>}

      {data && !loading && (
        <>
          <p className={data.locked ? "lockNote" : "openNote"}>
            {data.locked
              ? <>🔒 Targets for {label} are locked
                  {data.submittedAt ? <> — submitted by <b>{data.submittedBy}</b> on <b>{when(data.submittedAt)}</b></> : " (set in the database)"}.
                  {" "}To change them, contact the dashboard owner.</>
              : `Targets for ${label} have not been submitted yet. The values below are the Daily Report (Google Sheet) targets that the dashboard uses now. You can submit once — after that they are locked.`}
          </p>

          <div className="tableWrap targetsTable">
            <table>
              <thead><tr><th>S.No.</th><th className="l">Center</th><th>Target ({label})</th></tr></thead>
              <tbody>
                {CENTERS.map((c, i) => (
                  <tr key={c.id}>
                    <td>{i + 1}</td>
                    <td className="l">{c.name}</td>
                    <td>
                      {data.editable ? (
                        <input className="targetInput" inputMode="numeric" value={draft[c.id] ?? ""}
                          onChange={(e) => setDraft((d) => ({ ...d, [c.id]: e.target.value }))} aria-label={`Target for ${c.name}`} />
                      ) : inr(data.targets[c.id] ?? 0)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr><td colSpan={2} className="l">TOTAL</td><td>{inr(total)}</td></tr></tfoot>
            </table>
          </div>

          {data.editable && (
            <div className="adminBar">
              <button type="button" className="primary" onClick={submit} disabled={saving}>
                {saving ? "Submitting…" : `Submit targets for ${label}`}
              </button>
              <span className="muted">One-time submission — cannot be edited afterwards.</span>
            </div>
          )}
        </>
      )}
    </main>
  );
}
