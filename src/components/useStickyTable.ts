"use client";

import { useEffect, type RefObject } from "react";

/**
 * Keeps a table's header row pinned just under the sticky status line, and its TOTAL row pinned to the
 * bottom of the window, while the whole PAGE scrolls (no scroll box inside the page).
 * CSS `position: sticky` can't do this here because the table's box scrolls sideways when it is wider
 * than the window (e.g. when the browser is zoomed in), so we move the rows with a transform instead.
 */
export function useStickyTable(ref: RefObject<HTMLDivElement | null>, shown: boolean) {
  useEffect(() => {
    const wrap = ref.current;
    if (!wrap) return;
    let raf = 0;

    const update = () => {
      raf = 0;
      const table = wrap.querySelector("table");
      if (!table) return;
      const head = table.querySelector("thead");
      const foot = table.querySelector("tfoot");
      const status = document.querySelector(".status");
      const top = status ? Math.max(0, status.getBoundingClientRect().bottom) : 0;
      const r = table.getBoundingClientRect();
      const hh = head?.getBoundingClientRect().height ?? 0;
      const fh = foot?.getBoundingClientRect().height ?? 0;
      const room = Math.max(0, r.height - hh - fh);
      const headY = Math.min(Math.max(0, top - r.top), room);
      const footY = Math.min(Math.max(0, r.bottom - window.innerHeight), room - headY);
      wrap.style.setProperty("--head-y", `${headY}px`);
      wrap.style.setProperty("--foot-y", `${-footY}px`);
    };
    const schedule = () => { if (!raf) raf = requestAnimationFrame(update); };

    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    const ro = new ResizeObserver(schedule); // rows opening/closing, data loading
    ro.observe(wrap);
    schedule();
    return () => {
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      ro.disconnect();
      if (raf) cancelAnimationFrame(raf);
    };
  }, [ref, shown]); // re-attach once the table is on the page
}
