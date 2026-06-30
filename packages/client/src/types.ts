// Card game types for client

export type Suit = 'hearts' | 'diamonds' | 'clubs' | 'spades';
export type Rank = '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K' | 'A';

export interface Card {
  id: string;
  suit: Suit;
  rank: Rank;
  pointValue: number;
  faceDown?: boolean;
}

export interface House {
  id: string;
  cards: Card[];
  value: 9 | 10 | 11 | 12 | 13 | 14;
  isPukta: boolean;
  createdBy: string;
}

export type FloorCard = Card & { isLoose?: boolean; houseId?: string };

export interface GamePlayer {
  id: string;
  username: string;
  team: number;
  seat: number;
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
  handSizes: Record<string, number>;
  players: GamePlayer[];
}