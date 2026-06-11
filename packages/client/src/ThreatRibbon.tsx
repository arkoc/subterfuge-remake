import { memo } from 'react';
import type { OutpostId } from '@subterfuge/sim';
import type { Threat } from './useThreats.js';
import { formatEta } from './format.js';

interface ThreatLaneProps {
  threats: Threat[];
  onOpenOutpost: (id: OutpostId) => void;
  onOpenEvents: () => void;
}

/** Max threat rows visible at once. Anything beyond becomes a
 *  "+N more" link to the events sheet. */
const VISIBLE_LIMIT = 3;

/**
 * Multi-row threat lane. ONE source of truth for "you have inbound
 * enemy subs". Replaces the old single-line ribbon AND the per-outpost
 * ⚔ red badge on the map — the lane consolidates threat awareness.
 *
 * Each row shows: outpost name · ETA · projected outcome chip. Tap a
 * row → opens that outpost's sheet (the App's onOpenOutpost handler
 * is expected to also centre the map on it).
 *
 * Pulse animation runs once on first appearance (3 cycles) — it's an
 * alert, not constant noise.
 */
function ThreatLaneInner({ threats, onOpenOutpost, onOpenEvents }: ThreatLaneProps) {
  if (threats.length === 0) return null;
  const visible = threats.slice(0, VISIBLE_LIMIT);
  const overflow = threats.length - visible.length;
  return (
    <div className="threat-lane" role="alert" aria-live="polite">
      <div className="threat-lane-header">
        <span className="threat-glyph" aria-hidden="true">⚠</span>
        <span className="threat-count">{threats.length} inbound</span>
      </div>
      {visible.map((t) => (
        <button
          key={`${t.outpostId}-${t.subId}`}
          type="button"
          className={`threat-row threat-row-${outcomeClass(t.outcome)}`}
          onClick={() => onOpenOutpost(t.outpostId)}
          aria-label={`${t.outpostName} threatened — ${outcomeLabel(t.outcome)} in ${formatEta(t.etaMs)}`}
        >
          <span className="threat-row-name">{t.outpostName.toLowerCase()}</span>
          <span className="threat-row-eta">{formatEta(t.etaMs)}</span>
          <span className="threat-row-outcome">{outcomeLabel(t.outcome)}</span>
        </button>
      ))}
      {overflow > 0 && (
        <button
          type="button"
          className="threat-row threat-row-overflow"
          onClick={onOpenEvents}
          aria-label={`+${overflow} more inbound threats — open event log`}
        >
          +{overflow} more ›
        </button>
      )}
    </div>
  );
}

/**
 * Map a sim ArrivalOutcome to a viewer-perspective label. The viewer
 * is the defender (their outpost is being attacked), so:
 *   - attacker-wins → "WILL LOSE" (bad)
 *   - defender-wins → "HOLD"      (good)
 *   - tie           → "TIE"       (neutral-bad — both die)
 *   - gift          → "GIFT"      (good — incoming friendly)
 *   - reinforce / capture-dormant don't happen for hostile inbound
 */
function outcomeLabel(o: Threat['outcome']): string {
  switch (o) {
    case 'attacker-wins': return 'will lose';
    case 'defender-wins': return 'hold';
    case 'tie': return 'tie';
    case 'gift': return 'gift';
    case 'reinforce': return 'reinforce';
    case 'capture-dormant': return 'capture';
    default: return '?';
  }
}

function outcomeClass(o: Threat['outcome']): string {
  switch (o) {
    case 'attacker-wins': return 'lose';
    case 'defender-wins': return 'hold';
    case 'tie': return 'tie';
    default: return 'hold';
  }
}

export const ThreatRibbon = memo(ThreatLaneInner);
