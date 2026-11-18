"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Tabs from "./Tabs";
import { useStickyTable } from "./useStickyTable";
import ThemeToggle from "./ThemeToggle";
import { CENTERS, type CenterId } from "@/lib/centers";
import { personKey, rosterPeople } from "@/lib/targets";
import type { Role } from "@/lib/auth";

interface Line {
  sale_date: string; item_type: string; item_name: string | null; center_name: string; sold_by: string | null;
  guest_name: string | null; payment_type: string | null; collected: number; internal: boolean;
}
interface Info {
  invoiceNo: string; centerName: string; centerId: CenterId | null; client: string | null; sellers: string[];
  total: number; half: number; firstPayment: string; lines: Line[];
}
interface Split {
  id: number; invoice_no: string; client_name: string | null; from_center: string; from_seller: string | null;
  to_center_name: string; to_person: string; invoice_total: number; note: string | null;
  created_by: string; created_at: string; cancelled_by: string | null; cancelled_at: string | null; cancel_reason: string | null;
}

const inr = (n: number) => `${n < 0 ? "-" : ""}₹${Math.round(Math.abs(n)).toLocaleString("en-US")}`;
const when = (ts: string) =>
  new Date(ts.replace(" ", "T")).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" });
const centerName = (zenoti: string) => CENTERS.find((c) => c.zenoti.toLowerCase() === zenoti.toLowerCase())?.name ?? zenoti;
const PEOPLE = rosterPeople();
const ON_ROSTER = new Map(PEOPLE.map((p) => [personKey(p.name), p.center]));

export default function SplitsPage({ user }: { user: { name: string; role: Role } }) {
  const isAdmin = user.role === "admin";
  const [log, setLog] = useState<Split[]>([]);
  const [setup, setSetup] = useState(true);
  const [windowStart, setWindowStart] = useState("");
  const [loadErr, setLoadErr] = useState("");

  const [invoice, setInvoice] = useState("");
  const [info, setInfo] = useState<Info | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [toCenter, setToCenter] = useState<CenterId | "">("");
  const [toPerson, setToPerson] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");

  const tableRef = useRef<HTMLDivElement>(null);
  useStickyTable(tableRef, log.length > 0);

  const loadLog = useCallback(async () => {
    const res = await fetch("/api/splits", { cache: "no-store" });
    if (res.status === 401) { window.location.href = "/login"; return; }
    const j = await res.json().catch(() => ({}));
    if (!res.ok) { setLoadErr(j.error ?? "Could not load splits"); return; }
    setLoadErr(""); setSetup(j.setup); setLog(j.splits); setWindowStart(j.windowStart);
  }, []);
  useEffect(() => { loadLog(); }, [loadLog]);

  const post = async (body: object) => {
    const res = await fetch("/api/splits", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (res.status === 401) { window.location.href = "/login"; return null; }
    return { ok: res.ok, j: await res.json().catch(() => ({})) };
  };

  const resetForm = () => { setInfo(null); setProblem(null); setToCenter(""); setToPerson(""); setNote(""); };

  async function lookup() {
    setError(""); setDone(""); resetForm();
    if (!invoice.trim()) { setError("Enter an invoice number"); return; }
    setBusy(true);
    const r = await post({ action: "lookup", invoiceNo: invoice.trim() });
    setBusy(false);
    if (!r) return;
    if (!r.ok) { setError(r.j.error ?? "Could not look up the invoice"); return; }
    setInfo(r.j.info); setProblem(r.j.problem);
  }

  // What leaves the invoice branch: half of each seller's lines (non-rostered sellers come off the branch).
  const fromSide = useMemo(() => {
    if (!info) return [];
    const by = new Map<string, number>();
    for (const l of info.lines) {
      if (l.internal) continue;
      const seller = l.sold_by?.trim() || "";
      const label = ON_ROSTER.has(personKey(seller)) ? seller : `${centerName(info.centerName)} (branch)`;
      by.set(label, (by.get(label) ?? 0) + l.collected / 2);
    }
    return [...by.entries()].filter(([, v]) => v !== 0);
  }, [info]);

  const homePeople = PEOPLE.filter((p) => p.center === toCenter);
  const toName = CENTERS.find((c) => c.id === toCenter)?.name;

  async function save() {
    if (!info || !toCenter || !toPerson) return;
    const ok = window.confirm(
      `Split invoice ${info.invoiceNo} 50/50?\n\n`
      + `${centerName(info.centerName)} keeps ${inr(info.half)}\n${toName}: ${toPerson} gets ${inr(info.half)}\n\n`
      + "This is recorded in the split log with your name and the time.");
    if (!ok) return;
    setBusy(true); setError("");
    const r = await post({ action: "add", invoiceNo: info.invoiceNo, toCenter, toPerson, note });
    setBusy(false);
    if (!r) return;
    if (!r.ok) { setError(r.j.error ?? "Could not save the split"); return; }
    setDone(`Invoice ${info.invoiceNo} split: ${inr(info.half)} moved to ${toPerson} (${toName}). The dashboard updates within a minute.`);
    setInvoice(""); resetForm(); loadLog();
  }

  async function cancel(s: Split) {
    const reason = window.prompt(`Cancel the split of invoice ${s.invoice_no}?\n\nThe full amount goes back to ${centerName(s.from_center)}. Enter a reason:`);
    if (reason === null) return;
    if (!reason.trim()) { setError("A reason is needed to cancel a split"); return; }
    setError(""); setDone("");
    const r = await post({ action: "cancel", id: s.id, reason });
    if (!r) return;
    if (!r.ok) { setError(r.j.error ?? "Could not cancel the split"); return; }
    setDone(`Split of invoice ${s.invoice_no} cancelled.`); loadLog();
  }

  const logout = async () => { await fetch("/api/auth/logout", { method: "POST" }); window.location.href = "/login"; };
  const canCancel = (s: Split) => isAdmin && !s.cancelled_at;

  return (
    <main>
      <header className="top">
        <h1>Cross-branch 50/50 Splits</h1>
        <span className="muted topRight"><ThemeToggle /><button type="button" className="link" onClick={logout}>Log out</button></span>
      </header>

      <section className="filters">
        <div className="monthTag">When a client registered at one branch buys at another, the invoice is shared 50/50.</div>
        <Tabs active="splits" role={user.role} />
      </section>

      <p className="status">
        <span className="who">{user.name} <span className={`badge ${user.role}`}>{user.role.toUpperCase()}</span></span>
      </p>

      {loadErr && <p className="error">{loadErr}</p>}
      {!setup && <p className="lockNote">Splits are not set up in the database yet. The dashboard is unaffected. (Owner: run the setup SQL from the README.)</p>}
      {error && <p className="error">{error}</p>}
      {done && <p className="pos">{done}</p>}

      {isAdmin && setup && (
        <section className="card splitForm">
          <h2>Add a split</h2>
          <p className="muted">Enter the invoice raised at the branch the client visited. Invoices paid on or after {windowStart || "the 1st of last month"} (this month or last month) can be split.</p>
          <div className="row">
            <input value={invoice} onChange={(e) => setInvoice(e.target.value.toUpperCase())} placeholder="Invoice no. e.g. VVR94453"
              onKeyDown={(e) => { if (e.key === "Enter") lookup(); }} aria-label="Invoice number" />
            <button type="button" className="primary" onClick={lookup} disabled={busy}>{busy && !info ? "Looking up…" : "Look up"}</button>
          </div>

          {info && (
            <div className="invoiceCard">
              <div className="facts">
                <div><span className="muted">Invoice</span><b>{info.invoiceNo}</b></div>
                <div><span className="muted">Branch</span><b>{centerName(info.centerName)}</b></div>
                <div><span className="muted">Client</span><b>{info.client ?? "—"}</b></div>
                <div><span className="muted">Seller(s)</span><b>{info.sellers.join(", ") || "—"}</b></div>
                <div><span className="muted">Total paid</span><b>{inr(info.total)}</b></div>
              </div>
              <div className="tableWrap">
                <table>
                  <thead><tr><th className="l">Paid on</th><th className="l">Item</th><th className="l">Type</th><th className="l">Seller</th><th className="l">Payment</th><th>Amount</th></tr></thead>
                  <tbody>
                    {info.lines.map((l, i) => (
                      <tr key={i} className={l.internal ? "sub" : ""}>
                        <td className="l">{l.sale_date}</td><td className="l">{l.item_name ?? "—"}</td><td className="l">{l.item_type}</td>
                        <td className="l">{l.sold_by ?? "—"}</td>
                        <td className="l">{l.payment_type ?? "—"}{l.internal ? " (internal — not counted)" : ""}</td>
                        <td>{inr(l.collected)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {problem ? <p className="error">{problem}</p> : (
                <>
                  <div className="row">
                    <label>Client&apos;s home branch
                      <select value={toCenter} onChange={(e) => { setToCenter(e.target.value as CenterId); setToPerson(""); }}>
                        <option value="">Choose…</option>
                        {CENTERS.filter((c) => c.id !== info.centerId).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>
                    </label>
                    <label>Person who brought the client
                      <select value={toPerson} onChange={(e) => setToPerson(e.target.value)} disabled={!toCenter}>
                        <option value="">Choose…</option>
                        {homePeople.map((p) => <option key={p.name} value={p.name}>{p.name}</option>)}
                      </select>
                    </label>
                    <label className="grow">Note (optional)
                      <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder="e.g. referred by Khan Market" />
                    </label>
                  </div>

                  {toCenter && toPerson && (
                    <div className="preview">
                      <div><b>{centerName(info.centerName)}</b> keeps {inr(info.half)}
                        {fromSide.map(([who, v]) => <span key={who} className="neg"> · {who} {inr(-v)}</span>)}</div>
                      <div><b>{toName}</b> gets {inr(info.half)} <span className="pos">· {toPerson} +{inr(info.half)}</span></div>
                      <div className="muted">Each payment is split on its own payment date (part payments included).</div>
                    </div>
                  )}

                  <div className="row">
                    <button type="button" className="primary" onClick={save} disabled={busy || !toCenter || !toPerson}>
                      {busy ? "Saving…" : "Confirm 50/50 split"}
                    </button>
                    <button type="button" onClick={() => { setInvoice(""); resetForm(); }}>Clear</button>
                  </div>
                </>
              )}
            </div>
          )}
        </section>
      )}

      <h2 className="formTitle">Split log</h2>
      {setup && !log.length && !loadErr && <p className="muted">No splits yet.</p>}
      {log.length > 0 && (
        <div className="tableWrap" ref={tableRef}>
          <table>
            <thead>
              <tr>
                <th className="l">Added on</th><th className="l">Invoice</th><th className="l">Client</th>
                <th className="l">From (branch · seller)</th><th className="l">To (branch · person)</th>
                <th>Invoice total</th><th>Half moved</th><th className="l">Added by</th><th className="l">Status</th>
                {isAdmin && <th></th>}
              </tr>
            </thead>
            <tbody>
              {log.map((s) => (
                <tr key={s.id} className={s.cancelled_at ? "cancelled" : ""}>
                  <td className="l">{when(s.created_at)}</td>
                  <td className="l"><b>{s.invoice_no}</b>{s.note && <div className="muted wrap">{s.note}</div>}</td>
                  <td className="l">{s.client_name ?? "—"}</td>
                  <td className="l">{centerName(s.from_center)}<div className="muted">{s.from_seller ?? "—"}</div></td>
                  <td className="l">{centerName(s.to_center_name)}<div className="muted">{s.to_person}</div></td>
                  <td>{inr(s.invoice_total)}</td><td>{inr(s.invoice_total / 2)}</td>
                  <td className="l">{s.created_by}</td>
                  <td className="l">{s.cancelled_at
                    ? <span className="neg">Cancelled by {s.cancelled_by} on {when(s.cancelled_at)}<div className="muted wrap">{s.cancel_reason}</div></span>
                    : <span className="pos">Active</span>}</td>
                  {isAdmin && <td>{canCancel(s) && <button type="button" className="link" onClick={() => cancel(s)}>Cancel</button>}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
