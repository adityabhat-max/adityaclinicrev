import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import TargetsEditor from "@/components/TargetsEditor";
import { SESSION_COOKIE, verifySession } from "@/lib/auth";
import { editableMonths } from "@/lib/dates";

export const dynamic = "force-dynamic";

export default async function TargetsPage() {
  const session = await verifySession((await cookies()).get(SESSION_COOKIE)?.value);
  if (!session) redirect("/login");
  if (session.role !== "admin") redirect("/");
  return <TargetsEditor user={{ name: session.name, role: session.role }} months={editableMonths()} />;
}
