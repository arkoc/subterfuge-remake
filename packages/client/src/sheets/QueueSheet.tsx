import {
  DAY_MS,
  HOUR_MS,
  MINUTE_MS,
  type DeferableCommand,
  type OutpostId,
  type PlayerId,
  type QueuedOrder,
  type SpecialistKind,
  type SubId,
  type World,
  specialistMeta,
} from '@subterfuge/sim';
import { BottomSheet } from '../BottomSheet.js';
import {
  deletePendingCommand,
  deleteQueuedOrder,
  finalizePendingCommand,
  postCancelSub,
} from '../api.js';
import { SPECIALISTS } from '../specialistInfo.js';
import { playerColorHex, playerLetter } from '../colors.js';

interface QueueSheetProps {
  world: World;
  /** Always-live world. Used so the queue list stays complete even
   *  when the user scrubs back to a past view; items that haven't
   *  fired yet from that past vantage are dimmed. */
  liveWorld: World;
  activePlayerId: PlayerId;
  onClose: () => void;
  onError: (msg: string | null) => void;
  /** Open a pre-launch sub's popover (cargo slider + specialist
   *  checkboxes + cancel) — the EDIT path for a launching order. */
  onEditSub?: (subId: SubId) => void;
}

/**
 * Orders sheet — two sections per docs/12 §H.6:
 *
 *   PENDING   the 10-minute cancel fuse (warn rail). These fire soon;
 *             the row exists so the player can abort or fast-commit.
 *   SCHEDULED Time-Machine orders (phos rail), sorted by executeAt.
 *
 * Every row is self-explanatory without tapping through: a kind tag
 * (LAUNCH / DRILL / HIRE / …), then a STRUCTURED description — routes
 * render as `SCYLLA → CHARYBDIS` in map-label styling with the cargo
 * spelled out, specialists carry their glyph + name, and sub-targeting
 * orders describe the sub by its origin and cargo instead of leaking
 * internal ids ("sub #3" means nothing to a player).
 */
export function QueueSheet({
  world,
  liveWorld,
  activePlayerId,
  onClose,
  onError,
  onEditSub,
}: QueueSheetProps) {
  const myPending = liveWorld.pendingCommands
    .filter((p) => p.ownerId === activePlayerId)
    .sort((a, b) => a.executeAt - b.executeAt);
  const myQueued = liveWorld.queuedOrders
    .filter((q) => q.ownerId === activePlayerId)
    .sort((a, b) => a.executeAt - b.executeAt);
  // Pre-launch subs — ordered but not yet departed. They live on
  // `Sub.launchAt` rather than the pending-commands queue (the sub
  // object already exists so the pre-launch cargo editor can mutate
  // it), but to the PLAYER they're just another cancellable order, so
  // the Orders sheet lists them alongside everything else. Tapping the
  // sub's blip on the map offers the same cancel plus cargo editing.
  const myPreLaunch = liveWorld.subs
    .filter((s) => s.ownerId === activePlayerId && s.launchAt > liveWorld.time)
    .sort((a, b) => a.launchAt - b.launchAt);
  const viewTime = world.time;
  const isScrubbedBack = viewTime < liveWorld.time;

  return (
    <BottomSheet
      open
      onClose={onClose}
      title="orders"
      meta={`${myPreLaunch.length + myPending.length} pending · ${myQueued.length} scheduled`}
    >
      {myPending.length === 0 && myQueued.length === 0 && myPreLaunch.length === 0 && (
        <div className="empty">
          no pending or scheduled orders. issue a command and you'll have a
          10-minute window to cancel it here; scrub the timeline forward
          before launching to schedule for later.
        </div>
      )}

      {myPreLaunch.length > 0 && (
        <div className="section-title queue-section queue-section-pending">
          launching — pre-departure
        </div>
      )}
      {myPreLaunch.map((s) => {
        const eta = s.launchAt - viewTime;
        const dimmed = isScrubbedBack && s.launchAt > viewTime;
        return (
          <div
            key={`s${s.id as unknown as number}`}
            className={`queue-row queue-row-pending${dimmed ? ' queue-row-dim' : ''}`}
          >
            <span className="queue-main">
              <span className="queue-label">
                <span className="tag queue-kind-tag queue-kind-pending">launch</span>
                <span>
                  <Place world={liveWorld} id={s.sourceId} />
                  <Arrow />
                  <Place world={liveWorld} id={s.destinationId} />
                  <span className="queue-cargo"> · {s.drillers} drl</span>
                  {s.giftTo !== undefined && (
                    <span style={{ color: playerColorHex(s.giftTo) }}>
                      {' '}
                      · gift to {playerLetter(s.giftTo)}
                    </span>
                  )}
                </span>
              </span>
              <span className="queue-when queue-when-pending">
                departs in {formatRel(eta)}
              </span>
            </span>
            <span className="queue-actions">
              {onEditSub !== undefined && (
                <button
                  type="button"
                  className="btn queue-act"
                  title="change driller count / specialists aboard before departure"
                  onClick={() => onEditSub(s.id)}
                >
                  edit
                </button>
              )}
              <button
                type="button"
                className="btn ghost queue-cancel queue-act"
                title="cancel the launch — drillers and specialists return to the source"
                onClick={async () => {
                  const r = await postCancelSub({
                    ownerId: activePlayerId,
                    subId: s.id,
                  });
                  if (!r.ok) onError(r.error ?? 'failed to cancel launch');
                }}
              >
                cancel
              </button>
            </span>
          </div>
        );
      })}

      {myPending.length > 0 && (
        <div className="section-title queue-section queue-section-pending">
          pending — 10-min fuse
        </div>
      )}
      {myPending.map((cmd) => {
        const eta = cmd.executeAt - viewTime;
        const dimmed = isScrubbedBack && cmd.executeAt > viewTime;
        return (
          <div
            key={`p${cmd.id as unknown as number}`}
            className={`queue-row queue-row-pending${dimmed ? ' queue-row-dim' : ''}`}
          >
            <span className="queue-main">
              <span className="queue-label">
                <span className="tag queue-kind-tag queue-kind-pending">
                  {kindTagOf(cmd.command.kind)}
                </span>
                <CommandDetail command={cmd.command} world={liveWorld} />
              </span>
              <span className="queue-when queue-when-pending">
                fuse {formatRel(eta)} · t={formatAbsolute(cmd.executeAt)}
              </span>
            </span>
            <span className="queue-actions">
              {cmd.command.kind === 'hire' && (
                <button
                  type="button"
                  className="btn queue-act"
                  title={
                    cmd.executeAt > liveWorld.time
                      ? 'finalize instantly, skipping the 10-minute window'
                      : 'commit this pending hire at its original scheduled time'
                  }
                  onClick={async () => {
                    const r = await finalizePendingCommand(
                      cmd.id as unknown as number,
                      activePlayerId,
                    );
                    if (!r.ok) onError(r.error ?? 'failed to finalize');
                  }}
                >
                  {cmd.executeAt > liveWorld.time
                    ? 'finalize now'
                    : `finalize @ ${formatAbsolute(cmd.executeAt)}`}
                </button>
              )}
              <button
                type="button"
                className="btn ghost queue-cancel queue-act"
                onClick={async () => {
                  const r = await deletePendingCommand(
                    cmd.id as unknown as number,
                    activePlayerId,
                  );
                  if (!r.ok) onError(r.error ?? 'failed to cancel');
                }}
              >
                cancel
              </button>
            </span>
          </div>
        );
      })}

      {myQueued.length > 0 && (
        <div className="section-title queue-section queue-section-sched">
          scheduled
        </div>
      )}
      {myQueued.map((q) => {
        const eta = q.executeAt - viewTime;
        const dimmed = isScrubbedBack && q.executeAt > viewTime;
        return (
          <div
            key={`q${q.id as unknown as number}`}
            className={`queue-row queue-row-sched${dimmed ? ' queue-row-dim' : ''}`}
          >
            <span className="queue-main">
              <span className="queue-label">
                <span className="tag queue-kind-tag queue-kind-sched">
                  {kindTagOf(q.kind)}
                </span>
                <QueuedDetail order={q} world={liveWorld} />
              </span>
              <span className="queue-when queue-when-sched">
                in {formatRel(eta)} · t={formatAbsolute(q.executeAt)}
              </span>
            </span>
            <span className="queue-actions">
              <button
                type="button"
                className="btn ghost queue-cancel queue-act"
                onClick={async () => {
                  const r = await deleteQueuedOrder(q.id, activePlayerId);
                  if (!r.ok) onError(r.error ?? 'failed to cancel');
                }}
              >
                cancel
              </button>
            </span>
          </div>
        );
      })}
    </BottomSheet>
  );
}

// ---------------------------------------------------------------------
// Structured row details
// ---------------------------------------------------------------------

/** Short uppercase tag naming the command kind. */
function kindTagOf(kind: string): string {
  switch (kind) {
    case 'launch': return 'launch';
    case 'drill': return 'drill';
    case 'hire': return 'hire';
    case 'promote': return 'promote';
    case 'redirect': return 'redirect';
    case 'pirate-target': return 'pirate';
    case 'release-captive': return 'release';
    default: return kind;
  }
}

function Place({ world, id }: { world: World; id: OutpostId }) {
  return (
    <span className="queue-place">
      {world.outposts.find((o) => o.id === id)?.name ?? '?'}
    </span>
  );
}

function Arrow() {
  return (
    <span className="queue-arrow" aria-hidden="true">
      →
    </span>
  );
}

function Spec({ kind }: { kind: SpecialistKind }) {
  return (
    <span className="queue-spec">
      <span aria-hidden="true">{SPECIALISTS[kind]?.glyph ?? '◌'}</span>{' '}
      {kind.replace(/_/g, ' ')}
    </span>
  );
}

/** Describe a sub by what a player can see — origin + cargo — never by
 *  internal id. Falls back gracefully if the sub has since resolved. */
function SubRef({ world, subId }: { world: World; subId: SubId }) {
  const sub = world.subs.find(
    (s) => (s.id as unknown as number) === (subId as unknown as number),
  );
  if (sub === undefined) {
    return <span className="queue-gone">a sub that has since arrived</span>;
  }
  return (
    <span>
      sub from <Place world={world} id={sub.sourceId} />
      <span className="queue-cargo"> · {sub.drillers} drl</span>
      {sub.ownerId !== undefined && (
        <span
          className="queue-owner"
          style={{ color: playerColorHex(sub.ownerId) }}
        >
          {' '}
          ({playerLetter(sub.ownerId)})
        </span>
      )}
    </span>
  );
}

function QueuedDetail({ order: q, world }: { order: QueuedOrder; world: World }) {
  switch (q.kind) {
    case 'launch':
      return (
        <span>
          <Place world={world} id={q.sourceId} />
          <Arrow />
          <Place world={world} id={q.destinationId} />
          <span className="queue-cargo"> · {q.drillers} drl</span>
          {q.giftTo !== undefined && (
            <span style={{ color: playerColorHex(q.giftTo) }}>
              {' '}
              · gift to {playerLetter(q.giftTo)}
            </span>
          )}
          {q.specialistIds !== undefined && q.specialistIds.length > 0 && (
            <span className="queue-cargo">
              {' '}
              · {q.specialistIds.length} specialist
              {q.specialistIds.length > 1 ? 's' : ''} aboard
            </span>
          )}
        </span>
      );
    case 'drill':
      return (
        <span>
          convert <Place world={world} id={q.outpostId} /> to a mine
        </span>
      );
    case 'hire':
      return <Spec kind={q.specialistKind} />;
    case 'promote': {
      const s = world.specialists.find(
        (x) => (x.id as unknown as number) === (q.specialistId as unknown as number),
      );
      if (s === undefined) return <span>promote specialist</span>;
      const target = specialistMeta(s.kind).promotesTo;
      return (
        <span>
          <Spec kind={s.kind} />
          {target != null && (
            <>
              <Arrow />
              <Spec kind={target} />
            </>
          )}
        </span>
      );
    }
    case 'redirect':
      return (
        <span>
          <SubRef world={world} subId={q.subId} />
          <Arrow />
          <Place world={world} id={q.newDestinationId} />
        </span>
      );
    case 'pirate-target':
      return (
        <span>
          <SubRef world={world} subId={q.subId} /> hunts{' '}
          <SubRef world={world} subId={q.targetSubId} />
        </span>
      );
  }
}

function CommandDetail({
  command: c,
  world,
}: {
  command: DeferableCommand;
  world: World;
}) {
  switch (c.kind) {
    case 'drill':
      return (
        <span>
          convert <Place world={world} id={c.outpostId} /> to a mine
        </span>
      );
    case 'hire':
      return <Spec kind={c.specialistKind} />;
    case 'promote': {
      const s = world.specialists.find(
        (x) => (x.id as unknown as number) === (c.specialistId as unknown as number),
      );
      if (s === undefined) return <span>promote specialist</span>;
      const target = specialistMeta(s.kind).promotesTo;
      return (
        <span>
          <Spec kind={s.kind} />
          {target != null && (
            <>
              <Arrow />
              <Spec kind={target} />
            </>
          )}
        </span>
      );
    }
    case 'redirect':
      return (
        <span>
          <SubRef world={world} subId={c.subId} />
          <Arrow />
          <Place world={world} id={c.newDestinationId} />
        </span>
      );
    case 'pirate-target':
      return (
        <span>
          <SubRef world={world} subId={c.subId} /> hunts{' '}
          <SubRef world={world} subId={c.targetSubId} />
        </span>
      );
    case 'release-captive': {
      const s = world.specialists.find(
        (x) => (x.id as unknown as number) === (c.specialistId as unknown as number),
      );
      return (
        <span>
          send captive{' '}
          {s !== undefined ? <Spec kind={s.kind} /> : 'specialist'} home
          {s !== undefined && (
            <span
              className="queue-owner"
              style={{ color: playerColorHex(s.ownerId) }}
            >
              {' '}
              ({playerLetter(s.ownerId)})
            </span>
          )}
        </span>
      );
    }
  }
}

function formatAbsolute(ms: number): string {
  const days = Math.floor(ms / DAY_MS);
  const hours = Math.floor((ms % DAY_MS) / HOUR_MS);
  const mins = Math.floor((ms % HOUR_MS) / MINUTE_MS);
  if (days > 0) return `${days}d${hours}h`;
  if (hours > 0) return `${hours}h${mins}m`;
  return `${mins}m`;
}

function formatRel(ms: number): string {
  if (ms < 0) return 'overdue';
  const days = Math.floor(ms / (24 * HOUR_MS));
  const hours = Math.floor((ms % (24 * HOUR_MS)) / HOUR_MS);
  const mins = Math.floor((ms % HOUR_MS) / MINUTE_MS);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}
