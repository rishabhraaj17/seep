# House-building selection visual feedback

## Problem

Combining a hand card with 2+ floor cards to build/contribute to a house already works mechanically:
`handleCardClick` in `GameScreen.tsx` seeds `capturedCards` from `findCapturableCards` when a hand card
is selected, then toggles any floor card in/out of `capturedCards` on click. The gap is visual — the
selected hand card and the selected floor cards render with the identical gold `isSelected` highlight
(`PlayingCard.tsx`), so there's no way to distinguish "the card I'm playing" from "the table cards I'm
combining with it." There's also no running total shown for the current floor selection, so a player
has to sum ranks in their head against the 9–13 house-value buttons.

## Fix design

### 1. Distinct highlight color for floor-card selections

`PlayingCard.tsx` gets a new optional prop `selectedVariant?: 'gold' | 'teal'` (default `'gold'`,
preserving current behavior for the hand). When `'teal'`, the selected-state border/glow/background use
the existing teal/emerald tones already used elsewhere in the UI for "capture-eligible" badges
(`rgba(22,160,133,...)` / `#1abc9c`) instead of gold.

`FloorCards.tsx` passes `selectedVariant="teal"` on every `PlayingCard` it renders. `PlayerHand.tsx`
(hand cards) keeps the default gold. No other callers change.

### 2. Running sum readout

In `GameScreen.tsx`'s action bar (the block that already shows "Selected: 7♠" and the "Can capture N"
badge, ~line 926-939), add a badge showing the sum of `capturedCards`' rank values whenever
`capturedCards.length > 0`, using the existing `getCardValue` helper:

```
Floor sum: {capturedCards.reduce((s, c) => s + getCardValue(c), 0)}
```

Styled with the same teal palette as the floor-card selection highlight, for visual consistency between
"what's highlighted on the table" and "what this badge is summing."

### 3. Auto-disable unreachable house values

The 9–13 house-value button row (~line 976-990) computes, for each value `v`, whether it's reachable:
`getCardValue(selectedCard) + floorSum === v`. Buttons for unreachable values get `disabled` and the
existing greyed-out style (matching the disabled style already used for `handleBuildHouse`'s button).
Clicking a disabled value is a no-op (existing `onClick` already only fires on enabled buttons via the
`disabled` prop). If `capturedCards` is empty, all five values are enabled (no floor combo constrains
them yet) — same as current behavior.

## Out of scope

- No change to the underlying selection mechanism (`handleCardClick`, `capturedCards`, `findCapturableCards`).
- No change to the drag-and-drop flows (`handleDropOnCard`, `handleDropOnHouse`) — those remain single-card
  or house-click driven and are unaffected by this multi-select clarity fix.
- No change to server-side validation or payload shape.

## Testing

No test suite configured. Manual verification (once a dev DB is available): select a hand card, click
2+ floor cards, confirm they highlight teal (distinct from the gold hand-card highlight), confirm the
running "Floor sum" badge updates as cards are toggled, and confirm only house-value buttons matching
`selectedCard value + floor sum` are clickable.
