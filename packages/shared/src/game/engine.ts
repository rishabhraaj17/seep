import type { Card, House, FloorCard, GameState, Player } from '../index';
import { createDeck, getPointValue } from '../index';

// Game constants
export const HOUSE_VALUES = [9, 10, 11, 12, 13, 14] as const;
export type HouseValue = (typeof HOUSE_VALUES)[number];

// Calculate total point value of captured cards (max 22 per round)
export function calculatePoints(cards: Card[]): number {
  return cards.reduce((sum, card) => sum + card.pointValue, 0);
}

// Deal cards to players and floor
export function dealCards(players: Player[]): { players: Player[]; floor: FloorCard[] } {
  const deck = shuffle(createDeck());
  let deckIndex = 0;

  // Deal 4 cards to floor
  const floor: FloorCard[] = deck.slice(deckIndex, 4).map(card => ({ ...card }));
  deckIndex += 4;

  // Deal 4 cards to player 1 (bidding player)
  const newPlayers = [...players];
  newPlayers[0].hand = deck.slice(deckIndex, deckIndex + 4).map(card => ({ ...card, pointValue: getPointValue(card) }));
  deckIndex += 4;

  // Remaining cards will be dealt to all players after bidding
  // For now, deal to other players too to reach 12 each
  for (let i = 1; i < 4; i++) {
    const remaining = 12 - newPlayers[i].hand.length;
    newPlayers[i].hand = deck.slice(deckIndex, deckIndex + remaining).map(card => ({ ...card, pointValue: getPointValue(card) }));
    deckIndex += remaining;
  }

  return { players: newPlayers, floor };
}

// Shuffle deck (Fisher-Yates)
export function shuffle<T>(array: T[]): T[] {
  const result = [...array];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

// Validate if a card can be played as a bid
export function validateBid(cardRankToBid: string, hand: Card[]): boolean {
  // Card value mapping for bidding
  const rankValues: Record<string, number> = {
    '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9,
    '10': 10, 'J': 11, 'Q': 12, 'K': 13, 'A': 14
  };

  const bidValue = rankValues[cardRankToBid];
  return bidValue >= 9 && bidValue <= 14 && hand.some(c => rankValues[c.rank] === bidValue);
}

// Check if card values sum to target
export function canSumToTarget(cards: Card[], target: number): boolean {
  if (cards.length === 0) return false;
  if (cards.length === 1) return getCardValue(cards[0]) === target;

  const values = cards.map(getCardValue);

  // Check if any subset sums to target
  for (let mask = 1; mask < (1 << values.length); mask++) {
    const sum = values.reduce((acc, val, idx) => acc + ((mask & (1 << idx)) ? val : 0), 0);
    if (sum === target) return true;
  }
  return false;
}

// Get numeric value of a card for sum calculations
export function getCardValue(card: Card): number {
  if (card.rank === 'A') return 1;
  if (card.rank === 'J') return 11;
  if (card.rank === 'Q') return 12;
  if (card.rank === 'K') return 13;
  return parseInt(card.rank, 10);
}

// Validate capture action
export function validateCapture(playedCard: Card, targetCards: Card[]): boolean {
  const playedValue = getCardValue(playedCard);
  return canSumToTarget(targetCards, playedValue);
}

// Check if Seep is possible (capture all floor cards)
export function canSeep(playedCard: Card, floor: FloorCard[], houses: House[]): boolean {
  // Can't Seep on last turn (when floor has been organized into Pukta houses by partner)
  const puktaHouses = houses.filter(h => h.isPukta && h.createdBy);

  // If there are partner Pukta houses, can't Seep
  // (Simplified: assuming we track partner ownership properly)

  // Check if card can capture all remaining loose cards
  const allLooseCards = floor.filter(c => c.isLoose !== false);
  const combinedCards = [...allLooseCards];

  // Add cards from non-partner Kacha houses
  for (const house of houses.filter(h => !h.isPukta)) {
    combinedCards.push(...house.cards);
  }

  return combinedCards.length > 0 && canSumToTarget(combinedCards, getCardValue(playedCard));
}

// Build a house (Kacha - loose house)
export function buildHouse(
  playedCard: Card,
  existingCards: Card[],
  houseValue: HouseValue,
  playerId: string
): House {
  const cards = [...existingCards, playedCard];
  return {
    id: `house_${Date.now()}`,
    cards,
    value: houseValue,
    isPukta: false,
    createdBy: playerId,
  };
}

// Check if house can be cemented (Pukta)
export function canCementHouse(house: House): boolean {
  // A house is Pukta if it has multiple ways to reach the target sum
  // OR if it has a duplicate card of the house value
  const cardsOfHouseValue = house.cards.filter(c => getCardValue(c) === house.value);
  if (cardsOfHouseValue.length >= 2) return true;

  // Check for multiple combinations
  const values = house.cards.map(getCardValue);

  // Try to find 2+ disjoint subsets that both sum to house value
  // This is a simplified check - could be more thorough
  return false; // For now, require duplicate card to cement
}

// Process a completed house (check if cemented)
export function processHouse(house: House): { house: House; wasCemented: boolean } {
  const wasCemented = canCementHouse(house);
  return {
    house: { ...house, isPukta: wasCemented },
    wasCemented,
  };
}

// Convert Kacha to Pukta (opponent can "break" by adding to it)
export function convertToPukta(
  house: House,
  addedCard: Card,
  newValue: HouseValue,
  playerId: string
): House | null {
  // Can only Convert if house is still Kacha (not Pukta)
  if (house.isPukta) return null;

  return {
    ...house,
    cards: [...house.cards, addedCard],
    value: newValue,
    isPukta: true, // Adding to Kacha cements it
  };
}

// Execute a Seep - calculate bonus
export function executeSeep(): { points: number; isSeep: boolean } {
  return { points: 50, isSeep: true }; // 50 points for Seep
}

// Check if game round is over (all players empty hands)
export function isRoundOver(gameState: GameState): boolean {
  return gameState.currentPlayerIndex >= 4; // Simplified: after all turns
}

// Initialize a new game state
export function createInitialGameState(lobbyCode: string): GameState {
  return {
    lobbyCode,
    floor: [],
    houses: [],
    currentPlayerIndex: 0,
    roundNumber: 1,
    teamScores: { team1: 0, team2: 0 },
    capturedCards: { team1: [], team2: [] },
    seepCount: { team1: 0, team2: 0 },
    gamePhase: 'bidding',
  };
}