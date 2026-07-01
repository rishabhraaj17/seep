# First-round reveal timing fixes + toss animation polish

## Problem

Two related information-leak bugs around the start of a round, plus a request to make
the existing jack-toss animation more visible.

### Bug 1 — floor leaks before any bid is placed

`GameState.floor` should stay hidden from every player until the caller (seat 0)
announces their bid. A masking convention already exists for this
(`floor.map(c => ({ ...c, faceDown: true }))`), used by the per-socket `deal-cards`
event. However, the generic `game-state` event — broadcast raw and unmasked at ~17
call sites in `packages/server/src/index.ts`, including the moment `gamePhase`
transitions to `'bidding'` (line 1013, before any bid exists) — ships the true,
unmasked `floor` to the whole room. Any `game-state` broadcast during `'toss'` or
`'bidding'` phases undoes the masking done via `deal-cards`, so the floor is visible
well before it should be.

### Bug 2 — caller's hidden cards revealed too early

The caller (seat 0) is dealt all 12 of their cards at deal time, but only the first 4
should be visible/usable until they complete their first (house-building) play. Today,
`place-bid` (`packages/server/src/index.ts:1604-1613`) reveals the caller's full
12-card hand immediately when they announce their bid value — before they've actually
played a card. This should instead happen only after the caller finishes their first
play, exactly like the existing `dealRemainingCardsIfFirstTurn` mechanism already does
for the other three seats (`playerIndex > 0` branch, line ~189).

### Toss animation — feature request

The jack-toss screen (`TossPhase.tsx`) works but the deal pace is fast (600ms/card)
and the winning card isn't visually distinct, and the server's fixed 5000ms timer
before advancing to bidding isn't synced to how long the animation actually takes
(it can cut the animation short for a long toss, or leave a dead pause for a short one).

## Fix design

### 1. Redact floor in all `game-state` broadcasts

Add a helper in `packages/server/src/index.ts`:

```ts
function redactGameStateForBroadcast(gameState: GameState): GameState {
  if (gameState.gamePhase === 'toss' || gameState.gamePhase === 'bidding') {
    return { ...gameState, floor: gameState.floor.map(c => ({ ...c, faceDown: true })) };
  }
  return gameState;
}
```

Replace every `io.to(lobbyCode).emit('game-state', lobby.gameState)` /
`io.to(lobby.code).emit('game-state', ...)` / `socket.emit('game-state', ...)` call
(17 sites) with the redacted version:
`io.to(lobbyCode).emit('game-state', redactGameStateForBroadcast(lobby.gameState))`.

This makes "floor hidden until bid is placed" a structural guarantee — the true floor
is only ever present in a `game-state` payload once `gamePhase` is `'playing'` or later,
which happens precisely when the bid is placed (`place-bid` sets
`gameState.gamePhase = 'playing'`). No change needed to when phases transition; only
to what gets shipped to clients while in those phases.

### 2. Defer caller's full-hand reveal to after their first play

Extend `dealRemainingCardsIfFirstTurn` (line 185) so the `playerIndex === 0` case is
handled alongside `playerIndex > 0`, instead of being skipped:

- For `playerIndex > 0`: unchanged — draw 8 cards from the remaining deck, update the
  hand, emit `deal-cards` with the updated hand.
- For `playerIndex === 0` (the caller): no draw needed (their 12 cards were already
  dealt at deal time). Just emit `deal-cards` with their existing full hand from
  `lobby.hands.get(playerId)`.

Both branches still gate on `!hasCompletedFirstTurn` and still push `playerId` onto
`firstTurnCompleted`, matching current behavior.

Remove the now-premature/redundant reveal blocks:
- The "Also update caller's hand view with the full 12 cards now dealt" block in
  `place-bid` (~lines 1604-1613).
- The dealer-only early floor reveal inside the bot-bid branch of
  `checkAndTriggerBotTurn` (~lines 701-711) — redundant once fix (1) makes the floor
  reveal to everyone happen structurally and correctly at bid time (when `gamePhase`
  becomes `'playing'`).

No changes to the `askAbove8` reshuffle flow (dealer verifying the caller has a card
above 8, redealing the caller's 4 cards if not) — it already matches the intended rule
and is out of scope here.

### 3. Toss animation polish

In `TossPhase.tsx`:
- Increase the per-card deal interval from `600` to `900` (ms) in the `setInterval`
  driving `animatedDeals`.
- Add a highlight/glow treatment (e.g. a gold pulse/scale animation, similar to
  existing `motion` usage in the file) to the winning Jack `PlayingCard` and to the
  winning player's seat panel once `currentWinner` is set.

In `packages/server/src/index.ts` (`start-game` handler), replace the fixed
`setTimeout(() => proceedToBidding(lobbyCode), 5000)` with a duration computed from
the actual toss length plus a fixed hold after the winner is found, e.g.:

```ts
const tossAnimationMs = tossHistory.length * 900 + 2500;
setTimeout(async () => { await proceedToBidding(lobbyCode); }, tossAnimationMs);
```

This keeps the delay proportional to the client-side animation (900ms/card, matching
the new interval) plus a ~2.5s hold on the winner banner, so the transition never cuts
the animation short or leaves an awkward dead pause.

## Out of scope

- No change to `TossPhase.tsx` being shown at all — it stays as a first-round-only
  screen (explicitly requested to keep).
- No change to round 2+ dealing/bidding flow beyond what's already shared via
  `dealRemainingCardsIfFirstTurn` and the broadcast helper.
- No change to bid validation, house-building validation, or scoring logic.

## Testing

No test suite is configured for this repo (per `CLAUDE.md`). Verification will be
manual: start a game with 4 seats (bots or multiple browser sessions), confirm:
- Floor cards are never visible (rank/suit) to any player until a bid is placed.
- The caller only has 4 usable/visible cards until their first play resolves, after
  which their hand grows to the full remaining set.
- The toss screen deals at a visibly slower pace, highlights the winning card, and the
  transition to bidding lines up with the animation finishing.
