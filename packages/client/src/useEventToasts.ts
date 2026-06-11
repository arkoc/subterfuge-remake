import { useEffect, useRef } from 'react';
import type {
  Outpost,
  OutpostId,
  PlayerId,
  SubId,
  World,
} from '@subterfuge/sim';
import { subStatus } from '@subterfuge/sim';
import type { ToastKind } from './Toasts.js';
import { playerLetter } from './colors.js';
import { formatEta } from './format.js';

interface EventToastsOptions {
  liveWorld: World | null;
  activePlayerId: PlayerId;
  onToast: (kind: ToastKind, text: string) => void;
}

/**
 * Watch successive snapshots of the live world and surface relevant
 * events as toasts:
 *
 *   - An outpost I own changed hands → "Lost X"
 *   - An outpost I now own that previously was someone else's → "Captured X"
 *   - A new hostile sub appeared inbound → "Enemy sub → X · ETA Yh"
 *   - The winner became set → "Player X wins"
 *   - A queued order disappeared without a corresponding sub launch → "Queued order dropped"
 *
 * Compares the previous snapshot to the current.
 */
export function useEventToasts({
  liveWorld,
  activePlayerId,
  onToast,
}: EventToastsOptions): void {
  const prevRef = useRef<World | null>(null);
  const seenInboundRef = useRef<Set<SubId>>(new Set());
  const announcedWinnerRef = useRef<PlayerId | null>(null);
  // Track the highest message id we've already toasted, so we surface
  // chat exactly once per new message (not on every world snapshot).
  const lastChatIdRef = useRef<number>(-1);

  useEffect(() => {
    if (!liveWorld || !Array.isArray(liveWorld.outposts) || !Array.isArray(liveWorld.subs)) {
      return;
    }
    const prev = prevRef.current;
    prevRef.current = liveWorld;

    // Winner change (always announce, regardless of prev)
    if (
      liveWorld.winnerId !== null &&
      announcedWinnerRef.current !== liveWorld.winnerId
    ) {
      announcedWinnerRef.current = liveWorld.winnerId;
      const isMe = liveWorld.winnerId === activePlayerId;
      const winnerName = liveWorld.players.find(
        (p) => p.id === liveWorld.winnerId,
      )?.name;
      onToast(
        isMe ? 'success' : 'warn',
        isMe
          ? `victory — you reached 200 kg`
          : `${winnerName} wins at 200 kg`,
      );
    }

    if (!prev) return;

    // Outpost ownership changes
    const prevById = new Map<OutpostId, Outpost>();
    for (const o of prev.outposts) prevById.set(o.id, o);
    for (const o of liveWorld.outposts) {
      const before = prevById.get(o.id);
      if (!before) continue;
      if (before.ownerId === o.ownerId) continue;
      if (before.ownerId === activePlayerId && o.ownerId !== activePlayerId) {
        onToast('warn', `lost ${o.name}${o.ownerId !== null ? ` to ${playerLetter(o.ownerId)}` : ''}`);
      } else if (o.ownerId === activePlayerId && before.ownerId !== activePlayerId) {
        onToast('success', `captured ${o.name}`);
      }
    }

    // New inbound hostile subs targeting my outposts
    const liveInbound = new Set<SubId>();
    for (const sub of liveWorld.subs) {
      if (sub.ownerId === activePlayerId) continue;
      if (sub.giftTo === activePlayerId) continue;
      if (subStatus(sub, liveWorld.time) === 'queued') continue;
      const dest = liveWorld.outposts.find((o) => o.id === sub.destinationId);
      if (!dest || dest.ownerId !== activePlayerId) continue;
      liveInbound.add(sub.id);
      if (!seenInboundRef.current.has(sub.id)) {
        const etaMs = sub.arrivalAt - liveWorld.time;
        onToast(
          'warn',
          `enemy sub → ${dest.name} · ETA ${formatEta(etaMs)}`,
        );
      }
    }
    seenInboundRef.current = liveInbound;

    // New chat messages visible to me (broadcast OR direct-to-me, not
    // from me). One toast per message id; old messages don't replay
    // on subscribe (we initialise lastChatIdRef to the latest id on
    // first run so historical messages don't all fire as toasts).
    if (Array.isArray(liveWorld.messages)) {
      const initial = lastChatIdRef.current === -1;
      let maxId = lastChatIdRef.current;
      for (const m of liveWorld.messages) {
        if (m.id > maxId) maxId = m.id;
        if (initial) continue; // first pass: just learn the watermark
        if (m.id <= lastChatIdRef.current) continue;
        if (m.from === activePlayerId) continue;
        const visibleToMe = m.to === null || m.to === activePlayerId;
        if (!visibleToMe) continue;
        const fromLetter = playerLetter(m.from);
        const prefix = m.to === null ? `${fromLetter} → all` : `${fromLetter} → you`;
        // Truncate long messages so the toast doesn't dominate the
        // screen — full text is always available in the comms sheet.
        const snippet =
          m.text.length > 60 ? `${m.text.slice(0, 57)}…` : m.text;
        onToast('info', `${prefix} · ${snippet}`);
      }
      lastChatIdRef.current = maxId;
    }
  }, [liveWorld, activePlayerId, onToast]);
}

