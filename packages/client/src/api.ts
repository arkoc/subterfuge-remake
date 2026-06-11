import type {
  OutpostId,
  PlayerId,
  QueuedOrderId,
  SpecialistId,
  SpecialistKind,
  SubId,
  World,
} from '@subterfuge/sim';

export interface LaunchBody {
  ownerId: PlayerId;
  sourceId: OutpostId;
  destinationId: OutpostId;
  drillers: number;
  giftTo?: PlayerId;
  specialistIds?: SpecialistId[];
}

export interface HireBody {
  ownerId: PlayerId;
  kind: SpecialistKind;
}

export interface PromoteBody {
  ownerId: PlayerId;
  specialistId: SpecialistId;
}

export interface RedirectBody {
  ownerId: PlayerId;
  subId: SubId;
  newDestinationId: OutpostId;
}

export interface CancelSubBody {
  ownerId: PlayerId;
  subId: SubId;
}

export interface EditPreLaunchSubBody {
  ownerId: PlayerId;
  subId: SubId;
  drillers: number;
  specialistIds?: SpecialistId[];
}

export interface PirateTargetBody {
  ownerId: PlayerId;
  subId: SubId;
  targetSubId: SubId;
}

export interface ReleaseCaptiveBody {
  ownerId: PlayerId;
  specialistId: SpecialistId;
}

export interface DrillBody {
  ownerId: PlayerId;
  outpostId: OutpostId;
}

export interface QueueLaunchBody extends LaunchBody {
  executeAt: number;
  /** Pirate-chase this enemy sub the moment the queued launch fires. */
  pirateTargetSubId?: SubId;
}

export interface QueueDrillBody extends DrillBody {
  executeAt: number;
}

export interface QueueHireBody {
  ownerId: PlayerId;
  kind: SpecialistKind;
  executeAt: number;
}

export interface QueuePromoteBody {
  ownerId: PlayerId;
  specialistId: SpecialistId;
  executeAt: number;
}

export interface QueueRedirectBody extends RedirectBody {
  executeAt: number;
}

export interface QueuePirateTargetBody extends PirateTargetBody {
  executeAt: number;
}

export interface OrderResponse {
  ok: boolean;
  subId?: SubId;
  id?: QueuedOrderId;
  error?: string;
}

// ---------------------------------------------------------------------
// Game scoping. The shell sets the active game before mounting the
// in-game App; every order/state call below is then routed to
// /api/g/<id>/…. The server derives the acting player from the
// session's seat — the ownerId fields still present in bodies are
// ignored outside DEV_MODE.
// ---------------------------------------------------------------------

let activeGameId = 0;

export function setActiveGame(id: number): void {
  activeGameId = id;
}

function g(path: string): string {
  return `/api/g/${activeGameId}${path}`;
}

/**
 * POST/DELETE JSON and parse the `{ ok, error? }`-shaped response.
 *
 * Transport failures (network down, server unreachable, proxy 502
 * with a non-JSON body) resolve to `{ ok: false, error }` instead of
 * rejecting — every call site already routes `ok: false` into an
 * error toast, so this turns silent unhandled rejections into the
 * same user-visible path as server-side validation failures.
 */
async function requestJson<T extends { ok: boolean; error?: string }>(
  url: string,
  init?: RequestInit,
): Promise<T> {
  try {
    const r = await fetch(url, init);
    return (await r.json()) as T;
  } catch {
    return {
      ok: false,
      error: 'network error — the order did not reach the server',
    } as T;
  }
}

function postJson<T extends { ok: boolean; error?: string }>(
  url: string,
  body: unknown,
): Promise<T> {
  return requestJson<T>(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export function postLaunch(body: LaunchBody): Promise<OrderResponse> {
  return postJson(g('/orders/launch'), body);
}

export function postHire(body: HireBody): Promise<OrderResponse> {
  return postJson(g('/orders/hire'), body);
}

export function postHireNow(body: HireBody): Promise<OrderResponse> {
  return postJson(g('/orders/hire/now'), body);
}

export function postPromote(body: PromoteBody): Promise<OrderResponse> {
  return postJson(g('/orders/promote'), body);
}

export function postPromoteNow(body: PromoteBody): Promise<OrderResponse> {
  return postJson(g('/orders/promote/now'), body);
}

export function postRedirect(body: RedirectBody): Promise<OrderResponse> {
  return postJson(g('/orders/redirect'), body);
}

export function postCancelSub(body: CancelSubBody): Promise<OrderResponse> {
  return postJson(g('/orders/cancel-sub'), body);
}

export function postEditPreLaunchSub(
  body: EditPreLaunchSubBody,
): Promise<OrderResponse> {
  return postJson(g('/orders/edit-prelaunch-sub'), body);
}

export function postPirateTarget(body: PirateTargetBody): Promise<OrderResponse> {
  return postJson(g('/orders/pirate-target'), body);
}

/** Queue a redirect to fire at a future `executeAt` (Time Machine). */
export function postQueueRedirect(
  body: QueueRedirectBody,
): Promise<OrderResponse> {
  return postJson(g('/queue/redirect'), body);
}

/** Queue a pirate-target to fire at a future `executeAt` (Time Machine). */
export function postQueuePirateTarget(
  body: QueuePirateTargetBody,
): Promise<OrderResponse> {
  return postJson(g('/queue/pirate-target'), body);
}

export function postReleaseCaptive(body: ReleaseCaptiveBody): Promise<OrderResponse> {
  return postJson(g('/orders/release-captive'), body);
}

export function postDrill(body: DrillBody): Promise<OrderResponse> {
  return postJson(g('/orders/drill'), body);
}

export function postQueueLaunch(body: QueueLaunchBody): Promise<OrderResponse> {
  return postJson(g('/queue/launch'), body);
}

export function postQueueDrill(body: QueueDrillBody): Promise<OrderResponse> {
  return postJson(g('/queue/drill'), body);
}

export function postQueueHire(body: QueueHireBody): Promise<OrderResponse> {
  return postJson(g('/queue/hire'), body);
}

export function postQueuePromote(body: QueuePromoteBody): Promise<OrderResponse> {
  return postJson(g('/queue/promote'), body);
}

export function deleteQueuedOrder(
  id: QueuedOrderId,
  ownerId: PlayerId,
): Promise<{ ok: boolean; error?: string }> {
  return requestJson(
    g(`/queue/${id as unknown as number}?ownerId=${ownerId as unknown as number}`),
    { method: 'DELETE' },
  );
}

export function deletePendingCommand(
  id: number,
  ownerId: PlayerId,
): Promise<{ ok: boolean; error?: string }> {
  return requestJson(
    g(`/pending/${id}?ownerId=${ownerId as unknown as number}`),
    { method: 'DELETE' },
  );
}

export function finalizePendingCommand(
  id: number,
  ownerId: PlayerId,
): Promise<{ ok: boolean; error?: string }> {
  return postJson(g(`/pending/${id}/finalize`), { ownerId });
}

export interface ChatBody {
  from: PlayerId;
  to: PlayerId | null;
  text: string;
}

export function postChat(body: ChatBody): Promise<{ ok: boolean; error?: string }> {
  return postJson(g('/chat'), body);
}


// ---------------------------------------------------------------------
// Shell: identity + lobby (Phase A)
// ---------------------------------------------------------------------

export interface Me {
  user: { id: number; name: string };
  games: {
    id: number;
    code: string | null;
    status: 'lobby' | 'active' | 'finished';
    playerCount: number;
    seatsTaken: number;
    yourSeat: number | null;
    updatedAt: number;
  }[];
}

export async function fetchMe(): Promise<Me | null> {
  try {
    const r = await fetch('/api/me');
    if (!r.ok) return null;
    return (await r.json()) as Me;
  } catch {
    return null;
  }
}

export function postGuestName(name: string): Promise<{ ok: boolean; error?: string }> {
  return postJson('/api/auth/guest', { name });
}

export function createGame(body: {
  playerCount: number;
  simSpeed: number;
}): Promise<{ ok: boolean; id?: number; code?: string; error?: string }> {
  return postJson('/api/games', body);
}

export interface LobbyState {
  ok: boolean;
  id: number;
  code: string;
  status: 'lobby' | 'active' | 'finished';
  playerCount: number;
  simSpeed: number;
  seats: { seat: number; name: string }[];
  yourSeat: number | null;
  error?: string;
}

export async function fetchLobby(code: string): Promise<LobbyState | null> {
  try {
    const r = await fetch(`/api/games/${encodeURIComponent(code)}`);
    return (await r.json()) as LobbyState;
  } catch {
    return null;
  }
}

export function joinGame(code: string): Promise<LobbyState> {
  return postJson(`/api/games/${encodeURIComponent(code)}/join`, {});
}

export function leaveGame(code: string): Promise<{ ok: boolean; error?: string }> {
  return postJson(`/api/games/${encodeURIComponent(code)}/leave`, {});
}

export interface GameMeta {
  gameId: number;
  simVersion: string;
  /** Earliest sim time the server can replay (latest epoch baseline;
   *  0 unless a sim-version change promoted one mid-game). */
  epochFloor: number;
  /** The session's seat in this game. */
  yourSeat: number;
  simSpeed: number;
}

/** Fetch game-level metadata. Re-fetched on every WS reconnect since
 *  epoch promotion only ever happens at server boot. */
export async function fetchMeta(): Promise<GameMeta | null> {
  try {
    const r = await fetch(g('/meta'));
    if (!r.ok) return null;
    return (await r.json()) as GameMeta;
  } catch {
    return null;
  }
}

/**
 * Fetch the world state at a specific past sim time. The server
 * picks the closest checkpoint ≤ `at` and replays the event log
 * forward to `at`, filtered through `viewForPlayer`. Used by the
 * time scrubber when the user drags back further than the
 * in-memory snapshot buffer holds. Times below the epoch floor
 * return 409 → null; callers clamp via `fetchMeta().epochFloor`.
 */
export async function fetchReplayAt(
  playerId: PlayerId,
  at: number,
): Promise<World | null> {
  const url = g(`/replay?at=${Math.floor(at)}&playerId=${playerId as unknown as number}`);
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    return (await r.json()) as World;
  } catch {
    return null;
  }
}

export type StreamStatus = 'connected' | 'reconnecting';

/**
 * Open the per-player world-state WebSocket. Reconnects automatically
 * with capped exponential backoff (1s → 16s) whenever the socket
 * closes — server restarts, dropped Wi-Fi, laptop sleep. `onStatus`
 * fires on every transition so the UI can show a staleness banner
 * while the stream is down.
 *
 * Returns a cleanup function that cancels reconnection and closes
 * the live socket.
 */
export function openStateStream(
  playerId: PlayerId,
  onState: (w: World) => void,
  onStatus?: (s: StreamStatus) => void,
): () => void {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const url = `${proto}://${location.host}/ws?gameId=${activeGameId}&playerId=${playerId as unknown as number}`;
  let cancelled = false;
  let ws: WebSocket | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let attempt = 0;

  const connect = () => {
    if (cancelled) return;
    ws = new WebSocket(url);
    ws.onopen = () => {
      attempt = 0;
      onStatus?.('connected');
    };
    ws.onmessage = (evt) => {
      try {
        const msg = JSON.parse(evt.data as string) as { type: string; world?: World };
        if (msg.type === 'state' && msg.world) onState(msg.world);
      } catch {
        /* ignore parse errors */
      }
    };
    ws.onerror = (e) => {
      // Suppress the close-before-handshake event React StrictMode triggers
      // on the first (immediately-cancelled) mount.
      if (!cancelled) console.error('[ws] error', e);
    };
    ws.onclose = () => {
      if (cancelled) return;
      onStatus?.('reconnecting');
      const delay = Math.min(1000 * 2 ** attempt, 16_000);
      attempt += 1;
      retryTimer = setTimeout(connect, delay);
    };
  };
  connect();

  return () => {
    cancelled = true;
    if (retryTimer !== null) clearTimeout(retryTimer);
    const sock = ws;
    if (!sock) return;
    // Closing a socket that is still CONNECTING fires the browser's
    // "WebSocket is closed before the connection is established"
    // warning. Defer the close until after the handshake completes.
    if (sock.readyState === WebSocket.CONNECTING) {
      sock.addEventListener('open', () => sock.close(), { once: true });
    } else {
      sock.close();
    }
  };
}
