import express from 'express';
import http from 'http';
import { Server as SocketIOServer, Socket } from 'socket.io';
import cors from 'cors';
import dotenv from 'dotenv';
import { randomBytes } from 'crypto';
import authRoutes from './auth/routes.js';
import { generateToken, verifyToken, hasPermission } from './auth/jwt.js';
import { initDatabase } from './db.js';

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

// Check if round should end and update scores
function checkRoundEnd(lobby: LobbyState) {
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

    io.to(lobby.code).emit('game-state', lobby.gameState);
  }
}

// Bot turn manager
function checkAndTriggerBotTurn(lobby: LobbyState) {
  if (!lobby.gameState) return;

  if (lobby.gameState.gamePhase === 'bidding') {
    const bidder = lobby.players[0];
    if (bidder && bidder.socketId.startsWith('socket-Bot_')) {
      setTimeout(() => {
        const currentLobby = lobbies.get(lobby.code);
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
          io.to(currentLobby.code).emit('bid-placed', { bid: bidVal, playerId: bidder.id });
          io.to(currentLobby.code).emit('game-state', currentLobby.gameState);
          
          checkAndTriggerBotTurn(currentLobby);
        }
      }, 1500);
    }
  } else if (lobby.gameState.gamePhase === 'playing') {
    const currentPlayer = lobby.players[lobby.gameState.currentPlayerIndex];
    if (currentPlayer && currentPlayer.socketId.startsWith('socket-Bot_')) {
      setTimeout(() => {
        const currentLobby = lobbies.get(lobby.code);
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

          const isSeep = currentLobby.gameState.floor.length === 0;
          if (isSeep) {
            currentLobby.gameState.seepCount += 1;
            currentLobby.gameState.teamScores[team] += 50;
            io.to(currentLobby.code).emit('seep-executed', { playerId: currentPlayer.id });
          }
        } else {
          currentLobby.gameState.floor.push(selectedCard);
        }

        currentLobby.hands?.set(currentPlayer.id, hand.filter(c => c.id !== selectedCard.id));
        currentLobby.gameState.currentPlayerIndex = (currentLobby.gameState.currentPlayerIndex + 1) % 4;

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

        checkRoundEnd(currentLobby);
        checkAndTriggerBotTurn(currentLobby);
      }, 1500);
    }
  }
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

  // Add dummy player (bot) to lobby
  socket.on('add-bot', ({ lobbyCode }: { lobbyCode: string }) => {
    const lobby = lobbies.get(lobbyCode);
    if (!lobby) {
      socket.emit('error-message', { message: 'Lobby not found' });
      return;
    }
    if (lobby.players.length >= 4) {
      socket.emit('error-message', { message: 'Lobby is full' });
      return;
    }

    const botNum = lobby.players.filter(p => p.id.startsWith('Bot_')).length + 1;
    const botId = `Bot_${botNum}`;
    const team = (lobby.players.length % 2 === 0) ? 1 : 2;

    lobby.players.push({
      id: botId,
      socketId: `socket-Bot_${botId}-${lobbyCode}`,
      team
    });
    lobby.hands?.set(botId, []);

    io.to(lobbyCode).emit('player-joined', { userId: botId });
    io.to(lobbyCode).emit('lobby-state', {
      players: lobby.players.map(p => p.id)
    });
  });

  // Sync game and deal cards on request (avoids mounting race condition)
  socket.on('request-deal', ({ lobbyCode }: { lobbyCode: string }) => {
    const userId = socket.data.userId as string;
    const lobby = lobbies.get(lobbyCode);
    if (!lobby || !lobby.gameState || !lobby.hands) return;

    const playerIndex = lobby.players.findIndex(p => p.id === userId);
    if (playerIndex === -1) return;

    // Send the cards privately to the requesting player
    socket.emit('deal-cards', {
      lobbyCode,
      floor: lobby.gameState.floor,
      hand: lobby.hands.get(userId) || [],
      playerIndex,
      biddingPlayerIndex: 0,
    });

    // Also send the game state
    socket.emit('game-state', lobby.gameState);

    // Trigger bot turn if it is currently a bot's turn
    checkAndTriggerBotTurn(lobby);
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

      io.to(lobbyCode).emit('game-started', { lobbyCode });

      // Send each player only their own hand (private), along with their seat index
      lobby.players.forEach((p, i) => {
        io.to(p.socketId).emit('deal-cards', {
          lobbyCode,
          floor: floorCards,
          hand: hands[i],
          playerIndex: i,
          biddingPlayerIndex: 0,
        });
      });

      // Trigger bot turn if the first player is a bot
      checkAndTriggerBotTurn(lobby);
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

    // Trigger bot turn if it is a bot's turn now
    checkAndTriggerBotTurn(lobby);
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

    if (action === 'CAPTURE') {
      const cardValue = getCardNumericValue(card);
      const canCapture = canSumTo(cardValue, targetCards || []);

      if (!canCapture) {
        socket.emit('error-message', { message: 'Invalid capture — cards don\'t sum to your card value' });
        return;
      }

      // Determine team of current player
      const currentPlayerData = lobby.players[lobby.gameState.currentPlayerIndex];
      const team = currentPlayerData?.team === 1 ? 'team1' : 'team2';

      // Remove captured cards from floor and add to team's captures
      const captured = [card, ...(targetCards || [])];
      (targetCards || []).forEach((c: Card) => {
        lobby.gameState!.floor = lobby.gameState!.floor.filter(fc => fc.id !== c.id);
      });
      lobby.gameState.capturedCards[team].push(...captured);

      // Check if Seep occurred (floor cleared)
      const isSeep = lobby.gameState.floor.length === 0;
      if (isSeep) {
        lobby.gameState.seepCount += 1;
        lobby.gameState.teamScores[team] += 50;
        io.to(lobbyCode).emit('seep-executed', { playerId });
      }

      // Remove played card from hand and advance turn
      lobby.hands.set(playerId, hand.filter(c => c.id !== card.id));
      lobby.gameState.currentPlayerIndex = (lobby.gameState.currentPlayerIndex + 1) % 4;

      io.to(lobbyCode).emit('game-state', lobby.gameState);
    } else if (action === 'THROW') {
      // Throw: place card on the floor without capturing
      lobby.gameState.floor.push(card);

      // Remove played card from hand and advance turn
      lobby.hands.set(playerId, hand.filter(c => c.id !== card.id));
      lobby.gameState.currentPlayerIndex = (lobby.gameState.currentPlayerIndex + 1) % 4;

      io.to(lobbyCode).emit('game-state', lobby.gameState);
    } else if (action === 'BUILD_HOUSE') {
      const houseValue = payload.houseValue as 9 | 10 | 11 | 12 | 13 | 14;
      // Basic house build: played card + target floor cards form a house
      const newHouse = {
        id: `house-${Date.now()}`,
        cards: [card, ...(targetCards || [])],
        value: houseValue,
        isPukta: false,
        createdBy: playerId,
      };

      // Remove target cards from floor and add the house
      (targetCards || []).forEach((c: Card) => {
        lobby.gameState!.floor = lobby.gameState!.floor.filter(fc => fc.id !== c.id);
      });
      lobby.gameState.houses.push(newHouse);

      // Remove played card from hand and advance turn
      lobby.hands.set(playerId, hand.filter(c => c.id !== card.id));
      lobby.gameState.currentPlayerIndex = (lobby.gameState.currentPlayerIndex + 1) % 4;

      io.to(lobbyCode).emit('game-state', lobby.gameState);
    }

    // Relay action to other players for animation/display purposes
    socket.to(lobbyCode).emit('game-updated', { ...data, playerId });

    // Check if round should end
    checkRoundEnd(lobby);

    // Trigger bot turn if it is a bot's turn now
    checkAndTriggerBotTurn(lobby);
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

// Admin-only route: delete lobby
app.delete('/api/lobby/:code', authMiddleware('admin'), (req, res) => {
  const { code } = req.params;
  lobbies.delete(code);
  io.to(code).emit('lobby-deleted');
  res.json({ message: 'Lobby deleted' });
});

// Admin-only route: list all lobbies
app.get('/api/admin/lobbies', authMiddleware('admin'), (req: any, res: any) => {
  const allLobbies = Array.from(lobbies.values()).map(l => ({
    code: l.code,
    isPrivate: l.isPrivate,
    players: l.players.map(p => p.id),
    status: l.status
  }));
  res.json({ lobbies: allLobbies });
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