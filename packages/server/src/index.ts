import express from 'express';
import http from 'http';
import { Server as SocketIOServer, Socket } from 'socket.io';
import cors from 'cors';
import dotenv from 'dotenv';
import { randomBytes } from 'crypto';
import authRoutes from './auth/routes.js';
import { generateToken, verifyToken, hasPermission } from './auth/jwt.js';
import { initDatabase, seedAdminUser, pool } from './db.js';
import { chooseBestBotMove } from './bot.js';

// Game types
type Suit = 'hearts' | 'diamonds' | 'clubs' | 'spades';
type Rank = '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K' | 'A';

export interface Card {
  id: string;
  suit: Suit;
  rank: Rank;
  pointValue: number;
}

interface House {
  id: string;
  cards: Card[];
  value: 9 | 10 | 11 | 12 | 13 | 14;
  isPukta: boolean;
  createdBy: string;
  contributors?: string[];
}

interface RoundSummary {
  team1CardPoints: number;
  team2CardPoints: number;
  team1SeepsNet: number;
  team2SeepsNet: number;
  team1RoundScore: number;
  team2RoundScore: number;
  winningTeam: 1 | 2 | null;
}

export interface GameState {
  lobbyCode: string;
  floor: Card[];
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
  players: { id: string; username: string; team: number; seat: number; }[];
  deck: Card[];
  askAbove8?: boolean;
  roundSummary?: RoundSummary;
  dealerSelectionTeam?: 1 | 2;
  dealerIndex?: number;
}

interface LobbyState {
  code: string;
  isPrivate: boolean;
  players: { id: string; socketId: string; team: number; seat?: number; username?: string; }[];
  status: 'waiting' | 'bidding' | 'playing' | 'ended';
  gameState?: GameState;
  hands?: Map<string, Card[]>;
  teamNames?: { team1: string; team2: string };
}

// Helper functions
export function getPointValue(card: Card): number {
  if (card.suit === 'spades') {
    return getCardNumericValue(card);
  }
  if (card.rank === 'A') return 1;
  if (card.rank === '10' && card.suit === 'diamonds') return 6;
  return 0;
}

function createDeck(): Card[] {
  const suits: Suit[] = ['hearts', 'diamonds', 'clubs', 'spades'];
  const ranks: Rank[] = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
  const deck: Card[] = [];

  for (const suit of suits) {
    for (const rank of ranks) {
      deck.push({
        id: `${rank}${suit.charAt(0).toUpperCase()}`,
        suit,
        rank,
        pointValue: getPointValue({ suit, rank, id: '' } as Card),
      });
    }
  }
  return deck;
}

function shuffle<T>(array: T[]): T[] {
  const result = [...array];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

const rankToValue: Record<string, number> = {
  '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9,
  '10': 10, 'J': 11, 'Q': 12, 'K': 13, 'A': 1,
};

// Card value for capture/sum checks
export function getCardNumericValue(card: Card): number {
  if (card.rank === 'A') return 1;
  if (card.rank === 'J') return 11;
  if (card.rank === 'Q') return 12;
  if (card.rank === 'K') return 13;
  return parseInt(card.rank, 10);
}

// Check if sum of cards equals target
function canSumTo(target: number, cards: Card[]): boolean {
  const values = cards.map(getCardNumericValue);
  // Check all subset sums
  for (let mask = 1; mask < (1 << values.length); mask++) {
    let sum = 0;
    for (let i = 0; i < values.length; i++) {
      if (mask & (1 << i)) sum += values[i];
    }
    if (sum === target) return true;
  }
  return false;
}

function canPartitionIntoValue(cards: Card[], target: number): boolean {
  if (cards.length === 0) return true;
  const firstCard = cards[0];
  const firstVal = getCardNumericValue(firstCard);
  if (firstVal > target) return false;
  if (firstVal === target) {
    return canPartitionIntoValue(cards.slice(1), target);
  }
  return findComboAndPartition(cards.slice(1), target - firstVal, target);
}

function findComboAndPartition(cards: Card[], targetSum: number, target: number): boolean {
  if (targetSum === 0) return true;
  if (cards.length === 0) return false;
  
  for (let i = 0; i < cards.length; i++) {
    const val = getCardNumericValue(cards[i]);
    if (val <= targetSum) {
      const remainingCards = [...cards.slice(0, i), ...cards.slice(i + 1)];
      if (val === targetSum) {
        if (canPartitionIntoValue(remainingCards, target)) return true;
      } else {
        if (findComboAndPartition(remainingCards, targetSum - val, target)) return true;
      }
    }
  }
  return false;
}

// Calculate total points for captured cards
function calculatePoints(cards: Card[]): number {
  return cards.reduce((sum, card) => sum + getPointValue(card), 0);
}

function checkIfPukta(house: House): boolean {
  if (house.value >= 13) return true;
  const totalSum = house.cards.reduce((sum, c) => sum + getCardNumericValue(c), 0);
  return totalSum >= 2 * house.value;
}

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
  const result = { team1: false, team2: false };
  const contributors = house.contributors || [house.createdBy];
  for (const pid of contributors) {
    const p = players.find(player => player.id === pid);
    if (p) {
      if (p.team === 1) result.team1 = true;
      if (p.team === 2) result.team2 = true;
    }
  }
  return result;
}
// Bot helper to find capturable cards
function findCapturableCardsForBot(card: Card, floor: Card[]): Card[] {
  const cardValue = getCardNumericValue(card);
  const capturable: Card[] = [];

  // Single card match
  for (const floorCard of floor) {
    if (getCardNumericValue(floorCard) === cardValue) {
      capturable.push(floorCard);
      return capturable;
    }
  }

  // Sum combination check
  for (let i = 0; i < floor.length; i++) {
    for (let j = i + 1; j < floor.length; j++) {
      if (getCardNumericValue(floor[i]) + getCardNumericValue(floor[j]) === cardValue) {
        capturable.push(floor[i], floor[j]);
        return capturable;
      }
    }
  }

  return [];
}

// Helper functions for Database Persistence
async function loadLobby(code: string, client?: any): Promise<LobbyState | null> {
  const db = client || pool;
  const lobbyRes = await db.query(
    'SELECT code, is_private, status, team_names FROM lobbies WHERE code = $1',
    [code]
  );
  if (lobbyRes.rows.length === 0) {
    return null;
  }
  const lobbyRow = lobbyRes.rows[0];

  const playersRes = await db.query(
    `SELECT lp.user_id, lp.socket_id, lp.team, lp.seat, u.username 
     FROM lobby_players lp 
     LEFT JOIN users u ON lp.user_id = u.id 
     WHERE lp.lobby_code = $1 
     ORDER BY lp.seat ASC`,
    [code]
  );
  const players = playersRes.rows.map((r: any) => ({
    id: r.user_id,
    socketId: r.socket_id,
    team: r.team,
    seat: r.seat,
    username: r.user_id.startsWith('Bot_') ? r.user_id : (r.username || 'Player'),
  }));

  const lobby: LobbyState = {
    code: lobbyRow.code,
    isPrivate: lobbyRow.is_private,
    status: lobbyRow.status,
    players,
    teamNames: lobbyRow.team_names || { team1: 'Team 1', team2: 'Team 2' },
  };

  const gsRes = await db.query(
    'SELECT floor, houses, hands, current_player_index, round_number, team_scores, captured_cards, team_seeps, game_phase, bid, last_capture_team, first_turn_completed, toss_winner, toss_history, hand_sizes, deck, ask_above_8, round_summary, dealer_selection_team, dealer_index FROM game_states WHERE lobby_code = $1',
    [code]
  );

  if (gsRes.rows.length > 0) {
    const gsRow = gsRes.rows[0];
    lobby.gameState = {
      lobbyCode: code,
      floor: gsRow.floor,
      houses: gsRow.houses,
      currentPlayerIndex: gsRow.current_player_index,
      roundNumber: gsRow.round_number,
      teamScores: gsRow.team_scores,
      capturedCards: gsRow.captured_cards,
      seepCount: gsRow.team_seeps,
      gamePhase: gsRow.game_phase,
      bid: gsRow.bid || undefined,
      lastCaptureTeam: gsRow.last_capture_team || undefined,
      firstTurnCompleted: gsRow.first_turn_completed || [],
      tossWinner: gsRow.toss_winner || undefined,
      tossHistory: gsRow.toss_history || [],
      handSizes: gsRow.hand_sizes || {},
      players: players.map((p: any) => ({
        id: p.id,
        username: p.username,
        team: p.team,
        seat: p.seat,
      })),
      deck: gsRow.deck || [],
      askAbove8: gsRow.ask_above_8 || false,
      roundSummary: gsRow.round_summary || undefined,
      dealerSelectionTeam: gsRow.dealer_selection_team || undefined,
      dealerIndex: gsRow.dealer_index !== null && gsRow.dealer_index !== undefined ? gsRow.dealer_index : undefined,
    };
    const hands = new Map<string, Card[]>();
    if (gsRow.hands) {
      for (const [uid, cards] of Object.entries(gsRow.hands)) {
        hands.set(uid, cards as Card[]);
      }
    }
    lobby.hands = hands;
  } else {
    // Reconstruct empty hands for the players
    const hands = new Map<string, Card[]>();
    for (const p of players) {
      hands.set(p.id, []);
    }
    lobby.hands = hands;
  }

  return lobby;
}

async function saveLobby(lobby: LobbyState, client?: any): Promise<void> {
  const executeSave = async (db: any) => {
    await db.query(
      'UPDATE lobbies SET status = $1, is_private = $2 WHERE code = $3',
      [lobby.status, lobby.isPrivate, lobby.code]
    );

    if (lobby.gameState) {
      const handsObj: Record<string, Card[]> = {};
      const handSizes: Record<string, number> = {};
      if (lobby.hands) {
        for (const [uid, cards] of lobby.hands.entries()) {
          handsObj[uid] = cards;
          handSizes[uid] = cards.length;
        }
      }
      lobby.gameState.handSizes = handSizes;

      await db.query(
        `INSERT INTO game_states (
          lobby_code, floor, houses, hands, current_player_index, round_number, 
          team_scores, captured_cards, team_seeps, game_phase, bid, last_capture_team, first_turn_completed,
          toss_winner, toss_history, hand_sizes, deck, ask_above_8, round_summary, dealer_selection_team, dealer_index
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)
         ON CONFLICT (lobby_code) DO UPDATE SET
          floor = EXCLUDED.floor,
          houses = EXCLUDED.houses,
          hands = EXCLUDED.hands,
          current_player_index = EXCLUDED.current_player_index,
          round_number = EXCLUDED.round_number,
          team_scores = EXCLUDED.team_scores,
          captured_cards = EXCLUDED.captured_cards,
          team_seeps = EXCLUDED.team_seeps,
          game_phase = EXCLUDED.game_phase,
          bid = EXCLUDED.bid,
          last_capture_team = EXCLUDED.last_capture_team,
          first_turn_completed = EXCLUDED.first_turn_completed,
          toss_winner = EXCLUDED.toss_winner,
          toss_history = EXCLUDED.toss_history,
          hand_sizes = EXCLUDED.hand_sizes,
          deck = EXCLUDED.deck,
          ask_above_8 = EXCLUDED.ask_above_8,
          round_summary = EXCLUDED.round_summary,
          dealer_selection_team = EXCLUDED.dealer_selection_team,
          dealer_index = EXCLUDED.dealer_index,
          updated_at = CURRENT_TIMESTAMP`,
        [
          lobby.code,
          JSON.stringify(lobby.gameState.floor),
          JSON.stringify(lobby.gameState.houses),
          JSON.stringify(handsObj),
          lobby.gameState.currentPlayerIndex,
          lobby.gameState.roundNumber,
          JSON.stringify(lobby.gameState.teamScores),
          JSON.stringify(lobby.gameState.capturedCards),
          JSON.stringify(lobby.gameState.seepCount),
          lobby.gameState.gamePhase,
          lobby.gameState.bid ? JSON.stringify(lobby.gameState.bid) : null,
          lobby.gameState.lastCaptureTeam || null,
          JSON.stringify(lobby.gameState.firstTurnCompleted || []),
          lobby.gameState.tossWinner || null,
          JSON.stringify(lobby.gameState.tossHistory || []),
          JSON.stringify(handSizes),
          JSON.stringify(lobby.gameState.deck || []),
          lobby.gameState.askAbove8 || false,
          lobby.gameState.roundSummary ? JSON.stringify(lobby.gameState.roundSummary) : null,
          lobby.gameState.dealerSelectionTeam !== undefined ? lobby.gameState.dealerSelectionTeam : null,
          lobby.gameState.dealerIndex !== undefined ? lobby.gameState.dealerIndex : null,
        ]
      );
    }
  };

  if (client) {
    await executeSave(client);
  } else {
    const activeClient = await pool.connect();
    try {
      await activeClient.query('BEGIN');
      await executeSave(activeClient);
      await activeClient.query('COMMIT');
    } catch (err) {
      await activeClient.query('ROLLBACK');
      throw err;
    } finally {
      activeClient.release();
    }
  }
}

// Check if round should end and update scores
async function checkRoundEnd(lobby: LobbyState) {
  if (!lobby.hands || !lobby.gameState) return;

  // Check if all players have 0 cards in hand
  let allEmpty = true;
  for (const [, hand] of lobby.hands.entries()) {
    if (hand.length > 0) { allEmpty = false; break; }
  }
  if (!allEmpty) return;

  // Award remaining floor cards / houses to last-capture team
  const lastTeam = lobby.gameState.lastCaptureTeam === 2 ? 'team2' : 'team1';
  if (lobby.gameState.floor.length > 0) {
    lobby.gameState.capturedCards[lastTeam].push(...lobby.gameState.floor);
    lobby.gameState.floor = [];
  }
  lobby.gameState.houses.forEach(house => {
    lobby.gameState!.capturedCards[lastTeam].push(...house.cards);
  });
  lobby.gameState.houses = [];

  // --- Card points (total = 100 per round) ---
  const t1CardPts = calculatePoints(lobby.gameState.capturedCards.team1);
  const t2CardPts = calculatePoints(lobby.gameState.capturedCards.team2);

  // --- Seep net cancellation ---
  const rawT1Seeps = lobby.gameState.seepCount.team1;
  const rawT2Seeps = lobby.gameState.seepCount.team2;
  const netT1Seeps = Math.max(0, rawT1Seeps - rawT2Seeps);
  const netT2Seeps = Math.max(0, rawT2Seeps - rawT1Seeps);
  lobby.gameState.seepCount = { team1: 0, team2: 0 };

  // --- Round score: (winner_card - loser_card) × 2 + net_seep × 50 ---
  let t1RoundScore = 0;
  let t2RoundScore = 0;
  const cardDiff = t1CardPts - t2CardPts;

  if (cardDiff >= 0) {
    t1RoundScore = cardDiff * 2 + netT1Seeps * 50;
    t2RoundScore = -(cardDiff * 2) - netT1Seeps * 50 + netT2Seeps * 50;
  } else {
    t2RoundScore = (-cardDiff) * 2 + netT2Seeps * 50;
    t1RoundScore = -((-cardDiff) * 2) - netT2Seeps * 50 + netT1Seeps * 50;
  }

  lobby.gameState.teamScores.team1 += t1RoundScore;
  lobby.gameState.teamScores.team2 += t2RoundScore;

  // Determine winning team for this round
  const winningTeam: 1 | 2 | null = t1RoundScore > t2RoundScore ? 1 : t2RoundScore > t1RoundScore ? 2 : null;
  const losingTeam: 1 | 2 = winningTeam === 1 ? 2 : 1;

  lobby.gameState.roundSummary = {
    team1CardPoints: t1CardPts,
    team2CardPoints: t2CardPts,
    team1SeepsNet: netT1Seeps,
    team2SeepsNet: netT2Seeps,
    team1RoundScore: t1RoundScore,
    team2RoundScore: t2RoundScore,
    winningTeam,
  };

  console.log(`[ROUND END] Lobby ${lobby.code}: round ${lobby.gameState.roundNumber} — cards ${t1CardPts}-${t2CardPts}, seeps net ${netT1Seeps}-${netT2Seeps}, round score ${t1RoundScore}-${t2RoundScore}, totals ${lobby.gameState.teamScores.team1}-${lobby.gameState.teamScores.team2}`);

  // Game over?
  if (lobby.gameState.teamScores.team1 >= 100 || lobby.gameState.teamScores.team2 >= 100) {
    lobby.gameState.gamePhase = 'gameEnd';
    await saveLobby(lobby);
    console.log(`[GAME END] Lobby ${lobby.code}: final score ${lobby.gameState.teamScores.team1}-${lobby.gameState.teamScores.team2}`);
    io.to(lobby.code).emit('game-state', lobby.gameState);
    return;
  }

  // Transition to roundEnd — losing team must pick the next dealer
  lobby.gameState.gamePhase = 'roundEnd';
  lobby.gameState.dealerSelectionTeam = losingTeam;

  await saveLobby(lobby);
  io.to(lobby.code).emit('game-state', lobby.gameState);

  // If ALL losing-team players are bots, auto-select the first one as dealer
  const losingPlayers = lobby.players.filter(p => p.team === losingTeam);
  const allBots = losingPlayers.every(p => p.id.startsWith('Bot_'));
  if (allBots && losingPlayers.length > 0) {
    const chosenDealer = losingPlayers[0];
    const dealerIdx = lobby.players.findIndex(p => p.id === chosenDealer.id);
    setTimeout(() => startNextRound(lobby.code, dealerIdx), 2000);
  }
}

// Bot turn manager
async function startNextRound(lobbyCode: string, dealerPlayerIndex: number) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const lobby = await loadLobby(lobbyCode, client);
    if (!lobby?.gameState || lobby.gameState.gamePhase !== 'roundEnd') {
      await client.query('ROLLBACK');
      return;
    }

    // Rotate players array so dealerPlayerIndex is at position 3 (dealer)
    const rotated = [...lobby.players.slice(dealerPlayerIndex + 1), ...lobby.players.slice(0, dealerPlayerIndex + 1)];
    
    // Persist rotated seats to bypass check constraints and retain rotated seats on load
    await client.query('DELETE FROM lobby_players WHERE lobby_code = $1', [lobbyCode]);
    for (let i = 0; i < rotated.length; i++) {
      const p = rotated[i];
      const team = p.team ?? ((i === 0 || i === 2) ? 1 : 2);
      await client.query(
        'INSERT INTO lobby_players (lobby_code, user_id, socket_id, team, seat) VALUES ($1, $2, $3, $4, $5)',
        [lobbyCode, p.id, p.socketId, team, i + 1]
      );
      p.team = team;
      p.seat = i + 1;
    }
    lobby.players = rotated;

    const deck = shuffle(createDeck());
    const floorCards = deck.slice(0, 4);

    // Player 0 (caller) gets 12 cards; others (including dealer) get 4
    const hand0 = deck.slice(4, 16);  // caller gets 12
    const hand1 = deck.slice(16, 20); // others get 4
    const hand2 = deck.slice(20, 24);
    const hand3 = deck.slice(24, 28);
    const remainingDeck = deck.slice(28, 52);

    lobby.hands = new Map();
    lobby.hands.set(lobby.players[0].id, hand0);
    lobby.hands.set(lobby.players[1].id, hand1);
    lobby.hands.set(lobby.players[2].id, hand2);
    lobby.hands.set(lobby.players[3].id, hand3);

    const hasCardGe9 = hand0.some(c => {
      const val = getCardNumericValue(c);
      return val >= 9 && val <= 13;
    });

    lobby.gameState.roundNumber += 1;
    lobby.gameState.gamePhase = 'bidding';
    lobby.gameState.floor = floorCards;
    lobby.gameState.capturedCards = { team1: [], team2: [] };
    lobby.gameState.bid = undefined;
    lobby.gameState.currentPlayerIndex = 0;
    lobby.gameState.firstTurnCompleted = [];
    lobby.gameState.deck = remainingDeck;
    lobby.gameState.askAbove8 = !hasCardGe9;
    lobby.gameState.roundSummary = undefined;
    lobby.gameState.dealerSelectionTeam = undefined;
    lobby.gameState.lastCaptureTeam = undefined;
    lobby.gameState.dealerIndex = dealerPlayerIndex;
    lobby.gameState.players = lobby.players.map(p => ({
      id: p.id,
      username: p.username || p.id,
      team: p.team,
      seat: p.seat || 1,
    }));

    await saveLobby(lobby, client);
    await client.query('COMMIT');

    // Re-enter bidding flow: deal face-down floor + initial hands
    io.to(lobbyCode).emit('game-state', lobby.gameState);
    const faceDownFloor = floorCards.map(c => ({ ...c, faceDown: true }));
    lobby.players.forEach((p, i) => {
      io.to(p.socketId).emit('deal-cards', {
        lobbyCode,
        floor: faceDownFloor,
        hand: i === 3 ? hand3 : [hand0, hand1, hand2][i],
        playerIndex: i,
        biddingPlayerIndex: 0,
      });
    });

    await checkAndTriggerBotTurn(lobbyCode);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error starting next round:', err);
  } finally {
    client.release();
  }
}

async function checkAndTriggerBotTurn(lobbyCode: string) {
  // Load lobby from database
  const lobby = await loadLobby(lobbyCode);
  if (!lobby || !lobby.gameState || !lobby.hands) return;

  // Check if the game is waiting for dealer verification from a Bot Caller!
  if (lobby.gameState.askAbove8) {
    const callerPlayer = lobby.players[0];
    if (callerPlayer && callerPlayer.id.startsWith('Bot_')) {
      setTimeout(async () => {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          const currentLobby = await loadLobby(lobbyCode, client);
          if (!currentLobby || !currentLobby.gameState || !currentLobby.hands || !currentLobby.gameState.askAbove8) {
            await client.query('ROLLBACK');
            return;
          }

          const hand = currentLobby.hands.get(callerPlayer.id) || [];
          const hasAbove8 = hand.slice(0, 4).some(c => getCardNumericValue(c) > 8);
          
          if (!hasAbove8) {
            let currentDeck = currentLobby.gameState.deck || [];
            if (currentDeck.length < 4) {
              currentDeck = shuffle(createDeck());
            }

            const old4 = hand.slice(0, 4);
            const new4 = currentDeck.slice(0, 4);
            const remainingDeck = shuffle([...currentDeck.slice(4), ...old4]);
            const updatedHand = [...new4, ...hand.slice(4)];
            
            currentLobby.hands.set(callerPlayer.id, updatedHand);
            currentLobby.gameState.deck = remainingDeck;

            const newHasAbove8 = new4.some(c => getCardNumericValue(c) > 8);
            if (!newHasAbove8) {
              currentLobby.gameState.askAbove8 = true;
              io.to(lobbyCode).emit('toast-message', { 
                message: `🤖 Bot Caller (${callerPlayer.id}) had no cards above 8. Dealer dealt 4 new cards.` 
              });
            } else {
              currentLobby.gameState.askAbove8 = false;
              io.to(lobbyCode).emit('toast-message', { 
                message: `🤖 Dealer verified Bot Caller (${callerPlayer.id}) now has a card above 8.` 
              });
            }

            await saveLobby(currentLobby, client);
            await client.query('COMMIT');
            
            io.to(lobbyCode).emit('game-state', currentLobby.gameState);
            await checkAndTriggerBotTurn(lobbyCode);
          } else {
            currentLobby.gameState.askAbove8 = false;
            await saveLobby(currentLobby, client);
            await client.query('COMMIT');
            io.to(lobbyCode).emit('game-state', currentLobby.gameState);
            await checkAndTriggerBotTurn(lobbyCode);
          }
        } catch (err) {
          await client.query('ROLLBACK');
          console.error('Error in bot respond-above-8:', err);
        } finally {
          client.release();
        }
      }, 1000);
      return;
    }
  }

  if (lobby.gameState.gamePhase === 'bidding') {
    const bidder = lobby.players[0];
    if (bidder && bidder.socketId.startsWith('socket-Bot_')) {
      setTimeout(async () => {
        const currentLobby = await loadLobby(lobbyCode);
        if (!currentLobby || !currentLobby.gameState || currentLobby.gameState.gamePhase !== 'bidding') return;

        const hand = currentLobby.hands?.get(bidder.id) || [];
        const bidCard = hand.find(c => {
          const val = rankToValue[c.rank];
          return val >= 9 && val <= 14;
        });

        if (bidCard) {
          const bidVal = rankToValue[bidCard.rank];
          currentLobby.gameState.bid = { playerId: bidder.id, value: bidVal, fulfilled: false };
          currentLobby.gameState.gamePhase = 'playing';

          // Human dealer immediately sees the floor cards face-up when bid is announced
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
          io.to(currentLobby.code).emit('game-state', currentLobby.gameState);
          
          await checkAndTriggerBotTurn(currentLobby.code);
        }
      }, 1500);
    }
  } else if (lobby.gameState.gamePhase === 'playing') {
    const currentPlayer = lobby.players[lobby.gameState.currentPlayerIndex];
    if (currentPlayer && currentPlayer.socketId.startsWith('socket-Bot_')) {
      setTimeout(async () => {
        const currentLobby = await loadLobby(lobbyCode);
        if (!currentLobby || !currentLobby.gameState || currentLobby.gameState.gamePhase !== 'playing') return;

        const verifyPlayer = currentLobby.players[currentLobby.gameState.currentPlayerIndex];
        if (verifyPlayer?.id !== currentPlayer.id) return;

        const hand = currentLobby.hands?.get(currentPlayer.id) || [];
        if (hand.length === 0) return;

        const hasCompletedFirstTurn = currentLobby.gameState.firstTurnCompleted.includes(currentPlayer.id);
        const playerIndex = currentLobby.gameState.currentPlayerIndex;

        // Enforce visible hand limit (caller index 0 is exempt)
        const visibleHand = (playerIndex === 0 || hasCompletedFirstTurn) ? hand : hand.slice(0, 4);
        if (visibleHand.length === 0) return;

        let playAction = 'THROW';
        let selectedCard = visibleHand[0];
        let targetCards: Card[] = [];
        let houseValue: number | undefined = undefined;

        // Restriction: Restrict caller's first action to the called house value
        const isCallerFirstTurn = (playerIndex === 0 && !hasCompletedFirstTurn);
        if (isCallerFirstTurn) {
          const bidVal = currentLobby.gameState.bid!.value as 9 | 10 | 11 | 12 | 13 | 14;
          const bidCard = visibleHand.find(c => getCardNumericValue(c) === bidVal);
          if (bidCard) {
            selectedCard = bidCard;
            const capturable = findCapturableCardsForBot(bidCard, currentLobby.gameState.floor);
            if (capturable.length > 0) {
              playAction = 'CAPTURE';
              targetCards = capturable;
            } else {
              playAction = 'THROW';
              targetCards = [];
            }
          } else {
            selectedCard = visibleHand[0];
            playAction = 'THROW';
            targetCards = [];
          }
        } else {
          // Regular bot logic
          const botMove = chooseBestBotMove(
            currentPlayer.id,
            visibleHand,
            currentLobby.gameState.floor,
            currentLobby.gameState,
            currentPlayer.team as 1 | 2,
            currentLobby.players
          );
          playAction = botMove.action;
          selectedCard = botMove.card;
          targetCards = botMove.targetCards;
          houseValue = botMove.houseValue;
        }

        const team = currentPlayer.team === 1 ? 'team1' : 'team2';

        if (playAction === 'CAPTURE') {
          const cardValue = getCardNumericValue(selectedCard);
          const matchingHouses = currentLobby.gameState.houses.filter(h => h.value === cardValue);
          const nonMatchingHouses = currentLobby.gameState.houses.filter(h => h.value !== cardValue);
          
          const capturedHouseCards: Card[] = [];
          matchingHouses.forEach(h => {
            capturedHouseCards.push(...h.cards);
          });
          currentLobby.gameState.houses = nonMatchingHouses;

          targetCards.forEach(c => {
            currentLobby.gameState!.floor = currentLobby.gameState!.floor.filter(fc => fc.id !== c.id);
          });
          const captured = [selectedCard, ...capturedHouseCards, ...targetCards];
          currentLobby.gameState.capturedCards[team].push(...captured);
          currentLobby.gameState.lastCaptureTeam = currentPlayer.team === 2 ? 2 : 1;

          const isSeep = currentLobby.gameState.floor.length === 0 && currentLobby.gameState.houses.length === 0 && hand.length > 1;
          if (isSeep) {
            currentLobby.gameState.seepCount[team] += 1;
            if (currentLobby.gameState.seepCount[team] >= 3) {
              currentLobby.gameState.seepCount[team] = 0;
            }
            console.log(`[SEEP] Lobby ${currentLobby.code}: ${currentPlayer.id} (team ${currentPlayer.team}) cleared the table`);
            io.to(currentLobby.code).emit('seep-executed', { playerId: currentPlayer.id });
          }
        } else if (playAction === 'BUILD_HOUSE') {
          if (!houseValue || houseValue < 9 || houseValue > 13) {
            // Invalid house value, fall back to throw
            currentLobby.gameState!.floor.push(selectedCard);
            currentLobby.hands?.set(currentPlayer.id, hand.filter(c => c.id !== selectedCard.id));
            currentLobby.gameState.currentPlayerIndex = (currentLobby.gameState.currentPlayerIndex + 1) % 4;
            await logMove(pool, lobbyCode, currentPlayer.id, 'THROW', selectedCard, [], undefined);
            await saveLobby(currentLobby);
            io.to(currentLobby.code).emit('game-state', currentLobby.gameState);
            await checkRoundEnd(currentLobby);
            await checkAndTriggerBotTurn(currentLobby.code);
            return;
          }

          const targetedHouseIndex = currentLobby.gameState.houses.findIndex(h => 
            h.cards.some(hc => (targetCards || []).some(tc => tc.id === hc.id))
          );

          if (targetedHouseIndex === -1) {
            const existingHouse = currentLobby.gameState.houses.find(h => h.value === houseValue);
            (targetCards || []).forEach((c: Card) => {
              currentLobby.gameState!.floor = currentLobby.gameState!.floor.filter(fc => fc.id !== c.id);
            });

            if (existingHouse) {
              existingHouse.cards.push(selectedCard, ...(targetCards || []));
              existingHouse.isPukta = checkIfPukta(existingHouse);
              const contributors = existingHouse.contributors || [existingHouse.createdBy];
              if (!contributors.includes(currentPlayer.id)) {
                contributors.push(currentPlayer.id);
              }
              existingHouse.contributors = contributors;
            } else {
              const newHouse = {
                id: `house-${Date.now()}`,
                cards: [selectedCard, ...(targetCards || [])],
                value: houseValue as 9 | 10 | 11 | 12 | 13,
                isPukta: houseValue >= 13,
                createdBy: currentPlayer.id,
                contributors: [currentPlayer.id],
              };
              currentLobby.gameState.houses.push(newHouse);
            }
          } else {
            const targetedHouse = currentLobby.gameState.houses[targetedHouseIndex];
            const isDistortion = targetedHouse.value !== houseValue;

            if (isDistortion) {
              const existingHouse = currentLobby.gameState.houses.find(h => h.value === houseValue && h.id !== targetedHouse.id);
              const extraTargetCards = (targetCards || []).filter(tc => !targetedHouse.cards.some(hc => hc.id === tc.id));
              
              extraTargetCards.forEach((c: Card) => {
                currentLobby.gameState!.floor = currentLobby.gameState!.floor.filter(fc => fc.id !== c.id);
              });

              if (existingHouse) {
                existingHouse.cards.push(...targetedHouse.cards, selectedCard, ...extraTargetCards);
                existingHouse.isPukta = checkIfPukta(existingHouse);
                const contributors = existingHouse.contributors || [existingHouse.createdBy];
                const oldContributors = targetedHouse.contributors || [targetedHouse.createdBy];
                oldContributors.forEach(cid => {
                  if (!contributors.includes(cid)) contributors.push(cid);
                });
                if (!contributors.includes(currentPlayer.id)) {
                  contributors.push(currentPlayer.id);
                }
                existingHouse.contributors = contributors;
                currentLobby.gameState.houses = currentLobby.gameState.houses.filter(h => h.id !== targetedHouse.id);
              } else {
                targetedHouse.value = houseValue as 9 | 10 | 11 | 12 | 13;
                targetedHouse.cards.push(selectedCard, ...extraTargetCards);
                targetedHouse.createdBy = currentPlayer.id;
                targetedHouse.isPukta = checkIfPukta(targetedHouse);
                if (!targetedHouse.contributors) targetedHouse.contributors = [targetedHouse.createdBy];
                if (!targetedHouse.contributors.includes(currentPlayer.id)) {
                  targetedHouse.contributors.push(currentPlayer.id);
                }
              }
            } else {
              const extraTargetCards = (targetCards || []).filter(tc => !targetedHouse.cards.some(hc => hc.id === tc.id));
              
              extraTargetCards.forEach((c: Card) => {
                currentLobby.gameState!.floor = currentLobby.gameState!.floor.filter(fc => fc.id !== c.id);
              });

              targetedHouse.cards.push(selectedCard, ...extraTargetCards);
              targetedHouse.isPukta = checkIfPukta(targetedHouse);
              if (!targetedHouse.contributors) targetedHouse.contributors = [targetedHouse.createdBy];
              if (!targetedHouse.contributors.includes(currentPlayer.id)) {
                targetedHouse.contributors.push(currentPlayer.id);
              }
            }
          }
        } else {
          if (isCallerFirstTurn) {
            const bidVal = currentLobby.gameState.bid?.value;
            if (bidVal !== undefined) {
              const newHouse = {
                id: `house-${Date.now()}`,
                cards: [selectedCard],
                value: bidVal as 9 | 10 | 11 | 12 | 13,
                isPukta: bidVal >= 13,
                createdBy: currentPlayer.id,
                contributors: [currentPlayer.id],
              };
              currentLobby.gameState.houses.push(newHouse);
              playAction = 'BUILD_HOUSE';
              houseValue = bidVal;
            } else {
              currentLobby.gameState.floor.push(selectedCard);
            }
          } else {
            currentLobby.gameState.floor.push(selectedCard);
          }
        }

        currentLobby.hands?.set(currentPlayer.id, hand.filter(c => c.id !== selectedCard.id));

        // Mark first turn completed and deal remaining cards
        dealRemainingCardsIfFirstTurn(currentLobby, currentPlayer.id, playerIndex);

        currentLobby.gameState.currentPlayerIndex = (currentLobby.gameState.currentPlayerIndex + 1) % 4;

        console.log(`[BOT MOVE EXECUTED] Player: ${currentPlayer.id}, Action: ${playAction}, Card: ${selectedCard.rank}${selectedCard.suit}, Targets: [${targetCards.map(c => c.rank + c.suit).join(', ')}], House Value: ${houseValue || 'none'}`);
        await logMove(pool, lobbyCode, currentPlayer.id, playAction, selectedCard, targetCards, houseValue);
        await saveLobby(currentLobby);

        io.to(currentLobby.code).emit('move-executed', {
          playerId: currentPlayer.id,
          username: currentPlayer.id,
          action: playAction,
          card: selectedCard,
          targetCards,
          houseValue,
        });

        io.to(currentLobby.code).emit('game-state', currentLobby.gameState);
        io.to(currentLobby.code).emit('game-updated', {
          lobbyCode: currentLobby.code,
          action: playAction,
          payload: {
            card: selectedCard,
            targetCards: targetCards
          },
          playerId: currentPlayer.id
        });

        await checkRoundEnd(currentLobby);
        await checkAndTriggerBotTurn(currentLobby.code);
      }, 1500);
    }
  }
}


dotenv.config();

const ALLOWED_ORIGIN = process.env.CLIENT_ORIGIN || 'http://localhost:5173';

const app = express();
const server = http.createServer(app);
const io = new SocketIOServer(server, {
  cors: {
    origin: ALLOWED_ORIGIN,
    methods: ['GET', 'POST'],
  },
});

// Verify JWT on Socket.IO handshake — populates socket.data.userId / socket.data.role
io.use((socket, next) => {
  const token = socket.handshake.auth?.token as string | undefined;
  if (!token) return next(new Error('Authentication required'));
  const payload = verifyToken(token);
  if (!payload) return next(new Error('Invalid or expired token'));
  socket.data.userId = payload.userId;
  socket.data.role = payload.role;
  next();
});

app.use(cors({ origin: ALLOWED_ORIGIN }));
app.use(express.json());

async function proceedToBidding(lobbyCode: string) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const lockRes = await client.query('SELECT 1 FROM lobbies WHERE code = $1 FOR UPDATE', [lobbyCode]);
    if (lockRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return;
    }
    const lobby = await loadLobby(lobbyCode, client);
    if (!lobby || !lobby.gameState || lobby.gameState.gamePhase !== 'toss') {
      await client.query('ROLLBACK');
      return;
    }

    lobby.gameState.gamePhase = 'bidding';
    await saveLobby(lobby, client);
    await client.query('COMMIT');

    io.to(lobbyCode).emit('game-state', lobby.gameState);

    const gameState = lobby.gameState!;
    const hands = lobby.hands!;

    // Deal first 4 cards to all players
    lobby.players.forEach((p, i) => {
      const hand = hands.get(p.id) || [];
      const visibleHand = hand.slice(0, 4);
      const visibleFloor = gameState.floor.map(c => ({ ...c, faceDown: true }));
      io.to(p.socketId).emit('deal-cards', {
        lobbyCode,
        floor: visibleFloor,
        hand: visibleHand,
        playerIndex: i,
        biddingPlayerIndex: 0,
      });
    });

    // If dealer (player 0) is a bot, trigger their bidding choice
    await checkAndTriggerBotTurn(lobbyCode);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error proceeding to bidding:', err);
  } finally {
    client.release();
  }
}

async function logMove(
  client: any,
  lobbyCode: string,
  playerId: string,
  actionType: string,
  cardPlayed: Card,
  targetCards: Card[],
  houseValue?: number
) {
  try {
    await client.query(
      `INSERT INTO game_moves (lobby_code, player_id, action_type, card_played, target_cards, house_value)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        lobbyCode,
        playerId,
        actionType,
        JSON.stringify(cardPlayed),
        JSON.stringify(targetCards),
        houseValue || null,
      ]
    );
  } catch (err) {
    console.error('Error logging move to DB:', err);
  }
}

// Socket.io connection handling
io.on('connection', (socket: Socket) => {
  console.log(`Player connected: ${socket.id}`);

  // Create lobby
  socket.on('create-lobby', async ({ isPrivate }: { isPrivate: boolean }) => {
    const userId = socket.data.userId as string;
    const code = randomBytes(3).toString('hex').toUpperCase();

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      await client.query(
        'INSERT INTO lobbies (code, is_private, status, creator_id) VALUES ($1, $2, $3, $4)',
        [code, isPrivate || false, 'waiting', userId]
      );

      // Create lobby player (creator is first player: seat = 1, team = 1)
      await client.query(
        'INSERT INTO lobby_players (lobby_code, user_id, socket_id, team, seat) VALUES ($1, $2, $3, $4, $5)',
        [code, userId, socket.id, 1, 1]
      );

      await client.query('COMMIT');

      socket.join(code);
      console.log(`[LOBBY CREATED] ${code} by ${userId} (private: ${!!isPrivate})`);
      socket.emit('lobby-created', { code, isPrivate });
      socket.emit('lobby-state', { players: [userId] });
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('Error creating lobby:', err);
      socket.emit('error-message', { message: 'Failed to create lobby' });
    } finally {
      client.release();
    }
  });

  // Join lobby
  socket.on('join-lobby', async ({ lobbyCode }: { lobbyCode: string }) => {
    const userId = socket.data.userId as string;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Lock the lobby row for update
      const lobbyRes = await client.query(
        'SELECT status FROM lobbies WHERE code = $1 FOR UPDATE',
        [lobbyCode]
      );

      if (lobbyRes.rows.length === 0) {
        socket.emit('error-message', { message: 'Lobby not found' });
        await client.query('ROLLBACK');
        return;
      }

      const status = lobbyRes.rows[0].status;
      if (status !== 'waiting') {
        socket.emit('error-message', { message: 'Game already in progress' });
        await client.query('ROLLBACK');
        return;
      }

      // Check current players count and details
      const playersRes = await client.query(
        'SELECT user_id, team, seat FROM lobby_players WHERE lobby_code = $1 FOR UPDATE',
        [lobbyCode]
      );

      const playersCount = playersRes.rows.length;
      if (playersCount >= 4) {
        socket.emit('error-message', { message: 'Lobby is full' });
        await client.query('ROLLBACK');
        return;
      }

      if (playersRes.rows.some(r => r.user_id === userId)) {
        socket.emit('error-message', { message: 'Already in lobby' });
        await client.query('ROLLBACK');
        return;
      }

      // Find the first unoccupied seat (1 to 4)
      const occupiedSeats = playersRes.rows.map(r => r.seat);
      let seat = 1;
      for (let s = 1; s <= 4; s++) {
        if (!occupiedSeats.includes(s)) {
          seat = s;
          break;
        }
      }
      const team = (seat === 1 || seat === 3) ? 1 : 2;

      await client.query(
        'INSERT INTO lobby_players (lobby_code, user_id, socket_id, team, seat) VALUES ($1, $2, $3, $4, $5)',
        [lobbyCode, userId, socket.id, team, seat]
      );

      await client.query('COMMIT');

      socket.join(lobbyCode);
      console.log(`[LOBBY JOINED] ${lobbyCode}: ${userId} took seat ${seat} (team ${team})`);

      // Load updated lobby to broadcast state
      const updatedLobby = await loadLobby(lobbyCode);
      if (updatedLobby) {
        io.to(lobbyCode).emit('player-joined', { userId });
        io.to(lobbyCode).emit('lobby-state', {
          players: updatedLobby.players.map(p => p.id),
          playerDetails: updatedLobby.players.map(p => ({ id: p.id, team: p.team, seat: p.seat })),
          teamNames: updatedLobby.teamNames,
        });
      }
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('Error joining lobby:', err);
      socket.emit('error-message', { message: 'Failed to join lobby' });
    } finally {
      client.release();
    }
  });

  // Add dummy player (bot) to lobby
  socket.on('add-bot', async ({ lobbyCode }: { lobbyCode: string }) => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const lobbyRes = await client.query(
        'SELECT status FROM lobbies WHERE code = $1 FOR UPDATE',
        [lobbyCode]
      );

      if (lobbyRes.rows.length === 0) {
        socket.emit('error-message', { message: 'Lobby not found' });
        await client.query('ROLLBACK');
        return;
      }

      const status = lobbyRes.rows[0].status;
      if (status !== 'waiting') {
        socket.emit('error-message', { message: 'Game already in progress' });
        await client.query('ROLLBACK');
        return;
      }

      const playersRes = await client.query(
        'SELECT user_id, team, seat FROM lobby_players WHERE lobby_code = $1 FOR UPDATE',
        [lobbyCode]
      );

      const playersCount = playersRes.rows.length;
      if (playersCount >= 4) {
        socket.emit('error-message', { message: 'Lobby is full' });
        await client.query('ROLLBACK');
        return;
      }

      const botNum = playersRes.rows.filter(r => r.user_id.startsWith('Bot_')).length + 1;
      const botId = `Bot_${botNum}`;

      // Find the first unoccupied seat (1 to 4)
      const occupiedSeats = playersRes.rows.map(r => r.seat);
      let seat = 1;
      for (let s = 1; s <= 4; s++) {
        if (!occupiedSeats.includes(s)) {
          seat = s;
          break;
        }
      }
      const team = (seat === 1 || seat === 3) ? 1 : 2;

      await client.query(
        'INSERT INTO lobby_players (lobby_code, user_id, socket_id, team, seat) VALUES ($1, $2, $3, $4, $5)',
        [lobbyCode, botId, `socket-Bot_${botId}-${lobbyCode}`, team, seat]
      );

      await client.query('COMMIT');

      const updatedLobby = await loadLobby(lobbyCode);
      if (updatedLobby) {
        io.to(lobbyCode).emit('player-joined', { userId: botId });
        io.to(lobbyCode).emit('lobby-state', {
          players: updatedLobby.players.map(p => p.id),
          playerDetails: updatedLobby.players.map(p => ({ id: p.id, team: p.team, seat: p.seat })),
          teamNames: updatedLobby.teamNames,
        });
      }
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('Error adding bot:', err);
      socket.emit('error-message', { message: 'Failed to add bot' });
    } finally {
      client.release();
    }
  });

  // Host can reassign players to teams and rename teams
  socket.on('set-teams', async ({ lobbyCode, assignments, teamNames }: {
    lobbyCode: string;
    assignments: { userId: string; team: 1 | 2 }[];
    teamNames: { team1: string; team2: string };
  }) => {
    const userId = socket.data.userId as string;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Verify caller is host (first player in lobby)
      const hostRes = await client.query(
        'SELECT user_id FROM lobby_players WHERE lobby_code = $1 ORDER BY joined_at ASC LIMIT 1',
        [lobbyCode]
      );
      if (!hostRes.rows.length || hostRes.rows[0].user_id !== userId) {
        socket.emit('error-message', { message: 'Only the host can assign teams' });
        await client.query('ROLLBACK');
        return;
      }

      // Validate: exactly 2 players per team
      const t1 = assignments.filter(a => a.team === 1);
      const t2 = assignments.filter(a => a.team === 2);
      if (t1.length !== 2 || t2.length !== 2) {
        socket.emit('error-message', { message: 'Each team must have exactly 2 players' });
        await client.query('ROLLBACK');
        return;
      }

      // Update each player's team
      for (const { userId: pid, team } of assignments) {
        await client.query(
          'UPDATE lobby_players SET team = $1 WHERE lobby_code = $2 AND user_id = $3',
          [team, lobbyCode, pid]
        );
      }

      // Save team names on lobby
      await client.query(
        'UPDATE lobbies SET team_names = $1 WHERE code = $2',
        [JSON.stringify(teamNames), lobbyCode]
      );

      await client.query('COMMIT');

      const updatedLobby = await loadLobby(lobbyCode);
      if (updatedLobby) {
        io.to(lobbyCode).emit('teams-updated', {
          players: updatedLobby.players.map(p => ({ id: p.id, team: p.team, seat: p.seat })),
          teamNames,
        });
      }
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('Error in set-teams:', err);
      socket.emit('error-message', { message: 'Failed to update teams' });
    } finally {
      client.release();
    }
  });
  // Losing team selects the next round's dealer
  socket.on('select-dealer', async ({ lobbyCode, dealerId }: { lobbyCode: string; dealerId: string }) => {
    const userId = socket.data.userId as string;
    try {
      const lobby = await loadLobby(lobbyCode);
      if (!lobby?.gameState || lobby.gameState.gamePhase !== 'roundEnd') {
        socket.emit('error-message', { message: 'Not in dealer selection phase' });
        return;
      }
      const selectionTeam = lobby.gameState.dealerSelectionTeam;
      const pickerPlayer = lobby.players.find(p => p.id === userId);
      const chosenPlayer = lobby.players.find(p => p.id === dealerId);
      if (!pickerPlayer || pickerPlayer.team !== selectionTeam) {
        socket.emit('error-message', { message: 'Only the losing team can select the dealer' });
        return;
      }
      if (!chosenPlayer || chosenPlayer.team !== selectionTeam) {
        socket.emit('error-message', { message: 'Dealer must be from the losing team' });
        return;
      }
      const dealerIdx = lobby.players.findIndex(p => p.id === dealerId);
      await startNextRound(lobbyCode, dealerIdx);
    } catch (err) {
      console.error('Error in select-dealer:', err);
    }
  });

  // Sync game and deal cards on request (avoids mounting race condition)
  socket.on('request-deal', async ({ lobbyCode }: { lobbyCode: string }) => {
    const userId = socket.data.userId as string;
    try {
      const lobby = await loadLobby(lobbyCode);
      if (!lobby || !lobby.gameState || !lobby.hands) return;

      const playerIndex = lobby.players.findIndex(p => p.id === userId);
      if (playerIndex === -1) return;

      const hand = lobby.hands.get(userId) || [];
      let visibleHand = hand;
      if (playerIndex !== 0) {
        if (lobby.gameState.gamePhase === 'toss' || lobby.gameState.gamePhase === 'bidding') {
          visibleHand = hand.slice(0, 4);
        } else {
          const hasCompletedFirstTurn = lobby.gameState.firstTurnCompleted.includes(userId);
          if (!hasCompletedFirstTurn) {
            visibleHand = hand.slice(0, 4);
          }
        }
      }

      let visibleFloor = lobby.gameState.floor;
      if (lobby.gameState.gamePhase === 'toss' || lobby.gameState.gamePhase === 'bidding') {
        visibleFloor = lobby.gameState.floor.map(c => ({ ...c, faceDown: true }));
      }

      socket.emit('deal-cards', {
        lobbyCode,
        floor: visibleFloor,
        hand: visibleHand,
        playerIndex,
        biddingPlayerIndex: 0,
      });

      socket.emit('game-state', lobby.gameState);

      await checkAndTriggerBotTurn(lobbyCode);
    } catch (err) {
      console.error('Error on request-deal:', err);
    }
  });

  // Start game
  socket.on('start-game', async ({ lobbyCode }: { lobbyCode: string }) => {
    const userId = socket.data.userId as string;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const lockRes = await client.query('SELECT 1 FROM lobbies WHERE code = $1 FOR UPDATE', [lobbyCode]);
      if (lockRes.rows.length === 0) {
        await client.query('ROLLBACK');
        return;
      }

      const lobby = await loadLobby(lobbyCode, client);
      if (lobby && lobby.players.length === 4 && lobby.players.some(p => p.id === userId)) {
        
        // 1. Perform the Jack Toss
        const tossDeck = shuffle(createDeck());
        const tossHistory: { playerId: string; card: Card }[] = [];
        let tossWinnerId = '';
        let deckIdx = 0;
        
        while (!tossWinnerId && deckIdx < tossDeck.length) {
          for (let i = 0; i < lobby.players.length; i++) {
            const card = tossDeck[deckIdx++];
            tossHistory.push({ playerId: lobby.players[i].id, card });
            if (card.rank === 'J') {
              tossWinnerId = lobby.players[i].id;
              break;
            }
          }
        }

        // 2. Rotate players so that toss winner has seat = 1 (player index 0)
        const winnerIndex = lobby.players.findIndex(p => p.id === tossWinnerId);
        if (winnerIndex !== -1) {
          const rotatedPlayers = [...lobby.players.slice(winnerIndex), ...lobby.players.slice(0, winnerIndex)];
          // Atomically delete and re-insert to bypass unique primary key and seat range check constraints
          await client.query('DELETE FROM lobby_players WHERE lobby_code = $1', [lobbyCode]);
          for (let i = 0; i < rotatedPlayers.length; i++) {
            const p = rotatedPlayers[i];
            const team = p.team ?? ((i === 0 || i === 2) ? 1 : 2);
            await client.query(
              'INSERT INTO lobby_players (lobby_code, user_id, socket_id, team, seat) VALUES ($1, $2, $3, $4, $5)',
              [lobbyCode, p.id, p.socketId, team, i + 1]
            );
            p.team = team;
            p.seat = i + 1;
          }
          lobby.players = rotatedPlayers;
        }

        lobby.status = 'bidding';

        // 3. Deal cards (initial deal: floor gets 4, player 0 gets 12, others get 4)
        const deck = shuffle(createDeck());
        const floorCards = deck.slice(0, 4);
        
        const hand0 = deck.slice(4, 16);  // caller gets 12
        const hand1 = deck.slice(16, 20); // others get 4
        const hand2 = deck.slice(20, 24);
        const hand3 = deck.slice(24, 28);
        const remainingDeck = deck.slice(28, 52);

        lobby.hands = new Map();
        lobby.hands.set(lobby.players[0].id, hand0);
        lobby.hands.set(lobby.players[1].id, hand1);
        lobby.hands.set(lobby.players[2].id, hand2);
        lobby.hands.set(lobby.players[3].id, hand3);

        const hasCardGe9 = hand0.some(c => {
          const val = getCardNumericValue(c);
          return val >= 9 && val <= 13;
        });

        lobby.gameState = {
          lobbyCode,
          floor: floorCards,
          houses: [],
          currentPlayerIndex: 0,
          roundNumber: 1,
          teamScores: { team1: 0, team2: 0 },
          capturedCards: { team1: [], team2: [] },
          seepCount: { team1: 0, team2: 0 },
          gamePhase: 'toss',
          bid: undefined,
          lastCaptureTeam: undefined,
          firstTurnCompleted: [],
          tossWinner: tossWinnerId,
          tossHistory,
          handSizes: {},
          players: lobby.players.map(p => ({
            id: p.id,
            username: p.username || p.id,
            team: p.team,
            seat: p.seat || 1,
          })),
          deck: remainingDeck,
          askAbove8: !hasCardGe9,
        };

        await saveLobby(lobby, client);
        await client.query('COMMIT');

        io.to(lobbyCode).emit('game-started', { lobbyCode });
        io.to(lobbyCode).emit('game-state', lobby.gameState);

        // Automatically proceed to bidding after 5 seconds to show toss deals in UI
        setTimeout(async () => {
          await proceedToBidding(lobbyCode);
        }, 5000);

      } else {
        await client.query('ROLLBACK');
        socket.emit('error-message', { message: 'Need 4 players to start' });
      }
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('Error starting game:', err);
      socket.emit('error-message', { message: 'Failed to start game' });
    } finally {
      client.release();
    }
  });

  // Place bid
  socket.on('place-bid', async ({ lobbyCode, bid, cardId }: {
    lobbyCode: string;
    bid: number;
    cardId: string;
  }) => {
    const playerId = socket.data.userId as string;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const lockRes = await client.query('SELECT 1 FROM lobbies WHERE code = $1 FOR UPDATE', [lobbyCode]);
      if (lockRes.rows.length === 0) {
        await client.query('ROLLBACK');
        return;
      }

      const lobby = await loadLobby(lobbyCode, client);
      if (!lobby?.gameState || !lobby.hands) {
        await client.query('ROLLBACK');
        return;
      }

      const biddingPlayer = lobby.players[0];
      if (biddingPlayer?.id !== playerId) {
        socket.emit('error-message', { message: 'Not your turn to bid' });
        await client.query('ROLLBACK');
        return;
      }

      const hand = lobby.hands.get(playerId) || [];
      const hasCard = hand.some(c => c.id === cardId);

      if (!hasCard) {
        socket.emit('error-message', { message: 'Invalid bid card' });
        await client.query('ROLLBACK');
        return;
      }

      lobby.gameState.bid = { playerId, value: bid, fulfilled: false };
      lobby.gameState.gamePhase = 'playing';

      const bidCard = lobby.hands.get(playerId)!.find(c => c.id === cardId)!;
      await logMove(client, lobbyCode, playerId, 'BID', bidCard, [], bid);

      await saveLobby(lobby, client);
      await client.query('COMMIT');

      console.log(`[BID PLACED] Lobby ${lobbyCode}: ${playerId} called ${bid} with ${bidCard.rank}${bidCard.suit}`);
      io.to(lobbyCode).emit('bid-placed', { bid, playerId });
      io.to(lobbyCode).emit('game-state', lobby.gameState);

      let username = playerId;
      if (!playerId.startsWith('Bot_')) {
        const userRes = await client.query('SELECT username FROM users WHERE id = $1', [playerId]);
        if (userRes.rows.length > 0) {
          username = userRes.rows[0].username;
        }
      }
      io.to(lobbyCode).emit('move-executed', {
        playerId,
        username,
        action: 'BID',
        card: bidCard,
        targetCards: [],
        houseValue: bid,
      });
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
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('Error placing bid:', err);
    } finally {
      client.release();
    }
  });

  // Respond to dealer query about above 8 cards
  socket.on('respond-above-8', async ({ lobbyCode, answer }: { lobbyCode: string; answer: boolean }) => {
    const playerId = socket.data.userId as string;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const lockRes = await client.query('SELECT 1 FROM lobbies WHERE code = $1 FOR UPDATE', [lobbyCode]);
      if (lockRes.rows.length === 0) {
        await client.query('ROLLBACK');
        return;
      }

      const lobby = await loadLobby(lobbyCode, client);
      if (!lobby?.gameState || !lobby.hands) {
        await client.query('ROLLBACK');
        return;
      }

      const callerPlayer = lobby.players[0];
      if (callerPlayer?.id !== playerId) {
        socket.emit('error-message', { message: 'Only the caller can answer this' });
        await client.query('ROLLBACK');
        return;
      }

      const hand = lobby.hands.get(playerId) || [];
      const hasAbove8 = hand.slice(0, 4).some(c => getCardNumericValue(c) > 8);

      if (answer === false) {
        if (hasAbove8) {
          socket.emit('error-message', { message: 'Verification failed: You do have a card above 8 in your hand!' });
          await client.query('ROLLBACK');
          return;
        } else {
          let currentDeck = lobby.gameState.deck || [];
          if (currentDeck.length < 4) {
            currentDeck = shuffle(createDeck());
          }

          const old4 = hand.slice(0, 4);
          const new4 = currentDeck.slice(0, 4);
          const remainingDeck = shuffle([...currentDeck.slice(4), ...old4]);
          const updatedHand = [...new4, ...hand.slice(4)];
          
          lobby.hands.set(playerId, updatedHand);
          lobby.gameState.deck = remainingDeck;

          const newHasAbove8 = new4.some(c => getCardNumericValue(c) > 8);
          if (!newHasAbove8) {
            lobby.gameState.askAbove8 = true;
            io.to(lobbyCode).emit('toast-message', { message: 'Caller had no cards above 8. Dealer dealt 4 new cards.' });
          } else {
            lobby.gameState.askAbove8 = false;
            io.to(lobbyCode).emit('toast-message', { message: 'Dealer verified caller now has a card above 8. Proceeding to bid!' });
          }

          await saveLobby(lobby, client);
          await client.query('COMMIT');

          io.to(callerPlayer.socketId).emit('deal-cards', {
            lobbyCode,
            floor: lobby.gameState.floor,
            hand: updatedHand.slice(0, 4),
            playerIndex: 0,
            biddingPlayerIndex: 0,
          });

          io.to(lobbyCode).emit('game-state', lobby.gameState);
        }
      } else {
        if (hasAbove8) {
          lobby.gameState.askAbove8 = false;
          await saveLobby(lobby, client);
          await client.query('COMMIT');
          io.to(lobbyCode).emit('game-state', lobby.gameState);
        } else {
          let currentDeck = lobby.gameState.deck || [];
          if (currentDeck.length < 4) {
            currentDeck = shuffle(createDeck());
          }

          const old4 = hand.slice(0, 4);
          const new4 = currentDeck.slice(0, 4);
          const remainingDeck = shuffle([...currentDeck.slice(4), ...old4]);
          const updatedHand = [...new4, ...hand.slice(4)];
          
          lobby.hands.set(playerId, updatedHand);
          lobby.gameState.deck = remainingDeck;

          const newHasAbove8 = new4.some(c => getCardNumericValue(c) > 8);
          if (!newHasAbove8) {
            lobby.gameState.askAbove8 = true;
          } else {
            lobby.gameState.askAbove8 = false;
          }

          await saveLobby(lobby, client);
          await client.query('COMMIT');

          io.to(lobbyCode).emit('toast-message', { 
            message: 'Verification Alert: Caller lied! They had no cards above 8. Dealer dealt 4 new cards.' 
          });

          io.to(callerPlayer.socketId).emit('deal-cards', {
            lobbyCode,
            floor: lobby.gameState.floor,
            hand: updatedHand.slice(0, 4),
            playerIndex: 0,
            biddingPlayerIndex: 0,
          });

          io.to(lobbyCode).emit('game-state', lobby.gameState);
        }
      }
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('Error in respond-above-8:', err);
    } finally {
      client.release();
    }
  });

  // Handle game actions
  socket.on('game-action', async (data: { lobbyCode: string; action: string; payload: { card: Card; targetCards: Card[]; houseValue?: number } }) => {
    const playerId = socket.data.userId as string;
    const lobbyCode = data.lobbyCode;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const lockRes = await client.query('SELECT 1 FROM lobbies WHERE code = $1 FOR UPDATE', [lobbyCode]);
      if (lockRes.rows.length === 0) {
        await client.query('ROLLBACK');
        return;
      }

      const lobby = await loadLobby(lobbyCode, client);
      if (!lobby?.gameState || !lobby.hands) {
        await client.query('ROLLBACK');
        return;
      }

      const { action, payload } = data;
      let actionType = action;
      const card = payload.card;
      let targetCards = payload.targetCards || [];
      const houseValue = payload?.houseValue;

      // Force capture and Seep if only one matching card or house is left on the table
      const floorCount = lobby.gameState.floor.length;
      const houseCount = lobby.gameState.houses.length;
      const playedValue = getCardNumericValue(card);

      if (floorCount === 1 && houseCount === 0) {
        const looseCard = lobby.gameState.floor[0];
        if (getCardNumericValue(looseCard) === playedValue) {
          actionType = 'CAPTURE';
          data.action = 'CAPTURE';
          targetCards = [looseCard];
          payload.targetCards = [looseCard];
        }
      } else if (floorCount === 0 && houseCount === 1) {
        const onlyHouse = lobby.gameState.houses[0];
        if (onlyHouse.value === playedValue) {
          actionType = 'CAPTURE';
          data.action = 'CAPTURE';
          targetCards = [...onlyHouse.cards];
          payload.targetCards = [...onlyHouse.cards];
        }
      }

      // Enforce turn order
      const currentPlayer = lobby.players[lobby.gameState.currentPlayerIndex];
      if (currentPlayer?.id !== playerId) {
        socket.emit('error-message', { message: 'Not your turn' });
        await client.query('ROLLBACK');
        return;
      }

      // Verify the played card is actually in the player's visible hand
      const hand = lobby.hands.get(playerId) || [];
      const hasCompletedFirstTurn = lobby.gameState.firstTurnCompleted.includes(playerId);
      const playerIndex = lobby.players.findIndex(p => p.id === playerId);
      const visibleHand = (playerIndex === 0 || hasCompletedFirstTurn) ? hand : hand.slice(0, 4);

      if (!visibleHand.some(c => c.id === card.id)) {
        socket.emit('error-message', { message: 'Card not in hand' });
        await client.query('ROLLBACK');
        return;
      }

      // Drop any client-supplied target cards that don't actually exist on the
      // floor or in an active house — otherwise a client could fabricate cards
      // that happen to sum correctly and capture points that were never on the table.
      const realCardIds = new Set<string>([
        ...lobby.gameState.floor.map(c => c.id),
        ...lobby.gameState.houses.flatMap(h => h.cards.map(c => c.id)),
      ]);
      targetCards = targetCards.filter(tc => realCardIds.has(tc.id));
      payload.targetCards = targetCards;

      // Restriction: Restrict caller's first action to the called house value
      const isCallerFirstTurn = (playerIndex === 0 && !lobby.gameState.firstTurnCompleted.includes(playerId));
      if (isCallerFirstTurn) {
        const bidVal = lobby.gameState.bid?.value;
        if (bidVal !== undefined) {
          if (actionType === 'THROW') {
            if (getCardNumericValue(card) !== bidVal) {
              socket.emit('error-message', { message: `If you throw on your first turn, it must be the called card value (${bidVal})` });
              await client.query('ROLLBACK');
              return;
            }
          } else if (actionType === 'CAPTURE') {
            if (getCardNumericValue(card) !== bidVal) {
              socket.emit('error-message', { message: `Your first capture must be with a card of the bid value (${bidVal})` });
              await client.query('ROLLBACK');
              return;
            }
          } else if (actionType === 'BUILD_HOUSE') {
            const buildVal = payload.houseValue;
            if (buildVal !== bidVal) {
              socket.emit('error-message', { message: `Your first house build must be of the bid value (${bidVal})` });
              await client.query('ROLLBACK');
              return;
            }
          }
        }
      }

      let isValidCapture = true;
      let matchingHouses: House[] = [];
      let nonMatchingHouses: House[] = [];
      let validationFailureReason = '';

      if (actionType === 'CAPTURE') {
        const cardValue = getCardNumericValue(card);
        matchingHouses = lobby.gameState.houses.filter(h => h.value === cardValue);
        nonMatchingHouses = lobby.gameState.houses.filter(h => h.value !== cardValue);

        if (targetCards && targetCards.length > 0) {
          if (!canSumTo(cardValue, targetCards)) {
            isValidCapture = false;
            validationFailureReason = 'Target floor cards do not sum to played card value';
          }
        } else if (matchingHouses.length === 0) {
          isValidCapture = false;
          validationFailureReason = 'No matching houses on floor and no target floor cards selected';
        }

        if (!isValidCapture) {
          console.warn(`[VALIDATION FAILED] CAPTURE by ${playerId} with card ${card.rank}${card.suit} failed: ${validationFailureReason}. Falling back to THROW.`);
          actionType = 'THROW';
          targetCards = [];
        }
      }

      let isValidBuild = true;
      let targetedHouseIndex = -1;
      let isDistortion = false;
      const initialHouseValue = houseValue;

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

      if (actionType === 'CAPTURE') {
        const cardValue = getCardNumericValue(card);
        const capturedHouseCards: Card[] = [];
        matchingHouses.forEach(h => {
          capturedHouseCards.push(...h.cards);
        });
        lobby.gameState.houses = nonMatchingHouses;

        if (targetCards && targetCards.length > 0) {
          (targetCards || []).forEach((c: Card) => {
            lobby.gameState!.floor = lobby.gameState!.floor.filter(fc => fc.id !== c.id);
          });
        }

        const team = currentPlayer.team === 1 ? 'team1' : 'team2';
        const captured = [card, ...capturedHouseCards, ...(targetCards || [])];
        lobby.gameState.capturedCards[team].push(...captured);
        lobby.gameState.lastCaptureTeam = currentPlayer.team === 2 ? 2 : 1;

        const isSeep = lobby.gameState.floor.length === 0 && lobby.gameState.houses.length === 0 && hand.length > 1;
        if (isSeep) {
          lobby.gameState.seepCount[team] += 1;
          if (lobby.gameState.seepCount[team] >= 3) {
            lobby.gameState.seepCount[team] = 0;
          }
          console.log(`[SEEP] Lobby ${lobbyCode}: ${playerId} (team ${currentPlayer.team}) cleared the table`);
          io.to(lobbyCode).emit('seep-executed', { playerId });
        }

        lobby.hands.set(playerId, hand.filter(c => c.id !== card.id));
        dealRemainingCardsIfFirstTurn(lobby, playerId, playerIndex, socket);
        lobby.gameState.currentPlayerIndex = (lobby.gameState.currentPlayerIndex + 1) % 4;
        io.to(lobbyCode).emit('game-state', lobby.gameState);
      } else if (actionType === 'THROW') {
        const isCallerFirstTurn = (playerIndex === 0 && !hasCompletedFirstTurn);
        if (isCallerFirstTurn) {
          const bidVal = lobby.gameState.bid?.value;
          if (bidVal !== undefined) {
            const newHouse = {
              id: `house-${Date.now()}`,
              cards: [card],
              value: bidVal as 9 | 10 | 11 | 12 | 13,
              isPukta: bidVal >= 13,
              createdBy: playerId,
              contributors: [playerId],
            };
            lobby.gameState.houses.push(newHouse);
            actionType = 'BUILD_HOUSE';
            data.action = 'BUILD_HOUSE';
          } else {
            lobby.gameState.floor.push(card);
          }
        } else {
          lobby.gameState.floor.push(card);
        }

        lobby.hands.set(playerId, hand.filter(c => c.id !== card.id));
        dealRemainingCardsIfFirstTurn(lobby, playerId, playerIndex, socket);
        lobby.gameState.currentPlayerIndex = (lobby.gameState.currentPlayerIndex + 1) % 4;
        io.to(lobbyCode).emit('game-state', lobby.gameState);
      } else if (actionType === 'BUILD_HOUSE') {
        const houseValue = initialHouseValue as number;
        if (targetedHouseIndex === -1) {
          const existingHouse = lobby.gameState.houses.find(h => h.value === houseValue);

          (targetCards || []).forEach((c: Card) => {
            lobby.gameState!.floor = lobby.gameState!.floor.filter(fc => fc.id !== c.id);
          });

          if (existingHouse) {
            existingHouse.cards.push(card, ...(targetCards || []));
            existingHouse.isPukta = checkIfPukta(existingHouse);
            const contributors = existingHouse.contributors || [existingHouse.createdBy];
            if (!contributors.includes(playerId)) {
              contributors.push(playerId);
            }
            existingHouse.contributors = contributors;
          } else {
            const newHouse = {
              id: `house-${Date.now()}`,
              cards: [card, ...(targetCards || [])],
              value: houseValue as 9 | 10 | 11 | 12 | 13,
              isPukta: houseValue >= 13,
              createdBy: playerId,
              contributors: [playerId],
            };
            lobby.gameState.houses.push(newHouse);
          }
        } else {
          const targetedHouseObj = lobby.gameState.houses[targetedHouseIndex];
          if (isDistortion) {
            const existingHouse = lobby.gameState.houses.find(h => h.value === houseValue && h.id !== targetedHouseObj.id);
            const extraTargetCards = (targetCards || []).filter(tc => !targetedHouseObj.cards.some(hc => hc.id === tc.id));

            extraTargetCards.forEach((c: Card) => {
              lobby.gameState!.floor = lobby.gameState!.floor.filter(fc => fc.id !== c.id);
            });

            if (existingHouse) {
              existingHouse.cards.push(...targetedHouseObj.cards, card, ...extraTargetCards);
              existingHouse.isPukta = checkIfPukta(existingHouse);
              const contributors = existingHouse.contributors || [existingHouse.createdBy];
              const oldContributors = targetedHouseObj.contributors || [targetedHouseObj.createdBy];
              oldContributors.forEach(cid => {
                if (!contributors.includes(cid)) contributors.push(cid);
              });
              if (!contributors.includes(playerId)) {
                contributors.push(playerId);
              }
              existingHouse.contributors = contributors;
              lobby.gameState.houses = lobby.gameState.houses.filter(h => h.id !== targetedHouseObj.id);
            } else {
              targetedHouseObj.value = houseValue as 9 | 10 | 11 | 12 | 13;
              targetedHouseObj.cards.push(card, ...extraTargetCards);
              targetedHouseObj.createdBy = playerId;
              targetedHouseObj.isPukta = checkIfPukta(targetedHouseObj);
              const contributors = targetedHouseObj.contributors || [targetedHouseObj.createdBy];
              if (!contributors.includes(playerId)) {
                contributors.push(playerId);
              }
              targetedHouseObj.contributors = contributors;
            }
          } else {
            const extraTargetCards = (targetCards || []).filter(tc => !targetedHouseObj.cards.some(hc => hc.id === tc.id));

            extraTargetCards.forEach((c: Card) => {
              lobby.gameState!.floor = lobby.gameState!.floor.filter(fc => fc.id !== c.id);
            });

            targetedHouseObj.cards.push(card, ...extraTargetCards);
            targetedHouseObj.isPukta = checkIfPukta(targetedHouseObj);
            const contributors = targetedHouseObj.contributors || [targetedHouseObj.createdBy];
            if (!contributors.includes(playerId)) {
              contributors.push(playerId);
            }
            targetedHouseObj.contributors = contributors;
          }
        }

        lobby.hands.set(playerId, hand.filter(c => c.id !== card.id));
        dealRemainingCardsIfFirstTurn(lobby, playerId, playerIndex, socket);
        lobby.gameState.currentPlayerIndex = (lobby.gameState.currentPlayerIndex + 1) % 4;
        io.to(lobbyCode).emit('game-state', lobby.gameState);
      }

      await logMove(client, lobbyCode, playerId, actionType, card, targetCards, houseValue);
      await saveLobby(lobby, client);
      await client.query('COMMIT');

      let username = playerId;
      if (!playerId.startsWith('Bot_')) {
        const userRes = await client.query('SELECT username FROM users WHERE id = $1', [playerId]);
        if (userRes.rows.length > 0) {
          username = userRes.rows[0].username;
        }
      }
      console.log(`[MOVE EXECUTED] Player: ${playerId} (${username}), Original: ${action}, Executed: ${actionType}, Card: ${card.rank}${card.suit}, Targets: [${targetCards.map(c => c.rank + c.suit).join(', ')}], House Value: ${houseValue || 'none'}`);

      io.to(lobbyCode).emit('move-executed', {
        playerId,
        username,
        action: actionType,
        card,
        targetCards,
        houseValue,
      });

      socket.to(lobbyCode).emit('game-updated', { ...data, playerId });

      await checkRoundEnd(lobby);
      await checkAndTriggerBotTurn(lobbyCode);
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('Error during game action:', err);
    } finally {
      client.release();
    }
  });

  // Disconnect
  socket.on('disconnect', async () => {
    console.log(`Player disconnected: ${socket.id}`);
    try {
      const res = await pool.query(
        'SELECT lobby_code, user_id FROM lobby_players WHERE socket_id = $1',
        [socket.id]
      );
      if (res.rows.length > 0) {
        const { lobby_code: lobbyCode, user_id: userId } = res.rows[0];

        // Delete player from lobby_players
        await pool.query(
          'DELETE FROM lobby_players WHERE lobby_code = $1 AND user_id = $2',
          [lobbyCode, userId]
        );

        // Load lobby to see if it is empty
        const lobby = await loadLobby(lobbyCode);
        if (lobby) {
          if (lobby.players.length === 0) {
            // Delete lobby
            await pool.query('DELETE FROM lobbies WHERE code = $1', [lobbyCode]);
          } else {
            io.to(lobbyCode).emit('player-left', {
              players: lobby.players.map(p => p.id)
            });
          }
        }
      }
    } catch (err) {
      console.error('Error on disconnect:', err);
    }
  });
});

// Auth routes
app.use('/api/auth', authRoutes);

// Protected routes middleware
function authMiddleware(requiredRole: 'admin' | 'player' | 'spectator') {
  return (req: any, res: any, next: any) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const token = authHeader.split(' ')[1];
    const payload = verifyToken(token);

    if (!payload) {
      return res.status(401).json({ error: 'Invalid token' });
    }

    if (!hasPermission(payload.role, requiredRole)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    req.user = payload;
    next();
  };
}

// Admin-only route: delete lobby
app.delete('/api/lobby/:code', authMiddleware('admin'), async (req, res) => {
  const { code } = req.params;
  try {
    await pool.query('DELETE FROM lobbies WHERE code = $1', [code]);
    io.to(code).emit('lobby-deleted');
    res.json({ message: 'Lobby deleted' });
  } catch (err) {
    console.error('Error deleting lobby:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

// Admin-only route: list all lobbies
app.get('/api/admin/lobbies', authMiddleware('admin'), async (req: any, res: any) => {
  try {
    const result = await pool.query(`
      SELECT l.code, l.is_private as "isPrivate", l.status, array_to_json(array_remove(array_agg(lp.user_id), NULL)) as players
      FROM lobbies l
      LEFT JOIN lobby_players lp ON l.code = lp.lobby_code
      GROUP BY l.code, l.is_private, l.status
    `);
    res.json({ lobbies: result.rows });
  } catch (err) {
    console.error('Error fetching admin lobbies:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

const PORT = process.env.PORT || 3000;
initDatabase().then(() => seedAdminUser()).then(() => {
  server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}).catch(err => {
  console.error('Server failed to start due to database error:', err);
  process.exit(1);
});

export { app, io };