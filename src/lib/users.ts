import "server-only";
import { scryptSync, timingSafeEqual } from "node:crypto";
import type { Role } from "./auth";

/**
 * Two fixed accounts, configured through environment variables (never in the repo).
 * Password hashes are "scrypt:<saltHex>:<keyHex>" — create one with `node scripts/hash-password.cjs`.
 */
interface UserRecord { email: string; name: string; role: Role; hash: string }

function users(): UserRecord[] {
  const list: UserRecord[] = [
    { email: process.env.ADMIN_EMAIL ?? "", name: process.env.ADMIN_NAME ?? "Admin", role: "admin", hash: process.env.ADMIN_PASSWORD_HASH ?? "" },
    { email: process.env.VIEWER_EMAIL ?? "", name: process.env.VIEWER_NAME ?? "Viewer", role: "viewer", hash: process.env.VIEWER_PASSWORD_HASH ?? "" },
  ];
  return list.filter((u) => u.email && u.hash);
}

function checkPassword(password: string, stored: string): boolean {
  const [scheme, saltHex, keyHex] = stored.split(":");
  if (scheme !== "scrypt" || !saltHex || !keyHex) return false;
  const expected = Buffer.from(keyHex, "hex");
  const actual = scryptSync(password, Buffer.from(saltHex, "hex"), expected.length);
  return timingSafeEqual(actual, expected);
}

export function verifyLogin(email: string, password: string): Omit<UserRecord, "hash"> | null {
  const u = users().find((x) => x.email.toLowerCase() === email.trim().toLowerCase());
  if (!u || !checkPassword(password, u.hash)) return null;
  return { email: u.email, name: u.name, role: u.role };
}
