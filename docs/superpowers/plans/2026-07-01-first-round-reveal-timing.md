# First-Round Reveal Timing Fixes + Toss Animation Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the floor and the caller's hidden cards from being revealed to clients before they should be, and make the existing jack-toss animation slower and more visually distinct.

**Architecture:** Two server-side privacy fixes in `packages/server/src/index.ts` (a single redaction helper applied to every `game-state` broadcast, plus extending the existing first-turn-reveal mechanism to cover the caller's seat) and a client-side + server-side timing/visual tweak to `TossPhase.tsx` and the `start-game` handler.

**Tech Stack:** TypeScript, Express + Socket.io (server), React 18 + Vite + `motion/react` (client). No test framework is configured in this repo — verification is `tsc` type-checking plus manual play-through via the dev servers.

## Global Constraints

- No test suite exists in this repo (per `CLAUDE.md`); do not introduce one. Verify with `npm run build --workspace=@seep/server` / `npm run build --workspace=@seep/client` (type-checking) and manual play-through.
- `packages/server/src/index.ts` redeclares its own `Card`, `GameState`, etc. locally rather than importing `@seep/shared` (known tech debt per `CLAUDE.md`) — all edits here stay within that local-type world; do not attempt to unify the type systems as part of this work.
- Keep `TossPhase.tsx` and the toss phase itself — it is an intentional feature, not being removed.

---

### Task 1: Redact the floor in every `game-state` broadcast

**Files:**
- Modify: `packages/server/src/index.ts` (add helper near line 207, replace 18 emit call sites)

**Interfaces:**
- Produces: `function redactGameStateForBroadcast(gameState: GameState): GameState` — pure function, returns a copy of `gameState` with `floor` cards flagged `faceDown: true` when `gamePhase` is `'toss'` or `'bidding'`, otherwise returns `gameState` unchanged. Used by Task 2's edits too (they don't add new call sites, just rely on this already existing).

- [ ] **Step 1: Locate the insertion point**

Read `packages/server/src/index.ts` around line 185-219 — this is where `dealRemainingCardsIfFirstTurn` and `getHouseContributedTeams` are defined. Confirm the surrounding code still matches:

```ts
function dealRemainingCardsIfFirstTurn(lobby: LobbyState, playerId: string, playerIndex: number, socket?: any) {
  const hasCompletedFirstTurn = lobby.gameState!.firstTurnCompleted.includes(playerId);
  if (!hasCompletedFirstTurn) {
    lobby.gameState!.firstTurnCompleted.push(playerId);
    if (playerIndex > 0) {
      const currentHand = lobby.hands!.get(playerId) || [];
      const remainingDeck = lobby.gameState!.deck || [];
      const drawn = remainingDeck.slice(0, 8);
      lobby.gameState!.deck = remainingDeck.slice(8);
      const updatedHand = [...currentHand, ...drawn];
      lobby.hands!.set(playerId, updatedHand);
      if (socket) {
        socket.emit('deal-cards', {
          lobbyCode: lobby.code,
          floor: lobby.gameState!.floor,
          hand: updatedHand,
          playerIndex,
          biddingPlayerIndex: 0,
        });
      }
    }
  }
}
function getHouseContributedTeams(house: House, players: { id: string; team: number; }[]): { team1: boolean; team2: boolean } {
```

If this doesn't match exactly, stop and re-read the file before continuing — later steps assume this is the current state.

- [ ] **Step 2: Add the redaction helper**

Insert a new function directly between `dealRemainingCardsIfFirstTurn` and `getHouseContributedTeams`:

```ts
function redactGameStateForBroadcast(gameState: GameState): GameState {
  if (gameState.gamePhase === 'toss' || gameState.gamePhase === 'bidding') {
    return { ...gameState, floor: gameState.floor.map(c => ({ ...c, faceDown: true })) };
  }
  return gameState;
}
```

- [ ] **Step 3: Replace every raw `game-state` broadcast with the redacted version**

Run this from the repo root to confirm the current call sites (expect 18 matches):

```bash
grep -c "emit('game-state'" packages/server/src/index.ts
```

Then apply these two global substitutions (every call site is one of these two exact forms — `lobby.gameState` or `currentLobby.gameState` — there are no other variants):

```bash
sed -i '' "s/emit('game-state', lobby.gameState)/emit('game-state', redactGameStateForBroadcast(lobby.gameState))/g" packages/server/src/index.ts
sed -i '' "s/emit('game-state', currentLobby.gameState)/emit('game-state', redactGameStateForBroadcast(currentLobby.gameState))/g" packages/server/src/index.ts
```

(On Linux, drop the `''` after `-i`.)

Verify every call site was updated and none were missed:

```bash
grep -n "emit('game-state'" packages/server/src/index.ts
```

Expected: every line contains `redactGameStateForBroadcast(...)` wrapping either `lobby.gameState` or `currentLobby.gameState`. There should be no bare `emit('game-state', lobby.gameState)` or `emit('game-state', currentLobby.gameState)` left.

- [ ] **Step 4: Type-check**

```bash
npm run build --workspace=@seep/server
```

Expected: compiles with no errors.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/index.ts
git commit -m "fix: redact floor cards in all game-state broadcasts during toss/bidding"
```

---

### Task 2: Defer the caller's full-hand reveal to after their first play

**Files:**
- Modify: `packages/server/src/index.ts`
  - `dealRemainingCardsIfFirstTurn` (~line 185)
  - `place-bid` handler (~line 1585-1615, right after the `logMove(... 'BID' ...)` call)
  - `checkAndTriggerBotTurn`'s bot-bid branch (~line 683-720)

**Interfaces:**
- Consumes: `redactGameStateForBroadcast` from Task 1 (already applied at the `game-state` emit inside the bot-bid branch by Task 1's sed pass).
- Modifies: `dealRemainingCardsIfFirstTurn(lobby, playerId, playerIndex, socket?)` — now also handles `playerIndex === 0`.

- [ ] **Step 1: Extend `dealRemainingCardsIfFirstTurn` to reveal the caller's existing full hand**

Find (this is the function as left by Task 1 — only the closing braces of the `if (playerIndex > 0)` block matter here):

```ts
      if (socket) {
        socket.emit('deal-cards', {
          lobbyCode: lobby.code,
          floor: lobby.gameState!.floor,
          hand: updatedHand,
          playerIndex,
          biddingPlayerIndex: 0,
        });
      }
    }
  }
}
```

Replace with:

```ts
      if (socket) {
        socket.emit('deal-cards', {
          lobbyCode: lobby.code,
          floor: lobby.gameState!.floor,
          hand: updatedHand,
          playerIndex,
          biddingPlayerIndex: 0,
        });
      }
    } else if (socket) {
      // The caller's 12-card hand was already dealt in full at deal time;
      // only their first 4 cards were shown until now. Reveal the rest of
      // their hand now that their first (house-building) play is done.
      const fullHand = lobby.hands!.get(playerId) || [];
      socket.emit('deal-cards', {
        lobbyCode: lobby.code,
        floor: lobby.gameState!.floor,
        hand: fullHand,
        playerIndex,
        biddingPlayerIndex: 0,
      });
    }
  }
}
```

- [ ] **Step 2: Remove the premature caller/dealer reveal in `place-bid`**

Find in the `place-bid` handler:

```ts
      // Dealer immediately sees the floor face-up when bid is announced
      const dealerPlayer = lobby.players[3]; // dealer is always index 3
      if (dealerPlayer && !dealerPlayer.id.startsWith('Bot_')) {
        io.to(dealerPlayer.socketId).emit('deal-cards', {
          lobbyCode,
          floor: lobby.gameState.floor, // real face-up cards for dealer
          hand: (lobby.hands.get(dealerPlayer.id) || []).slice(0, 4),
          playerIndex: 3,
          biddingPlayerIndex: 0,
        });
      }

      // Also update caller's hand view with the full 12 cards now dealt
      if (!biddingPlayer.id.startsWith('Bot_')) {
        io.to(socket.id).emit('deal-cards', {
          lobbyCode,
          floor: lobby.gameState.floor,
          hand: lobby.hands.get(playerId) || [],
          playerIndex: 0,
          biddingPlayerIndex: 0,
        });
      }

      await checkAndTriggerBotTurn(lobbyCode);
```

Replace with:

```ts
      await checkAndTriggerBotTurn(lobbyCode);
```

(The floor is now correctly revealed to everyone via the `game-state` broadcast a few lines above this block, once `gamePhase` flips to `'playing'` — see Task 1. The caller's remaining 8 cards will be revealed by Step 1 above, once they complete their first play.)

- [ ] **Step 3: Remove the equivalent premature dealer reveal in the bot-bid branch**

Find in `checkAndTriggerBotTurn`:

```ts
        if (bidCard) {
          const bidVal = rankToValue[bidCard.rank];
          currentLobby.gameState.bid = { playerId: bidder.id, value: bidVal, fulfilled: false };
          currentLobby.gameState.gamePhase = 'playing';

          // Human dealer immediately sees the floor face-up when bid is announced
          const dealerPlayer = currentLobby.players[3];
          if (dealerPlayer && !dealerPlayer.id.startsWith('Bot_')) {
            io.to(dealerPlayer.socketId).emit('deal-cards', {
              lobbyCode: currentLobby.code,
              floor: currentLobby.gameState.floor,
              hand: currentLobby.hands?.get(dealerPlayer.id) || [],
              playerIndex: 3,
              biddingPlayerIndex: 0,
            });
          }

          await saveLobby(currentLobby);

          io.to(currentLobby.code).emit('bid-placed', { bid: bidVal, playerId: bidder.id });
          io.to(currentLobby.code).emit('game-state', redactGameStateForBroadcast(currentLobby.gameState));
          
          await checkAndTriggerBotTurn(currentLobby.code);
        }
```

Replace with:

```ts
        if (bidCard) {
          const bidVal = rankToValue[bidCard.rank];
          currentLobby.gameState.bid = { playerId: bidder.id, value: bidVal, fulfilled: false };
          currentLobby.gameState.gamePhase = 'playing';

          await saveLobby(currentLobby);

          io.to(currentLobby.code).emit('bid-placed', { bid: bidVal, playerId: bidder.id });
          io.to(currentLobby.code).emit('game-state', redactGameStateForBroadcast(currentLobby.gameState));
          
          await checkAndTriggerBotTurn(currentLobby.code);
        }
```

- [ ] **Step 4: Type-check**

```bash
npm run build --workspace=@seep/server
```

Expected: compiles with no errors.

- [ ] **Step 5: Manual verification**

```bash
npm run dev
```

Open the app, create/join a 4-seat lobby (bots can fill the other 3 seats if supported by the lobby UI), start the game, and as the caller (seat 0, first to bid):
1. Confirm you only see 4 cards and a face-down floor during bidding.
2. Place a bid.
3. Confirm the floor flips face-up for you immediately (everyone should see it at this point).
4. Confirm your hand is *still* only 4 cards right after the bid — it should NOT jump to 12 yet.
5. Play your first card (the house-building move). Confirm your hand grows to the full remaining set only after this play resolves.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/index.ts
git commit -m "fix: reveal caller's full hand after their first play, not at bid time"
```

---

### Task 3: Toss animation polish

**Files:**
- Modify: `packages/client/src/components/TossPhase.tsx`
- Modify: `packages/server/src/index.ts` (`start-game` handler, ~line 1508-1511)

**Interfaces:**
- No new exports; purely internal timing/visual changes.

- [ ] **Step 1: Slow down the per-card deal interval**

In `packages/client/src/components/TossPhase.tsx`, find:

```ts
    }, 600);
```

(inside the `useEffect`'s `setInterval` call driving `animatedDeals`). Replace with:

```ts
    }, 900);
```

- [ ] **Step 2: Highlight the winning seat panel**

In the same file, find the players-seats block:

```tsx
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
          {playersBySeat.map(player => {
            const isMe = player.id === userId;
            return (
              <div key={player.id} className="p-4 rounded-xl border flex flex-col items-center"
                style={isMe
                  ? { background: 'rgba(212,175,55,0.05)', border: '1px solid rgba(212,175,55,0.25)' }
                  : { background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(212,175,55,0.08)' }}>
                <span className={`text-xs font-bold mb-3 ${isMe ? 'text-gold-gradient' : 'text-emerald-400'}`}>
                  Seat {player.seat} ({isMe ? 'You' : seatLabel(player.seat)})
                </span>
                <div className="flex gap-1 flex-wrap justify-center min-h-[120px] items-center">
                  {cardsByPlayer[player.id]?.map(c => (
                    <PlayingCard key={c.id} card={c} size="sm" />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
```

Replace with:

```tsx
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
          {playersBySeat.map(player => {
            const isMe = player.id === userId;
            const isWinner = player.id === currentWinner;
            return (
              <motion.div
                key={player.id}
                animate={isWinner ? { scale: [1, 1.04, 1] } : {}}
                transition={isWinner ? { duration: 1.2, repeat: Infinity, repeatType: 'reverse' } : undefined}
                className="p-4 rounded-xl border flex flex-col items-center"
                style={isWinner
                  ? { background: 'rgba(212,175,55,0.18)', border: '1px solid #d4af37', boxShadow: '0 0 20px rgba(212,175,55,0.5)' }
                  : isMe
                    ? { background: 'rgba(212,175,55,0.05)', border: '1px solid rgba(212,175,55,0.25)' }
                    : { background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(212,175,55,0.08)' }}>
                <span className={`text-xs font-bold mb-3 ${isWinner || isMe ? 'text-gold-gradient' : 'text-emerald-400'}`}>
                  Seat {player.seat} ({isMe ? 'You' : seatLabel(player.seat)})
                </span>
                <div className="flex gap-1 flex-wrap justify-center min-h-[120px] items-center">
                  {cardsByPlayer[player.id]?.map(c => {
                    const isWinningCard = isWinner && c.rank === 'J';
                    return (
                      <motion.div
                        key={c.id}
                        animate={isWinningCard ? { scale: [1, 1.15, 1] } : {}}
                        transition={isWinningCard ? { duration: 1, repeat: Infinity, repeatType: 'reverse' } : undefined}
                        style={isWinningCard ? { filter: 'drop-shadow(0 0 12px rgba(212,175,55,0.9))' } : undefined}
                      >
                        <PlayingCard card={c} size="sm" />
                      </motion.div>
                    );
                  })}
                </div>
              </motion.div>
            );
          })}
        </div>
```

- [ ] **Step 3: Sync the server's advance-to-bidding timer with the animation**

In `packages/server/src/index.ts`, find in the `start-game` handler:

```ts
        // Automatically proceed to bidding after 5 seconds to show toss deals in UI
        setTimeout(async () => {
          await proceedToBidding(lobbyCode);
        }, 5000);
```

Replace with:

```ts
        // Proceed to bidding once the toss animation has had time to play out
        // client-side (900ms per dealt card, matching TossPhase.tsx, plus a
        // hold on the winner banner).
        const tossAnimationMs = tossHistory.length * 900 + 2500;
        setTimeout(async () => {
          await proceedToBidding(lobbyCode);
        }, tossAnimationMs);
```

This relies on the `tossHistory` array already declared earlier in the same handler (`const tossHistory: { playerId: string; card: Card }[] = [];`, populated during the jack-toss loop above).

- [ ] **Step 4: Type-check both packages**

```bash
npm run build --workspace=@seep/server
npm run build --workspace=@seep/client
```

Expected: both compile with no errors.

- [ ] **Step 5: Manual verification**

```bash
npm run dev
```

Start a new game (round 1) and watch the toss screen:
1. Cards deal out noticeably slower than before.
2. The winning player's seat panel and their winning Jack pulse/glow.
3. The transition to the bidding screen happens shortly after the winner is shown (no abrupt cutoff, no long dead pause).

- [ ] **Step 6: Commit**

```bash
git add packages/client/src/components/TossPhase.tsx packages/server/src/index.ts
git commit -m "feat: slow down toss animation and highlight the winning card/seat"
```
