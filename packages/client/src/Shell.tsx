import { useCallback, useEffect, useState } from 'react';
import type { PlayerId } from '@subterfuge/sim';
import { App } from './App.js';
import { Home } from './Home.js';
import { Lobby } from './Lobby.js';
import { fetchLobby, setActiveGame, type LobbyState } from './api.js';

/**
 * Phase A shell — the building around the cockpit. Hand-rolled
 * two-route router (no dep for two routes):
 *
 *   /          home — your games, create, join by code
 *   /g/<code>  lobby while filling; the in-game App once started
 *
 * The in-game App stays exactly what it was; the shell resolves the
 * invite code to a gameId + seat and mounts it.
 */
export function Shell() {
  const [path, setPath] = useState(location.pathname);

  useEffect(() => {
    const onPop = () => setPath(location.pathname);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const navigate = useCallback((to: string) => {
    history.pushState(null, '', to);
    setPath(to);
  }, []);

  const gameMatch = path.match(/^\/g\/([a-z0-9]+)$/i);
  if (gameMatch !== null) {
    return <GameGate code={gameMatch[1]!.toLowerCase()} navigate={navigate} />;
  }
  return <Home navigate={navigate} />;
}

/**
 * Resolve an invite code → lobby screen or the running game. Polls
 * while in the lobby so the screen flips to the map the moment the
 * last seat fills.
 */
function GameGate({
  code,
  navigate,
}: {
  code: string;
  navigate: (to: string) => void;
}) {
  const [state, setState] = useState<LobbyState | null | 'missing'>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const load = async () => {
      const s = await fetchLobby(code);
      if (cancelled) return;
      if (s === null || !s.ok) {
        setState('missing');
        return;
      }
      setState(s);
      // Keep polling until the game starts; the App's own WS takes
      // over from there.
      if (s.status === 'lobby') timer = setTimeout(() => void load(), 2000);
    };
    void load();
    return () => {
      cancelled = true;
      if (timer !== null) clearTimeout(timer);
    };
  }, [code]);

  if (state === null) {
    return <div className="shell-status">locating game…</div>;
  }
  if (state === 'missing') {
    return (
      <div className="shell-status">
        no game at <code>/g/{code}</code>
        <button type="button" className="shell-link" onClick={() => navigate('/')}>
          back to base
        </button>
      </div>
    );
  }
  if (state.status === 'lobby') {
    return <Lobby state={state} navigate={navigate} onRefresh={setState} />;
  }
  // Started (active or finished): mount the cockpit. A viewer without
  // a seat sees nothing useful outside DEV — keep them on the lobby
  // card instead of a broken map.
  if (state.yourSeat === null) {
    return (
      <div className="shell-status">
        this game started without you aboard
        <button type="button" className="shell-link" onClick={() => navigate('/')}>
          back to base
        </button>
      </div>
    );
  }
  setActiveGame(state.id);
  return (
    <App
      key={state.id}
      mySeat={state.yourSeat as PlayerId}
      onExit={() => navigate('/')}
    />
  );
}
