import { useState } from 'react';
import type { PlayerId, World } from '@subterfuge/sim';
import {
  liveNeptuniumThousandths,
  NEPTUNIUM_VICTORY_THOUSANDTHS,
} from '@subterfuge/sim';
import { playerColorHex, playerLetter } from './colors.js';

/**
 * End-of-game ceremony. Shown the moment `world.winnerId` is set;
 * dismissable so the final map stays explorable (the world is
 * read-only once finished — the server stops ticking it).
 */
export function VictoryOverlay({
  world,
  mySeat,
  onExit,
}: {
  world: World;
  mySeat: PlayerId;
  onExit?: (() => void) | undefined;
}) {
  const [dismissed, setDismissed] = useState(false);
  if (world.winnerId === null) return null;

  if (dismissed) {
    return (
      <button
        type="button"
        className="victory-chip"
        onClick={() => setDismissed(false)}
      >
        ⚑ game over — standings
      </button>
    );
  }

  const standings = world.players
    .slice()
    .sort((a, b) => {
      if (a.eliminated !== b.eliminated) return a.eliminated ? 1 : -1;
      return (
        liveNeptuniumThousandths(world, b, world.time) -
        liveNeptuniumThousandths(world, a, world.time)
      );
    });
  const won = world.winnerId === mySeat;
  const winner = world.players.find((p) => p.id === world.winnerId);
  const byNeptunium =
    winner !== undefined &&
    liveNeptuniumThousandths(world, winner, world.time) >=
      NEPTUNIUM_VICTORY_THOUSANDTHS;

  return (
    <div className="victory-backdrop" role="dialog" aria-label="game over">
      <div className="victory-card">
        <div className={`victory-headline ${won ? 'win' : 'lose'}`}>
          {won ? 'VICTORY' : 'GAME OVER'}
        </div>
        <div className="victory-sub">
          {playerLetter(world.winnerId)} · {winner?.name}{' '}
          {byNeptunium
            ? `raised ${NEPTUNIUM_VICTORY_THOUSANDTHS / 1000} kg of neptunium`
            : 'outlasted every rival fleet'}
        </div>
        <div className="victory-standings">
          {standings.map((p, i) => (
            <div
              key={p.id}
              className={`victory-row${p.id === mySeat ? ' me' : ''}${p.eliminated ? ' out' : ''}`}
            >
              <span className="victory-rank">{p.eliminated ? '—' : i + 1}</span>
              <span
                className="lobby-swatch"
                style={{ background: playerColorHex(p.id) }}
              />
              <span className="victory-name">
                {playerLetter(p.id)} {p.name}
                {p.id === mySeat ? ' (you)' : ''}
              </span>
              <span className="grow" />
              <span className="victory-kg">
                {(liveNeptuniumThousandths(world, p, world.time) / 1000).toFixed(1)}
                kg
              </span>
            </div>
          ))}
        </div>
        <div className="victory-actions">
          <button type="button" className="home-cta ghost" onClick={() => setDismissed(true)}>
            inspect the final map
          </button>
          {onExit !== undefined && (
            <button type="button" className="home-cta" onClick={onExit}>
              back to base
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
