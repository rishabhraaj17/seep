# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Install all workspace dependencies
npm install

# Run all packages in dev mode (server on :3000, client on :5173)
npm run dev

# Run a single workspace
npm run dev --workspace=@seep/server
npm run dev --workspace=@seep/client
npm run dev --workspace=@seep/shared  # tsc --watch

# Build all
npm run build

# Lint (client only — ESLint)
npm run lint --workspace=@seep/client

# Docker
docker-compose up       # full stack on :80
docker-compose build    # rebuild images
```

No test suite is currently configured.

## Architecture

This is an npm workspaces monorepo with three packages:

- **`@seep/shared`** — TypeScript types and pure game logic (no runtime dependencies). Compiled to `dist/`. Both server and client import from here.
- **`@seep/server`** — Express + Socket.io backend. All state is in-memory (no DB). Runs on port 3000.
- **`@seep/client`** — React 18 + Vite frontend. Connects to server via Socket.io. Runs on port 5173 in dev, served through nginx in Docker.

### Key Design Decisions

**State lives entirely on the server.** `LobbyState` holds the `Map<playerId, Card[]>` of private hands and the shared `GameState`. The client receives only what it needs per event — private hand cards are sent individually, not broadcast to the room.

**Dual type definitions (known tech debt).** `packages/server/src/index.ts` re-declares `Card`, `House`, `GameState`, etc. locally rather than importing from `@seep/shared`. When modifying types, update both `packages/shared/src/index.ts` and the local declarations in `server/src/index.ts`.

**Socket.io event protocol.** Server ↔ client communicate entirely via Socket.io events (no REST for gameplay). Key events:
- Client → Server: `create-lobby`, `join-lobby`, `start-game`, `place-bid`, `game-action`
- Server → Client: `lobby-created`, `lobby-state`, `player-joined`, `game-started`, `deal-cards`, `bid-placed`, `game-state`, `game-updated`, `seep-executed`, `player-left`, `error-message`

**Auth is REST, game is WebSocket.** `/api/auth/register` and `/api/auth/login` are HTTP endpoints returning JWT tokens. The JWT is not currently threaded through Socket.io connections — socket events use `userId` from the payload directly without server-side verification.

**In-memory only.** `lobbies: Map<string, LobbyState>` and `users: Map<string, User>` in `server/src/index.ts` and `server/src/auth/routes.ts` respectively. Restarting the server wipes all data.

### Game Logic (shared/src/game/engine.ts)

Core functions: `dealCards`, `validateCapture`, `canSumToTarget`, `buildHouse`, `canCementHouse`, `canSeep`, `executeSeep`, `createInitialGameState`. These are pure functions — import and unit-test them without spinning up the server.

Scoring: 10♦ = 6 pts, A♠ = 2 pts, all other Aces = 1 pt, all other Spades = 1 pt (max 22 pts/round). Seep bonus = 50 pts. Win = 100 pts.

### Client Screen Flow

`App.tsx` manages a single `screen` state: `login → lobby → game`. The Socket.io connection is created once after login and passed down as a prop. Components: `LoginScreen` → `LobbyScreen` → `GameScreen` (which composes `BiddingPhase`, `FloorCards`, `PlayerHand`, `PlayingCard`, `Scoreboard`).

## Environment Variables

Copy `.env.example` to `.env`. Required for production: `JWT_SECRET`. Optional: `PORT` (default 3000), `CLIENT_PORT` (default 80 in Docker). Client uses `VITE_SERVER_URL` (default `http://localhost:3002` in dev — note the port mismatch with server default 3000; set explicitly).
