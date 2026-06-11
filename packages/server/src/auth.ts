/**
 * Identity — guest-first cookie sessions (Phase A, doc 22).
 *
 * Playing never requires a form: the first request that needs an
 * identity mints an anonymous user + session and sets an httpOnly
 * cookie. A display name can be set later; email attach (magic link)
 * is a future phase. Sessions are opaque random tokens stored
 * server-side — nothing to forge, nothing to decode.
 */

import { randomBytes } from 'node:crypto';
import type { Context } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import type { GameStore, UserRow } from './db.js';

const SESSION_COOKIE = 'sid';
/** 399 days — the RFC 6265bis (and Hono-enforced) ceiling. Guests must
 *  survive long async games; sessions refresh on every request anyway. */
const COOKIE_MAX_AGE_S = 399 * 24 * 60 * 60;

const ADJECTIVES = [
  'silent', 'abyssal', 'rogue', 'crimson', 'pale', 'iron',
  'drowned', 'phantom', 'midnight', 'feral', 'hollow', 'arctic',
];
const NOUNS = [
  'kraken', 'leviathan', 'siren', 'manta', 'moray', 'nautilus',
  'angler', 'trench', 'barnacle', 'rip-tide', 'sounding', 'periscope',
];

function guestName(): string {
  const a = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)]!;
  const n = NOUNS[Math.floor(Math.random() * NOUNS.length)]!;
  const tag = randomBytes(2).toString('hex');
  return `${a}-${n}-${tag}`;
}

/** Per-request memo: when the first requireUser call MINTS a guest,
 *  the cookie only exists on the response — a second call in the same
 *  request would not see it and mint another guest. */
const resolved = new WeakMap<Context, UserRow>();

/**
 * Resolve the request's user, minting a guest identity (user +
 * session + cookie) when none exists. Always returns a user, and
 * always the SAME user for one request.
 */
export function requireUser(c: Context, store: GameStore): UserRow {
  const memo = resolved.get(c);
  if (memo !== undefined) return memo;
  const token = getCookie(c, SESSION_COOKIE);
  if (token !== undefined) {
    const user = store.userForSession(token);
    if (user !== null) {
      resolved.set(c, user);
      return user;
    }
  }
  const user = store.createUser(guestName());
  const fresh = randomBytes(32).toString('base64url');
  store.createSession(user.id, fresh);
  setCookie(c, SESSION_COOKIE, fresh, {
    httpOnly: true,
    sameSite: 'Lax',
    path: '/',
    maxAge: COOKIE_MAX_AGE_S,
  });
  resolved.set(c, user);
  return user;
}

/**
 * Resolve a user from a raw Cookie header (WebSocket upgrade requests
 * don't pass through Hono). Returns null rather than minting — a WS
 * connection without an identity has nothing to subscribe to.
 */
export function userFromCookieHeader(
  header: string | undefined,
  store: GameStore,
): UserRow | null {
  if (header === undefined) return null;
  const m = header.match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]+)`));
  if (m === null) return null;
  return store.userForSession(decodeURIComponent(m[1]!));
}
