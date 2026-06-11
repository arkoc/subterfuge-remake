import { useMemo, useState } from 'react';
import {
  type Outpost,
  type PlayerId,
  type Specialist,
  type SpecialistId,
  type Sub,
  type SubId,
  type World,
  LAUNCH_DELAY_MS,
  previewSpeed,
  simulateArrival,
  specialistsAtOutpost,
  travelTimeBetween,
} from '@subterfuge/sim';
import { BottomSheet } from '../BottomSheet.js';
import { CombatPreview } from '../CombatPreview.js';
import { playerColorHex, playerLetter } from '../colors.js';
import {
  postCancelSub,
  postEditPreLaunchSub,
  postLaunch,
  postQueueLaunch,
} from '../api.js';
import { SPECIALISTS } from '../specialistInfo.js';
import { formatDuration, formatSimTime } from '../format.js';

interface LaunchSheetProps {
  world: World;
  source: Outpost;
  destination: Outpost;
  activePlayerId: PlayerId;
  isScrubbed: boolean;
  executeAt: number;
  /** Live (un-scrubbed) sim time. When scrubbed, `world` is the
   *  projected world at `executeAt`, so `executeAt - world.time` is 0;
   *  the "queue for t+X" delta must be measured from live time. */
  liveTime: number;
  onClose: () => void;
  onError: (msg: string | null) => void;
  onInfo?: (msg: string) => void;
  /** After a successful launch, if a Pirate is among boarded
   *  specialists, the App enters target-picker mode for the new sub.
   *  Receives the new sub's id so it can attach pirate-target on the
   *  same sub. Called only if the launch succeeded AND a Pirate was
   *  selected for boarding. */
  onLaunchedWithPirate?: (newSubId: SubId) => void;
  /** Set when the launch was initiated by dragging onto an enemy sub
   *  from a Pirate-carrying outpost. The sheet auto-boards the Pirate
   *  and shows the target context so the player can confirm. The
   *  parent App wires the actual postPirateTarget call after launch. */
  prePiratedTargetSubId?: SubId;
  /** EDIT MODE — a pre-launch sub being modified during its 10-minute
   *  window. Same screen as launching: slider, specialists, combat
   *  preview; the CTA applies the edit instead of launching, plus a
   *  cancel-launch action. */
  editSub?: Sub;
}

export function LaunchSheet({
  world,
  source,
  destination,
  activePlayerId,
  isScrubbed,
  executeAt,
  liveTime,
  onClose,
  onError,
  onInfo,
  onLaunchedWithPirate,
  prePiratedTargetSubId,
  editSub,
}: LaunchSheetProps) {
  // Mode is fully derived — no toggle. Editing a pre-launch sub uses
  // this same screen; a scrubbed timeline queues (tap LIVE first to
  // launch immediately); live launches now.
  const mode: 'now' | 'queue' | 'edit' =
    editSub !== undefined ? 'edit' : isScrubbed ? 'queue' : 'now';
  // `max` covers source.drillers but stays ≥ 1 even for 0-driller
  // outposts so the slider has a usable range when the launch is a
  // specialist-only insertion (drillers=0). In edit mode the sub's own
  // cargo is re-allocatable, so it counts toward the pool.
  const max = Math.max(1, source.drillers + (editSub?.drillers ?? 0));
  // Launch default is ZERO cargo — boarding drillers is an explicit
  // choice (same philosophy as specialists: safe defaults, no
  // accidental armies). Edit mode starts from the sub's current cargo.
  const [drillers, setDrillers] = useState(
    editSub !== undefined ? editSub.drillers : 0,
  );
  const [gift, setGift] = useState(editSub?.giftTo !== undefined);
  // Specialists at the source that the active player can put on this sub.
  // Every active specialist is mobile — only captives are excluded.
  //
  // In queue mode, also surface specialists that are *en route* to the
  // source on the player's own subs and will arrive before `executeAt`.
  // The sim validates location at dispatch time — so as long as the
  // carrying sub survives its journey the queue order will succeed.
  // We tag each entry with an `arrivesAt` field so the UI can warn the
  // player the specialist isn't physically present yet.
  const availableSpecialists = useMemo(() => {
    const here = specialistsAtOutpost(world, source.id).filter(
      (s) => s.ownerId === activePlayerId && s.state === 'active',
    );
    const out: Array<Specialist & { arrivesAt?: number }> = here.map((s) => ({
      ...s,
    }));
    if (editSub !== undefined) {
      const subIdNum = editSub.id as unknown as number;
      for (const sp of world.specialists) {
        if (sp.state !== 'active') continue;
        if (sp.ownerId !== activePlayerId) continue;
        if (sp.location.kind !== 'sub') continue;
        if ((sp.location.id as unknown as number) !== subIdNum) continue;
        out.push({ ...sp });
      }
    }
    if (mode === 'queue') {
      const sourceId = source.id as unknown as number;
      for (const sub of world.subs) {
        if (sub.ownerId !== activePlayerId) continue;
        if ((sub.destinationId as unknown as number) !== sourceId) continue;
        if (sub.giftTo !== undefined && sub.giftTo !== activePlayerId) continue;
        if (sub.arrivalAt >= executeAt) continue;
        for (const s of world.specialists) {
          if (s.state !== 'active') continue;
          if (s.ownerId !== activePlayerId) continue;
          if (s.location.kind !== 'sub') continue;
          if (
            (s.location.id as unknown as number) !==
            (sub.id as unknown as number)
          ) {
            continue;
          }
          out.push({ ...s, arrivesAt: sub.arrivalAt });
        }
      }
    }
    return out;
  }, [world, source.id, activePlayerId, mode, executeAt, editSub]);
  // Specialists default to UNCHECKED — opt-in. The original
  // Subterfuge default-boarded everything at the source, which led to
  // accidents like sending the Queen on an attack run or burning a
  // Pirate you'd been saving for a different intercept. Defaults
  // should be safe: list the specialists so the player knows they're
  // here, but make boarding an explicit choice.
  //
  // EXCEPTION — when the launch was initiated by dragging the source
  // onto an enemy sub (`prePiratedTargetSubId` set), the user's
  // intent is unambiguous: send the Pirate after this sub. We pre-
  // check the Pirate so the launch is one click away.
  const [selectedSpecIds, setSelectedSpecIds] = useState<Set<number>>(() => {
    const initial = new Set<number>();
    if (editSub !== undefined) {
      const subIdNum = editSub.id as unknown as number;
      for (const sp of world.specialists) {
        if (
          sp.location.kind === 'sub' &&
          (sp.location.id as unknown as number) === subIdNum
        ) {
          initial.add(sp.id as unknown as number);
        }
      }
      return initial;
    }
    if (prePiratedTargetSubId !== undefined) {
      const pirateAtSource = availableSpecialists.find(
        (s) => s.kind === 'pirate' && s.arrivesAt === undefined,
      );
      if (pirateAtSource !== undefined) {
        initial.add(pirateAtSource.id as unknown as number);
      }
    }
    return initial;
  });
  const toggleSpec = (id: number): void => {
    setSelectedSpecIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const isDormant = destination.ownerId === null;
  const isEnemy =
    !isDormant && destination.ownerId !== activePlayerId;
  const isFriendly = destination.ownerId === activePlayerId;
  const canGift = isEnemy;
  const giftTo: PlayerId | null = gift && canGift ? destination.ownerId! : null;

  const effectiveMult = useMemo(() => {
    const kinds = availableSpecialists
      .filter((s) => selectedSpecIds.has(s.id as unknown as number))
      .map((s) => s.kind as string);
    return previewSpeed(world, activePlayerId, kinds, destination.ownerId);
  }, [availableSpecialists, selectedSpecIds, world, activePlayerId, destination.ownerId]);
  const travelMs = useMemo(
    () => travelTimeBetween(source, destination, effectiveMult),
    [source, destination, effectiveMult],
  );
  // Absolute sim time of arrival — caller already supplies executeAt
  // (queue mode) or we add the 10-min pre-launch (now mode).
  const arrivalSimTime =
    (mode === 'edit'
      ? editSub!.launchAt
      : mode === 'queue'
        ? executeAt
        : world.time + LAUNCH_DELAY_MS) + travelMs;
  // Combat preview must be a top-level hook (not inside a conditional
  // JSX prop) per React rules-of-hooks. We compute unconditionally and
  // render only when there's actually a combat (`!isFriendly`).
  const combatPreview = useMemo(
    () =>
      simulateArrival({
        world,
        sourceId: source.id,
        destinationId: destination.id,
        drillers,
        attackerId: activePlayerId,
        ...(giftTo !== null ? { giftTo } : {}),
      }),
    [world, source.id, destination.id, drillers, activePlayerId, giftTo],
  );
  // Drillers left at source after the order takes effect — surfaces
  // the most-asked decision-time question right by the slider.
  const sourceAfter = max - drillers;
  const pct = ((drillers / max) * 100).toFixed(0);

  // True when at least one boarded specialist is a Pirate — used to
  // surface the post-launch target-picker affordance and to hand the
  // newly-launched sub's id back to App for target selection.
  const hasPirateAboard = availableSpecialists.some(
    (s) =>
      s.kind === 'pirate' &&
      selectedSpecIds.has(s.id as unknown as number),
  );

  const submit = async (): Promise<void> => {
    onError(null);
    const specialistIds =
      selectedSpecIds.size > 0
        ? ([...selectedSpecIds] as unknown as SpecialistId[])
        : undefined;
    const body = {
      ownerId: activePlayerId,
      sourceId: source.id,
      destinationId: destination.id,
      drillers,
      ...(giftTo !== null ? { giftTo } : {}),
      ...(specialistIds !== undefined ? { specialistIds } : {}),
    };
    if (mode === 'edit') {
      const r = await postEditPreLaunchSub({
        ownerId: activePlayerId,
        subId: editSub!.id,
        drillers,
        specialistIds: [...selectedSpecIds] as unknown as SpecialistId[],
      });
      if (!r.ok) onError(r.error ?? 'edit failed');
      else onClose();
      return;
    }
    const r =
      mode === 'queue'
        ? await postQueueLaunch({
            ...body,
            executeAt,
            // Future pirate-launch: carry the target on the queued order
            // so the chase binds to the new sub when it fires (a queued
            // launch has no sub id yet for the post-launch hand-off).
            ...(prePiratedTargetSubId !== undefined
              ? { pirateTargetSubId: prePiratedTargetSubId }
              : {}),
          })
        : await postLaunch(body);
    if (!r.ok) {
      onError(r.error ?? 'order failed');
      return;
    }
    // Pirate hand-off: server returned the new sub's id; let the App
    // open the target picker for that sub. We close first so the
    // picker overlay isn't fighting the sheet for focus.
    const newSubId = r.subId;
    const triggerPiratePicker =
      hasPirateAboard && newSubId !== undefined && onLaunchedWithPirate !== undefined;
    // Only toast for non-obvious paths: Time-Machine queue (executes
    // at a future moment the player might lose track of) and the
    // pirate-picker hand-off (UX instruction). Routine launches show
    // up in the sub list / pre-launch dot — no toast needed.
    if (mode === 'queue') {
      onInfo?.(
        `order queued for t+${formatDuration(executeAt - liveTime)}`,
      );
    } else if (triggerPiratePicker) {
      onInfo?.('sub launching — tap target enemy sub for pirate');
    }
    onClose();
    if (triggerPiratePicker) onLaunchedWithPirate!(newSubId!);
  };

  return (
    <BottomSheet
      open
      onClose={onClose}
      title={mode === 'edit' ? 'edit launch' : mode === 'queue' ? 'queue order' : 'launch order'}
      meta={`${source.name} ▸ ${destination.name}`}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          background: 'var(--bg-surface-2)',
          border: '1px solid var(--line-mid)',
          borderRadius: 2,
          padding: '10px 14px',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <span style={{ fontSize: 9, letterSpacing: '0.22em', color: 'var(--txt-mute)', textTransform: 'uppercase' }}>
            travel
          </span>
          <span style={{ fontFamily: 'var(--mono-display)', fontSize: 15, color: 'var(--txt)' }}>
            {formatDuration(travelMs)}
          </span>
          <span
            style={{
              fontSize: 10,
              color: 'var(--txt-mute)',
              fontFamily: 'var(--mono-display)',
              marginTop: 2,
            }}
            title="absolute sim time the sub arrives"
          >
            arrives t={formatSimTime(arrivalSimTime)}
          </span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
          <span style={{ fontSize: 9, letterSpacing: '0.22em', color: 'var(--txt-mute)', textTransform: 'uppercase' }}>
            mode
          </span>
          <span
            className={`tag ${isDormant ? 'dormant' : isEnemy ? (gift ? 'friendly' : 'enemy') : 'friendly'}`}
          >
            {isDormant
              ? 'dormant — capture'
              : isEnemy
                ? gift
                  ? `gift to ${playerLetter(destination.ownerId)}`
                  : 'hostile — attack'
                : 'friendly — reinforce'}
          </span>
        </div>
      </div>

      <div className="slider">
        <div className="slider-head">
          <span className="label">cargo</span>
          <span>
            <span className="value">{drillers}</span>
            <span className="max"> / {max}</span>
          </span>
        </div>
        <input
          type="range"
          min={0}
          max={max}
          value={drillers}
          style={{ ['--p' as keyof React.CSSProperties]: `${pct}%` } as React.CSSProperties}
          onChange={(e) => setDrillers(Number(e.target.value))}
        />
        <div className="preset-row">
          {[0, 0.25, 0.5, 0.75, 1].map((frac) => {
            const v = frac === 0 ? 0 : Math.max(1, Math.floor(max * frac));
            return (
              <button
                key={frac}
                type="button"
                className={`preset-btn${drillers === v ? ' active' : ''}`}
                onClick={() => setDrillers(v)}
              >
                {frac === 0 ? 'none' : frac === 1 ? 'all' : `${Math.round(frac * 100)}%`}
              </button>
            );
          })}
        </div>
        <div
          style={{
            fontSize: 10,
            color: sourceAfter === 0 ? 'var(--warn)' : 'var(--txt-mute)',
            letterSpacing: '0.04em',
            marginTop: 4,
            fontFamily: 'var(--mono-display)',
          }}
        >
          {sourceAfter === 0
            ? `leaves ${source.name} empty`
            : `leaves ${sourceAfter} at ${source.name}`}
        </div>
      </div>

      {availableSpecialists.length > 0 && (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
            padding: '10px 12px',
            background: 'var(--bg-surface-2)',
            border: '1px solid var(--line-mid)',
            borderRadius: 2,
          }}
        >
          <div style={{ fontSize: 9, letterSpacing: '0.22em', color: 'var(--txt-mute)', textTransform: 'uppercase' }}>
            specialists aboard
          </div>
          {availableSpecialists.map((s) => {
            const id = s.id as unknown as number;
            const checked = selectedSpecIds.has(id);
            const arrivesIn =
              s.arrivesAt !== undefined ? s.arrivesAt - world.time : null;
            const info = SPECIALISTS[s.kind];
            return (
              <label
                key={id}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 10,
                  cursor: 'pointer',
                  fontSize: 12,
                  padding: '2px 0',
                }}
                title={
                  arrivesIn !== null
                    ? 'in flight — arrives at this outpost before the queue fires'
                    : info.short
                }
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggleSpec(id)}
                  style={{ accentColor: 'var(--phos)', width: 16, height: 16, marginTop: 2 }}
                />
                <span
                  aria-hidden="true"
                  style={{
                    fontFamily: 'var(--mono-display)',
                    fontSize: 14,
                    color: 'var(--phos)',
                    width: 16,
                    textAlign: 'center',
                    flex: '0 0 auto',
                    marginTop: 1,
                  }}
                >
                  {info.glyph}
                </span>
                <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
                  <span>{s.kind.replace(/_/g, ' ')}</span>
                  <span
                    style={{
                      color: 'var(--txt-mute)',
                      fontSize: 10,
                      lineHeight: 1.3,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {info.short}
                  </span>
                </span>
                {arrivesIn !== null && (
                  <span
                    style={{
                      fontSize: 10,
                      color: 'var(--warn)',
                      letterSpacing: '0.12em',
                      flex: '0 0 auto',
                    }}
                  >
                    +{formatDuration(arrivesIn)}
                  </span>
                )}
              </label>
            );
          })}
        </div>
      )}

      {!isFriendly && (
        <CombatPreview
          preview={combatPreview}
          world={world}
          destinationId={destination.id}
          viewerId={activePlayerId}
          attackerId={activePlayerId}
        />
      )}

      {canGift && mode !== 'edit' && (
        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '10px 12px',
            background: 'var(--bg-surface-2)',
            border: '1px solid var(--line-mid)',
            borderRadius: 2,
            cursor: 'pointer',
          }}
        >
          <input
            type="checkbox"
            checked={gift}
            onChange={(e) => setGift(e.target.checked)}
            style={{ accentColor: 'var(--phos)', width: 18, height: 18 }}
          />
          <span style={{ fontSize: 12 }}>
            gift to{' '}
            <strong style={{ color: playerColorHex(destination.ownerId), fontWeight: 600 }}>
              {playerLetter(destination.ownerId)} //{' '}
              {world.players.find((p) => p.id === destination.ownerId)?.name}
            </strong>
          </span>
        </label>
      )}

      {hasPirateAboard && onLaunchedWithPirate !== undefined && mode === 'now' && (
        <div
          style={{
            fontSize: 10,
            color: 'var(--crit)',
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            padding: '6px 12px',
            background: 'rgba(255, 84, 112, 0.08)',
            border: '1px solid var(--crit)',
            borderRadius: 2,
          }}
        >
          {prePiratedTargetSubId !== undefined ? (
            <>⚓ pirate target locked — will chase target sub on launch</>
          ) : (
            <>⚓ pirate aboard — after launch you'll pick an enemy sub to intercept</>
          )}
        </div>
      )}

      <div className="btn-row">
        <button type="button" className="btn ghost" onClick={onClose}>
          {mode === 'edit' ? 'close' : 'cancel'}
        </button>
        {mode === 'edit' && (
          <button
            type="button"
            className="btn danger"
            title="cancel the launch — drillers and specialists return to the source"
            onClick={async () => {
              const r = await postCancelSub({
                ownerId: activePlayerId,
                subId: editSub!.id,
              });
              if (!r.ok) onError(r.error ?? 'failed to cancel launch');
              else onClose();
            }}
          >
            cancel launch
          </button>
        )}
        <button
          type="button"
          className="btn primary"
          disabled={drillers === 0 && selectedSpecIds.size === 0}
          title={
            drillers === 0 && selectedSpecIds.size === 0
              ? 'pick drillers or at least one specialist to board'
              : undefined
          }
          onClick={() => void submit()}
        >
          {mode === 'edit'
            ? 'apply changes'
            : mode === 'queue'
              ? `queue for t+${formatDuration(executeAt - liveTime)}`
              : gift
                ? 'send gift'
                : hasPirateAboard && onLaunchedWithPirate !== undefined
                  ? 'launch & target'
                  : 'launch'}
        </button>
      </div>
    </BottomSheet>
  );
}
