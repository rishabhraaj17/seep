import express from 'express';
import http from 'http';
import { Server as SocketIOServer, Socket } from 'socket.io';
import cors from 'cors';
import dotenv from 'dotenv';
import { randomBytes } from 'crypto';
import authRoutes from './auth/routes.js';
import { generateToken, verifyToken, hasPermission } from './auth/jwt.js';

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
  seepCount: number;
  gamePhase: 'bidding' | 'playing' | 'roundEnd' | 'gameEnd';
  bid?: {
    playerId: string;
    value: number;
    fulfilled: boolean;
  };
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

// In-memory storage
const lobbies = new Map<string, LobbyState>();
const socketToLobby = new Map<string, string>();

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
  socket.on('create-lobby', ({ isPrivate }: { isPrivate: boolean }) => {
    const userId = socket.data.userId as string;
    const code = randomBytes(3).toString('hex').toUpperCase();

    const lobby: LobbyState = {
      code,
      isPrivate: isPrivate || false,
      players: [{ id: userId, socketId: socket.id, team: 1 }],
      status: 'waiting',
      hands: new Map([[userId, []]]),
    };

    lobbies.set(code, lobby);
    socketToLobby.set(socket.id, code);
    socket.join(code);

    socket.emit('lobby-created', { code, isPrivate });
    socket.emit('lobby-state', { players: [userId] });
  });

  // Join lobby
  socket.on('join-lobby', ({ lobbyCode }: { lobbyCode: string }) => {
    const userId = socket.data.userId as string;
    const lobby = lobbies.get(lobbyCode);

    if (!lobby) {
      socket.emit('error-message', { message: 'Lobby not found' });
      return;
    }

    if (lobby.players.length >= 4) {
      socket.emit('error-message', { message: 'Lobby is full' });
      return;
    }

    if (lobby.players.some(p => p.id === userId)) {
      socket.emit('error-message', { message: 'Already in lobby' });
      return;
    }

    // Assign team (alternating: 1&3 vs 2&4)
    const team = (lobby.players.length % 2 === 0) ? 1 : 2;
    lobby.players.push({ id: userId, socketId: socket.id, team });
    lobby.hands?.set(userId, []);

    socketToLobby.set(socket.id, lobbyCode);
    socket.join(lobbyCode);

    io.to(lobbyCode).emit('player-joined', { userId });
    io.to(lobbyCode).emit('lobby-state', {
      players: lobby.players.map(p => p.id)
    });
  });

  // Start game
  socket.on('start-game', ({ lobbyCode }: { lobbyCode: string }) => {
    const userId = socket.data.userId as string;
    const lobby = lobbies.get(lobbyCode);
    // Only a player already in the lobby can start it
    if (lobby && lobby.players.length === 4 && lobby.players.some(p => p.id === userId)) {
      lobby.status = 'bidding';

      // Deal cards
      const deck = shuffle(createDeck());
      let deckIndex = 0;

      // Deal 4 floor cards
      const floorCards = deck.slice(deckIndex, 4);
      deckIndex += 4;

      // Deal 12 cards to each player
      const hands: Card[][] = [];
      for (let i = 0; i < 4; i++) {
        hands.push(deck.slice(deckIndex, deckIndex + 12));
        deckIndex += 12;
      }

      // Store hands in lobby
      lobby.hands = new Map();
      lobby.players.forEach((p, i) => {
        lobby.hands?.set(p.id, hands[i]);
      });

      // Initialize game state
      lobby.gameState = {
        lobbyCode,
        floor: floorCards,
        houses: [],
        currentPlayerIndex: 0,
        roundNumber: 1,
        teamScores: { team1: 0, team2: 0 },
        capturedCards: { team1: [], team2: [] },
        seepCount: 0,
        gamePhase: 'bidding',
        bid: undefined,
      };

      io.to(lobbyCode).emit('game-started');
      io.to(lobbyCode).emit('deal-cards', {
        floor: floorCards,
        hands,
        biddingPlayerIndex: 0,
      });
    } else {
      socket.emit('error-message', { message: 'Need 4 players to start' });
    }
  });

  // Place bid
  socket.on('place-bid', ({ lobbyCode, bid, cardId }: {
    lobbyCode: string;
    bid: number;
    cardId: string;
  }) => {
    const playerId = socket.data.userId as string;
    const lobby = lobbies.get(lobbyCode);
    if (!lobby?.gameState || !lobby.hands) return;

    // Only the bidding player (index 0) can place a bid
    const biddingPlayer = lobby.players[0];
    if (biddingPlayer?.id !== playerId) {
      socket.emit('error-message', { message: 'Not your turn to bid' });
      return;
    }

    const hand = lobby.hands.get(playerId) || [];
    const hasCard = hand.some(c => c.id === cardId);

    if (!hasCard) {
      socket.emit('error-message', { message: 'Invalid bid card' });
      return;
    }

    lobby.gameState.bid = { playerId, value: bid, fulfilled: false };
    lobby.gameState.gamePhase = 'playing';
    io.to(lobbyCode).emit('bid-placed', { bid, playerId });
    io.to(lobbyCode).emit('game-state', lobby.gameState);
  });

  // Handle game actions
  socket.on('game-action', (data: { lobbyCode: string; action: string; payload: { card: Card; targetCards: Card[]; houseValue?: number } }) => {
    const playerId = socket.data.userId as string;
    const lobby = lobbies.get(data.lobbyCode);
    if (!lobby?.gameState || !lobby.hands) return;

    const { action, payload } = data;
    const { card, targetCards } = payload;
    const lobbyCode = data.lobbyCode;

    // Enforce turn order
    const currentPlayer = lobby.players[lobby.gameState.currentPlayerIndex];
    if (currentPlayer?.id !== playerId) {
      socket.emit('error-message', { message: 'Not your turn' });
      return;
    }

    // Verify the played card is actually in the player's hand
    const hand = lobby.hands.get(playerId) || [];
    if (!hand.some(c => c.id === card.id)) {
      socket.emit('error-message', { message: 'Card not in hand' });
      return;
    }

    // Valid capture check
    if (action === 'CAPTURE') {
      const cardValue = getCardNumericValue(card);
      const canCapture = canSumTo(cardValue, targetCards);

      if (canCapture) {
        // Remove captured cards from floor
        targetCards.forEach((c: Card) => {
          lobby.gameState!.floor = lobby.gameState!.floor.filter(fc => fc.id !== c.id);
        });

        // Check if Seep occurred
        const isSeep = lobby.gameState.floor.length === 0;
        if (isSeep) {
          lobby.gameState.seepCount += 1;
          io.to(lobbyCode).emit('seep-executed', { playerId });
        }

        // Remove played card from hand and advance turn
        lobby.hands.set(playerId, hand.filter(c => c.id !== card.id));
        lobby.gameState.currentPlayerIndex = (lobby.gameState.currentPlayerIndex + 1) % 4;

        io.to(lobbyCode).emit('game-state', lobby.gameState);
      }
    }

    // Relay action to other players
    socket.to(lobbyCode).emit('game-updated', { ...data, playerId });
  });

  // Disconnect
  socket.on('disconnect', () => {
    console.log(`Player disconnected: ${socket.id}`);

    const lobbyCode = socketToLobby.get(socket.id);
    if (lobbyCode) {
      const lobby = lobbies.get(lobbyCode);
      if (lobby) {
        lobby.players = lobby.players.filter(p => p.socketId !== socket.id);
        io.to(lobbyCode).emit('player-left', {
          players: lobby.players.map(p => p.id)
        });
      }
      socketToLobby.delete(socket.id);
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

// Admin-only route example
app.delete('/api/lobby/:code', authMiddleware('admin'), (req, res) => {
  const { code } = req.params;
  lobbies.delete(code);
  io.to(code).emit('lobby-deleted');
  res.json({ message: 'Lobby deleted' });
});

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

export { app, io };