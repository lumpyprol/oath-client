/**
 * Browser sessions (P4 unit 8). A signed, HttpOnly cookie carrying the seat
 * and game id — the mechanism that lets a browser authenticate without
 * setting the `x-player-token` header a JSON client uses (D58: a header
 * cannot ride an address bar or an `<img src>`, so cookies bootstrap the
 * browser flow).
 *
 * NO cookie-parser, NO cookie-signing library: the no-new-dependency
 * convention holds. Signing is an HMAC over `${gameId}:${seat}`; parsing is
 * a few lines. The cookie is long-lived on purpose — this is a friend group
 * playing over months, so an expiring session loses players rather than
 * buying security.
 */

import { createHmac, timingSafeEqual, randomBytes } from 'node:crypto';

const COOKIE_NAME = 'oath_session';
/** ~400 days; effectively "until you clear cookies". */
const MAX_AGE_SECONDS = 400 * 24 * 60 * 60;

/**
 * The signing secret. A real secret comes from the environment; in dev we
 * fall back to a per-boot random value and say so loudly — sessions then
 * do not survive a restart, which is fine locally and a clear signal to
 * set the variable in any real deployment.
 */
const SECRET: string = (() => {
  const fromEnv = process.env.SESSION_SECRET;
  if (fromEnv && fromEnv.length > 0) return fromEnv;
  const generated = randomBytes(32).toString('hex');
  console.warn(
    'SESSION_SECRET is not set — using a per-boot random secret; sessions will NOT survive a restart. Set SESSION_SECRET in any real deployment.',
  );
  return generated;
})();

const b64url = (buf: Buffer | string): string =>
  Buffer.from(buf).toString('base64url');

function sign(payload: string): string {
  return createHmac('sha256', SECRET).update(payload).digest('base64url');
}

export interface Session {
  gameId: string;
  seat: number;
}

/** The cookie VALUE (payload.signature), base64url throughout. */
export function encodeSession(session: Session): string {
  const payload = `${session.gameId}:${session.seat}`;
  return `${b64url(payload)}.${sign(payload)}`;
}

/** Verify and decode a cookie value, or null if absent/tampered/malformed. */
export function decodeSession(value: string | undefined): Session | null {
  if (!value) return null;
  const dot = value.indexOf('.');
  if (dot < 0) return null;
  const payloadB64 = value.slice(0, dot);
  const sig = value.slice(dot + 1);
  let payload: string;
  try {
    payload = Buffer.from(payloadB64, 'base64url').toString('utf8');
  } catch {
    return null;
  }
  const expected = sign(payload);
  // Constant-time compare; timingSafeEqual throws on length mismatch.
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  const colon = payload.lastIndexOf(':'); // a game id (UUID) contains no ':'
  if (colon < 0) return null;
  const gameId = payload.slice(0, colon);
  const seat = Number(payload.slice(colon + 1));
  if (!gameId || !Number.isInteger(seat) || seat < 0) return null;
  return { gameId, seat };
}

/** Parse a Cookie header into a name→value map. About five lines, as promised. */
export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? '').split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    out[part.slice(0, eq).trim()] = decodeURIComponent(part.slice(eq + 1).trim());
  }
  return out;
}

/** The session on this request, from its Cookie header, or null. */
export function sessionFromRequest(cookieHeader: string | undefined): Session | null {
  return decodeSession(parseCookies(cookieHeader)[COOKIE_NAME]);
}

/**
 * A `Set-Cookie` value establishing the session. HttpOnly (JS cannot read
 * it), SameSite=Lax (a top-level navigation from Discord carries it, but a
 * cross-site form POST does not), Path=/, long Max-Age, and Secure only
 * behind TLS — `secure` is decided per request so local http still works.
 */
export function setCookieHeader(session: Session, secure: boolean): string {
  const parts = [
    `${COOKIE_NAME}=${encodeSession(session)}`,
    'HttpOnly',
    'SameSite=Lax',
    'Path=/',
    `Max-Age=${MAX_AGE_SECONDS}`,
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

export { COOKIE_NAME, MAX_AGE_SECONDS };
