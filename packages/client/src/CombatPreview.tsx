import { useState } from 'react';
import {
  type ArrivalPreview,
  HOUR_MS,
  MINUTE_MS,
  type OutpostId,
  type PlayerId,
  type World,
} from '@subterfuge/sim';

interface CombatPreviewProps {
  preview: ArrivalPreview;
  world: World;
  /** Destination outpost id (used to determine viewer perspective). */
  destinationId: OutpostId;
  /** The player viewing the preview. Used to pick "you" labels. */
  viewerId: PlayerId;
  /** The sub's owner (attacker). */
  attackerId: PlayerId;
}

type Perspective = 'attacker' | 'defender' | 'bystander';

/**
 * Combat-preview card. Renders the projected outcome at sub arrival.
 *
 * The preview labels adapt to the viewer's perspective:
 *   - the viewer is the attacker (their sub) → "you win / you lose"
 *   - the viewer is the defender (sub heading to their outpost) →
 *     "you hold / you lose outpost"
 *   - the viewer is neither → neutral "attacker wins / defender holds"
 */
export function CombatPreview({
  preview,
  world,
  destinationId,
  viewerId,
  attackerId,
}: CombatPreviewProps) {
  const dest = world.outposts.find((o) => o.id === destinationId);
  const perspective: Perspective =
    viewerId === attackerId
      ? 'attacker'
      : dest && dest.ownerId === viewerId
        ? 'defender'
        : 'bystander';
  const labels = outcomeLabel(preview, perspective);
  const isCombat =
    preview.outcome === 'attacker-wins' ||
    preview.outcome === 'defender-wins' ||
    preview.outcome === 'tie';
  // Default-open for combat outcomes — the detail panel is the most
  // useful state for the *one* moment this preview is on screen.
  const [open, setOpen] = useState(isCombat);

  return (
    <div className="preview">
      <button
        type="button"
        className={`preview-summary ${labels.cls}`}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className="sym" aria-hidden="true">{labels.sym}</span>
        <span className="text">{labels.text}</span>
        {isCombat && (
          <span className="math">
            <span style={{ color: 'var(--combat-attacker)' }}>{preview.attackerDrillers}</span>
            {preview.shieldAbsorbed > 0 && (
              <>
                <span className="op">−</span>
                <span style={{ color: 'var(--txt-mute)' }}>
                  {preview.shieldAbsorbed}sh
                </span>
              </>
            )}
            <span className="op">vs</span>
            <span style={{ color: 'var(--crit)' }}>
              {preview.defenderDrillersAtArrival}
              {preview.shieldAtArrival > preview.shieldAbsorbed && (
                <span
                  style={{ color: 'var(--txt-mute)', marginLeft: 2 }}
                >
                  +{preview.shieldAtArrival}sh
                </span>
              )}
            </span>
          </span>
        )}
        <span className="when">
          t+{formatRelative(preview.arrivalAt - world.time)}
        </span>
        <span className="chev" aria-hidden="true">
          {open ? '▾' : '▸'}
        </span>
      </button>
      {open && (
        <div className="preview-detail">
          <div className="row">
            <span>attacker</span>
            <span className="val">
              {preview.attackerDrillers} drl
              {preview.shieldAbsorbed > 0 && (
                <span style={{ color: 'var(--txt-mute)', fontSize: 10 }}>
                  {' '}
                  (−{preview.shieldAbsorbed} to shield)
                </span>
              )}
            </span>
          </div>
          {isCombat && (
            <div className="row">
              <span>defender</span>
              <span className="val">
                {preview.defenderDrillersAtArrival} drl
                {preview.shieldAtArrival > 0 && (
                  <span style={{ color: 'var(--txt-mute)', fontSize: 10 }}>
                    {' '}
                    + {preview.shieldAtArrival} shield
                  </span>
                )}
              </span>
            </div>
          )}
          <div className="row">
            <span>outcome</span>
            <span className="val">{labels.detail}</span>
          </div>
          {isCombat && <SpecialistBreakdown preview={preview} perspective={perspective} />}
        </div>
      )}
    </div>
  );
}

/**
 * Breakdown of which specialists died / were captured in the
 * projected combat. Only renders when there's at least one
 * specialist event; absence is no information loss.
 */
function SpecialistBreakdown({
  preview,
  perspective,
}: {
  preview: ArrivalPreview;
  perspective: Perspective;
}) {
  const {
    attackerKilled,
    attackerCaptured,
    defenderKilled,
    defenderCaptured,
  } = preview;
  const total =
    attackerKilled.length +
    attackerCaptured.length +
    defenderKilled.length +
    defenderCaptured.length;
  if (total === 0) return null;
  const youSide = perspective === 'attacker' ? 'attacker' : perspective === 'defender' ? 'defender' : null;
  const yourKilled = youSide === 'attacker' ? attackerKilled : youSide === 'defender' ? defenderKilled : [];
  const yourCaptured = youSide === 'attacker' ? attackerCaptured : youSide === 'defender' ? defenderCaptured : [];
  const theirKilled = youSide === 'attacker' ? defenderKilled : youSide === 'defender' ? attackerKilled : [];
  const theirCaptured = youSide === 'attacker' ? defenderCaptured : youSide === 'defender' ? attackerCaptured : [];
  const youLabel = youSide === null ? 'attacker' : 'you';
  const themLabel = youSide === null ? 'defender' : 'enemy';
  return (
    <>
      <div className="row" style={{ marginTop: 4 }}>
        <span style={{ fontSize: 10, color: 'var(--txt-mute)', letterSpacing: '0.18em' }}>
          specialists
        </span>
      </div>
      {(yourKilled.length > 0 || yourCaptured.length > 0) && (
        <div className="row" style={{ fontSize: 11 }}>
          <span style={{ color: 'var(--txt-mute)' }}>{youLabel}</span>
          <span className="val" style={{ fontFamily: 'var(--mono-display)', fontSize: 11 }}>
            {yourKilled.length > 0 && (
              <span style={{ color: 'var(--crit)' }} title="killed in combat">
                {yourKilled.map((s) => s.kind.replace(/_/g, ' ')).join(', ')} †
              </span>
            )}
            {yourKilled.length > 0 && yourCaptured.length > 0 && (
              <span style={{ color: 'var(--txt-mute)' }}> · </span>
            )}
            {yourCaptured.length > 0 && (
              <span style={{ color: 'var(--warn)' }} title="captured by enemy">
                {yourCaptured.map((s) => s.kind.replace(/_/g, ' ')).join(', ')} ⛓
              </span>
            )}
          </span>
        </div>
      )}
      {(theirKilled.length > 0 || theirCaptured.length > 0) && (
        <div className="row" style={{ fontSize: 11 }}>
          <span style={{ color: 'var(--txt-mute)' }}>{themLabel}</span>
          <span className="val" style={{ fontFamily: 'var(--mono-display)', fontSize: 11 }}>
            {theirKilled.length > 0 && (
              <span style={{ color: 'var(--crit)' }} title="killed in combat">
                {theirKilled.map((s) => s.kind.replace(/_/g, ' ')).join(', ')} †
              </span>
            )}
            {theirKilled.length > 0 && theirCaptured.length > 0 && (
              <span style={{ color: 'var(--txt-mute)' }}> · </span>
            )}
            {theirCaptured.length > 0 && (
              <span style={{ color: 'var(--phos)' }} title="you capture them">
                {theirCaptured.map((s) => s.kind.replace(/_/g, ' ')).join(', ')} ⛓
              </span>
            )}
          </span>
        </div>
      )}
    </>
  );
}

function outcomeLabel(
  preview: ArrivalPreview,
  perspective: Perspective,
): { cls: string; sym: string; text: string; detail: string } {
  const { outcome, attackerDrillers, attackerSurviving, defenderSurviving } = preview;
  switch (outcome) {
    case 'capture-dormant':
      return {
        cls: 'neutral',
        sym: '⌖',
        text: 'CAPTURE',
        detail: `${attackerDrillers} drillers garrison the outpost`,
      };
    case 'reinforce':
      return {
        cls: 'win',
        sym: '⇑',
        text: 'REINFORCE',
        detail: `+${attackerDrillers} drillers · ${defenderSurviving} total`,
      };
    case 'gift':
      return {
        cls: 'neutral',
        sym: '⌥',
        text: 'GIFT',
        detail: `${attackerDrillers} drillers transfer to recipient`,
      };
    case 'attacker-wins':
      if (perspective === 'attacker') {
        return {
          cls: 'win',
          sym: '⚔',
          text: 'YOU WIN — CAPTURE',
          detail: `${attackerSurviving} driller${attackerSurviving === 1 ? '' : 's'} garrison the outpost`,
        };
      }
      if (perspective === 'defender') {
        return {
          cls: 'lose',
          sym: '✕',
          text: 'YOU LOSE — OUTPOST CAPTURED',
          detail: `attacker takes the outpost with ${attackerSurviving} driller${attackerSurviving === 1 ? '' : 's'} remaining`,
        };
      }
      return {
        cls: 'neutral',
        sym: '⚔',
        text: 'ATTACKER WINS',
        detail: `outpost captured with ${attackerSurviving} driller${attackerSurviving === 1 ? '' : 's'} remaining`,
      };
    case 'defender-wins':
      if (perspective === 'attacker') {
        return {
          cls: 'lose',
          sym: '✕',
          text: 'YOU LOSE',
          detail: `defender holds with ${defenderSurviving} driller${defenderSurviving === 1 ? '' : 's'}`,
        };
      }
      if (perspective === 'defender') {
        return {
          cls: 'win',
          sym: '✓',
          text: 'YOU HOLD',
          detail: `${defenderSurviving} driller${defenderSurviving === 1 ? '' : 's'} remain after combat`,
        };
      }
      return {
        cls: 'neutral',
        sym: '✓',
        text: 'DEFENDER HOLDS',
        detail: `${defenderSurviving} driller${defenderSurviving === 1 ? '' : 's'} remain`,
      };
    case 'tie':
      if (perspective === 'attacker') {
        return {
          cls: 'tie',
          sym: '⇋',
          text: 'TIE — YOU LOSE',
          detail: 'both sides annihilated; defender keeps outpost by rule',
        };
      }
      if (perspective === 'defender') {
        return {
          cls: 'win',
          sym: '⇋',
          text: 'TIE — YOU HOLD',
          detail: 'both sides annihilated; you keep the outpost by rule',
        };
      }
      return {
        cls: 'tie',
        sym: '⇋',
        text: 'TIE — DEFENDER HOLDS',
        detail: 'both sides annihilated; defender keeps outpost by rule',
      };
  }
}

function formatRelative(ms: number): string {
  if (ms < 0) return 'overdue';
  const days = Math.floor(ms / (24 * HOUR_MS));
  const hours = Math.floor((ms % (24 * HOUR_MS)) / HOUR_MS);
  const mins = Math.floor((ms % HOUR_MS) / MINUTE_MS);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}
