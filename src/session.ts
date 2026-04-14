const COOKIE_NAME = "prping_session";

async function sign(value: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(value)
  );
  const sigHex = Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `${value}.${sigHex}`;
}

async function verify(
  signed: string,
  secret: string
): Promise<string | null> {
  const lastDot = signed.lastIndexOf(".");
  if (lastDot === -1) return null;
  const value = signed.slice(0, lastDot);
  const expected = await sign(value, secret);
  if (expected.length !== signed.length) return null;
  let result = 0;
  for (let i = 0; i < expected.length; i++) {
    result |= expected.charCodeAt(i) ^ signed.charCodeAt(i);
  }
  return result === 0 ? value : null;
}

export async function createSessionCookie(
  userLogin: string,
  secret: string
): Promise<string> {
  const signed = await sign(userLogin, secret);
  return `${COOKIE_NAME}=${encodeURIComponent(signed)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=604800`;
}

export async function getSessionUser(
  cookieHeader: string | undefined,
  secret: string
): Promise<string | null> {
  if (!cookieHeader) return null;
  const match = cookieHeader.match(
    new RegExp(`(?:^|;\\s*)${COOKIE_NAME}=([^;]+)`)
  );
  if (!match) return null;
  return verify(decodeURIComponent(match[1]), secret);
}

export function clearSessionCookie(): string {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}
