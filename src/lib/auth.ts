/**
 * Signed session cookie (HMAC-SHA256 via Web Crypto) — works in middleware (edge) and in Node routes.
 * Cookie value: base64url(JSON payload) + "." + base64url(signature).
 */
export type Role = "admin" | "viewer";
export interface Session { email: string; name: string; role: Role; exp: number }

export const SESSION_COOKIE = "sd_session";
export const SESSION_MAX_AGE = 7 * 24 * 3600; // seconds

const enc = new TextEncoder();
const toB64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64url = (s: string) =>
  Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));

async function key(): Promise<CryptoKey> {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) throw new Error("AUTH_SECRET is missing or too short");
  return crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

export async function signSession(s: Omit<Session, "exp">): Promise<string> {
  const payload: Session = { ...s, exp: Math.floor(Date.now() / 1000) + SESSION_MAX_AGE };
  const body = toB64url(enc.encode(JSON.stringify(payload)));
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", await key(), enc.encode(body)));
  return `${body}.${toB64url(sig)}`;
}

export async function verifySession(token: string | undefined | null): Promise<Session | null> {
  if (!token) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  try {
    const ok = await crypto.subtle.verify("HMAC", await key(), fromB64url(sig), enc.encode(body));
    if (!ok) return null;
    const s = JSON.parse(new TextDecoder().decode(fromB64url(body))) as Session;
    if (!s.exp || s.exp < Date.now() / 1000) return null;
    if (s.role !== "admin" && s.role !== "viewer") return null;
    return s;
  } catch {
    return null;
  }
}
