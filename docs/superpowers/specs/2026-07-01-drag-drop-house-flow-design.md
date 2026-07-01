# Drag-and-Drop House Build / Capture Flow — Design Specification
**Date**: 2026-07-01
**Topic**: Refine the existing drag-and-drop play interaction to explicitly ask "eat or build a house?" when ambiguous, mirror the server's house-value eligibility rules on the client, relax the value-holding rule for same-team contributions, and give houses a haphazard real-card stack visual instead of a face-down count for non-admins.

---

## 1. Current State (baseline)

Drag-and-drop already exists:
- `PlayerHand.tsx` makes hand cards `draggable`, firing `onDragStart` (`GameScreen.tsx:303`).
- `FloorCards.tsx` cards accept drop via `onDropOnCard` → `handleDropOnCard` (`GameScreen.tsx:307-328`), which **silently decides** the action: same rank → `CAPTURE`, sum in `[9,13]` → `BUILD_HOUSE`, else → `THROW`.
- Dropping on an existing house (`handleDropOnHouse`, `GameScreen.tsx:330-338`) always opens a modal (`houseActionPrompt`) asking Eat (Capture) vs Contribute — this part already matches what we want, just needs its eligibility check tightened (see §3).
- Dropping on empty table space (`handleDropOnBoard`, `GameScreen.tsx:340-352`) always throws — unaffected by this change.
- Houses render two ways depending on role (`GameScreen.tsx:817-843`): admins with the "reveal" toggle on see grouped card stacks; everyone else sees a generic "🃏 N Cards" placeholder.
- Server (`packages/server/src/index.ts:1884-1966`) re-validates every `BUILD_HOUSE` action and requires the acting player's **remaining hand** to contain a card whose value equals the target house value — uniformly, before it even distinguishes new-build / distortion / contribution. This is what makes house-building "solid" (nobody can build a house they can never close), but it's currently too strict for same-team contribution.

---

## 2. Drop-onto-single-floor-card: ask only when ambiguous

Replace the auto-decide block in `handleDropOnCard` with an eligibility computation:

- `canEat = playedVal === targetVal`
- `canBuild = sum in [9,13]` **and** the remaining hand (hand minus the dragged card) contains a card whose value equals `sum` (mirrors the server rule in §1, computed client-side purely for UX — the server remains the source of truth and re-validates independently).

Behavior:
| canEat | canBuild | Result |
|---|---|---|
| true | false | `CAPTURE` directly, no modal |
| false | true | `BUILD_HOUSE` directly, no modal |
| true | true | Open the existing `houseActionPrompt` modal, generalized to also cover a single floor card (not just a full house), asking "Eat (Capture) or Build House of {sum}?" |
| false | false | `THROW` (today's fallback — the target card is unaffected, dragged card becomes a new loose open card) |

The modal component itself doesn't need a new UI — `houseActionPrompt` state already renders "Eat vs Contribute"; we generalize its copy/state to accept either a `House` or a synthetic single-card target, and its two buttons stay `performHouseAction('CAPTURE' | 'CONTRIBUTE', ...)`.

## 3. Drop-onto-existing-house: apply the same eligibility gate, plus the team exception

Today `handleDropOnHouse` unconditionally opens the modal. We keep asking (the ambiguity here is inherent — capture vs. contribute is close to always a real choice), but the **eligibility of the Contribute option** must reflect:

- If the house's controlling team (creator's team, i.e. `getHouseTeams`) equals the current player's team → Contribute is **always** eligible, regardless of what's in the player's hand (the new exception).
- Otherwise (opponent's house, or a fresh distortion) → Contribute is only eligible if the remaining hand holds the resulting value, matching server behavior.

If Contribute isn't eligible under these rules, that button is disabled/hidden in the modal rather than sent to the server and silently downgraded.

## 4. Server-side rule fix: same-team contribution doesn't need the value in hand

In `packages/server/src/index.ts`, the `BUILD_HOUSE` validation block (currently ~lines 1884-1966) checks `remainingHand.some(v => v === houseValue)` unconditionally up front. Restructure so the check is skipped specifically for the **non-distorting contribution to a house whose creator is on the acting player's own team**:

1. Determine `targetedHouseIndex` first (unchanged logic — matches `targetCards` against existing house cards).
2. If no targeted house (fresh build) → value-in-hand check applies (unchanged).
3. If targeted house exists:
   - Compute `isDistortion = targetedHouseObj.value !== houseValue` (unchanged).
   - If `isDistortion` → value-in-hand check applies (unchanged; distortion is effectively claiming/escalating the house, still must be closeable).
   - If **not** distortion (straight contribution) and `creatorTeam === playerTeam` → **skip** the value-in-hand check. All other contribution validation (partitioning cards into the declared value via `canPartitionIntoValue`, "cannot contribute to opponent's house without distorting" for the cross-team case) stays exactly as-is.
   - If not distortion and `creatorTeam !== playerTeam` → value-in-hand check still applies (unchanged from today).

This is a narrow, additive change — every other existing validation path (new house, distortion, opponent contribution, Pukta/cementing rules, partition checks) is untouched.

## 5. House stack visuals: always show real cards, haphazardly stacked

Per your clarification: everyone sees each house's actual cards at all times (not just admins), stacked to look like a loosely-thrown real pile — small per-card rotation and x/y jitter. What stays admin-gated is the **chronological build-order** view (today's "🔍 View stack order" modal, `houseDetailModal`) — that's a distinct feature (ordered list, bottom-to-top) and is unaffected.

Implementation:
- Remove the `role === 'admin' && adminShowHouseCards` gate around the card-rendering branch in the "Active Houses" block (`GameScreen.tsx:817-843`) — the haphazard stack always renders, replacing the "🃏 N Cards" placeholder entirely.
- Replace the current `groupHouseCards`-based neat-column stacking with a haphazard layout: each card gets a small pseudo-random rotation (~ ±6-10°) and x/y offset, **deterministic per card id** (seeded from a hash of `card.id`, not `Math.random()` on every render) so the pile doesn't visually jump around on re-renders/animations.
- The "🔍 View stack order" button and its modal remain exactly as they are today, admin-toggle-gated, showing the same cards in build order with numbering.
- Creator/contributor team badges (`getHouseTeams`) are unaffected.

## 6. Non-goals / unchanged

- Empty-table drop (`handleDropOnBoard`) behavior is unchanged.
- Click-based selection flow (tap card → action bar → Capture/Throw/Build buttons) stays as a fallback interaction path; drag-and-drop is additive, not a replacement.
- Cementing (Pukta) rules, capture subset-sum logic, bidding, seep counting, and all other engine rules are untouched.
- Bot AI already goes through the same server-side validation path, so the relaxed same-team-contribution rule and the tightened per-case value check apply to bots automatically — no separate bot logic changes needed.
