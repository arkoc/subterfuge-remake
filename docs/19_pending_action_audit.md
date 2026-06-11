# Pending Action Audit: Cancellation Coverage & Hire Finalize-Now Analysis

## 1. All Pending Action Types

| Action | Pending Window | Cancel API | Wired in UI | Cancellable? | Notes |
|--------|---|---|---|---|---|
| **Launch sub** | 10 min (LAUNCH_DELAY_MS) | POST `/api/orders/cancel-sub` | Yes (all sheets) | Yes | Pre-launch window; drillers & specialists refunded on cancel |
| **Hire specialist** | 10 min (PENDING_DELAY_MS) | DELETE `/api/pending/:id` | Yes (QueueSheet) | Yes | Deferred via pending-commands; cancel shows in Orders sheet |
| **Promote specialist** | 10 min (PENDING_DELAY_MS) | DELETE `/api/pending/:id` | Yes (QueueSheet) | Yes | Same infra as hire; deferred 10-min window |
| **Drill mine** | 10 min (PENDING_DELAY_MS) | DELETE `/api/pending/:id` | Yes (QueueSheet) | Yes | Deferred order; cancel shows in Orders sheet |
| **Redirect sub** (Navigator) | 10 min (PENDING_DELAY_MS) | DELETE `/api/pending/:id` | Yes (QueueSheet) | Yes | Only valid if Navigator aboard; deferred action |
| **Pirate target** (Pirate) | 10 min (PENDING_DELAY_MS) | DELETE `/api/pending/:id` | Yes (QueueSheet) | Yes | Only valid with Pirate aboard; deferred state-machine trigger |
| **Release captive** | 10 min (PENDING_DELAY_MS) | DELETE `/api/pending/:id` | Yes (QueueSheet + OutpostSheet) | Yes | Deferred via pending-commands; an instant `/now` variant exists server-side but the UI uses the cancellable path |
| **Chat** (global/DM) | None (immediate) | N/A | N/A | N/A | Instant send; no pending window per spec |
| **Funding start** | None (immediate) | N/A | Yes (FleetSheet) | N/A | Instant; no cancel needed; auto-stops if lead drops |
| **Funding stop** | None (immediate) | N/A | Yes (FleetSheet) | N/A | Instant revocation |

**Key findings:**
- All deferrable actions use `pendingCommands.ts` infrastructure (pending-commands.ts:32-45)
- Uniform 10-minute window aligns with rulebook per types.ts:125-128
- All cancellable actions properly wired in QueueSheet (QueueSheet.tsx:77-90)
- Sub launches use separate mechanism via `sub.launchAt` (orders.ts:113)
- Funding & chat are immediate by design; no deferral needed

---

## 2. Gaps Found

**No gaps detected.** All deferable actions (drill, hire, promote, redirect, pirate-target) are:
1. ✓ Listed in DeferableCommand union (types.ts:418-445)
2. ✓ Handled in applyDeferable() switch (pending-commands.ts:112-141)
3. ✓ Have cancel API endpoints (main.ts:476-497 for pending; 410-430 for subs)
4. ✓ Exposed in UI via QueueSheet (shows both pending + queued orders)
5. ✓ Match rulebook "10-minute cancellable" semantics

Sub launches are **intentionally separate**: they use `Sub.launchAt` (types.ts:302) + the pre-launch edit window (orders.ts:153-190), not the pending-commands queue. This is correct per the rulebook.

---

## 3. Hire Finalize-Now Analysis

### Current Pending Mechanic for Hire

**Line 361-368 (main.ts):**
```typescript
app.post('/api/orders/hire', async (c) => {
  const body = (await c.req.json()) as { ownerId: number; kind: string };
  return deferAndRespond(c, {
    kind: 'hire',
    ownerId: body.ownerId as PlayerId,
    specialistKind: body.kind as SpecialistKind,
  });
});
```

The hire flows through `deferAndRespond()` (main.ts:122-140), which:
1. Calls `defer()` to create a PendingCommand (pending-commands.ts:33-45)
2. Sets `executeAt = issuedAt + PENDING_DELAY_MS` (types.ts:128 = 10 min)
3. Records a `defer` event for replay
4. Returns the pending command's id so the UI can show it

The actual hire execution happens in the tick loop (tick.ts:132-148), which calls `dispatchPending()` → `applyDeferable()` → `executeHire()`.

**Validation that blocks immediate hire (hiring.ts:168-192):**
- `world.time < player.nextHireAt` — can only hire when timer fires (line 173-176)
- `queenOutpostOf() === null` — Queen must be at a friendly outpost (line 178-182)
- `kind not in current roster` — can only pick offered kinds (line 184-189)
- `isCapReached()` — cannot exceed specialist hard cap (line 190-192)

**The 10-minute window is NOT load-bearing for the hire timer itself.** The timer (`nextHireAt`) is checked at execution time, not at issuance. The pending window exists only because the rulebook mandates "all cancellable actions have a 10-min window."

### Architectural Blocker (None)

There is **no architectural blocker** to adding a finalize-now option. The pending window is pure admin—delays the side effect but doesn't affect game state validation. The blocker checklist:

1. ✗ Is the pending window needed for determinism? **No.** The hire logic is deterministic either way.
2. ✗ Is it needed to prevent order race conditions? **No.** Each hire is a discrete transaction.
3. ✗ Does it synchronize with other actions? **No.** The 10-min delay matches launches but isn't coupled to them.
4. ✗ Does skipping it break replay logic? **No.** Events are recorded at dispatch time; a finalize-now would emit the same `executeHire` effect.

**Conclusion:** Finalize-now is feasible; it requires **new code, not restructuring**.

### Recommended Approach

**Option A: Dual-path dispatch (recommended)**

Add a new endpoint `/api/orders/hire/finalize` that bypasses `deferAndRespond()` and calls `executeHire()` directly:

1. **New endpoint** (main.ts after line 368):
   ```typescript
   app.post('/api/orders/hire/finalize', async (c) => {
     const body = (await c.req.json()) as { ownerId: number; kind: string };
     try {
       const spec = executeHire(game.world, {
         ownerId: body.ownerId as PlayerId,
         kind: body.kind as SpecialistKind,
       });
       recordEvent({ kind: 'hire', ownerId: body.ownerId, ... });
       broadcastState();
       return c.json({ ok: true, specialistId: spec.id });
     } catch (e) {
       // same error handling as deferAndRespond
     }
   });
   ```

2. **New client function** (api.ts after line 102):
   ```typescript
   export async function postHireFinalize(body: HireBody): Promise<OrderResponse> {
     const r = await fetch('/api/orders/hire/finalize', { ... });
     return r.json();
   }
   ```

3. **UI toggle in HireSheet** (HireSheet.tsx:96-119):
   - Add a "finalize now" button alongside the normal hire button
   - Disabled if Queen is away (validation happens server-side; button prevents pointless clicks)
   - Toast differs: "specialist hired immediately" vs. "hire pending — cancel within 10m"

**Cost of this approach:**
- 3 files touched: main.ts (15 loc), api.ts (8 loc), HireSheet.tsx (20 loc)
- No sim changes; no type changes
- ~30 minutes of dev + test

**Option B: Parameter-driven (alternative)**

Modify the existing `/api/orders/hire` endpoint to accept an optional `finalizeNow?: boolean` query param. Simpler in some ways but couples two behaviors in one route.

### What About Other Pending Actions?

**Redirect** and **Pirate-target** could plausibly get finalize-now too. But these have **validation at execution time** that might reasonably fail:
- Redirect: Navigator must still be aboard at execution time (orders.ts:344-351)
- Pirate-target: target sub must still exist (pirate.ts logic)

A finalize-now for these would need real-time validation, not "try now and fail later." Worth considering as a follow-up if players request it, but hire is the cleanest candidate because the only runtime check is the Queen's location (a stable, player-controlled fact).

---

## 4. Recommendations

### 1. **Implement Hire Finalize-Now** (Priority: Medium)
- Addresses player pain point: waiting 10 min to use a hired specialist
- Low risk: no sim changes, pure order dispatch
- Suggested timeline: pair with next UX iteration

### 2. **Document Pending-Command Architecture** (Priority: Low)
- Update docs/05_specialists.md §1 to clarify hire deferral vs. the 10-min cancel window
- Add a sentence explaining why the window doesn't block the timer: "The hire is only issued when the timer fires; the 10-minute cancel window defers the *effect* but not the *availability check*."

### 3. **Test Replay Edge Cases** (Priority: Low)
- Verify that cancelling a pending hire while the Queen is away, then moving her to an outpost before executeAt, doesn't create a state desync
- Currently untested in pending-commands.test.ts

### 4. **Consider Redirect/Pirate Finalize-Now** (Priority: Future)
- Only if players request "I want to redirect my Navigator-equipped sub *immediately*"
- Requires real-time Navigator validation, which is more complex than hire

---

## Appendix: Code Citations

- **Pending-command infrastructure:** `/packages/sim/src/pending-commands.ts:14-24`
- **Deferable command types:** `/packages/sim/src/types.ts:407-455`
- **Time constants:** `/packages/sim/src/types.ts:76-128`
- **Hire execution:** `/packages/sim/src/hiring.ts:168-201`
- **Server defer/cancel routes:** `/packages/server/src/main.ts:122-140`, `476-497`
- **Client API:** `/packages/client/src/api.ts:203-212`
- **Client UI (Orders sheet):** `/packages/client/src/sheets/QueueSheet.tsx:50-92`
- **Tick dispatch:** `/packages/sim/src/tick.ts:132-148`
