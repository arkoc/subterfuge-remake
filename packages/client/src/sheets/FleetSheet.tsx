import {
  type PlayerId,
  type World,
  electricalOutput,
  liveNeptuniumThousandths,
  totalDrillers,
  NEPTUNIUM_VICTORY_THOUSANDTHS,
} from '@subterfuge/sim';
import { BottomSheet } from '../BottomSheet.js';
import { playerColorHex, playerLetter } from '../colors.js';

interface FleetSheetProps {
  world: World;
  activePlayerId: PlayerId;
  onClose: () => void;
}

/**
 * Fleet leaderboard — the Neptunium RACE, one card per player.
 *
 * Card anatomy (top → bottom):
 *   rank · swatch · letter+name · tags …            kg (big)
 *   ────────────── race bar to 200 kg ──────────────
 *   factories · generators · mines · drillers · energy · rate
 *
 * The race bar is the hero: every player's progress toward the same
 * finish line, in their identity colour — the sheet-scale version of
 * the HUD victory meter. Outpost ownership and mine counts are common
 * knowledge (docs/07), so those numbers are exact for everyone; only
 * DRILLER totals are fog-limited (≈ for rivals).
 */
export function FleetSheet({ world, activePlayerId, onClose }: FleetSheetProps) {
  return (
    <BottomSheet open onClose={onClose} title="fleet" meta="the race to 200 kg">
      {world.players
        .slice()
        .sort((a, b) => {
          // Eliminated players sink to the bottom regardless of banked kg.
          if (a.eliminated !== b.eliminated) return a.eliminated ? 1 : -1;
          const an = liveNeptuniumThousandths(world, a, world.time);
          const bn = liveNeptuniumThousandths(world, b, world.time);
          return bn - an;
        })
        .map((p, rank) => {
          const live = liveNeptuniumThousandths(world, p, world.time);
          const pct = Math.min(100, (live / NEPTUNIUM_VICTORY_THOUSANDTHS) * 100);
          const isMe = p.id === activePlayerId;
          let factories = 0;
          let generators = 0;
          let mines = 0;
          for (const o of world.outposts) {
            if (o.ownerId !== p.id) continue;
            if (o.kind === 'factory') factories += 1;
            else if (o.kind === 'generator') generators += 1;
            else if (o.kind === 'mine') mines += 1;
          }
          const outposts = factories + generators + mines;
          // Production rate: mines × outposts kg/day (docs/06). Both
          // counts are common knowledge, so this is exact for rivals
          // too — and it's the number that decides the race.
          const ratePerDay = mines * outposts;
          const drillers = totalDrillers(world, p.id);
          // Electrical cap. Generators are common knowledge, but the
          // Queen's +150 / specialist bonuses depend on locations the
          // fog may hide — rivals get the ≈ treatment like drillers.
          const energy = electricalOutput(world, p.id);
          const color = playerColorHex(p.id);
          return (
            <div
              key={p.id}
              className={`lb-card${isMe ? ' lb-card-me' : ''}${p.eliminated ? ' lb-card-out' : ''}`}
            >
              <div className="lb-card-top">
                <span className="lb-rank">{p.eliminated ? '—' : rank + 1}</span>
                <span className="lb-swatch" style={{ background: color }} />
                <span className="lb-id">
                  <strong>{playerLetter(p.id)}</strong> {p.name}
                </span>
                {isMe && <span className="lb-you">you</span>}
                {p.eliminated && <span className="lb-out">eliminated</span>}
                <span className="lb-kg">
                  {(live / 1000).toFixed(1)}
                  <span className="lb-unit">kg</span>
                </span>
              </div>
              <div
                className="lb-race"
                role="progressbar"
                aria-valuenow={Math.round(pct)}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={`${p.name} neptunium progress`}
              >
                <span
                  style={{
                    width: `${pct}%`,
                    background: color,
                    boxShadow: isMe ? `0 0 8px ${color}66` : 'none',
                  }}
                />
              </div>
              <div className="lb-card-foot">
                {/* Labeled stat grid — every asset class spelled out.
                    Glyph shorthand (▲2 ●3 ◆1) read as cryptic; a
                    value-over-label cell is self-explanatory. */}
                <span className="lb-stat-grid" role="list">
                  <StatCell label="factories" value={String(factories)} glyph="▲" />
                  <StatCell label="generators" value={String(generators)} glyph="●" />
                  <StatCell label="mines" value={String(mines)} glyph="◆" />
                  <StatCell
                    label="drillers"
                    value={`${isMe ? '' : '≈'}${drillers}`}
                    title={
                      isMe
                        ? `${drillers} drillers total`
                        : 'visible drillers only — garrisons outside your sonar are hidden'
                    }
                  />
                  <StatCell
                    label="energy"
                    value={`${isMe ? '' : '≈'}${energy}`}
                    glyph={'⚡︎'}
                    title={
                      isMe
                        ? `electrical capacity — driller stockpile cap (${drillers}/${energy})`
                        : 'electrical capacity estimated from what your sonar can see'
                    }
                  />
                  <StatCell
                    label="rate"
                    value={
                      p.eliminated || ratePerDay === 0 ? '—' : `+${ratePerDay}/d`
                    }
                    accent={ratePerDay > 0 && !p.eliminated}
                    title={`neptunium per day = ${mines} mines × ${outposts} outposts`}
                  />
                </span>
              </div>
            </div>
          );
        })}
      <div className="help" style={{ marginTop: 12 }}>
        ≈ visible drillers only · rate = mines × outposts · first to{' '}
        {NEPTUNIUM_VICTORY_THOUSANDTHS / 1000} kg wins
      </div>
    </BottomSheet>
  );
}

/** One value-over-label cell of the per-player stat grid. */
function StatCell({
  label,
  value,
  glyph,
  accent = false,
  title,
}: {
  label: string;
  value: string;
  /** Optional map-glyph prefix tying the number back to the shape the
   *  player sees on the chart (▲ factory, ● generator, ◆ mine). */
  glyph?: string;
  accent?: boolean;
  title?: string;
}) {
  return (
    <span className="lb-cell" role="listitem" {...(title ? { title } : {})}>
      <span className={`lb-cell-value${accent ? ' accent' : ''}`}>
        {glyph !== undefined && (
          <span className="lb-cell-glyph" aria-hidden="true">
            {glyph}
          </span>
        )}
        {value}
      </span>
      <span className="lb-cell-label">{label}</span>
    </span>
  );
}
