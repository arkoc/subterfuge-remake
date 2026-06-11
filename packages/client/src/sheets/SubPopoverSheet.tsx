import { useMemo, useState } from 'react';
import {
  HOUR_MS,
  MINUTE_MS,
  type PlayerId,
  simulateSubArrival,
  simulateSubEncounter,
  type SpecialistId,
  specialistsAtOutpost,
  specialistsOnSub,
  type SubId,
  type World,
  subStatus,
} from '@subterfuge/sim';
import { BottomSheet } from '../BottomSheet.js';
import { CombatPreview } from '../CombatPreview.js';
import { playerColorHex, playerLetter } from '../colors.js';
import { postCancelSub, postEditPreLaunchSub } from '../api.js';
import { SpecialistChip } from '../SpecialistChip.js';
import { SUB_GLYPH } from '../specialistInfo.js';

interface SubPopoverSheetProps {
  world: World;
  subId: SubId;
  activePlayerId: PlayerId;
  onClose: () => void;
}

export function SubPopoverSheet({
  world,
  subId,
  activePlayerId,
  onClose,
}: SubPopoverSheetProps) {
  const sub = world.subs.find((s) => s.id === subId);
  // Combat preview only makes sense for a sub heading to an outpost.
  // A chase sub has no outpost destination per se — the encounter
  // resolves at the intercept point, not at an outpost.
  const isChasing = sub?.chase !== undefined && sub.chase.phase === 'chasing';
  const isReturning = sub?.chase !== undefined && sub.chase.phase === 'returning';
  const preview = useMemo(
    () => (sub && !isChasing ? simulateSubArrival(world, sub) : null),
    [world, sub, isChasing],
  );
  // Mirror-route sub-vs-sub preview: if this sub will meet an opposing
  // sub before arrival, the actual combat fires at the encounter
  // point, not at the destination. Surface that.
  const subEncounter = useMemo(
    () => (sub && !isChasing && !isReturning ? simulateSubEncounter(world, sub) : null),
    [world, sub, isChasing, isReturning],
  );
  if (!sub) return null;
  const src = world.outposts.find((o) => o.id === sub.sourceId);
  const dst = world.outposts.find((o) => o.id === sub.destinationId);
  const status = subStatus(sub, world.time);
  const eta = sub.arrivalAt - world.time;
  const launchIn = sub.launchAt - world.time;
  const targetSub = isChasing
    ? world.subs.find(
        (s) => (s.id as unknown as number) === (sub.chase!.targetSubId as unknown as number),
      )
    : null;

  let statusLabel: string;
  if (isChasing) statusLabel = 'pirate chase';
  else if (isReturning) statusLabel = 'returning';
  else if (status === 'queued') statusLabel = 'queued';
  else statusLabel = 'in flight';
  const ownerName = world.players.find((p) => p.id === sub.ownerId)?.name ?? '';
  const meta = `${statusLabel} · ${playerLetter(sub.ownerId)} ${ownerName}`;

  return (
    <BottomSheet
      open
      onClose={onClose}
      title={`${SUB_GLYPH} sub #${sub.id as unknown as number}`}
      meta={meta}
    >
      {isChasing && targetSub && (
        <div className="row">
          <span>chasing</span>
          <span className="val" style={{ color: playerColorHex(targetSub.ownerId) }}>
            sub #{targetSub.id as unknown as number} ({targetSub.drillers} drillers)
          </span>
        </div>
      )}
      {isChasing && !targetSub && (
        <div className="row">
          <span>chasing</span>
          <span className="val" style={{ color: 'var(--txt-mute)' }}>
            target out of sight
          </span>
        </div>
      )}
      {isReturning && (
        <div className="row">
          <span>returning to</span>
          <span className="val">{dst?.name ?? '?'}</span>
        </div>
      )}
      {!isChasing && !isReturning && (
        <div className="row">
          <span>route</span>
          <span className="val">
            {src?.name ?? '?'} → {dst?.name ?? '?'}
          </span>
        </div>
      )}
      {/* Speed — every sub, not just pirates. The multiplier is the
          composite of specialist effects (Helmsman 2×, Smuggler 3×,
          Admiral global, pirate-return 4×, …); 1.0× = base hull. */}
      <div className="row">
        <span>speed</span>
        <span className="val" style={{ fontFamily: 'var(--mono-display)' }}>
          {sub.speedMultiplier.toFixed(1)}×{' '}
          <span style={{ color: 'var(--txt-mute)' }}>base</span>
          {sub.speedMultiplier > 1 && (
            <span style={{ color: 'var(--phos)', marginLeft: 6, fontSize: 11 }}>
              boosted
            </span>
          )}
        </span>
      </div>
      <div className="row">
        <span>cargo</span>
        <span
          className="val"
          style={{ fontSize: 14, color: 'var(--txt)', fontFamily: 'var(--mono-display)' }}
        >
          {sub.drillers} drl
          {sub.giftTo !== undefined && (
            <span
              style={{
                fontSize: 10,
                marginLeft: 6,
                color: playerColorHex(sub.giftTo),
              }}
            >
              · gift to {playerLetter(sub.giftTo)}
            </span>
          )}
        </span>
      </div>
      <div className="row">
        <span>{status === 'queued' ? 'launches' : 'arrives'} in</span>
        <span
          className="val"
          style={{
            color: status === 'queued' ? 'var(--warn)' : 'var(--phos)',
            fontFamily: 'var(--mono-display)',
          }}
        >
          {formatDur(status === 'queued' ? launchIn : eta)}
        </span>
      </div>

      <SubSpecialistsList world={world} subId={subId} />

      {sub.ownerId === activePlayerId && status === 'queued' && (
        <PreLaunchControls world={world} subId={subId} onClose={onClose} />
      )}

      {sub.ownerId === activePlayerId && status !== 'queued' && (
        <SubActions world={world} subId={subId} />
      )}

      {/* Combat timeline — a single ordered list so the player sees
          *what fires when*. Mirror-route encounters fire en-route and
          (depending on outcome) can prevent the arrival from happening
          at all; the chronological order is critical. */}
      {(subEncounter || preview) && (
        <div className="section-title">combat timeline</div>
      )}
      {subEncounter && (
        <SubEncounterCard
          encounter={subEncounter}
          subOwnerId={sub.ownerId}
          viewerId={activePlayerId}
          world={world}
        />
      )}
      {preview && (
        <CombatPreview
          preview={preview}
          world={world}
          destinationId={sub.destinationId}
          viewerId={activePlayerId}
          attackerId={sub.ownerId}
        />
      )}
    </BottomSheet>
  );
}

/**
 * Compact preview card for a mirror-route sub-vs-sub encounter that
 * will fire before this sub reaches its destination. Sized to look
 * familiar next to the existing CombatPreview's expanded panel.
 */
function SubEncounterCard({
  encounter,
  subOwnerId,
  viewerId,
  world,
}: {
  encounter: NonNullable<ReturnType<typeof simulateSubEncounter>>;
  subOwnerId: PlayerId;
  viewerId: PlayerId;
  world: World;
}) {
  const isMine = subOwnerId === viewerId;
  const fromMyPerspective: 'win' | 'lose' | 'tie' = isMine
    ? encounter.outcome
    : encounter.outcome === 'win'
      ? 'lose'
      : encounter.outcome === 'lose'
        ? 'win'
        : 'tie';
  const cls =
    fromMyPerspective === 'win' ? 'win' : fromMyPerspective === 'lose' ? 'lose' : 'tie';
  const sym = fromMyPerspective === 'win' ? '⚔' : fromMyPerspective === 'lose' ? '✕' : '⇋';
  const label =
    fromMyPerspective === 'win'
      ? isMine
        ? 'YOU WIN — INTERCEPT'
        : 'ATTACKER WINS — INTERCEPT'
      : fromMyPerspective === 'lose'
        ? isMine
          ? 'YOU LOSE — INTERCEPT'
          : 'DEFENDER WINS — INTERCEPT'
        : 'TIE — BOTH SUBS LOST';

  const eta = encounter.encounterAt - world.time;
  return (
    <div className="preview" style={{ marginTop: 8 }}>
      <div className={`preview-summary ${cls}`} style={{ cursor: 'default' }}>
        <span className="sym" aria-hidden="true">{sym}</span>
        <span className="text">{label}</span>
        <span className="math">
          <span style={{ color: '#5fb4ff' }}>{encounter.subDrillersBefore}</span>
          <span className="op">vs</span>
          <span style={{ color: '#ff5470' }}>{encounter.otherDrillersBefore}</span>
        </span>
        <span className="when">t+{formatDur(eta)}</span>
      </div>
      <div className="preview-detail">
        <div className="row">
          <span style={{ fontSize: 10, color: 'var(--txt-mute)', letterSpacing: '0.18em' }}>
            mirror-route encounter
          </span>
          <span className="val" style={{ fontSize: 11 }}>
            with sub #{encounter.otherSubId as unknown as number}
          </span>
        </div>
        <div className="row">
          <span>this sub</span>
          <span className="val">{encounter.subDrillersBefore} drl</span>
        </div>
        <div className="row">
          <span>opposing sub</span>
          <span className="val">{encounter.otherDrillersBefore} drl</span>
        </div>
        <div className="row">
          <span>outcome</span>
          <span className="val">
            {encounter.outcome === 'tie'
              ? 'both subs destroyed'
              : `${encounter.survivingDrillers} driller${encounter.survivingDrillers === 1 ? '' : 's'} survive on the winner`}
          </span>
        </div>
        <div
          className="row"
          style={{ fontSize: 10, color: 'var(--txt-mute)' }}
        >
          this fires en route — the arrival preview below assumes the
          opposing sub is gone (the actual arrival may not happen if
          this sub also loses the encounter).
        </div>
      </div>
    </div>
  );
}

function SubSpecialistsList({ world, subId }: { world: World; subId: SubId }) {
  const aboard = specialistsOnSub(world, subId);
  if (aboard.length === 0) return null;
  return (
    <>
      <div className="section-title">specialists aboard</div>
      {aboard.map((s) => (
        <SpecialistChip
          key={s.id as unknown as number}
          kind={s.kind}
          status={s.state}
        />
      ))}
    </>
  );
}

function SubActions({
  world,
  subId,
}: {
  world: World;
  subId: SubId;
}) {
  const aboard = specialistsOnSub(world, subId);
  const hasNavigator = aboard.some(
    (s) => s.state === 'active' && s.kind === 'navigator',
  );
  const hasPirate = aboard.some(
    (s) => s.state === 'active' && s.kind === 'pirate',
  );
  if (!hasNavigator && !hasPirate) return null;
  return (
    <>
      <div className="section-title">actions</div>
      {hasNavigator && (
        <div className="help" style={{ marginTop: 6 }}>
          drag this sub onto an outpost to redirect.
        </div>
      )}
      {hasPirate && (
        <div className="help" style={{ marginTop: 6 }}>
          drag this sub onto an enemy sub to target it.
        </div>
      )}
    </>
  );
}

function PreLaunchControls({
  world,
  subId,
  onClose,
}: {
  world: World;
  subId: SubId;
  onClose: () => void;
}) {
  const sub = world.subs.find((s) => s.id === subId);
  const src = sub ? world.outposts.find((o) => o.id === sub.sourceId) : null;
  const [draft, setDraft] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // Specialist roster the user wants on the sub — null = not edited
  // yet (we'll send drillers only). When set, this is the full
  // desired roster sent to the server as `specialistIds`.
  const [draftSpecs, setDraftSpecs] = useState<Set<number> | null>(null);
  if (!sub || !src) return null;
  const current = draft ?? sub.drillers;
  const max = src.drillers + sub.drillers;

  const onboard = specialistsOnSub(world, sub.id);
  const atSource = specialistsAtOutpost(world, src.id).filter(
    (s) => s.ownerId === sub.ownerId && s.state === 'active',
  );
  const onboardIds = new Set(onboard.map((s) => s.id as unknown as number));
  const currentSpecIds =
    draftSpecs ??
    new Set(onboard.map((s) => s.id as unknown as number));
  const specsChanged =
    draftSpecs !== null &&
    (draftSpecs.size !== onboardIds.size ||
      [...draftSpecs].some((x) => !onboardIds.has(x)));
  const changed = current !== sub.drillers || specsChanged;

  const toggleSpec = (id: number): void => {
    const next = new Set<number>(currentSpecIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setDraftSpecs(next);
  };

  const onApply = async (): Promise<void> => {
    setBusy(true);
    setErr(null);
    const body: Parameters<typeof postEditPreLaunchSub>[0] = {
      ownerId: sub.ownerId,
      subId,
      drillers: current,
    };
    if (draftSpecs !== null) {
      body.specialistIds = [...draftSpecs] as unknown as SpecialistId[];
    }
    const r = await postEditPreLaunchSub(body);
    setBusy(false);
    if (r.ok) {
      setDraft(null);
      setDraftSpecs(null);
    } else {
      setErr(r.error ?? 'edit failed');
    }
  };

  const onCancel = async (): Promise<void> => {
    setBusy(true);
    setErr(null);
    const r = await postCancelSub({ ownerId: sub.ownerId, subId });
    setBusy(false);
    if (r.ok) onClose();
    else setErr(r.error ?? 'cancel failed');
  };

  return (
    <>
      <div className="section-title">pre-launch</div>
      <div className="row">
        <span>drillers</span>
        <span
          className="val"
          style={{ fontFamily: 'var(--mono-display)', fontSize: 13 }}
        >
          {current} / {max}
        </span>
      </div>
      <input
        type="range"
        min={1}
        max={max}
        step={1}
        value={current}
        disabled={busy}
        onChange={(e) => setDraft(Number(e.target.value))}
        style={{ width: '100%', marginTop: 4 }}
      />

      {(onboard.length > 0 || atSource.length > 0) && (
        <div style={{ marginTop: 8 }}>
          <div className="section-title" style={{ marginBottom: 4 }}>
            specialists
          </div>
          {[...onboard, ...atSource.filter((s) => !onboardIds.has(s.id as unknown as number))].map((s) => {
            const id = s.id as unknown as number;
            const checked = currentSpecIds.has(id);
            return (
              <label
                key={id}
                className="row"
                style={{
                  fontSize: 12,
                  cursor: busy ? 'default' : 'pointer',
                  opacity: busy ? 0.6 : 1,
                }}
              >
                <span>
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={busy}
                    onChange={() => toggleSpec(id)}
                    style={{ marginRight: 6, verticalAlign: 'middle' }}
                  />
                  {s.kind.replace(/_/g, ' ')}
                </span>
                <span
                  className="val"
                  style={{ fontSize: 10, color: 'var(--txt-mute)' }}
                >
                  {checked ? 'aboard' : 'at source'}
                </span>
              </label>
            );
          })}
        </div>
      )}

      <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
        <button
          type="button"
          className="btn primary"
          style={{ flex: 1 }}
          disabled={busy || !changed}
          onClick={() => {
            void onApply();
          }}
        >
          apply
        </button>
        <button
          type="button"
          className="btn danger"
          style={{ flex: 1 }}
          disabled={busy}
          onClick={() => {
            void onCancel();
          }}
        >
          cancel launch
        </button>
      </div>
      {err !== null && (
        <div
          className="row"
          style={{ color: 'var(--warn)', fontSize: 11, marginTop: 4 }}
        >
          {err}
        </div>
      )}
    </>
  );
}

function formatDur(ms: number): string {
  if (ms < 0) return 'overdue';
  const days = Math.floor(ms / (24 * HOUR_MS));
  const hours = Math.floor((ms % (24 * HOUR_MS)) / HOUR_MS);
  const mins = Math.floor((ms % HOUR_MS) / MINUTE_MS);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}
