import { useEffect, useState } from 'react';
import {
  createGame,
  fetchMe,
  joinGame,
  postGuestName,
  type Me,
} from './api.js';

/**
 * Home — your games, create a new one, join by code. Identity is
 * guest-first: a session already exists by the time this renders
 * (fetchMe mints one), so the only "account" UI is an inline rename.
 */
export function Home({ navigate }: { navigate: (to: string) => void }) {
  const [me, setMe] = useState<Me | null>(null);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [playerCount, setPlayerCount] = useState(4);
  const [pace, setPace] = useState<'realtime' | 'fast' | 'blitz'>('fast');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void fetchMe().then(setMe);
  }, []);

  const submitName = async () => {
    const name = nameDraft.trim();
    setEditingName(false);
    if (name.length < 2 || me === null || name === me.user.name) return;
    await postGuestName(name);
    setMe(await fetchMe());
  };

  const onCreate = async () => {
    setBusy(true);
    setError(null);
    // Pace presets: real Subterfuge runs 1×; "fast" compresses a week
    // into hours for friendly games; "blitz" into ~an evening.
    const simSpeed = pace === 'realtime' ? 1 : pace === 'fast' ? 60 : 240;
    const r = await createGame({ playerCount, simSpeed });
    setBusy(false);
    if (!r.ok || r.code === undefined) {
      setError(r.error ?? 'create failed');
      return;
    }
    navigate(`/g/${r.code}`);
  };

  const onJoin = async () => {
    const code = joinCode.trim().toLowerCase();
    if (code.length === 0) return;
    setBusy(true);
    setError(null);
    const r = await joinGame(code);
    setBusy(false);
    if (!r.ok) {
      setError(r.error ?? 'join failed');
      return;
    }
    navigate(`/g/${code}`);
  };

  return (
    <div className="home">
      <header className="home-mast">
        <img src="/favicon.svg" alt="" width={44} height={44} />
        <div>
          <h1>subterfuge remake</h1>
          <p className="home-sub">a week-long war under the surface</p>
        </div>
        <span className="grow" />
        {me !== null &&
          (editingName ? (
            <input
              className="home-name-input"
              autoFocus
              defaultValue={me.user.name}
              maxLength={24}
              onChange={(e) => setNameDraft(e.target.value)}
              onBlur={() => void submitName()}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void submitName();
                if (e.key === 'Escape') setEditingName(false);
              }}
            />
          ) : (
            <button
              type="button"
              className="home-name"
              title="tap to change your callsign"
              onClick={() => {
                setNameDraft(me.user.name);
                setEditingName(true);
              }}
            >
              {me.user.name}
            </button>
          ))}
      </header>

      {error !== null && <div className="home-error">{error}</div>}

      <section className="home-panel">
        <h2>new game</h2>
        <div className="home-row">
          <label>
            players
            <select
              value={playerCount}
              onChange={(e) => setPlayerCount(Number(e.target.value))}
            >
              {[2, 3, 4, 5, 6, 7, 8].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <label>
            pace
            <select
              value={pace}
              onChange={(e) => setPace(e.target.value as typeof pace)}
            >
              <option value="realtime">classic — real time, ~1 week</option>
              <option value="fast">fast — a day per ~25 min</option>
              <option value="blitz">blitz — a day per ~6 min</option>
            </select>
          </label>
          <button
            type="button"
            className="home-cta"
            disabled={busy}
            onClick={() => void onCreate()}
          >
            create & get invite link
          </button>
        </div>
      </section>

      <section className="home-panel">
        <h2>join by code</h2>
        <div className="home-row">
          <input
            placeholder="invite code, e.g. m79ucw"
            value={joinCode}
            maxLength={12}
            onChange={(e) => setJoinCode(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void onJoin();
            }}
          />
          <button
            type="button"
            className="home-cta"
            disabled={busy || joinCode.trim().length === 0}
            onClick={() => void onJoin()}
          >
            join
          </button>
        </div>
      </section>

      <section className="home-panel">
        <h2>your games</h2>
        {me === null ? (
          <div className="help">loading…</div>
        ) : me.games.length === 0 ? (
          <div className="help">
            nothing on the sonar yet — create a game and send the link to
            your rivals.
          </div>
        ) : (
          <div className="home-games">
            {me.games.map((g) => (
              <button
                key={g.id}
                type="button"
                className="home-game-row"
                onClick={() => g.code !== null && navigate(`/g/${g.code}`)}
              >
                <span className={`home-game-status s-${g.status}`}>
                  {g.status === 'lobby'
                    ? `lobby ${g.seatsTaken}/${g.playerCount}`
                    : g.status}
                </span>
                <span className="home-game-code">/g/{g.code}</span>
                <span className="grow" />
                <span className="home-game-meta">
                  {g.playerCount} players
                  {g.yourSeat !== null ? ` · you are ${String.fromCharCode(65 + g.yourSeat)}` : ''}
                </span>
              </button>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
