# Seep PostgreSQL and Bot Strategy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate a PostgreSQL database via Docker Compose, persist all game, user, and lobby data, and implement full Seep game rules alongside a heuristic bot strategy.

**Architecture:** Use a `postgres:15-alpine` container for database storage, connect using Node `pg` Pool inside the backend server, self-bootstrap database tables on startup, and query/save state on each transaction. Bots will execute heuristically weighted actions.

**Tech Stack:** PostgreSQL 15, `pg` (node-postgres), Docker Compose, Socket.io, TypeScript.

## Global Constraints
- Do not run `npm install` inside subpackages directly unless workspace context is preserved.
- Keep the database schema fully synchronized with TypeScript types defined in `packages/shared/src/index.ts`.

---

### Task 1: Docker Compose and Database Initialization

**Files:**
- Modify: `docker-compose.yml`
- Create: `packages/server/src/db.ts`
- Modify: `packages/server/src/index.ts`

**Interfaces:**
- Consumes: Database URL via environment variable `DATABASE_URL`
- Produces: Exported database query function `pool.query(text, params)` and automatic table creation on startup.

- [ ] **Step 1: Update `docker-compose.yml` with the Postgres service**
  Modify `docker-compose.yml` to define the `seep-db` service:
  ```yaml
  version: '3.9'

  services:
    # Database
    seep-db:
      image: postgres:15-alpine
      container_name: seep-db
      ports:
        - "5432:5432"
      environment:
        - POSTGRES_USER=seep_user
        - POSTGRES_PASSWORD=seep_pass
        - POSTGRES_DB=seep_db
      volumes:
        - seep_pgdata:/var/lib/postgresql/data
      restart: unless-stopped
      healthcheck:
        test: ["CMD-SHELL", "pg_isready -U seep_user -d seep_db"]
        interval: 10s
        timeout: 5s
        retries: 5

    # Backend server
    seep-server:
      build:
        context: .
        dockerfile: Dockerfile.server
      container_name: seep-server
      ports:
        - "3002:3000"
      environment:
        - NODE_ENV=production
        - JWT_SECRET=${JWT_SECRET:-seep-secret-key-change-in-production}
        - PORT=3000
        - DATABASE_URL=postgres://seep_user:seep_pass@seep-db:5432/seep_db
      depends_on:
        seep-db:
          condition: service_healthy
      restart: unless-stopped
      healthcheck:
        test: ["CMD", "wget", "-qO-", "http://localhost:3000/health"]
        interval: 30s
        timeout: 10s
        retries: 3

    # Frontend
    seep-client:
      build:
        context: .
        dockerfile: Dockerfile.client
      container_name: seep-client
      ports:
        - "5273:80"
      restart: unless-stopped
      depends_on:
        seep-server:
          condition: service_healthy

  volumes:
    seep_pgdata:
  ```

- [ ] **Step 2: Install `pg` and `@types/pg` packages**
  Run from root:
  ```bash
  npm install pg --workspace=@seep/server
  npm install --save-dev @types/pg --workspace=@seep/server
  ```

- [ ] **Step 3: Create `packages/server/src/db.ts`**
  Write the connection pool and migration scripts:
  ```typescript
  import pg from 'pg';

  const connectionString = process.env.DATABASE_URL || 'postgres://seep_user:seep_pass@localhost:5432/seep_db';

  export const pool = new pg.Pool({
    connectionString,
  });

  export async function initDatabase() {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Create users table
      await client.query(`
        CREATE TABLE IF NOT EXISTS users (
          id VARCHAR(50) PRIMARY KEY,
          username VARCHAR(50) UNIQUE NOT NULL,
          password_hash VARCHAR(255) NOT NULL,
          role VARCHAR(20) DEFAULT 'player' CHECK (role IN ('admin', 'player', 'spectator')),
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      `);

      // Create lobbies table
      await client.query(`
        CREATE TABLE IF NOT EXISTS lobbies (
          code VARCHAR(10) PRIMARY KEY,
          is_private BOOLEAN DEFAULT FALSE,
          status VARCHAR(20) DEFAULT 'waiting' CHECK (status IN ('waiting', 'bidding', 'playing', 'ended')),
          creator_id VARCHAR(50) REFERENCES users(id) ON DELETE SET NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      `);

      // Create lobby_players table
      await client.query(`
        CREATE TABLE IF NOT EXISTS lobby_players (
          lobby_code VARCHAR(10) REFERENCES lobbies(code) ON DELETE CASCADE,
          user_id VARCHAR(50) NOT NULL,
          socket_id VARCHAR(100) NOT NULL,
          team INTEGER NOT NULL CHECK (team IN (1, 2)),
          seat INTEGER NOT NULL CHECK (seat BETWEEN 1 AND 4),
          joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (lobby_code, seat)
        );
      `);

      // Create game_states table
      await client.query(`
        CREATE TABLE IF NOT EXISTS game_states (
          lobby_code VARCHAR(10) PRIMARY KEY REFERENCES lobbies(code) ON DELETE CASCADE,
          floor JSONB NOT NULL,
          houses JSONB NOT NULL,
          hands JSONB NOT NULL,
          current_player_index INTEGER NOT NULL CHECK (current_player_index BETWEEN 0 AND 3),
          round_number INTEGER NOT NULL DEFAULT 1,
          team_scores JSONB NOT NULL,
          captured_cards JSONB NOT NULL,
          team_seeps JSONB NOT NULL,
          game_phase VARCHAR(20) NOT NULL CHECK (game_phase IN ('bidding', 'playing', 'roundEnd', 'gameEnd')),
          bid JSONB,
          last_capture_team INTEGER CHECK (last_capture_team IN (1, 2)),
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      `);

      await client.query('COMMIT');
      console.log('Database schema successfully verified/created.');
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('Failed to initialize database schema:', err);
      throw err;
    } finally {
      client.release();
    }
  }
  ```

- [ ] **Step 4: Initialize the database in `packages/server/src/index.ts`**
  Import and call `initDatabase()` at startup before starting the server.
  Modify `packages/server/src/index.ts` at the bottom:
  ```typescript
  import { initDatabase } from './db.js';

  const PORT = process.env.PORT || 3000;
  initDatabase().then(() => {
    server.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  }).catch(err => {
    console.error('Server failed to start due to database error:', err);
    process.exit(1);
  });
  ```

- [ ] **Step 5: Test compiler and save checkpoint**
  Verify the type compiler passes:
  ```bash
  cd packages/server && npx tsc --noEmit
  ```

---

### Task 2: Refactoring User Authentication to PostgreSQL

**Files:**
- Modify: `packages/server/src/auth/routes.ts`

**Interfaces:**
- Consumes: `pool` from `../db.ts`
- Produces: Queries database for registrations, logins, user listing, and role updates.

- [ ] **Step 1: Rewrite `packages/server/src/auth/routes.ts` to use PostgreSQL queries**
  Replace the in-memory `users` Map with SQL queries targeting the `users` table:
  ```typescript
  import { Router } from 'express';
  import bcrypt from 'bcryptjs';
  import { generateToken, verifyToken } from './jwt.js';
  import { pool } from '../db.js';

  const router = Router();

  // Register
  router.post('/register', async (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required' });
    }

    try {
      const existing = await pool.query('SELECT id FROM users WHERE username = $1', [username]);
      if (existing.rows.length > 0) {
        return res.status(409).json({ error: 'Username already exists' });
      }

      const id = Date.now().toString();
      const passwordHash = await bcrypt.hash(password, 10);
      const role = 'player';

      await pool.query(
        'INSERT INTO users (id, username, password_hash, role) VALUES ($1, $2, $3, $4)',
        [id, username, passwordHash, role]
      );

      const token = generateToken({ userId: id, username, role });
      res.json({ token, user: { id, username, role } });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Server error during registration' });
    }
  });

  // Login
  router.post('/login', async (req, res) => {
    const { username, password } = req.body;

    try {
      const result = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
      if (result.rows.length === 0) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }

      const user = result.rows[0];
      const validPassword = await bcrypt.compare(password, user.password_hash);
      if (!validPassword) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }

      const token = generateToken({ userId: user.id, username: user.username, role: user.role });
      res.json({ token, user: { id: user.id, username: user.username, role: user.role } });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Server error during login' });
    }
  });

  // Get current user details
  router.get('/me', async (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const token = authHeader.split(' ')[1];
    const payload = verifyToken(token);

    if (!payload) {
      return res.status(401).json({ error: 'Invalid token' });
    }

    res.json({ user: payload });
  });

  // List all users for admin
  router.get('/users', async (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ error: 'No token provided' });
    }
    const token = authHeader.split(' ')[1];
    const payload = verifyToken(token);
    if (!payload || payload.role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden' });
    }

    try {
      const result = await pool.query('SELECT id, username, role FROM users ORDER BY username ASC');
      res.json({ users: result.rows });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Server error fetching users' });
    }
  });

  // Change user role
  router.post('/change-role', async (req, res) => {
    const { username, role } = req.body;
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ error: 'No token provided' });
    }
    const token = authHeader.split(' ')[1];
    const payload = verifyToken(token);
    if (!payload) {
      return res.status(401).json({ error: 'Invalid token' });
    }

    if (!username || !role) {
      return res.status(400).json({ error: 'Username and role required' });
    }

    if (!['admin', 'player', 'spectator'].includes(role)) {
      return res.status(400).json({ error: 'Invalid role' });
    }

    const isSelf = payload.username === username;
    const isAdmin = payload.role === 'admin';

    if (!isSelf && !isAdmin) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    try {
      const userRes = await pool.query('SELECT id, username FROM users WHERE username = $1', [username]);
      if (userRes.rows.length === 0) {
        return res.status(404).json({ error: 'User not found' });
      }

      const user = userRes.rows[0];
      await pool.query('UPDATE users SET role = $1 WHERE id = $2', [role, user.id]);

      let newToken = undefined;
      if (isSelf) {
        newToken = generateToken({ userId: user.id, username: user.username, role });
      }

      res.json({
        message: `Role updated`,
        token: newToken,
        user: { id: user.id, username: user.username, role }
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Server error updating role' });
    }
  });

  export default router;
  ```

- [ ] **Step 2: Verify compile**
  Run `cd packages/server && npx tsc --noEmit` to verify type safety.

---

### Task 3: Persisting Lobbies and Game State in PostgreSQL

**Files:**
- Modify: `packages/server/src/index.ts`

- [ ] **Step 1: Replace Lobby operations in server event handlers with database transactions**
  Modify connection, create-lobby, join-lobby, request-deal, start-game, place-bid, and game-action handlers to query and update the database (`lobbies`, `lobby_players`, and `game_states` tables) instead of the in-memory maps. Ensure that JSON fields are stored correctly by stringifying/parsing JSON values or passing direct objects.

- [ ] **Step 2: Add support for admin lobby listing and deletions in Postgres**
  Update the Express routes at the bottom of `packages/server/src/index.ts`:
  ```typescript
  app.delete('/api/lobby/:code', authMiddleware('admin'), async (req, res) => {
    const { code } = req.params;
    try {
      await pool.query('DELETE FROM lobbies WHERE code = $1', [code]);
      io.to(code).emit('lobby-deleted');
      res.json({ message: 'Lobby deleted' });
    } catch (err) {
      res.status(500).json({ error: 'Database error' });
    }
  });

  app.get('/api/admin/lobbies', authMiddleware('admin'), async (req, res) => {
    try {
      const result = await pool.query(`
        SELECT l.code, l.is_private, l.status, array_to_json(array_remove(array_agg(lp.user_id), NULL)) as players
        FROM lobbies l
        LEFT JOIN lobby_players lp ON l.code = lp.lobby_code
        GROUP BY l.code
      `);
      res.json({ lobbies: result.rows });
    } catch (err) {
      res.status(500).json({ error: 'Database error' });
    }
  });
  ```

---

### Task 4: Enforcing Strict Seep Game Rules

**Files:**
- Modify: `packages/shared/src/game/engine.ts`
- Modify: `packages/server/src/index.ts`

- [ ] **Step 1: Update point values and combinations rule implementation in `engine.ts`**
  Modify card value mapping to strictly implement Spades numerical value scoring and ensure other Aces value 1, and 10 of Diamonds value 6:
  ```typescript
  export function getCardNumericValue(card: Card): number {
    if (card.rank === 'A') return 1;
    if (card.rank === 'J') return 11;
    if (card.rank === 'Q') return 12;
    if (card.rank === 'K') return 13;
    return parseInt(card.rank, 10);
  }

  export function getPointValue(card: Card): number {
    if (card.suit === 'spades') {
      return getCardNumericValue(card);
    }
    if (card.rank === 'A') return 1;
    if (card.rank === '10' && card.suit === 'diamonds') return 6;
    return 0;
  }
  ```

- [ ] **Step 2: Deal 12 cards to dealer, 4 cards to players (deal remaining 8 cards later)**
  Refactor game start logic so only the dealer starts with 12 cards in hand, while other players play the first round with 4 cards and receive the remaining 8 after playing their first turn.
  Update the deal logic on the server to reflect this.

- [ ] **Step 3: Implement caller constraint and house checks**
  Ensure the caller must have a card $\ge 9$ to call, otherwise redeal. Restrict caller's first action to the called house.

- [ ] **Step 4: Layering, Cementing (Pukta) and Distorting checks**
  Enforce rules where houses with 2+ matching cards (layered) or houses of value 13 cannot be distorted. Keep unlayered houses open to distortion.

- [ ] **Step 5: Seep Cancellation & Max 3 Reset**
  Keep track of seeps per team. If a team reaches a 3rd seep, reset their seeps. Cancel out seeps at round end.

---

### Task 5: Implementing Heuristic Bot Strategy Engine

**Files:**
- Create: `packages/server/src/bot.ts`
- Modify: `packages/server/src/index.ts`

- [ ] **Step 1: Create `packages/server/src/bot.ts`**
  Implement the heuristic scoring engine that analyzes options and returns the highest scored move:
  ```typescript
  import { Card, GameState } from '@seep/shared';
  import { getCardNumericValue, getPointValue } from '@seep/shared/src/game/engine';

  export interface BotPlay {
    action: 'CAPTURE' | 'BUILD_HOUSE' | 'THROW';
    card: Card;
    targetCards: Card[];
    houseValue?: number;
    score: number;
  }

  export function chooseBestBotMove(
    botId: string,
    hand: Card[],
    floor: Card[],
    gameState: GameState,
    team: 1 | 2
  ): BotPlay {
    const plays: BotPlay[] = [];

    // Evaluate all cards in hand
    for (const card of hand) {
      const val = getCardNumericValue(card);

      // A. CAPTURES
      // 1. Direct captures
      const matches = floor.filter(fc => getCardNumericValue(fc) === val);
      if (matches.length > 0) {
        const score = 1000 + matches.reduce((sum, c) => sum + getPointValue(c), 0) + getPointValue(card);
        plays.push({ action: 'CAPTURE', card, targetCards: matches, score });
      }

      // 2. Sum captures
      // Check combination pairs
      for (let i = 0; i < floor.length; i++) {
        for (let j = i + 1; j < floor.length; j++) {
          if (getCardNumericValue(floor[i]) + getCardNumericValue(floor[j]) === val) {
            const score = 1000 + getPointValue(floor[i]) + getPointValue(floor[j]) + getPointValue(card);
            plays.push({ action: 'CAPTURE', card, targetCards: [floor[i], floor[j]], score });
          }
        }
      }

      // B. BUILD HOUSES (if card is between 9 and 13)
      if (val >= 9 && val <= 13) {
        // Build with floor card
        for (const fc of floor) {
          if (getCardNumericValue(fc) < val) {
            const needed = val - getCardNumericValue(fc);
            const extra = hand.find(hc => hc.id !== card.id && getCardNumericValue(hc) === needed);
            if (extra) {
              plays.push({ action: 'BUILD_HOUSE', card, targetCards: [fc], houseValue: val, score: 300 });
            }
          }
        }
      }

      // C. THROW (default safe option)
      // Check if throw setup a seep (total table sum under 14)
      const currentTableSum = floor.reduce((sum, fc) => sum + getCardNumericValue(fc), 0);
      const postThrowSum = currentTableSum + val;
      const seepRisk = postThrowSum <= 13;
      const throwScore = seepRisk ? 50 - val : 100 - val; // Prefer throwing small cards, heavily penalize seep risks

      plays.push({ action: 'THROW', card, targetCards: [], score: throwScore });
    }

    // Sort by score descending and return best play
    plays.sort((a, b) => b.score - a.score);
    return plays[0];
  }
  ```

- [ ] **Step 2: Integrate bot play in server triggers**
  Call `chooseBestBotMove` in bot turns to execute the best heuristic action automatically.
