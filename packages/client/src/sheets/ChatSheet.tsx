import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  type OutpostId,
  type PlayerId,
  type World,
} from '@subterfuge/sim';
import { BottomSheet } from '../BottomSheet.js';
import { postChat } from '../api.js';
import { playerColorHex, playerLetter } from '../colors.js';
import {
  markSeen,
  threadOf,
  threadSummaries,
  type ThreadKey,
} from '../chatThreads.js';
import { formatTime } from '../format.js';

interface ChatSheetProps {
  world: World;
  activePlayerId: PlayerId;
  /** Open directly inside a thread (e.g. "hail" from an enemy outpost
   *  sheet). Omit to start on the conversation list. */
  initialThread?: ThreadKey;
  /** Fired whenever the viewer's seen-watermarks advance, so the App
   *  can refresh the msg tab badge immediately. */
  onSeenChange?: () => void;
  onClose: () => void;
  onError: (msg: string | null) => void;
  /** Tap on an @outpost mention → caller centers map + opens that
   *  outpost's sheet. */
  onJumpToOutpost?: (id: OutpostId) => void;
  /** Tap on an @player mention → caller can switch active POV (DEV)
   *  or just acknowledge. Currently we just no-op outside of DEV. */
  onJumpToPlayer?: (id: PlayerId) => void;
}

interface MentionCandidate {
  kind: 'outpost' | 'player';
  /** Display name shown in the autocomplete + inserted into text. */
  display: string;
  /** The exact token written into the text (without the `@`). */
  token: string;
  /** Sort key — owned outposts first, then alphabetical. */
  ownPriority: number;
}

/**
 * Comms sheet — a two-level chat:
 *
 *   LIST view    every conversation at a glance: the pinned ALL-STATIONS
 *                broadcast channel, then DM threads sorted by recency
 *                (unread count + last-message preview per row), then
 *                "start a conversation" rows for players you haven't
 *                talked to yet.
 *   THREAD view  one conversation: bubbles (yours right in phosphor,
 *                theirs left in their identity colour), composer with
 *                @mention autocomplete. Opening a thread — or receiving
 *                a message while it's open — advances the seen
 *                watermark, which clears the unread badges.
 *
 * Mentions are stored verbatim in the message text (e.g. "watch
 * @Triton") — no schema change needed. The renderer parses on display.
 */
export function ChatSheet({
  world,
  activePlayerId,
  initialThread,
  onSeenChange,
  onClose,
  onError,
  onJumpToOutpost,
  onJumpToPlayer,
}: ChatSheetProps) {
  const [thread, setThread] = useState<ThreadKey | null>(initialThread ?? null);
  const [text, setText] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Mention autocomplete state — derived from text + cursor position.
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionSelIdx, setMentionSelIdx] = useState(0);
  const [popoverRect, setPopoverRect] = useState<{
    left: number;
    bottom: number;
    width: number;
  } | null>(null);
  useLayoutEffect(() => {
    if (mentionQuery === null || !inputRef.current) {
      setPopoverRect(null);
      return;
    }
    const update = (): void => {
      const r = inputRef.current?.getBoundingClientRect();
      if (!r) return;
      setPopoverRect({
        left: r.left,
        bottom: window.innerHeight - r.top + 4,
        width: r.width,
      });
    };
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [mentionQuery]);

  const summaries = threadSummaries(world, activePlayerId);

  // Messages of the open thread, chronological.
  const threadMsgs = useMemo(() => {
    if (thread === null) return [];
    return world.messages.filter((m) => threadOf(m, activePlayerId) === thread);
  }, [world.messages, thread, activePlayerId]);

  const lastThreadMsgId =
    threadMsgs.length > 0 ? threadMsgs[threadMsgs.length - 1]!.id : -1;

  // SEEN: opening a thread or receiving into the open thread advances
  // the watermark immediately — the badge clears the moment you look.
  // Only notify when the watermark actually moved: onSeenChange
  // re-renders the App, so an unconditional call here would loop.
  useEffect(() => {
    if (thread === null || lastThreadMsgId < 0) return;
    if (markSeen(activePlayerId, thread, lastThreadMsgId)) {
      onSeenChange?.();
    }
  }, [thread, lastThreadMsgId, activePlayerId, onSeenChange]);

  // Pin the scroll to the newest message in thread view.
  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [threadMsgs.length, thread]);

  const partner =
    thread !== null && thread !== 'all'
      ? world.players.find((p) => (p.id as unknown as number) === thread) ?? null
      : null;
  const partnerGone = partner !== null && partner.eliminated;

  // Catalogue of all possible mentions.
  const candidates = useMemo<MentionCandidate[]>(() => {
    const out: MentionCandidate[] = [];
    for (const o of world.outposts) {
      out.push({
        kind: 'outpost',
        display: o.name,
        token: o.name,
        ownPriority: o.ownerId === activePlayerId ? 0 : 1,
      });
    }
    for (const p of world.players) {
      out.push({
        kind: 'player',
        display: `${playerLetter(p.id)} ${p.name}`,
        token: playerLetter(p.id),
        ownPriority: p.id === activePlayerId ? 0 : 1,
      });
    }
    return out;
  }, [world.outposts, world.players, activePlayerId]);

  const filteredMentions = useMemo<MentionCandidate[]>(() => {
    if (mentionQuery === null) return [];
    const q = mentionQuery.toLowerCase();
    const matches = candidates.filter((c) => c.token.toLowerCase().startsWith(q));
    matches.sort((a, b) => {
      if (a.ownPriority !== b.ownPriority) return a.ownPriority - b.ownPriority;
      return a.token.localeCompare(b.token);
    });
    return matches.slice(0, 8);
  }, [candidates, mentionQuery]);

  const updateMentionState = (raw: string, caret: number): void => {
    const left = raw.slice(0, caret);
    const atIdx = left.lastIndexOf('@');
    if (atIdx === -1) {
      setMentionQuery(null);
      return;
    }
    const charBefore = atIdx === 0 ? ' ' : left[atIdx - 1];
    if (charBefore !== undefined && /\S/.test(charBefore)) {
      setMentionQuery(null);
      return;
    }
    const between = left.slice(atIdx + 1);
    if (/\s/.test(between)) {
      setMentionQuery(null);
      return;
    }
    setMentionQuery(between);
    setMentionSelIdx(0);
  };

  const insertMention = (c: MentionCandidate): void => {
    const input = inputRef.current;
    if (!input) return;
    const caret = input.selectionStart ?? text.length;
    const left = text.slice(0, caret);
    const right = text.slice(caret);
    const atIdx = left.lastIndexOf('@');
    if (atIdx === -1) return;
    const replaced = left.slice(0, atIdx) + `@${c.token} ` + right;
    setText(replaced);
    setMentionQuery(null);
    const newCaret = atIdx + c.token.length + 2;
    requestAnimationFrame(() => {
      input.focus();
      input.setSelectionRange(newCaret, newCaret);
    });
  };

  const send = async (): Promise<void> => {
    const trimmed = text.trim();
    if (!trimmed || thread === null) return;
    const to = thread === 'all' ? null : (thread as unknown as PlayerId);
    const r = await postChat({ from: activePlayerId, to, text: trimmed });
    if (!r.ok) onError(r.error ?? 'chat failed');
    else setText('');
  };

  // ---------------- LIST VIEW ----------------
  if (thread === null) {
    const totalConvos = summaries.filter((s) => s.last !== null).length;
    return (
      <BottomSheet
        open
        onClose={onClose}
        title="comms"
        meta={
          totalConvos === 0
            ? 'no conversations yet'
            : `${totalConvos} conversation${totalConvos === 1 ? '' : 's'}`
        }
      >
        {summaries.map((s) => {
          const isAll = s.key === 'all';
          const name = isAll
            ? 'all stations'
            : `${playerLetter(s.partnerId)} ${
                world.players.find((p) => p.id === s.partnerId)?.name ?? '?'
              }`;
          const color = isAll ? 'var(--phos)' : playerColorHex(s.partnerId);
          const gone =
            !isAll &&
            (world.players.find((p) => p.id === s.partnerId)?.eliminated ?? false);
          return (
            <button
              key={String(s.key)}
              type="button"
              className={`convo-row${s.unread > 0 ? ' has-unread' : ''}${gone ? ' convo-gone' : ''}`}
              onClick={() => setThread(s.key)}
            >
              <span
                className={`convo-avatar${isAll ? ' convo-avatar-all' : ''}`}
                style={{ borderColor: color, color }}
                aria-hidden="true"
              >
                {isAll ? '⊕' : playerLetter(s.partnerId)}
              </span>
              <span className="convo-main">
                <span className="convo-name" style={{ color }}>
                  {name}
                  {isAll && <span className="convo-sub">broadcast — everyone reads this</span>}
                  {gone && <span className="convo-sub">eliminated — archive</span>}
                </span>
                <span className="convo-preview">
                  {s.last === null ? (
                    <span className="convo-start">start a conversation ›</span>
                  ) : (
                    <>
                      {s.last.from === activePlayerId
                        ? 'you: '
                        : isAll
                          ? `${playerLetter(s.last.from)}: `
                          : ''}
                      {s.last.text}
                    </>
                  )}
                </span>
              </span>
              <span className="convo-side">
                {s.last !== null && (
                  <span className="convo-time">{formatTime(s.last.sentAt)}</span>
                )}
                {s.unread > 0 && (
                  <span className="convo-unread">
                    {s.unread > 99 ? '99+' : s.unread}
                  </span>
                )}
              </span>
            </button>
          );
        })}
      </BottomSheet>
    );
  }

  // ---------------- THREAD VIEW ----------------
  const isAll = thread === 'all';
  const headerColor = isAll ? 'var(--phos)' : playerColorHex(partner?.id ?? null);
  return (
    <BottomSheet
      open
      onClose={onClose}
      title="comms"
      meta={isAll ? 'all stations' : `dm · ${partner?.name ?? '?'}`}
    >
      <div className="thread-head">
        <button
          type="button"
          className="thread-back"
          onClick={() => setThread(null)}
          aria-label="back to conversations"
        >
          ‹
        </button>
        <span
          className={`convo-avatar${isAll ? ' convo-avatar-all' : ''}`}
          style={{ borderColor: headerColor, color: headerColor }}
          aria-hidden="true"
        >
          {isAll ? '⊕' : playerLetter(partner?.id ?? null)}
        </span>
        <span className="thread-title" style={{ color: headerColor }}>
          {isAll ? 'all stations' : `${playerLetter(partner?.id ?? null)} ${partner?.name ?? '?'}`}
          <span className="convo-sub">
            {isAll
              ? 'broadcast — every player reads this channel'
              : partnerGone
                ? 'eliminated — archive only'
                : 'private — only the two of you'}
          </span>
        </span>
      </div>

      <div ref={listRef} className="chat-log chat-thread">
        {threadMsgs.length === 0 && (
          <div className="empty">
            {isAll ? 'no transmissions yet. say hello.' : 'no messages yet. open the channel.'}
          </div>
        )}
        {threadMsgs.map((m) => {
          const mine = m.from === activePlayerId;
          return (
            <div key={m.id} className={`bubble ${mine ? 'bubble-mine' : 'bubble-theirs'}`}>
              {!mine && isAll && (
                <span
                  className="bubble-from"
                  style={{ color: playerColorHex(m.from) }}
                >
                  {playerLetter(m.from)}{' '}
                  {world.players.find((p) => p.id === m.from)?.name ?? ''}
                </span>
              )}
              <span className="bubble-text">
                {renderMentions(m.text, world, onJumpToOutpost, onJumpToPlayer)}
              </span>
              <span className="bubble-time">{formatTime(m.sentAt)}</span>
            </div>
          );
        })}
      </div>

      {partnerGone ? (
        <div className="help">this player has been eliminated — the archive stays readable.</div>
      ) : (
        <div className="chat-input" style={{ position: 'relative' }}>
          <textarea
            ref={inputRef}
            rows={1}
            value={text}
            maxLength={500}
            placeholder={
              isAll ? 'broadcast… try @name' : `message ${partner?.name ?? ''}…`
            }
            onChange={(e) => {
              const v = e.target.value;
              setText(v);
              updateMentionState(v, e.target.selectionStart ?? v.length);
              // Auto-grow up to the CSS max-height, then scroll.
              const el = e.target as HTMLTextAreaElement;
              el.style.height = 'auto';
              el.style.height = `${el.scrollHeight}px`;
            }}
            onKeyDown={(e) => {
              if (mentionQuery !== null && filteredMentions.length > 0) {
                if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  setMentionSelIdx((i) => Math.min(filteredMentions.length - 1, i + 1));
                  return;
                }
                if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  setMentionSelIdx((i) => Math.max(0, i - 1));
                  return;
                }
                if (e.key === 'Enter' || e.key === 'Tab') {
                  e.preventDefault();
                  const pick = filteredMentions[mentionSelIdx];
                  if (pick !== undefined) insertMention(pick);
                  return;
                }
                if (e.key === 'Escape') {
                  e.preventDefault();
                  setMentionQuery(null);
                  return;
                }
              }
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void send();
                // Reset the auto-grown height after sending.
                const el = e.currentTarget as HTMLTextAreaElement;
                requestAnimationFrame(() => {
                  el.style.height = 'auto';
                });
              }
            }}
            onSelect={(e) => {
              const t = e.target as HTMLTextAreaElement;
              updateMentionState(t.value, t.selectionStart ?? t.value.length);
            }}
          />
          {mentionQuery !== null && filteredMentions.length > 0 && popoverRect !== null &&
            createPortal(
              <div
                className="mention-popover"
                role="listbox"
                aria-label="mention suggestions"
                style={{
                  position: 'fixed',
                  left: popoverRect.left,
                  bottom: popoverRect.bottom,
                  width: popoverRect.width,
                }}
              >
                {filteredMentions.map((c, idx) => (
                  <button
                    key={`${c.kind}-${c.token}`}
                    type="button"
                    className={`mention-row${idx === mentionSelIdx ? ' active' : ''}`}
                    onMouseEnter={() => setMentionSelIdx(idx)}
                    onClick={() => insertMention(c)}
                  >
                    <span className={`mention-kind-tag mention-tag-${c.kind}`}>
                      {c.kind === 'outpost' ? '⌖' : '◉'}
                    </span>
                    <span className="mention-row-name">{c.display}</span>
                    <span className="mention-row-token">@{c.token}</span>
                  </button>
                ))}
              </div>,
              document.body,
            )}
          <button
            type="button"
            className="chat-send"
            aria-label="send message"
            title="send (enter) · new line (shift+enter)"
            onClick={() => void send()}
            disabled={text.trim().length === 0}
          >
            {'➤\uFE0E'}
          </button>
        </div>
      )}
    </BottomSheet>
  );
}

/** Parse `@Token` substrings and render matches as clickable chips.
 *  Unmatched `@thing` text stays as plain text. The first match wins
 *  (outpost > player) for ambiguous tokens. */
function renderMentions(
  text: string,
  world: World,
  onJumpToOutpost: ((id: OutpostId) => void) | undefined,
  onJumpToPlayer: ((id: PlayerId) => void) | undefined,
): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  const re = /(^|\s)@([A-Za-z][A-Za-z0-9_-]*)/g;
  let lastIdx = 0;
  let match: RegExpExecArray | null;
  let n = 0;
  while ((match = re.exec(text)) !== null) {
    const [, lead, token] = match;
    const start = match.index + (lead ?? '').length;
    if (start > lastIdx) {
      out.push(<span key={`t${n++}`}>{text.slice(lastIdx, start)}</span>);
    }
    const tokenLower = (token ?? '').toLowerCase();
    const outpost = world.outposts.find(
      (o) => o.name.toLowerCase() === tokenLower,
    );
    const player = !outpost
      ? world.players.find((p) => playerLetter(p.id).toLowerCase() === tokenLower)
      : undefined;
    if (outpost && onJumpToOutpost !== undefined) {
      out.push(
        <button
          key={`m${n++}`}
          type="button"
          className="mention-chip mention-chip-outpost"
          onClick={() => onJumpToOutpost(outpost.id)}
          title={`centre map on ${outpost.name}`}
        >
          @{token}
        </button>,
      );
    } else if (player) {
      out.push(
        <button
          key={`m${n++}`}
          type="button"
          className="mention-chip mention-chip-player"
          style={{ color: playerColorHex(player.id) }}
          onClick={() => onJumpToPlayer?.(player.id)}
          title={`${playerLetter(player.id)} ${player.name}`}
        >
          @{token}
        </button>,
      );
    } else {
      out.push(<span key={`u${n++}`}>{`@${token}`}</span>);
    }
    lastIdx = re.lastIndex;
  }
  if (lastIdx < text.length) {
    out.push(<span key={`t${n++}`}>{text.slice(lastIdx)}</span>);
  }
  return out;
}

