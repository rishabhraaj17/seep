import express from 'express';
import http from 'http';
import { Server as SocketIOServer, Socket } from 'socket.io';
import cors from 'cors';
import dotenv from 'dotenv';
import { randomBytes } from 'crypto';
import authRoutes from './auth/routes.js';
import { generateToken, verifyToken, hasPermission } from './auth/jwt.js';
import { initDatabase, pool } from './db.js';
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
}

interface LobbyState {
  code: string;
  isPrivate: boolean;
  players: { id: string; socketId: string; team: number; seat?: number; username?: string; }[];
  status: 'waiting' | 'bidding' | 'playing' | 'ended';
  gameState?: GameState;
  hands?: Map<string, Card[]>;
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

// Calculate total points for captured cards
function calculatePoints(cards: Card[]): number {
  return cards.reduce((sum, card) => sum + getPointValue(card), 0);
}

function checkIfPukta(house: House): boolean {
  if (house.value >= 13) return true;
  const cardsOfHouseValue = house.cards.filter(c => getCardNumericValue(c) === house.value);
  return cardsOfHouseValue.length >= 2;
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
    'SELECT code, is_private, status FROM lobbies WHERE code = $1',
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
  };

  const gsRes = await db.query(
    'SELECT floor, houses, hands, current_player_index, round_number, team_scores, captured_cards, team_seeps, game_phase, bid, last_capture_team, first_turn_completed, toss_winner, toss_history, hand_sizes FROM game_states WHERE lobby_code = $1',
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
          toss_winner, toss_history, hand_sizes
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
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
  for (const [_, hand] of lobby.hands.entries()) {
    if (hand.length > 0) {
      allEmpty = false;
      break;
    }
  }

  if (allEmpty) {
    // Award remaining floor cards and houses to the team that made the last capture
    const lastTeam = lobby.gameState.lastCaptureTeam === 2 ? 'team2' : 'team1';
    if (lobby.gameState.floor.length > 0) {
      lobby.gameState.capturedCards[lastTeam].push(...lobby.gameState.floor);
      lobby.gameState.floor = [];
    }
    if (lobby.gameState.houses.length > 0) {
      lobby.gameState.houses.forEach(house => {
        lobby.gameState!.capturedCards[lastTeam].push(...house.cards);
      });
      lobby.gameState.houses = [];
    }

    const team1Captures = lobby.gameState.capturedCards.team1;
    const team2Captures = lobby.gameState.capturedCards.team2;

    const team1RoundPoints = calculatePoints(team1Captures);
    const team2RoundPoints = calculatePoints(team2Captures);

    lobby.gameState.teamScores.team1 += team1RoundPoints;
    lobby.gameState.teamScores.team2 += team2RoundPoints;

    // Seep points calculation and cancellation
    const team1Seeps = lobby.gameState.seepCount.team1;
    const team2Seeps = lobby.gameState.seepCount.team2;

    let finalTeam1Seeps = 0;
    let finalTeam2Seeps = 0;
    if (team1Seeps > team2Seeps) {
      finalTeam1Seeps = team1Seeps - team2Seeps;
    } else if (team2Seeps > team1Seeps) {
      finalTeam2Seeps = team2Seeps - team1Seeps;
    }

    lobby.gameState.teamScores.team1 += finalTeam1Seeps * 50;
    lobby.gameState.teamScores.team2 += finalTeam2Seeps * 50;

    // Reset seep counts
    lobby.gameState.seepCount = { team1: 0, team2: 0 };

    if (lobby.gameState.teamScores.team1 >= 100 || lobby.gameState.teamScores.team2 >= 100) {
      lobby.gameState.gamePhase = 'gameEnd';
    } else {
      // Setup next round
      lobby.gameState.roundNumber += 1;
      lobby.gameState.gamePhase = 'bidding';

      let deck: Card[] = [];
      let floorCards: Card[] = [];
      let hands: Card[][] = [];
      let redeal = true;

      while (redeal) {
        deck = shuffle(createDeck());
        let deckIndex = 0;
        floorCards = deck.slice(deckIndex, 4);
        deckIndex += 4;

        hands = [];
        for (let i = 0; i < 4; i++) {
          hands.push(deck.slice(deckIndex, deckIndex + 12));
          deckIndex += 12;
        }

        // Caller (player 0) constraint check on first 4 cards
        const hasCardGe9 = hands[0].slice(0, 4).some(c => {
          const val = getCardNumericValue(c);
          return val >= 9 && val <= 13;
        });
        if (hasCardGe9) {
          redeal = false;
        }
      }

      lobby.hands.clear();
      lobby.players.forEach((p, i) => {
        lobby.hands?.set(p.id, hands[i]);
      });

      lobby.gameState.floor = floorCards;
      lobby.gameState.capturedCards = { team1: [], team2: [] };
      lobby.gameState.bid = undefined;
      lobby.gameState.currentPlayerIndex = 0;
      lobby.gameState.firstTurnCompleted = [];

      // Broadcast new deal cards privately to all
      lobby.players.forEach((p, i) => {
        const visibleHand = (i === 3) ? hands[i] : hands[i].slice(0, 4);
        io.to(p.socketId).emit('deal-cards', {
          lobbyCode: lobby.code,
          floor: floorCards,
          hand: visibleHand,
          playerIndex: i,
          biddingPlayerIndex: 0,
        });
      });
    }

    // Save updated state to database
    await saveLobby(lobby);

    io.to(lobby.code).emit('game-state', lobby.gameState);
  }
}

// Bot turn manager
async function checkAndTriggerBotTurn(lobbyCode: string) {
  // Load lobby from database
  const lobby = await loadLobby(lobbyCode);
  if (!lobby || !lobby.gameState) return;

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

        // Enforce visible hand limit (dealer index 3 is exempt)
        const visibleHand = (playerIndex === 3 || playerIndex === 0 || hasCompletedFirstTurn) ? hand : hand.slice(0, 4);
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
            io.to(currentLobby.code).emit('seep-executed', { playerId: currentPlayer.id });
          }
        } else if (playAction === 'BUILD_HOUSE') {
          const newHouse = {
            id: `house-${Date.now()}`,
            cards: [selectedCard, ...targetCards],
            value: houseValue! as 9 | 10 | 11 | 12 | 13 | 14,
            isPukta: houseValue! >= 13,
            createdBy: currentPlayer.id,
          };
          targetCards.forEach(c => {
            currentLobby.gameState!.floor = currentLobby.gameState!.floor.filter(fc => fc.id !== c.id);
          });
          currentLobby.gameState.houses.push(newHouse);
        } else {
          currentLobby.gameState.floor.push(selectedCard);
        }

        currentLobby.hands?.set(currentPlayer.id, hand.filter(c => c.id !== selectedCard.id));

        // Mark first turn completed
        if (!hasCompletedFirstTurn) {
          currentLobby.gameState.firstTurnCompleted.push(currentPlayer.id);
        }

        currentLobby.gameState.currentPlayerIndex = (currentLobby.gameState.currentPlayerIndex + 1) % 4;

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
      io.to(p.socketId).emit('deal-cards', {
        lobbyCode,
        floor: gameState.floor,
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

      // Load updated lobby to broadcast state
      const updatedLobby = await loadLobby(lobbyCode);
      if (updatedLobby) {
        io.to(lobbyCode).emit('player-joined', { userId });
        io.to(lobbyCode).emit('lobby-state', {
          players: updatedLobby.players.map(p => p.id)
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
          players: updatedLobby.players.map(p => p.id)
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
      if (playerIndex !== 3) {
        if (lobby.gameState.gamePhase === 'toss' || lobby.gameState.gamePhase === 'bidding') {
          visibleHand = hand.slice(0, 4);
        } else {
          const hasCompletedFirstTurn = lobby.gameState.firstTurnCompleted.includes(userId);
          if (playerIndex !== 0 && !hasCompletedFirstTurn) {
            visibleHand = hand.slice(0, 4);
          }
        }
      }

      socket.emit('deal-cards', {
        lobbyCode,
        floor: lobby.gameState.floor,
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
            const team = (i === 0 || i === 2) ? 1 : 2;
            await client.query(
              'INSERT INTO lobby_players (lobby_code, user_id, socket_id, team, seat) VALUES ($1, $2, $3, $4, $5)',
              [lobbyCode, p.id, p.socketId, team, i + 1]
            );
            p.team = team;
          }
          lobby.players = rotatedPlayers;
        }

        lobby.status = 'bidding';

        // 3. Deal cards (with guaranteed bidding card >= 9 in dealer's first 4 cards)
        let deck: Card[] = [];
        let floorCards: Card[] = [];
        let hands: Card[][] = [];
        let redeal = true;

        while (redeal) {
          deck = shuffle(createDeck());
          let deckIndex = 0;
          floorCards = deck.slice(deckIndex, 4);
          deckIndex += 4;

          hands = [];
          for (let i = 0; i < 4; i++) {
            hands.push(deck.slice(deckIndex, deckIndex + 12));
            deckIndex += 12;
          }

          // Dealer (seat 1, index 0) constraint check on first 4 cards
          const hasCardGe9 = hands[0].slice(0, 4).some(c => {
            const val = getCardNumericValue(c);
            return val >= 9 && val <= 13;
          });
          if (hasCardGe9) {
            redeal = false;
          }
        }

        lobby.hands = new Map();
        lobby.players.forEach((p, i) => {
          lobby.hands?.set(p.id, hands[i]);
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

      const bidCard = hand.find(c => c.id === cardId)!;
      await logMove(client, lobbyCode, playerId, 'BID', bidCard, [], bid);

      await saveLobby(lobby, client);
      await client.query('COMMIT');

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

      if (!biddingPlayer.id.startsWith('Bot_')) {
        io.to(socket.id).emit('deal-cards', {
          lobbyCode,
          floor: lobby.gameState.floor,
          hand: hand, // full 12 cards
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
      const { card, targetCards } = payload;
      const houseValue = payload?.houseValue;

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
      const visibleHand = (playerIndex === 3 || playerIndex === 0 || hasCompletedFirstTurn) ? hand : hand.slice(0, 4);

      if (!visibleHand.some(c => c.id === card.id)) {
        socket.emit('error-message', { message: 'Card not in hand' });
        await client.query('ROLLBACK');
        return;
      }

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

      if (actionType === 'CAPTURE') {
        const cardValue = getCardNumericValue(card);

        // Find if there is any house of this value
        const matchingHouses = lobby.gameState.houses.filter(h => h.value === cardValue);
        const nonMatchingHouses = lobby.gameState.houses.filter(h => h.value !== cardValue);
        
        const capturedHouseCards: Card[] = [];
        matchingHouses.forEach(h => {
          capturedHouseCards.push(...h.cards);
        });
        lobby.gameState.houses = nonMatchingHouses;

        if (targetCards && targetCards.length > 0) {
          const canCapture = canSumTo(cardValue, targetCards);
          if (!canCapture) {
            socket.emit('error-message', { message: 'Invalid capture — cards don\'t sum to your card value' });
            await client.query('ROLLBACK');
            return;
          }

          // Remove target cards from floor
          (targetCards || []).forEach((c: Card) => {
            lobby.gameState!.floor = lobby.gameState!.floor.filter(fc => fc.id !== c.id);
          });
        } else if (matchingHouses.length === 0) {
          socket.emit('error-message', { message: 'No cards selected to capture' });
          await client.query('ROLLBACK');
          return;
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
          io.to(lobbyCode).emit('seep-executed', { playerId });
        }

        lobby.hands.set(playerId, hand.filter(c => c.id !== card.id));

        // Mark first turn completed
        if (!hasCompletedFirstTurn) {
          lobby.gameState.firstTurnCompleted.push(playerId);
          if (playerIndex !== 0) {
            const updatedHand = lobby.hands.get(playerId) || [];
            socket.emit('deal-cards', {
              lobbyCode,
              floor: lobby.gameState.floor,
              hand: updatedHand,
              playerIndex,
              biddingPlayerIndex: 0,
            });
          }
        }

        lobby.gameState.currentPlayerIndex = (lobby.gameState.currentPlayerIndex + 1) % 4;
        io.to(lobbyCode).emit('game-state', lobby.gameState);
      } else if (actionType === 'THROW') {
        lobby.gameState.floor.push(card);

        lobby.hands.set(playerId, hand.filter(c => c.id !== card.id));

        // Mark first turn completed
        if (!hasCompletedFirstTurn) {
          lobby.gameState.firstTurnCompleted.push(playerId);
          if (playerIndex !== 0) {
            const updatedHand = lobby.hands.get(playerId) || [];
            socket.emit('deal-cards', {
              lobbyCode,
              floor: lobby.gameState.floor,
              hand: updatedHand,
              playerIndex,
              biddingPlayerIndex: 0,
            });
          }
        }

        lobby.gameState.currentPlayerIndex = (lobby.gameState.currentPlayerIndex + 1) % 4;
        io.to(lobbyCode).emit('game-state', lobby.gameState);
      } else if (actionType === 'BUILD_HOUSE') {
        const houseValue = payload.houseValue as 9 | 10 | 11 | 12 | 13 | 14;

        if (!hand.some(c => getCardNumericValue(c) === houseValue)) {
          socket.emit('error-message', { message: 'You must hold a card of the house value in hand to build it' });
          await client.query('ROLLBACK');
          return;
        }

        const targetedHouseIndex = lobby.gameState.houses.findIndex(h => 
          h.cards.some(hc => (targetCards || []).some(tc => tc.id === hc.id))
        );

        if (targetedHouseIndex === -1) {
          if (lobby.gameState.houses.length >= 2) {
            actionType = 'THROW';
            lobby.gameState.floor.push(card);

            lobby.hands.set(playerId, hand.filter(c => c.id !== card.id));

            if (!hasCompletedFirstTurn) {
              lobby.gameState.firstTurnCompleted.push(playerId);
              if (playerIndex !== 0) {
                const updatedHand = lobby.hands.get(playerId) || [];
                socket.emit('deal-cards', {
                  lobbyCode,
                  floor: lobby.gameState.floor,
                  hand: updatedHand,
                  playerIndex,
                  biddingPlayerIndex: 0,
                });
              }
            }

            lobby.gameState.currentPlayerIndex = (lobby.gameState.currentPlayerIndex + 1) % 4;
            io.to(lobbyCode).emit('game-state', lobby.gameState);

          } else {

          const targetSum = (targetCards || []).reduce((sum, c) => sum + getCardNumericValue(c), 0);
          if (getCardNumericValue(card) + targetSum !== houseValue) {
            socket.emit('error-message', { message: `Played card and target cards must sum to ${houseValue}` });
            await client.query('ROLLBACK');
            return;
          }

          const newHouse = {
            id: `house-${Date.now()}`,
            cards: [card, ...(targetCards || [])],
            value: houseValue,
            isPukta: houseValue >= 13,
            createdBy: playerId,
          };

          (targetCards || []).forEach((c: Card) => {
            lobby.gameState!.floor = lobby.gameState!.floor.filter(fc => fc.id !== c.id);
          });
          lobby.gameState.houses.push(newHouse);
        }
      } else {
        const targetedHouse = lobby.gameState.houses[targetedHouseIndex];
          const isDistortion = targetedHouse.value !== houseValue;

          if (isDistortion) {
            if (targetedHouse.isPukta || targetedHouse.value === 13) {
              socket.emit('error-message', { message: 'Cannot distort a cemented (Pukta) house or a house of value 13' });
              await client.query('ROLLBACK');
              return;
            }

            const creatorIndex = lobby.players.findIndex(p => p.id === targetedHouse.createdBy);
            const playerIndex = lobby.players.findIndex(p => p.id === playerId);
            const creatorTeam = creatorIndex !== -1 ? lobby.players[creatorIndex]?.team : undefined;
            const playerTeam = playerIndex !== -1 ? lobby.players[playerIndex]?.team : undefined;

            if (creatorTeam === playerTeam) {
              socket.emit('error-message', { message: 'You cannot distort a house built by your own team' });
              await client.query('ROLLBACK');
              return;
            }

            const extraTargetCards = (targetCards || []).filter(tc => !targetedHouse.cards.some(hc => hc.id === tc.id));
            const extraSum = extraTargetCards.reduce((sum, c) => sum + getCardNumericValue(c), 0);

            if (getCardNumericValue(card) + targetedHouse.value + extraSum !== houseValue) {
              socket.emit('error-message', { message: `Played card, house value, and extra cards must sum to ${houseValue}` });
              await client.query('ROLLBACK');
              return;
            }

            targetedHouse.value = houseValue;
            targetedHouse.cards.push(card, ...extraTargetCards);
            targetedHouse.createdBy = playerId;
            targetedHouse.isPukta = checkIfPukta(targetedHouse);

            extraTargetCards.forEach((c: Card) => {
              lobby.gameState!.floor = lobby.gameState!.floor.filter(fc => fc.id !== c.id);
            });

          } else {
            const creatorPlayer = lobby.players.find(p => p.id === targetedHouse.createdBy);
            const playerIndex = lobby.players.findIndex(p => p.id === playerId);
            const creatorIndex = lobby.players.findIndex(p => p.id === targetedHouse.createdBy);
            
            const playerTeam = lobby.players[playerIndex]?.team;
            const creatorTeam = creatorIndex !== -1 ? lobby.players[creatorIndex]?.team : undefined;

            if (creatorTeam && creatorTeam !== playerTeam) {
              socket.emit('error-message', { message: 'Cannot contribute to opponent\'s house without distorting it' });
              await client.query('ROLLBACK');
              return;
            }

            const extraTargetCards = (targetCards || []).filter(tc => !targetedHouse.cards.some(hc => hc.id === tc.id));
            const extraSum = extraTargetCards.reduce((sum, c) => sum + getCardNumericValue(c), 0);

            if (getCardNumericValue(card) + extraSum !== houseValue && getCardNumericValue(card) !== houseValue) {
              socket.emit('error-message', { message: 'Contribution must equal the house value' });
              await client.query('ROLLBACK');
              return;
            }

            targetedHouse.cards.push(card, ...extraTargetCards);
            targetedHouse.isPukta = checkIfPukta(targetedHouse);

            extraTargetCards.forEach((c: Card) => {
              lobby.gameState!.floor = lobby.gameState!.floor.filter(fc => fc.id !== c.id);
            });
          }
        }

        lobby.hands.set(playerId, hand.filter(c => c.id !== card.id));
        
        // Mark first turn completed
        if (!hasCompletedFirstTurn) {
          lobby.gameState.firstTurnCompleted.push(playerId);
          if (playerIndex !== 0) {
            const updatedHand = lobby.hands.get(playerId) || [];
            socket.emit('deal-cards', {
              lobbyCode,
              floor: lobby.gameState.floor,
              hand: updatedHand,
              playerIndex,
              biddingPlayerIndex: 0,
            });
          }
        }

        lobby.gameState.currentPlayerIndex = (lobby.gameState.currentPlayerIndex + 1) % 4;
        io.to(lobbyCode).emit('game-state', lobby.gameState);
      }

      await logMove(client, lobbyCode, playerId, action, card, targetCards, houseValue);
      await saveLobby(lobby, client);
      await client.query('COMMIT');

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
        action,
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
initDatabase().then(() => {
  server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}).catch(err => {
  console.error('Server failed to start due to database error:', err);
  process.exit(1);
});

export { app, io };