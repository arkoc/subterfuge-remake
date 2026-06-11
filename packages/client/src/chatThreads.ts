import type { ChatMessage, PlayerId, World } from '@subterfuge/sim';

/**
 * Client-side chat thread model.
 *
 * The sim stores one flat message log (global broadcasts + DMs, already
 * filtered per viewer by the server). The client organises it into
 * THREADS: the pinned "all stations" broadcast channel plus one DM
 * thread per other player.
 *
 * Seen/unseen is deliberately CLIENT-side state (localStorage, keyed
 * per viewing player): read receipts are presentation, not game rules —
 * they have no business inside the deterministic sim or the event log.
 */

/** 'all' = the global broadcast channel; a number = DM partner id. */
export type ThreadKey = 'all' | number;

/** Which thread does a message belong to, from `me`'s point of view? */
export function threadOf(m: ChatMessage, me: PlayerId): ThreadKey {
  if (m.to === null) return 'all';
  return (m.from === me ? m.to : m.from) as unknown as number;
}

export interface ThreadSummary {
  key: ThreadKey;
  /** DM partner, or null for the broadcast channel. */
  partnerId: PlayerId | null;
  /** Newest message in the thread (null = no history yet). */
  last: ChatMessage | null;
  /** Messages from others newer than the viewer's seen watermark. */
  unread: number;
}

type SeenMap = Record<string, number>;

const seenStorageKey = (me: PlayerId): string =>
  `subterfuge-chat-seen-p${me as unknown as number}`;

/** Load the per-thread "last seen message id" watermarks. */
export function loadSeen(me: PlayerId): SeenMap {
  try {
    const raw = localStorage.getItem(seenStorageKey(me));
    if (raw === null) return {};
    const parsed = JSON.parse(raw) as unknown;
    return typeof parsed === 'object' && parsed !== null ? (parsed as SeenMap) : {};
  } catch {
    return {};
  }
}

/**
 * Advance a thread's seen watermark (monotonic — never goes back).
 * Returns true only when the watermark actually moved, so callers can
 * gate their notify-the-badge side effects and never loop.
 */
export function markSeen(me: PlayerId, key: ThreadKey, lastMsgId: number): boolean {
  const map = loadSeen(me);
  const k = String(key);
  if ((map[k] ?? -1) >= lastMsgId) return false;
  map[k] = lastMsgId;
  try {
    localStorage.setItem(seenStorageKey(me), JSON.stringify(map));
  } catch {
    /* storage full / private mode — unread state degrades gracefully */
  }
  return true;
}

/**
 * Build the conversation list: the broadcast channel first, then every
 * other player — those with history sorted newest-first, the rest in
 * letter order (so "start a conversation" targets are stable).
 * Eliminated players are included only when history exists (you can
 * read the archive, and the UI disables their composer).
 */
export function threadSummaries(world: World, me: PlayerId): ThreadSummary[] {
  const seen = loadSeen(me);
  const byThread = new Map<string, { last: ChatMessage; unread: number }>();
  for (const m of world.messages) {
    const key = String(threadOf(m, me));
    const cur = byThread.get(key);
    const watermark = seen[key] ?? -1;
    const isUnread = m.from !== me && m.id > watermark;
    if (cur === undefined) {
      byThread.set(key, { last: m, unread: isUnread ? 1 : 0 });
    } else {
      if (m.id > cur.last.id) cur.last = m;
      if (isUnread) cur.unread += 1;
    }
  }

  const all = byThread.get('all');
  const out: ThreadSummary[] = [
    {
      key: 'all',
      partnerId: null,
      last: all?.last ?? null,
      unread: all?.unread ?? 0,
    },
  ];

  const partners = world.players.filter((p) => p.id !== me);
  const withHistory: ThreadSummary[] = [];
  const fresh: ThreadSummary[] = [];
  for (const p of partners) {
    const key = String(p.id as unknown as number);
    const t = byThread.get(key);
    const summary: ThreadSummary = {
      key: p.id as unknown as number,
      partnerId: p.id,
      last: t?.last ?? null,
      unread: t?.unread ?? 0,
    };
    if (t !== undefined) withHistory.push(summary);
    else if (!p.eliminated) fresh.push(summary);
  }
  withHistory.sort((a, b) => (b.last?.sentAt ?? 0) - (a.last?.sentAt ?? 0));
  return [...out, ...withHistory, ...fresh];
}

/** Total unread across all threads — drives the msg tab badge. */
export function totalUnread(world: World, me: PlayerId): number {
  let n = 0;
  for (const t of threadSummaries(world, me)) n += t.unread;
  return n;
}
