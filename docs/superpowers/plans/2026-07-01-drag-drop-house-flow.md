# Drag-and-Drop House Build/Capture Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the existing drag-and-drop play interaction explicitly ask "eat or build a house?" only when genuinely ambiguous, relax the house-value-in-hand rule for same-team house contributions, and give every house a haphazard, always-visible real-card stack instead of a face-down count.

**Architecture:** All client changes live in `packages/client/src/components/GameScreen.tsx` (the existing convention in this file: pure decision-logic helpers are colocated as module-level functions alongside the component, e.g. `getCardValue`, `groupHouseCards`, `getHouseTeams` already work this way — we follow that pattern rather than introducing a new file). The one server change is a targeted restructure of the existing `BUILD_HOUSE` validation block in `packages/server/src/index.ts`.

**Tech Stack:** React 19 + TypeScript (client), Express + Socket.io + TypeScript (server). No test framework is configured in this repo (confirmed in `CLAUDE.md`: "No test suite is currently configured"), so verification in this plan uses `npx tsc --noEmit` (type safety) plus explicit manual QA checklists per task instead of automated test steps.

## Global Constraints

- Follow the existing codebase convention: pure logic helpers stay as module-level functions inside `GameScreen.tsx`, not extracted to a new file.
- Every `BUILD_HOUSE` validation path other than "non-distorting contribution to your own team's house" must keep its current strictness exactly as-is (new house builds, distortions, and opponent-house contributions are unchanged).
- The admin-only "🔍 View stack order" feature (`houseDetailModal`) is unaffected by this plan — it continues to show build order, gated by `role === 'admin' && adminShowHouseCards`.
- No new npm dependencies.
- Verify every client task with `npx tsc --noEmit -p .` run from `packages/client`, and every server task with the same run from `packages/server`. Pre-existing unrelated errors (e.g. `Cannot find module 'pg'`) are expected and must be ignored — only check that your change introduces zero *new* errors (compare against a baseline run before your edit).

---

### Task 1: Client — eligibility and jitter helper functions

**Files:**
- Modify: `packages/client/src/components/GameScreen.tsx` (add module-level functions near the existing `getCardValue`/`groupHouseCards`/`getHouseTeams` helpers, i.e. after line 110)

**Interfaces:**
- Consumes: `Card`, `GamePlayer`, `House` types (already imported at line 4); `getCardValue(card: Card): number` (existing, line 23-29).
- Produces (used by Task 2 and Task 3):
  - `getRemainingHand(hand: Card[], playedCard: Card): Card[]`
  - `computeFloorDropEligibility(playedCard: Card, targetCard: Card, hand: Card[]): { canEat: boolean; canBuild: boolean; sum: number }`
  - `isOwnTeamHouse(house: House, players: GamePlayer[], userId: string): boolean`
  - `canContributeToHouse(playedCard: Card, targetHouse: House, floorCards: Card[], players: GamePlayer[], userId: string, hand: Card[]): boolean`
  - `seededJitter(id: string): { rotate: number; x: number; y: number }`

- [ ] **Step 1: Add the helper functions**

Insert this block into `packages/client/src/components/GameScreen.tsx` immediately after the closing brace of `getHouseTeams` (currently ends at line 110, right before `export default function GameScreen({`):

```ts
function getRemainingHand(hand: Card[], playedCard: Card): Card[] {
  return hand.filter(c => c.id !== playedCard.id);
}

function computeFloorDropEligibility(
  playedCard: Card,
  targetCard: Card,
  hand: Card[]
): { canEat: boolean; canBuild: boolean; sum: number } {
  const playedVal = getCardValue(playedCard);
  const targetVal = getCardValue(targetCard);
  const sum = playedVal + targetVal;
  const canEat = playedVal === targetVal;
  const remainingHand = getRemainingHand(hand, playedCard);
  const canBuild = sum >= 9 && sum <= 13 && remainingHand.some(c => getCardValue(c) === sum);
  return { canEat, canBuild, sum };
}

function isOwnTeamHouse(house: House, players: GamePlayer[], userId: string): boolean {
  const creator = players.find(p => p.id === house.createdBy);
  const self = players.find(p => p.id === userId);
  if (!creator || !self) return false;
  return creator.team === self.team;
}

function canContributeToHouse(
  playedCard: Card,
  targetHouse: House,
  floorCards: Card[],
  players: GamePlayer[],
  userId: string,
  hand: Card[]
): boolean {
  // Mirrors the server's own-team relaxation: a teammate can always add
  // matching cards to their own team's house without holding the closing value.
  if (isOwnTeamHouse(targetHouse, players, userId)) return true;

  const playedVal = getCardValue(playedCard);
  const cleanFloorCards = floorCards.filter(fc => !targetHouse.cards.some(hc => hc.id === fc.id));
  const floorSum = cleanFloorCards.reduce((sum, c) => sum + getCardValue(c), 0);
  const isStacking = playedVal + floorSum === targetHouse.value;
  const resultingValue = isStacking ? targetHouse.value : playedVal + targetHouse.value + floorSum;

  if (resultingValue < 9 || resultingValue > 13) return false;
  const remainingHand = getRemainingHand(hand, playedCard);
  return remainingHand.some(c => getCardValue(c) === resultingValue);
}

function seededJitter(id: string): { rotate: number; x: number; y: number } {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) | 0;
  }
  const rand = (seed: number) => {
    const x = Math.sin(seed) * 10000;
    return x - Math.floor(x);
  };
  const rotate = (rand(hash) - 0.5) * 16;
  const x = (rand(hash + 1) - 0.5) * 14;
  const y = (rand(hash + 2) - 0.5) * 10;
  return { rotate, x, y };
}
```

- [ ] **Step 2: Verify it compiles**

Run from `packages/client`:
```bash
npx tsc --noEmit -p .
```
Expected: same error count/content as a baseline run taken before this edit (run `npx tsc --noEmit -p . 2>&1 | wc -l` before and after — the number must not increase). These functions are not called yet, so there should be zero new errors and no "unused" errors (TypeScript doesn't flag unused top-level functions by default).

- [ ] **Step 3: Commit**

```bash
git add packages/client/src/components/GameScreen.tsx
git commit -m "feat: add house eligibility and stack-jitter helpers"
```

---

### Task 2: Client — unified action prompt, ambiguity-only asking, and team-aware contribute gating

**Files:**
- Modify: `packages/client/src/components/GameScreen.tsx`

**Interfaces:**
- Consumes: `computeFloorDropEligibility`, `canContributeToHouse` (from Task 1); existing `performHouseAction`, `handleDropOnCard`, `handleDropOnHouse`, `handleHouseClick`, `executeHouseAction`, `houseActionPrompt` state (all at their current line numbers, subject to shift after Task 1's insertion — locate by content, not line number).
- Produces (used by later UI code in this same file): a new `actionPrompt` state of shape `{ title: string; eatLabel: string; buildLabel: string; canEat: boolean; canBuild: boolean; onEat: () => void; onBuild: () => void } | null`, replacing `houseActionPrompt` everywhere.

- [ ] **Step 1: Replace the `houseActionPrompt` state declaration**

Find:
```ts
  const [houseActionPrompt, setHouseActionPrompt] = useState<{ card: Card; house: House; floorCards: Card[] } | null>(null);
```

Replace with:
```ts
  const [actionPrompt, setActionPrompt] = useState<{
    title: string;
    eatLabel: string;
    buildLabel: string;
    canEat: boolean;
    canBuild: boolean;
    onEat: () => void;
    onBuild: () => void;
  } | null>(null);
```

- [ ] **Step 2: Update `performHouseAction` to clear the new state**

Find (inside `performHouseAction`, near its end):
```ts
    setHand(prev => prev.filter(c => c.id !== playedCard.id));
    setSelectedCard(null);
    setCapturedCards([]);
    setHouseActionPrompt(null);
  };

  const executeHouseAction = (playedCard: Card, targetHouse: House, floorCards: Card[]) => {
    setHouseActionPrompt({ card: playedCard, house: targetHouse, floorCards });
  };
```

Replace with:
```ts
    setHand(prev => prev.filter(c => c.id !== playedCard.id));
    setSelectedCard(null);
    setCapturedCards([]);
    setActionPrompt(null);
  };

  const openHouseActionPrompt = (playedCard: Card, targetHouse: House, floorCards: Card[]) => {
    const contributeEligible = canContributeToHouse(
      playedCard,
      targetHouse,
      floorCards,
      gameState?.players || [],
      userId,
      hand
    );
    setActionPrompt({
      title: `House ${targetHouse.value}`,
      eatLabel: 'Eat (Capture) House',
      buildLabel: 'Contribute / Distort',
      canEat: true,
      canBuild: contributeEligible,
      onEat: () => performHouseAction('CAPTURE', playedCard, targetHouse, floorCards),
      onBuild: () => performHouseAction('CONTRIBUTE', playedCard, targetHouse, floorCards),
    });
  };
```

- [ ] **Step 3: Update the two call sites that used `executeHouseAction`**

Find:
```ts
  const handleDropOnHouse = (e: React.DragEvent, targetHouse: House) => {
    e.preventDefault();
    e.stopPropagation();
    const cardId = e.dataTransfer.getData('cardId');
    const playedCard = hand.find(c => c.id === cardId);
    if (!playedCard || !lobbyCode) return;

    executeHouseAction(playedCard, targetHouse, capturedCards);
  };
```

Replace with:
```ts
  const handleDropOnHouse = (e: React.DragEvent, targetHouse: House) => {
    e.preventDefault();
    e.stopPropagation();
    const cardId = e.dataTransfer.getData('cardId');
    const playedCard = hand.find(c => c.id === cardId);
    if (!playedCard || !lobbyCode) return;

    openHouseActionPrompt(playedCard, targetHouse, capturedCards);
  };
```

Find:
```ts
  const handleHouseClick = (house: House) => {
    if (!selectedCard || !lobbyCode) return;
    executeHouseAction(selectedCard, house, capturedCards);
  };
```

Replace with:
```ts
  const handleHouseClick = (house: House) => {
    if (!selectedCard || !lobbyCode) return;
    openHouseActionPrompt(selectedCard, house, capturedCards);
  };
```

- [ ] **Step 4: Rewrite `handleDropOnCard` to ask only when ambiguous**

Find:
```ts
  const handleDropOnCard = (e: React.DragEvent, targetCard: Card) => {
    e.preventDefault();
    e.stopPropagation();
    const cardId = e.dataTransfer.getData('cardId');
    const playedCard = hand.find(c => c.id === cardId);
    if (!playedCard || !lobbyCode) return;

    const playedVal = getCardValue(playedCard);
    const targetVal = getCardValue(targetCard);
    const sum = playedVal + targetVal;

    if (playedVal === targetVal) {
      socket.emit('game-action', { lobbyCode, action: 'CAPTURE', payload: { card: playedCard, targetCards: [targetCard] } });
      setHand(prev => prev.filter(c => c.id !== playedCard.id));
    } else if (sum >= 9 && sum <= 13) {
      socket.emit('game-action', { lobbyCode, action: 'BUILD_HOUSE', payload: { card: playedCard, targetCards: [targetCard], houseValue: sum } });
      setHand(prev => prev.filter(c => c.id !== playedCard.id));
    } else {
      socket.emit('game-action', { lobbyCode, action: 'THROW', payload: { card: playedCard, targetCards: [] } });
      setHand(prev => prev.filter(c => c.id !== playedCard.id));
    }
  };
```

Replace with:
```ts
  const handleDropOnCard = (e: React.DragEvent, targetCard: Card) => {
    e.preventDefault();
    e.stopPropagation();
    const cardId = e.dataTransfer.getData('cardId');
    const playedCard = hand.find(c => c.id === cardId);
    if (!playedCard || !lobbyCode) return;

    const { canEat, canBuild, sum } = computeFloorDropEligibility(playedCard, targetCard, hand);

    const doEat = () => {
      socket.emit('game-action', { lobbyCode, action: 'CAPTURE', payload: { card: playedCard, targetCards: [targetCard] } });
      setHand(prev => prev.filter(c => c.id !== playedCard.id));
      setActionPrompt(null);
    };
    const doBuild = () => {
      socket.emit('game-action', { lobbyCode, action: 'BUILD_HOUSE', payload: { card: playedCard, targetCards: [targetCard], houseValue: sum } });
      setHand(prev => prev.filter(c => c.id !== playedCard.id));
      setActionPrompt(null);
    };

    if (canEat && canBuild) {
      setActionPrompt({
        title: `${playedCard.rank}${suitSymbol(playedCard.suit)} on ${targetCard.rank}${suitSymbol(targetCard.suit)}`,
        eatLabel: 'Eat (Capture)',
        buildLabel: `Build House of ${sum}`,
        canEat: true,
        canBuild: true,
        onEat: doEat,
        onBuild: doBuild,
      });
    } else if (canEat) {
      doEat();
    } else if (canBuild) {
      doBuild();
    } else {
      socket.emit('game-action', { lobbyCode, action: 'THROW', payload: { card: playedCard, targetCards: [] } });
      setHand(prev => prev.filter(c => c.id !== playedCard.id));
    }
  };
```

- [ ] **Step 5: Rewrite the prompt modal JSX to be generic**

Find (the "EAT vs CONTRIBUTE CHOOSE PROMPT" block):
```tsx
      {/* ─── EAT vs CONTRIBUTE CHOOSE PROMPT ─── */}
      <AnimatePresence>
        {houseActionPrompt && (
          <motion.div
            key="house-action-prompt"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-md"
          >
            <motion.div
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, y: 20 }}
              className="glass-panel rounded-2xl p-6 w-full max-w-sm text-center flex flex-col items-center border border-gold/30"
              style={{ background: 'rgba(9,22,12,0.98)' }}
            >
              <h3 className="text-lg font-display font-bold text-gold-gradient mb-2">
                House Action Decision
              </h3>
              <p className="text-xs text-gray-300 mb-6 font-display">
                Would you like to Eat (Capture) House {houseActionPrompt.house.value} or Contribute to it?
              </p>

              <div className="flex flex-col gap-3 w-full">
                <button
                  onClick={() => performHouseAction('CAPTURE', houseActionPrompt.card, houseActionPrompt.house, houseActionPrompt.floorCards)}
                  className="w-full py-3 rounded-xl text-xs font-bold font-display uppercase tracking-widest btn-gold shadow-lg cursor-pointer"
                >
                  🍽️ Eat (Capture) House
                </button>

                <button
                  onClick={() => performHouseAction('CONTRIBUTE', houseActionPrompt.card, houseActionPrompt.house, houseActionPrompt.floorCards)}
                  className="w-full py-3 rounded-xl text-xs font-bold font-display uppercase tracking-widest text-emerald-100 bg-emerald-950/50 border border-emerald-800/40 hover:border-emerald-600 transition-all cursor-pointer"
                >
                  ➕ Contribute / Distort
                </button>

                <button
                  onClick={() => setHouseActionPrompt(null)}
                  className="w-full py-2.5 rounded-xl text-xs text-gray-400 hover:text-gray-200 transition-all bg-transparent border-0 mt-2 cursor-pointer"
                >
                  Cancel
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
```

Replace with:
```tsx
      {/* ─── EAT vs BUILD/CONTRIBUTE CHOOSE PROMPT ─── */}
      <AnimatePresence>
        {actionPrompt && (
          <motion.div
            key="action-prompt"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-md"
          >
            <motion.div
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, y: 20 }}
              className="glass-panel rounded-2xl p-6 w-full max-w-sm text-center flex flex-col items-center border border-gold/30"
              style={{ background: 'rgba(9,22,12,0.98)' }}
            >
              <h3 className="text-lg font-display font-bold text-gold-gradient mb-2">
                {actionPrompt.title}
              </h3>
              <p className="text-xs text-gray-300 mb-6 font-display">
                What would you like to do?
              </p>

              <div className="flex flex-col gap-3 w-full">
                <button
                  onClick={actionPrompt.canEat ? actionPrompt.onEat : undefined}
                  disabled={!actionPrompt.canEat}
                  className={`w-full py-3 rounded-xl text-xs font-bold font-display uppercase tracking-widest shadow-lg transition-all ${
                    actionPrompt.canEat ? 'btn-gold cursor-pointer' : 'bg-black/30 text-gray-500 border border-gray-800 cursor-not-allowed'
                  }`}
                >
                  🍽️ {actionPrompt.eatLabel}
                </button>

                <button
                  onClick={actionPrompt.canBuild ? actionPrompt.onBuild : undefined}
                  disabled={!actionPrompt.canBuild}
                  className={`w-full py-3 rounded-xl text-xs font-bold font-display uppercase tracking-widest transition-all ${
                    actionPrompt.canBuild
                      ? 'text-emerald-100 bg-emerald-950/50 border border-emerald-800/40 hover:border-emerald-600 cursor-pointer'
                      : 'bg-black/30 text-gray-500 border border-gray-800 cursor-not-allowed'
                  }`}
                >
                  ➕ {actionPrompt.buildLabel}
                </button>

                <button
                  onClick={() => setActionPrompt(null)}
                  className="w-full py-2.5 rounded-xl text-xs text-gray-400 hover:text-gray-200 transition-all bg-transparent border-0 mt-2 cursor-pointer"
                >
                  Cancel
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
```

- [ ] **Step 6: Verify it compiles**

Run from `packages/client`:
```bash
npx tsc --noEmit -p .
```
Expected: no new errors versus the Task 1 baseline. In particular, confirm there are no leftover references to `houseActionPrompt`, `setHouseActionPrompt`, or `executeHouseAction` (search: `grep -n "houseActionPrompt\|executeHouseAction" packages/client/src/components/GameScreen.tsx` should return nothing).

- [ ] **Step 7: Manual QA checklist** (run `npm run dev`, join a 2-player-per-team test lobby)

1. Drag a hand card onto a floor card of the *same rank* where no house-sum is also possible (e.g., hand 2♠ onto floor 2♦, sum=4, not 9-13) → card is captured immediately, no popup.
2. Drag a hand card onto a floor card where only a house-sum is possible and your hand holds the needed value (e.g., hand 5 onto floor 4 = 9, and you hold another 9-value card) → house is built immediately, no popup.
3. Drag a hand card onto a floor card where sum is 9-13 but your hand does NOT hold the resulting value → falls back to THROW (dragged card becomes a new loose card), no popup.
4. Drag a hand card onto a floor card where both same-rank capture AND a valid house-sum (with matching hand value) are possible → popup appears with both options enabled; picking either produces the correct server action (verify via the "move-executed" toast).
5. Drag a hand card onto an existing house belonging to your OWN team, without holding the house's value in hand → popup appears with "Contribute / Distort" enabled (not grayed out).
6. Drag a hand card onto an existing house belonging to the OPPONENT team, without holding the resulting value → popup appears with "Contribute / Distort" disabled/grayed out; "Eat" remains clickable.

- [ ] **Step 8: Commit**

```bash
git add packages/client/src/components/GameScreen.tsx
git commit -m "feat: ask eat-vs-build only when ambiguous, gate contribute by team/hand rules"
```

---

### Task 3: Client — always-visible haphazard house stack

**Files:**
- Modify: `packages/client/src/components/GameScreen.tsx`

**Interfaces:**
- Consumes: `seededJitter` (from Task 1), existing `House`/`Card` types, existing `canViewStack` computation (unchanged).
- Produces: no new exports; purely visual change to the "Active Houses" rendering block.

- [ ] **Step 1: Remove the now-unused `groupHouseCards` function and its call site**

Find the function definition (currently lines 31-79, right after `getCardValue`):
```ts
function groupHouseCards(cards: Card[], targetValue: number): Card[][] {
  const result: Card[][] = [];
  const remaining = [...cards];

  const findAndRemoveSubset = (): boolean => {
    let foundPath: Card[] | null = null;
    const search = (startIndex: number, currentSum: number, path: Card[]): boolean => {
      if (currentSum === targetValue) {
        foundPath = [...path];
        return true;
      }
      if (currentSum > targetValue) {
        return false;
      }
      for (let i = startIndex; i < remaining.length; i++) {
        const card = remaining[i];
        const val = getCardValue(card);
        path.push(card);
        if (search(i + 1, currentSum + val, path)) {
          return true;
        }
        path.pop();
      }
      return false;
    };

    if (search(0, 0, [])) {
      if (foundPath) {
        (foundPath as Card[]).forEach(c => {
          const idx = remaining.findIndex(rc => rc.id === c.id);
          if (idx !== -1) remaining.splice(idx, 1);
        });
        result.push(foundPath);
        return true;
      }
    }
    return false;
  };

  while (remaining.length > 0) {
    const found = findAndRemoveSubset();
    if (!found) {
      remaining.forEach(c => result.push([c]));
      break;
    }
  }

  return result;
}
```

Delete this entire function.

Then find, inside the houses `.map()` in the "Active Houses" block:
```ts
                  const groups = groupHouseCards(house.cards, house.value);
                  const houseTeams = getHouseTeams(house, gameState.players);
```

Replace with:
```ts
                  const houseTeams = getHouseTeams(house, gameState.players);
```

- [ ] **Step 2: Rename the admin toggle label for accuracy**

Find:
```tsx
                <div className="flex items-center justify-between mb-3 text-xs text-gray-300">
                  <span>Reveal House Cards</span>
```

Replace with:
```tsx
                <div className="flex items-center justify-between mb-3 text-xs text-gray-300">
                  <span>Reveal Stack Order</span>
```

- [ ] **Step 3: Replace the conditional stack rendering with an always-visible haphazard pile**

Find:
```tsx
                      {/* Stack of Cards grouped together */}
                      {role === 'admin' && adminShowHouseCards ? (
                        <div className="flex gap-2 items-start justify-center mt-2.5 min-h-[96px] px-2">
                          {groups.map((group, gIdx) => (
                            <div key={gIdx} className="flex flex-col items-center">
                              {group.map((c, cIdx) => (
                                <div
                                  key={c.id}
                                  style={{
                                    marginTop: cIdx > 0 ? '-28px' : '0px',
                                    zIndex: cIdx,
                                    position: 'relative',
                                  }}
                                >
                                  <PlayingCard card={c} size="sm" />
                                </div>
                              ))}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="flex flex-col items-center justify-center mt-2.5 min-h-[96px] px-4 py-2 border border-emerald-800/10 rounded-lg bg-black/40">
                          <span className="text-[20px] mb-1">🃏</span>
                          <span className="text-[10px] text-gray-400 tracking-wide font-display">
                            {house.cards.length} Cards
                          </span>
                        </div>
                      )}
```

Replace with:
```tsx
                      {/* Haphazard real-card stack — always visible to every player */}
                      <div className="relative flex items-center justify-center mt-2.5 min-h-[96px]" style={{ minWidth: '80px' }}>
                        {house.cards.map((c, cIdx) => {
                          const { rotate, x, y } = seededJitter(c.id);
                          return (
                            <div
                              key={c.id}
                              style={{
                                position: 'absolute',
                                transform: `translate(${x}px, ${y - cIdx * 2}px) rotate(${rotate}deg)`,
                                zIndex: cIdx,
                              }}
                            >
                              <PlayingCard card={c} size="sm" />
                            </div>
                          );
                        })}
                      </div>
```

- [ ] **Step 4: Verify it compiles**

Run from `packages/client`:
```bash
npx tsc --noEmit -p .
```
Expected: no new errors versus the Task 1 baseline. Confirm `grep -n "groupHouseCards" packages/client/src/components/GameScreen.tsx` returns nothing.

- [ ] **Step 5: Manual QA checklist** (run `npm run dev`)

1. As a non-admin player, build/view a house — confirm you can see the actual cards (not a face-down "🃏 N Cards" placeholder), stacked with visible overlap and slight rotation/offset per card (not a perfectly neat pile).
2. Reload the page (or trigger a re-render, e.g. by having another player make a move) — confirm the same house's cards keep the same jitter (they don't visually "reshuffle" on every render).
3. As an admin, the "Reveal Stack Order" toggle still gates only the 🔍 button and its build-order modal — turning it off hides the 🔍 button but the haphazard stack itself remains visible either way.

- [ ] **Step 6: Commit**

```bash
git add packages/client/src/components/GameScreen.tsx
git commit -m "feat: show haphazard real-card house stacks to all players"
```

---

### Task 4: Server — relax the house-value-in-hand rule for same-team contributions

**Files:**
- Modify: `packages/server/src/index.ts` (the `BUILD_HOUSE` validation block inside the `game-action` socket handler)

**Interfaces:**
- Consumes: existing `hand: Card[]`, `card: Card`, `houseValue: number | undefined`, `targetCards: Card[]`, `lobby.gameState.houses: House[]`, `lobby.players: { id: string; team: number }[]`, `getCardNumericValue`, `canPartitionIntoValue`, `getHouseContributedTeams` — all already defined earlier in this file, unchanged.
- Produces: no new exports; the runtime behavior of `BUILD_HOUSE` validation changes only for the "non-distorting contribution to your own team's house" case.

- [ ] **Step 1: Take a baseline typecheck count**

Run from `packages/server`:
```bash
npx tsc --noEmit -p . 2>&1 | tee /tmp/server-tsc-baseline.txt | wc -l
```
Note the number — you'll compare against it after the edit.

- [ ] **Step 2: Restructure the `BUILD_HOUSE` validation block**

Find (this is the full existing block, starting at `if (actionType === 'BUILD_HOUSE') {` through its matching closing brace, immediately before `if (actionType === 'CAPTURE') {`):

```ts
      if (actionType === 'BUILD_HOUSE') {
        if (!houseValue || houseValue < 9 || houseValue > 13) {
          isValidBuild = false;
          validationFailureReason = `Invalid house value: ${houseValue}`;
        } else {
          const remainingHand = hand.filter(c => c.id !== card.id);
          if (!remainingHand.some(c => getCardNumericValue(c) === houseValue)) {
            isValidBuild = false;
            validationFailureReason = `Player does not hold matching card value ${houseValue} in hand after play`;
          } else {
            targetedHouseIndex = lobby.gameState.houses.findIndex(h => 
              h.cards.some(hc => (targetCards || []).some(tc => tc.id === hc.id))
            );

            if (targetedHouseIndex === -1) {
              if (lobby.gameState.houses.length >= 2) {
                isValidBuild = false;
                validationFailureReason = 'Cannot build new house: floor already has 2 active houses';
              } else {
                if (!canPartitionIntoValue([card, ...(targetCards || [])], houseValue)) {
                  isValidBuild = false;
                  validationFailureReason = `Card stack cannot be grouped into layers summing to ${houseValue}`;
                }
              }
            } else {
              const targetedHouseObj = lobby.gameState.houses[targetedHouseIndex]!;
              isDistortion = targetedHouseObj.value !== houseValue;

              if (isDistortion) {
                if (targetedHouseObj.isPukta || targetedHouseObj.value === 13) {
                  isValidBuild = false;
                  validationFailureReason = `Cannot distort cemented (Pukta) house or a house of value 13`;
                } else if (houseValue <= targetedHouseObj.value) {
                  isValidBuild = false;
                  validationFailureReason = `Can only distort to a higher value (target: ${houseValue}, current: ${targetedHouseObj.value})`;
                } else {
                  const creatorIndex = lobby.players.findIndex(p => p.id === targetedHouseObj.createdBy);
                  const playerIndex = lobby.players.findIndex(p => p.id === playerId);
                  const creatorTeam = creatorIndex !== -1 ? lobby.players[creatorIndex]?.team : undefined;
                  const playerTeam = playerIndex !== -1 ? lobby.players[playerIndex]?.team : undefined;

                  if (creatorTeam === playerTeam) {
                    isValidBuild = false;
                    validationFailureReason = 'You cannot distort a house built by your own team';
                  } else {
                    const extraTargetCards = (targetCards || []).filter(tc => !targetedHouseObj.cards.some(hc => hc.id === tc.id));
                    if (!canPartitionIntoValue([...targetedHouseObj.cards, card, ...extraTargetCards], houseValue)) {
                      isValidBuild = false;
                      validationFailureReason = `Final distorted cards do not sum into layers of ${houseValue}`;
                    }
                  }
                }
              } else {
                // Contribution
                const creatorIndex = lobby.players.findIndex(p => p.id === targetedHouseObj.createdBy);
                const playerIndex = lobby.players.findIndex(p => p.id === playerId);
                const creatorTeam = creatorIndex !== -1 ? lobby.players[creatorIndex]?.team : undefined;
                const playerTeam = playerIndex !== -1 ? lobby.players[playerIndex]?.team : undefined;

                const teams = getHouseContributedTeams(targetedHouseObj, lobby.players);
                const bothTeamsContributed = teams.team1 && teams.team2;

                if (!bothTeamsContributed && creatorTeam && creatorTeam !== playerTeam) {
                  isValidBuild = false;
                  validationFailureReason = 'Cannot contribute to opponent\'s house without distorting it';
                } else {
                  const extraTargetCards = (targetCards || []).filter(tc => !targetedHouseObj.cards.some(hc => hc.id === tc.id));
                  if (!canPartitionIntoValue([card, ...extraTargetCards], houseValue)) {
                    isValidBuild = false;
                    validationFailureReason = `New cards cannot be grouped into layers of value ${houseValue}`;
                  }
                }
              }
            }
          }
        }

        if (!isValidBuild) {
          console.warn(`[VALIDATION FAILED] BUILD_HOUSE by ${playerId} for value ${houseValue} failed: ${validationFailureReason}. Falling back to THROW.`);
          actionType = 'THROW';
          targetCards = [];
        }
      }
```

Replace with:

```ts
      if (actionType === 'BUILD_HOUSE') {
        if (!houseValue || houseValue < 9 || houseValue > 13) {
          isValidBuild = false;
          validationFailureReason = `Invalid house value: ${houseValue}`;
        } else {
          targetedHouseIndex = lobby.gameState.houses.findIndex(h => 
            h.cards.some(hc => (targetCards || []).some(tc => tc.id === hc.id))
          );

          const remainingHand = hand.filter(c => c.id !== card.id);
          const holdsHouseValue = remainingHand.some(c => getCardNumericValue(c) === houseValue);

          // A teammate contributing (not distorting) to their own team's existing
          // house doesn't need to personally hold the closing value — the team
          // already has a stake in that house. Every other path (new builds,
          // distortions, opponent-house contributions) still requires it.
          let requiresHoldingValue = true;
          if (targetedHouseIndex !== -1) {
            const targetedHouseObj = lobby.gameState.houses[targetedHouseIndex]!;
            const willBeDistortion = targetedHouseObj.value !== houseValue;
            if (!willBeDistortion) {
              const creatorIndex = lobby.players.findIndex(p => p.id === targetedHouseObj.createdBy);
              const playerIndex = lobby.players.findIndex(p => p.id === playerId);
              const creatorTeam = creatorIndex !== -1 ? lobby.players[creatorIndex]?.team : undefined;
              const playerTeam = playerIndex !== -1 ? lobby.players[playerIndex]?.team : undefined;
              if (creatorTeam !== undefined && creatorTeam === playerTeam) {
                requiresHoldingValue = false;
              }
            }
          }

          if (requiresHoldingValue && !holdsHouseValue) {
            isValidBuild = false;
            validationFailureReason = `Player does not hold matching card value ${houseValue} in hand after play`;
          } else {
            if (targetedHouseIndex === -1) {
              if (lobby.gameState.houses.length >= 2) {
                isValidBuild = false;
                validationFailureReason = 'Cannot build new house: floor already has 2 active houses';
              } else {
                if (!canPartitionIntoValue([card, ...(targetCards || [])], houseValue)) {
                  isValidBuild = false;
                  validationFailureReason = `Card stack cannot be grouped into layers summing to ${houseValue}`;
                }
              }
            } else {
              const targetedHouseObj = lobby.gameState.houses[targetedHouseIndex]!;
              isDistortion = targetedHouseObj.value !== houseValue;

              if (isDistortion) {
                if (targetedHouseObj.isPukta || targetedHouseObj.value === 13) {
                  isValidBuild = false;
                  validationFailureReason = `Cannot distort cemented (Pukta) house or a house of value 13`;
                } else if (houseValue <= targetedHouseObj.value) {
                  isValidBuild = false;
                  validationFailureReason = `Can only distort to a higher value (target: ${houseValue}, current: ${targetedHouseObj.value})`;
                } else {
                  const creatorIndex = lobby.players.findIndex(p => p.id === targetedHouseObj.createdBy);
                  const playerIndex = lobby.players.findIndex(p => p.id === playerId);
                  const creatorTeam = creatorIndex !== -1 ? lobby.players[creatorIndex]?.team : undefined;
                  const playerTeam = playerIndex !== -1 ? lobby.players[playerIndex]?.team : undefined;

                  if (creatorTeam === playerTeam) {
                    isValidBuild = false;
                    validationFailureReason = 'You cannot distort a house built by your own team';
                  } else {
                    const extraTargetCards = (targetCards || []).filter(tc => !targetedHouseObj.cards.some(hc => hc.id === tc.id));
                    if (!canPartitionIntoValue([...targetedHouseObj.cards, card, ...extraTargetCards], houseValue)) {
                      isValidBuild = false;
                      validationFailureReason = `Final distorted cards do not sum into layers of ${houseValue}`;
                    }
                  }
                }
              } else {
                // Contribution
                const creatorIndex = lobby.players.findIndex(p => p.id === targetedHouseObj.createdBy);
                const playerIndex = lobby.players.findIndex(p => p.id === playerId);
                const creatorTeam = creatorIndex !== -1 ? lobby.players[creatorIndex]?.team : undefined;
                const playerTeam = playerIndex !== -1 ? lobby.players[playerIndex]?.team : undefined;

                const teams = getHouseContributedTeams(targetedHouseObj, lobby.players);
                const bothTeamsContributed = teams.team1 && teams.team2;

                if (!bothTeamsContributed && creatorTeam && creatorTeam !== playerTeam) {
                  isValidBuild = false;
                  validationFailureReason = 'Cannot contribute to opponent\'s house without distorting it';
                } else {
                  const extraTargetCards = (targetCards || []).filter(tc => !targetedHouseObj.cards.some(hc => hc.id === tc.id));
                  if (!canPartitionIntoValue([card, ...extraTargetCards], houseValue)) {
                    isValidBuild = false;
                    validationFailureReason = `New cards cannot be grouped into layers of value ${houseValue}`;
                  }
                }
              }
            }
          }
        }

        if (!isValidBuild) {
          console.warn(`[VALIDATION FAILED] BUILD_HOUSE by ${playerId} for value ${houseValue} failed: ${validationFailureReason}. Falling back to THROW.`);
          actionType = 'THROW';
          targetCards = [];
        }
      }
```

- [ ] **Step 3: Verify it compiles**

Run from `packages/server`:
```bash
npx tsc --noEmit -p . 2>&1 | wc -l
```
Expected: same count as the Task 4 Step 1 baseline (no new errors).

- [ ] **Step 4: Manual QA checklist** (run `npm run dev`, 4-player test lobby with 2v2 teams)

1. Player A builds House 10. Player A's teammate (Player B) plays a card of value 10 to add to it, while B's remaining hand holds NO other card equal to 10 → the move must still succeed (no fallback THROW, no `[VALIDATION FAILED]` log for this move).
2. An opponent (Player C, different team) attempts to add a matching-value card to House 10 without holding a 10 in their remaining hand and without both teams already having contributed → move falls back to THROW as before (unchanged behavior — verify the `[VALIDATION FAILED]` log line still appears for this case).
3. Player A attempts to distort (escalate) their own team's house to a higher value without holding that higher value in hand → still fails/falls back to THROW (distortion is unaffected by this change).
4. A fresh house build (no existing house being targeted) without holding the value → still fails/falls back to THROW (new-build path is unaffected).

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/index.ts
git commit -m "fix: let teammates contribute to their own team's house without holding the value"
```
