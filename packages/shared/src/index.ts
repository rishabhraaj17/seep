// Card Game Types for Seep (Sweep)

export type Suit = 'hearts' | 'diamonds' | 'clubs' | 'spades';

export type Rank = '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K' | 'A';

export interface Card {
  id: string; // unique identifier (e.g., "AH" for Ace of Hearts, "10D" for 10 of Diamonds)
  suit: Suit;
  rank: Rank;
  pointValue: number; // 0 for most cards, special values for scoring cards
}

export interface Player {
  id: string;
  username: string;
  role: 'player' | 'spectator' | 'admin';
  team?: 1 | 2; // Partners are on teams 1 and 2
  seat: 1 | 2 | 3 | 4; // Seat position (partners: 1&3 vs 2&4)
  hand: Card[];
  score: number;
}

export interface House {
  id: string;
  cards: Card[];
  value: 9 | 10 | 11 | 12 | 13 | 14; // House values range from 9-14
  isPukta: boolean; // false = Kacha (loose), true = Pukta (cemented/fixed)
  createdBy: string; // player id who built it
}

export type FloorCard = Card & { isLoose?: boolean; houseId?: string };

export interface Lobby {
  code: string;
  isPrivate: boolean;
  players: Player[];
  maxPlayers: 4;
  status: 'waiting' | 'bidding' | 'playing' | 'ended';
}

export interface GameState {
  lobbyCode: string;
  floor: FloorCard[];
  houses: House[];
  currentPlayerIndex: number;
  roundNumber: number;
  teamScores: { team1: number; team2: number };
  capturedCards: { team1: Card[]; team2: Card[] };
  seepCount: { team1: number; team2: number };
  gamePhase: 'toss' | 'bidding' | 'playing' | 'roundEnd' | 'gameEnd';
  bid?: {
    playerId: string;
    value: number;
    fulfilled: boolean;
  };
  lastCaptureTeam?: 1 | 2;
  firstTurnCompleted: string[];
  tossWinner?: string;
  tossHistory?: { playerId: string; card: Card }[];
}

export interface LobbyAction {
  type: 'CREATE' | 'JOIN' | 'LEAVE' | 'START' | 'KICK';
  payload: {
    code?: string;
    playerId?: string;
    isPrivate?: boolean;
  };
}

export interface GameAction {
  type: 'CAPTURE' | 'BUILD_HOUSE' | 'THROW';
  payload: {
    playerId: string;
    card?: Card;
    targetCards?: Card[]; // cards being captured in CAPTURE
    houseValue?: 9 | 10 | 11 | 12 | 13 | 14; // for BUILD_HOUSE
    targetHouseId?: string; // for converting Kacha to Pukta
  };
}

export interface AuthPayload {
  token?: string;
  userId?: string;
  username?: string;
  role?: 'player' | 'spectator' | 'admin';
}

export function getCardNumericValue(card: Card): number {
  if (card.rank === 'A') return 1;
  if (card.rank === 'J') return 11;
  if (card.rank === 'Q') return 12;
  if (card.rank === 'K') return 13;
  return parseInt(card.rank, 10);
}

// Helper functions for card point calculation
export function getPointValue(card: Card): number {
  if (card.suit === 'spades') {
    return getCardNumericValue(card);
  }
  if (card.rank === 'A') return 1;
  if (card.rank === '10' && card.suit === 'diamonds') return 6;
  return 0;
}

// Generate a standard 52-card deck
export function createDeck(): Card[] {
  const suits: Suit[] = ['hearts', 'diamonds', 'clubs', 'spades'];
  const ranks: Rank[] = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

  const deck: Card[] = [];

  for (const suit of suits) {
    for (const rank of ranks) {
      const card: Card = {
        id: `${rank}${suit.charAt(0).toUpperCase()}`,
        suit,
        rank,
        pointValue: getPointValue({ suit, rank, id: '', pointValue: 0 } as Card),
      };
      deck.push(card);
    }
  }

  return deck;
}