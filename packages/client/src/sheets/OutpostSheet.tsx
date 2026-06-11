import {
  type Outpost,
  type OutpostId,
  type PlayerId,
  type World,
  currentShieldCharge,
  drillCost,
  FACTORY_DRILLERS_PER_CYCLE,
  GENERATOR_ELECTRICAL_OUTPUT,
  hasQueenAt,
  maxShieldCharge,
  outpostCount,
  playerById,
  QUEEN_ELECTRICAL_OUTPUT,
  queenOutpostOf,
  sonarRange,
  specialistMeta,
  specialistsAtOutpost,
} from '@subterfuge/sim';
import {
  postDrill,
  postPromote,
  postQueueDrill,
  postReleaseCaptive,
} from '../api.js';
import { BottomSheet } from '../BottomSheet.js';
import { playerColorHex, playerLetter } from '../colors.js';
import { SpecialistChip } from '../SpecialistChip.js';

interface OutpostSheetProps {
  world: World;
  outpost: Outpost;
  activePlayerId: PlayerId;
  isScrubbed: boolean;
  executeAt: number;
  onClose: () => void;
  onError: (msg: string | null) => void;
  onInfo?: (msg: string) => void;
  /** Open a DM thread with this outpost's owner ("hail"). Rendered as
   *  a button on enemy-owned outposts — diplomacy one tap from the
   *  thing you're looking at. */
  onHail?: (playerId: PlayerId) => void;
}

export function OutpostSheet({
  world,
  outpost,
  activePlayerId,
  isScrubbed,
  executeAt,
  onClose,
  onError,
  onInfo,
  onHail,
}: OutpostSheetProps) {
  const isOwned = outpost.ownerId === activePlayerId;
  const isDormant = outpost.ownerId === null;
  const isEnemy = !isOwned && !isDormant;
  const isMine = outpost.kind === 'mine';
  // Live values include specialist modifiers (Queen/SC/King max,
  // Tinkerer drain, IO/Princess sonar) — `world` must be passed so
  // the math picks up the live roster, not the static `shieldKind`
  // table.
  const shieldNow = currentShieldCharge(outpost, world.time, world);
  const shieldMax = maxShieldCharge(world, outpost);

  const player = playerById(world, activePlayerId);
  const myDrillCost = drillCost(player.minesDrilled);
  const queenHere = hasQueenAt(world, outpost.id);
  const canDrill = isOwned && !queenHere && !isMine && outpost.drillers >= myDrillCost;

  // Compact header meta: "kind · owner · queen?" all on one line.
  // Meta keeps just kind + owner-letter (the most-glanceable identity).
  // Hostile / queen-here details are now in dedicated status chips in
  // the body so the header doesn't overflow on small phones.
  const ownerLetter =
    outpost.ownerId === null ? 'dormant' : playerLetter(outpost.ownerId);
  const metaPieces = [
    outpost.fogged ? 'fogged' : outpost.kind,
    ownerLetter,
  ];

  return (
    <BottomSheet
      open
      onClose={onClose}
      title={outpost.name.toLowerCase()}
      meta={metaPieces.join(' · ')}
    >
      {outpost.fogged && (
        <div className="help">fogged — only the kind + owner are visible.</div>
      )}

      {(queenHere || isEnemy) && (
        <div className="row">
          <span>status</span>
          <span className="val" style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
            {queenHere && <span className="tag queen">queen</span>}
            {isEnemy && <span className="tag enemy">hostile</span>}
            {/* Hail — compact icon, not a CTA: messaging the owner is a
                side path, not the sheet's main action. Owner-coloured
                so it reads as "talk to THEM". */}
            {isEnemy && onHail !== undefined && outpost.ownerId !== null && (
              <button
                type="button"
                className="hail-icon"
                style={{
                  borderColor: playerColorHex(outpost.ownerId),
                  color: playerColorHex(outpost.ownerId),
                }}
                title={`message ${playerById(world, outpost.ownerId).name}`}
                aria-label={`message ${playerById(world, outpost.ownerId).name}`}
                onClick={() => onHail(outpost.ownerId!)}
              >
                {'✉︎'}
              </button>
            )}
          </span>
        </div>
      )}

      {!outpost.fogged && (
        <div className="row">
          <span>garrison</span>
          <span
            className="val"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              fontFamily: 'var(--mono-display)',
            }}
          >
            <span style={{ color: 'var(--txt)' }}>{outpost.drillers}</span>
            <span style={{ color: 'var(--txt-mute)' }}>·</span>
            <span
              aria-hidden="true"
              style={{
                display: 'inline-block',
                width: 40,
                height: 3,
                background: 'var(--line-mid)',
                borderRadius: 1,
                position: 'relative',
                overflow: 'hidden',
              }}
            >
              <span
                style={{
                  position: 'absolute',
                  inset: '0 auto 0 0',
                  width: shieldMax > 0 ? `${(shieldNow / shieldMax) * 100}%` : '0',
                  background: 'var(--phos)',
                  boxShadow: '0 0 4px var(--phos)',
                }}
              />
            </span>
            <span style={{ fontSize: 11, color: 'var(--txt-dim)' }}>
              {shieldNow}/{shieldMax}
            </span>
          </span>
        </div>
      )}

      {!outpost.fogged && (
        <div className="row">
          <span>contribution</span>
          <span className="val" style={{ color: 'var(--phos)' }}>
            {outpost.kind === 'factory' && `+${FACTORY_DRILLERS_PER_CYCLE}/8h`}
            {outpost.kind === 'generator' &&
              `+${GENERATOR_ELECTRICAL_OUTPUT}${queenHere ? `+${QUEEN_ELECTRICAL_OUTPUT}` : ''} elec`}
            {outpost.kind === 'mine' &&
              outpost.ownerId !== null &&
              `+${outpostCount(world, outpost.ownerId)}kg/d`}
          </span>
        </div>
      )}

      {!outpost.fogged && (
        <SpecialistsList
          world={world}
          outpostId={outpost.id}
          activePlayerId={activePlayerId}
          onError={onError}
          onInfo={onInfo}
        />
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 }}>
        {isOwned && (
          <div
            style={{
              fontSize: 10,
              color: 'var(--txt-mute)',
              letterSpacing: '0.06em',
              padding: '6px 0',
              textAlign: 'center',
              borderTop: '1px dotted var(--line-faint)',
              borderBottom: '1px dotted var(--line-faint)',
            }}
          >
            drag from this outpost to another to launch a sub
          </div>
        )}

        {isOwned && !queenHere && !isMine && (
          <button
            type="button"
            className="btn"
            disabled={!canDrill}
            onClick={async () => {
              onError(null);
              const r = isScrubbed
                ? await postQueueDrill({
                    ownerId: activePlayerId,
                    outpostId: outpost.id,
                    executeAt,
                  })
                : await postDrill({ ownerId: activePlayerId, outpostId: outpost.id });
              if (!r.ok) onError(r.error ?? 'drill failed');
              else {
                if (isScrubbed) onInfo?.('drill queued for the future');
                onClose();
              }
            }}
          >
            {isScrubbed ? `queue drill (${myDrillCost})` : `drill mine (${myDrillCost})`}
            {!canDrill && outpost.drillers < myDrillCost && (
              <span style={{ color: 'var(--crit)', marginLeft: 6 }}>
                short by {myDrillCost - outpost.drillers}
              </span>
            )}
          </button>
        )}

        {isDormant && (
          <div className="help">drag from your outpost here to claim.</div>
        )}

        {isEnemy && (
          <div className="help">drag from your outpost here to attack.</div>
        )}
      </div>
    </BottomSheet>
  );
}

function SpecialistsList({
  world,
  outpostId,
  activePlayerId,
  onError,
  onInfo,
}: {
  world: World;
  outpostId: OutpostId;
  activePlayerId: PlayerId;
  onError: (msg: string | null) => void;
  onInfo?: ((msg: string) => void) | undefined;
}) {
  const here = specialistsAtOutpost(world, outpostId);
  if (here.length === 0) return null;
  const active = here.filter((s) => s.state === 'active');
  const captive = here.filter((s) => s.state === 'captive');
  const outpost = world.outposts.find((o) => o.id === outpostId);

  // Pre-compute auto-action hints for the captive list:
  //   - Hypnotist of the holder at this outpost → next tick conversion
  //   - Diplomat of the captive's original owner whose own outpost's
  //     sonar reaches this outpost → next tick release
  const holderHypnotistHere = outpost
    ? active.some(
        (s) => s.kind === 'hypnotist' && s.ownerId === outpost.ownerId,
      )
    : false;

  const dxToHere = (o: { pos: { x: number; y: number } }, target: { x: number; y: number }) => {
    const dx = o.pos.x - target.x;
    const dy = o.pos.y - target.y;
    return dx * dx + dy * dy;
  };
  const diplomatReachesHere = (ownerOf: PlayerId): boolean => {
    if (!outpost) return false;
    for (const d of world.specialists) {
      if (d.kind !== 'diplomat') continue;
      if (d.state !== 'active') continue;
      if (d.ownerId !== ownerOf) continue;
      if (d.location.kind !== 'outpost') continue;
      const dipOutpost = world.outposts.find((o) => o.id === d.location.id);
      if (!dipOutpost || dipOutpost.ownerId !== ownerOf) continue;
      const r = sonarRange(world, dipOutpost);
      if (dxToHere(dipOutpost, outpost.pos) <= r * r) return true;
    }
    return false;
  };

  // Promotion is only legal at the Queen's outpost, on the player's
  // own hire cadence (a promote consumes the hire window) — same rules
  // the hire sheet's promotionCandidates enforces. When all of that
  // lines up for a specialist listed HERE, surface an inline ↑ button
  // so the player doesn't have to round-trip through the hire sheet.
  const me = world.players[activePlayerId as unknown as number];
  const hireWindowReady = me !== undefined && world.time >= me.nextHireAt;
  const queenHomeId = queenOutpostOf(world, activePlayerId);
  const promotionsHere =
    hireWindowReady &&
    queenHomeId !== null &&
    (queenHomeId as unknown as number) === (outpostId as unknown as number);

  return (
    <>
      <div className="section-title">specialists</div>
      {active.map((s) => {
        const foreign = outpost && s.ownerId !== outpost.ownerId;
        const promoteTo =
          promotionsHere &&
          s.ownerId === activePlayerId &&
          s.kind !== 'princess'
            ? specialistMeta(s.kind).promotesTo
            : null;
        return (
          <SpecialistChip
            key={s.id as unknown as number}
            kind={s.kind}
            status={
              foreign ? (
                `${playerLetter(s.ownerId)}`
              ) : promoteTo !== null ? (
                <>
                  active
                  <span
                    role="button"
                    tabIndex={0}
                    className="release-btn promote-mini"
                    title={`promote to ${promoteTo.replace(/_/g, ' ')} — uses this hire window`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onError(null);
                      void postPromote({
                        ownerId: activePlayerId,
                        specialistId: s.id,
                      }).then((r) => {
                        if (!r.ok) onError(r.error ?? 'promote failed');
                        else
                          onInfo?.(
                            `promoting ${s.kind.replace(/_/g, ' ')} → ${promoteTo.replace(/_/g, ' ')}`,
                          );
                      });
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.stopPropagation();
                        e.preventDefault();
                        (e.target as HTMLElement).click();
                      }
                    }}
                  >
                    ↑ {promoteTo.replace(/_/g, ' ')}
                  </span>
                </>
              ) : (
                'active'
              )
            }
            {...(foreign ? { accentColor: playerColorHex(s.ownerId) } : {})}
          />
        );
      })}
      {captive.length > 0 && (
        <>
          <div
            className="section-title"
            style={{ marginTop: 6, color: 'var(--warn)' }}
          >
            captives
          </div>
          {captive.map((s) => {
            const willConvert = holderHypnotistHere;
            const willRelease = diplomatReachesHere(s.ownerId);
            const statusLabel = willConvert
              ? 'converting'
              : willRelease
                ? 'releasing'
                : `captive · ${playerLetter(s.ownerId)}`;
            const accent = willConvert
              ? 'var(--phos)'
              : willRelease
                ? 'var(--warn)'
                : playerColorHex(s.ownerId);
            const canRelease = outpost?.ownerId === activePlayerId;
            return (
              <SpecialistChip
                key={s.id as unknown as number}
                kind={s.kind}
                status={
                  canRelease ? (
                    <>
                      {statusLabel}
                      <span
                        role="button"
                        tabIndex={0}
                        className="release-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          onError(null);
                          void postReleaseCaptive({
                            ownerId: activePlayerId,
                            specialistId: s.id,
                          }).then((r) => {
                            if (!r.ok) onError(r.error ?? 'release failed');
                            // Deferred, not instant — the release sits on
                            // the 10-minute fuse like every cancellable
                            // order. Say so, or the player thinks it
                            // already happened.
                            else
                              onInfo?.(
                                `releasing ${s.kind.replace(/_/g, ' ')} — cancel within 10m in orders`,
                              );
                          });
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.stopPropagation();
                            e.preventDefault();
                            (e.target as HTMLElement).click();
                          }
                        }}
                      >
                        release
                      </span>
                    </>
                  ) : (
                    statusLabel
                  )
                }
                accentColor={accent}
              />
            );
          })}
        </>
      )}
    </>
  );
}

