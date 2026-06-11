import type { ChatMessage, PlayerId, World } from './types.js';
import { MAX_CHAT_MESSAGES } from './types.js';
import { playerById } from './queries.js';

/**
 * Diplomacy mechanics — chat and gifts.
 *
 * Gifts are handled in `arriveSub` (subs.ts); this file holds chat:
 * appendMessage / messagesVisibleTo.
 *
 * Funding was removed entirely (June 2026) — see
 * docs/21_contracts_and_drowned_queen_plan.md for the replacement design.
 *
 * Captives release (Diplomat) and conversion (Hypnotist) belong to
 * the specialist phase.
 */

// ---------- Chat ----------

export interface PostMessageInput {
  readonly from: PlayerId;
  /** null = global broadcast; otherwise a DM to this player. */
  readonly to: PlayerId | null;
  readonly text: string;
}

export function appendMessage(world: World, input: PostMessageInput): ChatMessage {
  const text = input.text.trim();
  if (text.length === 0) {
    throw new Error('message text must be non-empty');
  }
  if (text.length > 500) {
    throw new Error('message text too long (max 500 chars)');
  }
  // Verify recipient exists if it's a DM
  if (input.to !== null) {
    playerById(world, input.to);
  }
  playerById(world, input.from);

  const msg: ChatMessage = {
    id: world.nextMessageId,
    from: input.from,
    to: input.to,
    text,
    sentAt: world.time,
  };
  world.nextMessageId += 1;
  world.messages.push(msg);

  // Cap retained history. Cheaper than a deque; messages array is
  // small enough that O(n) splice is fine.
  if (world.messages.length > MAX_CHAT_MESSAGES) {
    world.messages.splice(0, world.messages.length - MAX_CHAT_MESSAGES);
  }
  return msg;
}

/**
 * Filter chat messages to those a given viewer should see: global
 * messages plus any DM involving them.
 */
export function messagesVisibleTo(world: World, viewerId: PlayerId): ChatMessage[] {
  return world.messages.filter(
    (m) => m.to === null || m.to === viewerId || m.from === viewerId,
  );
}

