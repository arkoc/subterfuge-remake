import { useState } from 'react';
import { joinGame, leaveGame, type LobbyState } from './api.js';
import { playerColorHex } from './colors.js';
import type { PlayerId } from '@subterfuge/sim';

/**
 * Pre-start lobby: who's aboard, the invite link, join/leave. The
 * GameGate polls the lobby state and flips to the map when the last
 * seat fills — this component is purely presentational + two actions.
 */
export function Lobby({
  state,
  navigate,
  onRefresh,
}: {
  state: LobbyState;
  navigate: (to: string) => void;
  onRefresh: (s: LobbyState) => void;
}) {
  const [copied, setCopied] = useState(false);
  const url = `${location.origin}/g/${state.code}`;
  const seated = new Map(state.seats.map((s) => [s.seat, s.name]));

  return (
    <div className="home">
      <header className="home-mast">
        <img src="/favicon.svg" alt="" width={44} height={44} />
        <div>
          <h1>lobby · {state.code}</h1>
          <p className="home-sub">
            dive begins the moment all {state.playerCount} captains are aboard
          </p>
        </div>
      </header>

      <section className="home-panel">
        <h2>invite link</h2>
        <div className="home-row">
          <input readOnly value={url} onFocus={(e) => e.target.select()} />
          <button
            type="button"
            className="home-cta"
            onClick={() => {
              void navigator.clipboard.writeText(url).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              });
            }}
          >
            {copied ? 'copied ✓' : 'copy'}
          </button>
        </div>
      </section>

      <section className="home-panel">
        <h2>
          crew {state.seats.length}/{state.playerCount}
        </h2>
        <div className="home-games">
          {Array.from({ length: state.playerCount }, (_, seat) => {
            const name = seated.get(seat);
            return (
              <div key={seat} className="home-game-row lobby-seat">
                <span
                  className="lobby-swatch"
                  style={{ background: playerColorHex(seat as PlayerId) }}
                />
                <span className="home-game-code">
                  {String.fromCharCode(65 + seat)}
                </span>
                {name !== undefined ? (
                  <span>
                    {name}
                    {state.yourSeat === seat ? ' (you)' : ''}
                  </span>
                ) : (
                  <span className="help">waiting for a captain…</span>
                )}
              </div>
            );
          })}
        </div>
      </section>

      <section className="home-panel">
        <div className="home-row">
          {state.yourSeat === null ? (
            <button
              type="button"
              className="home-cta"
              onClick={() => {
                void joinGame(state.code).then((s) => {
                  if (s.ok) onRefresh(s);
                });
              }}
            >
              take a seat
            </button>
          ) : (
            <button
              type="button"
              className="home-cta ghost"
              onClick={() => {
                void leaveGame(state.code).then(() => navigate('/'));
              }}
            >
              leave lobby
            </button>
          )}
          <button type="button" className="home-cta ghost" onClick={() => navigate('/')}>
            back to base
          </button>
        </div>
      </section>
    </div>
  );
}
