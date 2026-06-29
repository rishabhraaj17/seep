import express from 'express';
import http from 'http';
import { Server as SocketIOServer, Socket } from 'socket.io';
import cors from 'cors';
import dotenv from 'dotenv';
import { randomBytes } from 'crypto';
import authRoutes from './auth/routes.js';
import { generateToken, verifyToken, hasPermission } from './auth/jwt.js';
import { initDatabase, pool } from './db.js';

// Game types
type Suit = 'hearts' | 'diamonds' | 'clubs' | 'spades';
type Rank = '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K' | 'A';

interface Card {
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

interface GameState {
  lobbyCode: string;
  floor: Card[];
  houses: House[];
  currentPlayerIndex: number;
  roundNumber: number;
  teamScores: { team1: number; team2: number };
  capturedCards: { team1: Card[]; team2: Card[] };
  seepCount: { team1: number; team2: number };
  gamePhase: 'bidding' | 'playing' | 'roundEnd' | 'gameEnd';
  bid?: {
    playerId: string;
    value: number;
    fulfilled: boolean;
  };
  lastCaptureTeam?: 1 | 2;
}

interface LobbyState {
  code: string;
  isPrivate: boolean;
  players: { id: string; socketId: string; team: number }[];
  status: 'waiting' | 'bidding' | 'playing' | 'ended';
  gameState?: GameState;
  hands?: Map<string, Card[]>;
}

// Helper functions
function getPointValue(card: Card): number {
  if (card.rank === '10' && card.suit === 'diamonds') return 6;
  if (card.rank === 'A' && card.suit === 'spades') return 2;
  if (card.rank === 'A') return 1;
  if (card.suit === 'spades') return 1;
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
  '10': 10, 'J': 11, 'Q': 12, 'K': 13, 'A': 14
};

// Card value for capture/sum checks
function getCardNumericValue(card: Card): number {
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
    'SELECT user_id, socket_id, team FROM lobby_players WHERE lobby_code = $1 ORDER BY seat ASC',
    [code]
  );
  const players = playersRes.rows.map((r: any) => ({
    id: r.user_id,
    socketId: r.socket_id,
    team: r.team,
  }));

  const lobby: LobbyState = {
    code: lobbyRow.code,
    isPrivate: lobbyRow.is_private,
    status: lobbyRow.status,
    players,
  };

  const gsRes = await db.query(
    'SELECT floor, houses, hands, current_player_index, round_number, team_scores, captured_cards, team_seeps, game_phase, bid, last_capture_team FROM game_states WHERE lobby_code = $1',
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
      if (lobby.hands) {
        for (const [uid, cards] of lobby.hands.entries()) {
          handsObj[uid] = cards;
        }
      }

      await db.query(
        `INSERT INTO game_states (
          lobby_code, floor, houses, hands, current_player_index, round_number, 
          team_scores, captured_cards, team_seeps, game_phase, bid, last_capture_team
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
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
    // Award remaining floor cards to the team that made the last capture
    const lastTeam = lobby.gameState.lastCaptureTeam === 2 ? 'team2' : 'team1';
    if (lobby.gameState.floor.length > 0) {
      lobby.gameState.capturedCards[lastTeam].push(...lobby.gameState.floor);
      lobby.gameState.floor = [];
    }

    const team1Captures = lobby.gameState.capturedCards.team1;
    const team2Captures = lobby.gameState.capturedCards.team2;

    const team1RoundPoints = calculatePoints(team1Captures);
    const team2RoundPoints = calculatePoints(team2Captures);

    lobby.gameState.teamScores.team1 += team1RoundPoints;
    lobby.gameState.teamScores.team2 += team2RoundPoints;

    if (lobby.gameState.teamScores.team1 >= 100 || lobby.gameState.teamScores.team2 >= 100) {
      lobby.gameState.gamePhase = 'gameEnd';
    } else {
      // Setup next round
      lobby.gameState.roundNumber += 1;
      lobby.gameState.gamePhase = 'bidding';

      const deck = shuffle(createDeck());
      let deckIndex = 0;

      const floorCards = deck.slice(deckIndex, 4);
      deckIndex += 4;

      const hands: Card[][] = [];
      for (let i = 0; i < 4; i++) {
        hands.push(deck.slice(deckIndex, deckIndex + 12));
        deckIndex += 12;
      }

      lobby.hands.clear();
      lobby.players.forEach((p, i) => {
        lobby.hands?.set(p.id, hands[i]);
      });

      lobby.gameState.floor = floorCards;
      lobby.gameState.capturedCards = { team1: [], team2: [] };
      lobby.gameState.bid = undefined;
      lobby.gameState.currentPlayerIndex = 0;

      // Broadcast new deal cards privately to all
      lobby.players.forEach((p, i) => {
        io.to(p.socketId).emit('deal-cards', {
          lobbyCode: lobby.code,
          floor: floorCards,
          hand: hands[i],
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

        let playAction = 'THROW';
        let selectedCard = hand[0];
        let targetCards: Card[] = [];

        // Check if bot can capture
        for (const card of hand) {
          const capturable = findCapturableCardsForBot(card, currentLobby.gameState.floor);
          if (capturable.length > 0) {
            playAction = 'CAPTURE';
            selectedCard = card;
            targetCards = capturable;
            break;
          }
        }

        const team = currentPlayer.team === 1 ? 'team1' : 'team2';

        if (playAction === 'CAPTURE') {
          targetCards.forEach(c => {
            currentLobby.gameState!.floor = currentLobby.gameState!.floor.filter(fc => fc.id !== c.id);
          });
          const captured = [selectedCard, ...targetCards];
          currentLobby.gameState.capturedCards[team].push(...captured);
          currentLobby.gameState.lastCaptureTeam = currentPlayer.team === 2 ? 2 : 1;

          const isSeep = currentLobby.gameState.floor.length === 0;
          if (isSeep) {
            currentLobby.gameState.seepCount[team] += 1;
            currentLobby.gameState.teamScores[team] += 50;
            io.to(currentLobby.code).emit('seep-executed', { playerId: currentPlayer.id });
          }
        } else {
          currentLobby.gameState.floor.push(selectedCard);
        }

        currentLobby.hands?.set(currentPlayer.id, hand.filter(c => c.id !== selectedCard.id));
        currentLobby.gameState.currentPlayerIndex = (currentLobby.gameState.currentPlayerIndex + 1) % 4;

        await saveLobby(currentLobby);

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

      socket.emit('deal-cards', {
        lobbyCode,
        floor: lobby.gameState.floor,
        hand: lobby.hands.get(userId) || [],
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
    try {
      const lobby = await loadLobby(lobbyCode);
      if (lobby && lobby.players.length === 4 && lobby.players.some(p => p.id === userId)) {
        lobby.status = 'bidding';

        // Deal cards
        const deck = shuffle(createDeck());
        let deckIndex = 0;

        const floorCards = deck.slice(deckIndex, 4);
        deckIndex += 4;

        const hands: Card[][] = [];
        for (let i = 0; i < 4; i++) {
          hands.push(deck.slice(deckIndex, deckIndex + 12));
          deckIndex += 12;
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
          gamePhase: 'bidding',
          bid: undefined,
          lastCaptureTeam: undefined,
        };

        await saveLobby(lobby);

        io.to(lobbyCode).emit('game-started', { lobbyCode });

        lobby.players.forEach((p, i) => {
          io.to(p.socketId).emit('deal-cards', {
            lobbyCode,
            floor: floorCards,
            hand: hands[i],
            playerIndex: i,
            biddingPlayerIndex: 0,
          });
        });

        await checkAndTriggerBotTurn(lobbyCode);
      } else {
        socket.emit('error-message', { message: 'Need 4 players to start' });
      }
    } catch (err) {
      console.error('Error starting game:', err);
      socket.emit('error-message', { message: 'Failed to start game' });
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

      await saveLobby(lobby, client);
      await client.query('COMMIT');

      io.to(lobbyCode).emit('bid-placed', { bid, playerId });
      io.to(lobbyCode).emit('game-state', lobby.gameState);

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
      const { card, targetCards } = payload;

      // Enforce turn order
      const currentPlayer = lobby.players[lobby.gameState.currentPlayerIndex];
      if (currentPlayer?.id !== playerId) {
        socket.emit('error-message', { message: 'Not your turn' });
        await client.query('ROLLBACK');
        return;
      }

      // Verify the played card is actually in the player's hand
      const hand = lobby.hands.get(playerId) || [];
      if (!hand.some(c => c.id === card.id)) {
        socket.emit('error-message', { message: 'Card not in hand' });
        await client.query('ROLLBACK');
        return;
      }

      if (action === 'CAPTURE') {
        const cardValue = getCardNumericValue(card);
        const canCapture = canSumTo(cardValue, targetCards || []);

        if (!canCapture) {
          socket.emit('error-message', { message: 'Invalid capture — cards don\'t sum to your card value' });
          await client.query('ROLLBACK');
          return;
        }

        const team = currentPlayer.team === 1 ? 'team1' : 'team2';

        const captured = [card, ...(targetCards || [])];
        (targetCards || []).forEach((c: Card) => {
          lobby.gameState!.floor = lobby.gameState!.floor.filter(fc => fc.id !== c.id);
        });
        lobby.gameState.capturedCards[team].push(...captured);
        lobby.gameState.lastCaptureTeam = currentPlayer.team === 2 ? 2 : 1;

        const isSeep = lobby.gameState.floor.length === 0;
        if (isSeep) {
          lobby.gameState.seepCount[team] += 1;
          lobby.gameState.teamScores[team] += 50;
          io.to(lobbyCode).emit('seep-executed', { playerId });
        }

        lobby.hands.set(playerId, hand.filter(c => c.id !== card.id));
        lobby.gameState.currentPlayerIndex = (lobby.gameState.currentPlayerIndex + 1) % 4;

        io.to(lobbyCode).emit('game-state', lobby.gameState);
      } else if (action === 'THROW') {
        lobby.gameState.floor.push(card);

        lobby.hands.set(playerId, hand.filter(c => c.id !== card.id));
        lobby.gameState.currentPlayerIndex = (lobby.gameState.currentPlayerIndex + 1) % 4;

        io.to(lobbyCode).emit('game-state', lobby.gameState);
      } else if (action === 'BUILD_HOUSE') {
        const houseValue = payload.houseValue as 9 | 10 | 11 | 12 | 13 | 14;
        const newHouse = {
          id: `house-${Date.now()}`,
          cards: [card, ...(targetCards || [])],
          value: houseValue,
          isPukta: false,
          createdBy: playerId,
        };

        (targetCards || []).forEach((c: Card) => {
          lobby.gameState!.floor = lobby.gameState!.floor.filter(fc => fc.id !== c.id);
        });
        lobby.gameState.houses.push(newHouse);

        lobby.hands.set(playerId, hand.filter(c => c.id !== card.id));
        lobby.gameState.currentPlayerIndex = (lobby.gameState.currentPlayerIndex + 1) % 4;

        io.to(lobbyCode).emit('game-state', lobby.gameState);
      }

      await saveLobby(lobby, client);
      await client.query('COMMIT');

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