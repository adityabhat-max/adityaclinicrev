import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import SplitsPage from "@/components/SplitsPage";
import { SESSION_COOKIE, verifySession } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function Splits() {
  const session = await verifySession((await cookies()).get(SESSION_COOKIE)?.value);
  if (!session) redirect("/login");
  return <SplitsPage user={{ name: session.name, role: session.role }} />;
}
