"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CENTERS, type CenterId } from "@/lib/centers";
import { ROSTER } from "@/lib/roster";
import { dayLabel, rangeLabel, type Range } from "@/lib/dates";
import type { Report } from "@/lib/report";
import type { Role } from "@/lib/auth";
import Tabs from "./Tabs";
import { useStickyTable } from "./useStickyTable";
import ThemeToggle from "./ThemeToggle";

interface Payload {
  current: Range; comparison: Range; yesterday: string; generatedAt: string; report: Report; error?: string;
  freshness?: { data_through?: string; last_successful_sync?: string } | null;
  targetMonth?: string; savedTargets?: number;
  /** Sales-person targets for the month, keyed by lower-case name (display only). */
  personTargets?: Record<string, number>;
  /** Active cross-branch splits touching the shown dates; splitsError = they could not be loaded. */
  splitCount?: number; splitsError?: boolean;
}

const inr = (n: number | null | undefined) =>
  n == null ? "" : `${n < 0 ? "-" : ""}₹${Math.round(Math.abs(n)).toLocaleString("en-US")}`;
const pct = (n: number | null) => (n == null ? "--" : `${(n * 100).toFixed(2)}%`);
const REFRESH_MS = 5 * 60 * 1000;

export default function Dashboard({ initial, user }: {
  initial: { current: Range; comparison: Range };
  user: { name: string; role: Role };
}) {
  const [current, setCurrent] = useState(initial.current);
  const [comparison, setComparison] = useState(initial.comparison);
  const [centers, setCenters] = useState<CenterId[]>([]);
  const [owner, setOwner] = useState("");
  const [open, setOpen] = useState<CenterId | null>(null);
  const [centersOpen, setCentersOpen] = useState(false);
  const centersRef = useRef<HTMLDivElement>(null);
  const tableRef = useRef<HTMLDivElement>(null);

  // Close the centers menu on outside click or Esc.
  useEffect(() => {
    if (!centersOpen) return;
    const onDown = (e: MouseEvent) => {
      if (centersRef.current && !centersRef.current.contains(e.target as Node)) setCentersOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setCentersOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [centersOpen]);
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const inflight = useRef<AbortController | null>(null);
  const load = useCallback(async () => {
    inflight.current?.abort(); // a newer request replaces an older one still loading
    const ac = new AbortController();
    inflight.current = ac;
    setLoading(true);
    const q = new URLSearchParams({
      curFrom: current.from, curTo: current.to, cmpFrom: comparison.from, cmpTo: comparison.to,
      centers: centers.join(","), owners: owner,
    });
    try {
      const res = await fetch(`/api/report?${q}`, { cache: "no-store", signal: ac.signal });
      if (res.status === 401) { window.location.href = "/login"; return; }
      const json = (await res.json()) as Payload;
      if (!res.ok) throw new Error(json.error ?? res.statusText);
      if (!ac.signal.aborted) { setData(json); setError(""); }
    } catch (e) {
      if (ac.signal.aborted) return;
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally { if (!ac.signal.aborted) setLoading(false); }
  }, [current, comparison, centers, owner]);

  // Wait briefly after a filter change (e.g. while picking dates) before loading; auto-refresh every 5 min.
  useEffect(() => {
    const t = setTimeout(load, 350);
    const i = setInterval(load, REFRESH_MS);
    return () => { clearTimeout(t); clearInterval(i); };
  }, [load]);

  const ownerOptions = useMemo(
    () => (centers.length ? centers : CENTERS.map((c) => c.id)).flatMap((id) => ROSTER[id].map((n) => ({ n, id }))),
    [centers]);

  const r = data?.report;
  useStickyTable(tableRef, !!r);
  const curL = data ? rangeLabel(data.current) : "";
  const cmpL = data ? rangeLabel(data.comparison) : "";
  const yL = data ? dayLabel(data.yesterday) : "";
  const toggleCenter = (id: CenterId) =>
    setCenters((cs) => (cs.includes(id) ? cs.filter((c) => c !== id) : [...cs, id]));

  const logout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  };

  const fresh = data?.freshness;
  const lastSync = fresh?.last_successful_sync;
  const stale = !!lastSync && Date.now() - new Date(lastSync).getTime() > 2 * 3600_000;

  return (
    <main>
      <header className="top">
        <h1>Sales Performance Dashboard{curL && ` — ${curL}`}</h1>
        <span className="muted topRight">
          {loading ? "Refreshing…" : data ? `Updated ${new Date(data.generatedAt).toLocaleTimeString("en-IN")}` : ""}
          <ThemeToggle />
          <button type="button" className="link" onClick={logout}>Log out</button>
        </span>
      </header>

      <section className="filters">
        <label>Current period
          <span className="pair">
            <input type="date" value={current.from} onChange={(e) => setCurrent({ ...current, from: e.target.value })} />
            <input type="date" value={current.to} onChange={(e) => setCurrent({ ...current, to: e.target.value })} />
          </span>
        </label>
        <label>Compare with
          <span className="pair">
            <input type="date" value={comparison.from} onChange={(e) => setComparison({ ...comparison, from: e.target.value })} />
            <input type="date" value={comparison.to} onChange={(e) => setComparison({ ...comparison, to: e.target.value })} />
          </span>
        </label>
        <div className="multi" ref={centersRef}>
          <button type="button" className="multiBtn" aria-expanded={centersOpen} onClick={() => setCentersOpen((o) => !o)}>
            {centers.length ? `${centers.length} center(s)` : "All centers"} ▾
          </button>
          {centersOpen && (
            <div className="menu">
              {CENTERS.map((c) => (
                <label key={c.id} className="check">
                  <input type="checkbox" checked={centers.includes(c.id)} onChange={() => toggleCenter(c.id)} /> {c.name}
                </label>
              ))}
              <div className="menuActions">
                {centers.length > 0 && <button type="button" onClick={() => setCenters([])}>Clear</button>}
                <button type="button" onClick={() => setCentersOpen(false)}>Done</button>
              </div>
            </div>
          )}
        </div>
        <label>Sales owner
          <select value={owner} onChange={(e) => setOwner(e.target.value)}>
            <option value="">Everyone</option>
            {ownerOptions.map(({ n, id }) => <option key={n} value={n}>{n} · {id}</option>)}
          </select>
        </label>
        <Tabs active="dashboard" role={user.role} />
      </section>

      <p className="status">
        {fresh?.data_through && (
          <span className={stale ? "error" : "muted"}>
            Zenoti data through {dayLabel(fresh.data_through.slice(0, 10))}
            {lastSync && ` · last sync ${new Date(lastSync).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}`}
            {stale && " — sync looks stalled, numbers may be incomplete"}
            {" · "}
          </span>
        )}
        <span className="who">{user.name} <span className={`badge ${user.role}`}>{user.role.toUpperCase()}</span></span>
        {!!data?.splitCount && (
          <a className="splitNote muted" href="/splits">Includes {data.splitCount} cross-branch 50/50 split{data.splitCount > 1 ? "s" : ""}</a>
        )}
        {data?.splitsError && <span className="splitNote error">Cross-branch splits could not be loaded — figures shown without them.</span>}
      </p>
      {error && <p className="error">{error}</p>}

      {r && (
        <>
          <section className="kpis">
            <Kpi label={`Current Achieved (${curL})`} value={inr(r.total.current)} />
            <Kpi label="Targets" value={inr(r.total.target)} />
            <Kpi label="Achieved %" value={pct(r.total.achievedPct)} />
            <Kpi label={`Achieved (${cmpL})`} value={inr(r.total.comparison)} />
            <Kpi label={`Difference vs ${cmpL}`} value={inr(r.total.difference)} tone={r.total.difference < 0 ? "neg" : "pos"} />
            <Kpi label={yL} value={inr(r.total.yesterday)} />
            <Kpi label="Product Sales" value={inr(r.total.product)} />
          </section>

          <div className="tableWrap dashTable" ref={tableRef}>
            <table>
              <thead>
                <tr>
                  <th>S.No.</th><th className="l">Center Name</th><th>Target</th>
                  <th>Current ({curL}) Achieved</th><th>Achieved %</th><th>Achieved ({cmpL})</th>
                  <th>Difference vs {cmpL}</th><th>{yL}</th><th>Product Sales ({curL})</th>
                  <th>Should achieve for 80% of target</th><th>Deficit for 80%</th>
                </tr>
              </thead>
              <tbody>
                {r.centers.map((c) => (
                  <Fragment key={c.id}>
                    <tr className="click" onClick={() => setOpen(open === c.id ? null : c.id)}>
                      <td>{c.sno}</td><td className="l">{open === c.id ? "▾" : "▸"} {c.name}</td>
                      <td>{inr(c.target)}</td>
                      <td>{inr(c.current)}</td><td>{pct(c.achievedPct)}</td>
                      <td>{inr(c.comparison)}</td><td className={c.difference < 0 ? "neg" : "pos"}>{inr(c.difference)}</td>
                      <td>{inr(c.yesterday)}</td><td>{inr(c.product)}</td><td>{inr(c.target80)}</td><td>{inr(c.deficit80)}</td>
                    </tr>
                    {open === c.id && [
                      ...c.owners, { name: "No Sales Owner", nso: true, ...c.noSalesOwner },
                      // only when a split moved money that isn't tied to a rostered person
                      ...(c.splitAdjustment && (c.splitAdjustment.current || c.splitAdjustment.comparison
                        || c.splitAdjustment.yesterday || c.splitAdjustment.product)
                        ? [{ name: "Split adjustment (50/50)", nso: true, ...c.splitAdjustment }] : []),
                    ].map((o) => {
                      // Person target: same formulas as the center row (Achieved % = current ÷ target, 80% = target × 0.8).
                      const t = "nso" in o ? undefined : data?.personTargets?.[o.name.toLowerCase()];
                      return (
                        <tr key={o.name} className="sub">
                          <td></td><td className="l">{o.name}</td><td>{t == null ? "" : inr(t)}</td><td>{inr(o.current)}</td>
                          <td>{t == null ? "" : pct(t ? o.current / t : null)}</td>
                          <td>{inr(o.comparison)}</td><td>{inr(o.current - (o.comparison ?? 0))}</td>
                          <td>{inr(o.yesterday)}</td><td>{inr(o.product)}</td>
                          <td>{t == null ? "" : inr(t * 0.8)}</td><td>{t == null ? "" : inr(t * 0.8 - o.current)}</td>
                        </tr>
                      );
                    })}
                  </Fragment>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={2} className="l">TOTAL</td><td>{inr(r.total.target)}</td><td>{inr(r.total.current)}</td>
                  <td>{pct(r.total.achievedPct)}</td><td>{inr(r.total.comparison)}</td>
                  <td className={r.total.difference < 0 ? "neg" : "pos"}>{inr(r.total.difference)}</td>
                  <td>{inr(r.total.yesterday)}</td><td>{inr(r.total.product)}</td>
                  <td>{inr(r.total.target80)}</td><td>{inr(r.total.deficit80)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}
    </main>
  );
}

function Kpi({ label, value, tone }: { label: string; value: string; tone?: "pos" | "neg" }) {
  return <div className="kpi"><div className="muted">{label}</div><div className={`v ${tone ?? ""}`}>{value}</div></div>;
}
