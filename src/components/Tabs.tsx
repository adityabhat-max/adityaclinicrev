import Link from "next/link";
import type { Role } from "@/lib/auth";

/** Dashboard / Targets / Splits tabs. Targets is only shown to the admin; everyone can see Splits (view only). */
export default function Tabs({ active, role }: { active: "dashboard" | "targets" | "splits"; role: Role }) {
  return (
    <nav className="tabs" aria-label="Pages">
      <Link href="/" className={active === "dashboard" ? "active" : ""}>Dashboard</Link>
      {role === "admin" && <Link href="/targets" className={active === "targets" ? "active" : ""}>Targets</Link>}
      <Link href="/splits" className={active === "splits" ? "active" : ""}>50/50 Splits</Link>
    </nav>
  );
}
