import { useState, type ReactNode } from 'react';
import {
  HIRE_CADENCE_MS,
  type PlayerId,
  type World,
  hireRoster,
  previewHireRosters,
  promotionCandidates,
  queenOutpostOf,
  rosterKinds,
  specialistMeta,
} from '@subterfuge/sim';
import {
  postHire,
  postPromote,
  postQueueHire,
  postQueuePromote,
} from '../api.js';
import { BottomSheet } from '../BottomSheet.js';
import { SPECIALISTS } from '../specialistInfo.js';

interface HireSheetProps {
  world: World;
  activePlayerId: PlayerId;
  /** Time Machine: when true, hire/promote enqueue at `executeAt`
   *  instead of going through the 10-min pending fuse. */
  isScrubbed?: boolean;
  executeAt?: number;
  onClose: () => void;
  onError: (msg: string | null) => void;
  onInfo?: (msg: string) => void;
}

export function HireSheet({
  world,
  activePlayerId,
  isScrubbed = false,
  executeAt = 0,
  onClose,
  onError,
  onInfo,
}: HireSheetProps) {
  const player = world.players[activePlayerId as unknown as number]!;
  const roster = hireRoster(world, activePlayerId);
  const offered = rosterKinds(roster);
  const queenAt = queenOutpostOf(world, activePlayerId);
  const dueAt = player.nextHireAt;
  const dueIn = dueAt - world.time;
  const isDue = dueIn <= 0;
  const promotions = promotionCandidates(world, activePlayerId);
  // Next two rosters AFTER the current one — spec says the player can
  // see upcoming offers. We project deterministically; cap-state shown
  // is the live one (a kind that's at cap now is still excluded, even
  // though it might come back later).
  const upcoming = previewHireRosters(world, activePlayerId, 3).slice(1);

  const meta = isDue
    ? queenAt !== null
      ? '◉ ready'
      : 'queen away'
    : `in ${formatMs(dueIn)}`;

  const reason = !isDue
    ? `next hire in ${formatMs(dueIn)}`
    : queenAt === null
      ? 'queen must be at an owned outpost'
      : null;

  const blocked = !isDue || queenAt === null;
  const actionWord = isScrubbed ? 'queue' : 'hire';

  return (
    <BottomSheet
      open
      onClose={onClose}
      title={isScrubbed ? 'queue hire' : 'hire'}
      meta={meta}
    >
      {isScrubbed && (
        <div
          className="help"
          style={{
            marginBottom: 8,
            color: 'var(--warn)',
            letterSpacing: '0.04em',
          }}
        >
          scheduling for t+{formatMs(executeAt - world.time)} — order can be
          cancelled until that moment from the queue.
        </div>
      )}
      {reason && (
        <div className="help" style={{ marginBottom: 8 }}>
          {reason}
        </div>
      )}
      {offered.length === 0 ? (
        <div className="help">no candidates — all options excluded</div>
      ) : (
        offered.map((kind) => {
          const info = SPECIALISTS[kind];
          return (
            <RosterRow
              key={kind}
              glyph={info.glyph}
              title={kind.replace(/_/g, ' ')}
              sub={info.short}
              long={info.long}
              actionLabel={actionWord}
              disabled={blocked}
              onAction={async () => {
                onError(null);
                const r = isScrubbed
                  ? await postQueueHire({
                      ownerId: activePlayerId,
                      kind,
                      executeAt,
                    })
                  : await postHire({ ownerId: activePlayerId, kind });
                if (!r.ok) onError(r.error ?? 'hire failed');
                else {
                  // Only toast for the Time-Machine queue path —
                  // routine "pending" lives in the Orders sheet.
                  if (isScrubbed) onInfo?.('hire queued for the future');
                  onClose();
                }
              }}
            />
          );
        })
      )}

      {promotions.length > 0 && (
        <>
          <div className="section-title" style={{ marginTop: 12 }}>
            or promote — uses this hire window
          </div>
          {promotions.map((spec) => {
            const target = specialistMeta(spec.kind).promotesTo!;
            const targetInfo = SPECIALISTS[target];
            return (
              <RosterRow
                key={spec.id as unknown as number}
                glyph={targetInfo.glyph}
                title={target.replace(/_/g, ' ')}
                sub={`upgrade your ${spec.kind.replace(/_/g, ' ')} · ${targetInfo.short}`}
                long={targetInfo.long}
                actionLabel="promote"
                disabled={blocked}
                onAction={async () => {
                  onError(null);
                  const r = isScrubbed
                    ? await postQueuePromote({
                        ownerId: activePlayerId,
                        specialistId: spec.id,
                        executeAt,
                      })
                    : await postPromote({
                        ownerId: activePlayerId,
                        specialistId: spec.id,
                      });
                  if (!r.ok) onError(r.error ?? 'promote failed');
                  else {
                    if (isScrubbed) onInfo?.('promote queued for the future');
                    onClose();
                  }
                }}
              />
            );
          })}
        </>
      )}

      {upcoming.length > 0 && (
        <>
          <div className="section-title" style={{ marginTop: 12 }}>
            coming next
          </div>
          {upcoming.map((r, i) => {
            const offsetMs = (i + 1) * HIRE_CADENCE_MS + Math.max(0, dueIn);
            const kinds = rosterKinds(r);
            return (
              <div
                key={`upcoming-${i}`}
                className="row"
                style={{
                  fontSize: 11,
                  color: 'var(--txt-mute)',
                  letterSpacing: '0.02em',
                }}
              >
                <span>+{formatMs(offsetMs)}</span>
                <span className="val">
                  {kinds.length > 0
                    ? kinds.map((k) => k.replace(/_/g, ' ')).join(' · ')
                    : 'no candidates'}
                </span>
              </div>
            );
          })}
        </>
      )}
    </BottomSheet>
  );
}

/**
 * One roster row, used for hires AND promotions so the two read the
 * same way. Tap anatomy is deliberately split:
 *
 *   row body  → expand/collapse the full description (SAFE — nothing
 *               commits; this is what a curious tap should do)
 *   action    → an explicit labelled button on the right; the ONLY
 *               thing that hires/promotes.
 *
 * The old design made the whole row the hire button, so tapping the
 * glyph to read about a specialist HIRED them — an irreversible
 * mis-tap on the most exploratory surface in the game.
 */
function RosterRow({
  glyph,
  title,
  sub,
  long,
  actionLabel,
  disabled,
  onAction,
}: {
  glyph: string;
  title: string;
  sub: string;
  long: ReactNode;
  actionLabel: string;
  disabled: boolean;
  onAction: () => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`roster-row${open ? ' open' : ''}`}>
      <button
        type="button"
        className="roster-body"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        title={open ? 'collapse' : 'show full description'}
      >
        <span className="hire-glyph" aria-hidden="true">
          {glyph}
        </span>
        <span className="roster-text">
          <span className="roster-title">{title}</span>
          <span className="roster-sub">{sub}</span>
        </span>
        <span className="roster-chev" aria-hidden="true">
          {open ? '▾' : '▸'}
        </span>
      </button>
      <button
        type="button"
        className="btn roster-cta"
        disabled={disabled}
        onClick={() => void onAction()}
      >
        {actionLabel}
      </button>
      {open && <div className="roster-long">{long}</div>}
    </div>
  );
}

function formatMs(ms: number): string {
  const abs = Math.abs(ms);
  if (abs >= 3600_000) {
    const h = Math.floor(abs / 3600_000);
    const m = Math.floor((abs % 3600_000) / 60_000);
    return m === 0 ? `${h}h` : `${h}h${m}m`;
  }
  if (abs >= 60_000) {
    const m = Math.floor(abs / 60_000);
    return `${m}m`;
  }
  return `${Math.floor(abs / 1000)}s`;
}
