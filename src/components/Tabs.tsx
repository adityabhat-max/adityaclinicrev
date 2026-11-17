import Link from "next/link";
import type { Role } from "@/lib/auth";

/** Dashboard / Targets tabs. The Targets tab is only shown to the admin. */
export default function Tabs({ active, role }: { active: "dashboard" | "targets"; role: Role }) {
  return (
    <nav className="tabs" aria-label="Pages">
      <Link href="/" className={active === "dashboard" ? "active" : ""}>Dashboard</Link>
      {role === "admin" && <Link href="/targets" className={active === "targets" ? "active" : ""}>Targets</Link>}
    </nav>
  );
}
