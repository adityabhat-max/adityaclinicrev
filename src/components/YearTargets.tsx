"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CENTERS, type CenterId } from "@/lib/centers";
import { monthLabel } from "@/lib/dates";
import { useStickyTable } from "./useStickyTable";

interface YearData {
  year: number; present: string; months: string[]; submitted: boolean;
  targets: Record<string, Record<CenterId, number | null>>;
}

const inr = (n: number | null | undefined) => (n == null ? "—" : `₹${Math.round(n).toLocaleString("en-US")}`);
const QUARTERS = { All: [1, 12], Q1: [1, 3], Q2: [4, 6], Q3: [7, 9], Q4: [10, 12] } as const; // calendar quarters
type Quarter = keyof typeof QUARTERS;
const ORDER_KEY = "yearTargets.order";

/** View-only table: centers × months of the present year. Month columns can be dragged to sit side by side. */
export default function YearTargets({ refreshKey }: { refreshKey: number }) {
  const [data, setData] = useState<YearData | null>(null);
  const [error, setError] = useState("");
  const [quarter, setQuarter] = useState<Quarter>("All");
  const [order, setOrder] = useState<string[]>([]);
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const tableRef = useRef<HTMLDivElement>(null);
  useStickyTable(tableRef, !!data);

  useEffect(() => {
    (async () => {
      const res = await fetch("/api/targets/year", { cache: "no-store" });
      if (res.status === 401) { window.location.href = "/login"; return; }
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setError(j.error ?? "Could not load the year's targets"); return; }
      const d = j as YearData;
      setData(d);
      // Keep the viewer's own column order (if any) for months that still exist; new months go at the end.
      let saved: string[] = [];
      try { saved = JSON.parse(localStorage.getItem(ORDER_KEY) ?? "[]"); } catch { /* storage unavailable */ }
      const kept = saved.filter((m) => d.months.includes(m));
      setOrder([...kept, ...d.months.filter((m) => !kept.includes(m))]);
    })();
  }, [refreshKey]);

  const saveOrder = (o: string[]) => {
    setOrder(o);
    try { localStorage.setItem(ORDER_KEY, JSON.stringify(o)); } catch { /* storage unavailable */ }
  };

  const visible = useMemo(() => {
    const [a, b] = QUARTERS[quarter];
    return order.filter((m) => { const n = Number(m.slice(5)); return n >= a && n <= b; });
  }, [order, quarter]);

  const move = (from: string, to: string) => {
    if (from === to) return;
    const o = order.filter((m) => m !== from);
    o.splice(o.indexOf(to), 0, from); // dropped column takes the target's place
    saveOrder(o);
  };

  if (error) return <p className="error">{error}</p>;
  if (!data) return <p className="muted">Loading the year&apos;s targets…</p>;

  const total = (m: string) => CENTERS.reduce((s, c) => s + (data.targets[m]?.[c.id] ?? 0), 0);
  const isDefaultOrder = order.join() === data.months.join();

  return (
    <section className="yearTargets">
      <div className="yearBar">
        <h2>Targets {data.year}</h2>
        <div className="seg" role="group" aria-label="Quarter">
          {(Object.keys(QUARTERS) as Quarter[]).map((q) => {
            const [a, b] = QUARTERS[q];
            const has = data.months.some((m) => { const n = Number(m.slice(5)); return n >= a && n <= b; });
            return (
              <button key={q} type="button" className={quarter === q ? "on" : ""} disabled={!has} onClick={() => setQuarter(q)}>
                {q === "All" ? "All months" : q}
              </button>
            );
          })}
        </div>
        <span className="muted">Drag a month&apos;s header to move it next to another month.</span>
        {!isDefaultOrder && <button type="button" className="link" onClick={() => saveOrder(data.months)}>Reset column order</button>}
      </div>

      <div className="tableWrap yearTable" ref={tableRef}>
        <table>
          <thead>
            <tr>
              <th className="l">Center</th>
              {visible.map((m) => (
                <th key={m} draggable
                  className={`drag${dragging === m ? " dragging" : ""}${over === m && dragging !== m ? " dropHere" : ""}${m === data.present ? " current" : ""}`}
                  onDragStart={(e) => { setDragging(m); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", m); }}
                  onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; if (over !== m) setOver(m); }}
                  onDragLeave={() => setOver((o) => (o === m ? null : o))}
                  onDrop={(e) => { e.preventDefault(); const from = e.dataTransfer.getData("text/plain") || dragging; if (from) move(from, m); setOver(null); setDragging(null); }}
                  onDragEnd={() => { setDragging(null); setOver(null); }}
                  title="Drag to move this month">
                  <span className="grip" aria-hidden>⠿</span> {monthLabel(`${m}-01`)}
                  {m === data.present && <div className="thNote">{data.submitted ? "current" : "current · not submitted"}</div>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {CENTERS.map((c) => (
              <tr key={c.id}>
                <td className="l">{c.name}</td>
                {visible.map((m) => <td key={m} className={m === data.present ? "current" : ""}>{inr(data.targets[m]?.[c.id])}</td>)}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td className="l">TOTAL</td>
              {visible.map((m) => <td key={m}>{inr(total(m))}</td>)}
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="muted">₹0 = no target set for that center in that month. Past months are view only.</p>
    </section>
  );
}
