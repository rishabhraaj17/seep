# Seep (Sweep) - Indian Card Game

A full-stack multiplayer web application for the traditional Indian card game Seep (Sweep).

## Quick Start (Docker)

```bash
# Create .env file
cp .env.example .env

# Start the game
docker-compose up

# Access at http://localhost
```

## Development

```bash
# Install dependencies
npm install

# Start development servers
npm run dev
```

This starts:
- Backend: http://localhost:3000
- Frontend: http://localhost:5173

## Tech Stack

- **Frontend**: React 18 (Vite), Tailwind CSS, motion/react, lucide-react
- **Backend**: Express (Node.js), Socket.io
- **Database**: In-memory (SQLite/Drizzle ready)
- **Real-time**: Socket.io for turn synchronization
- **Auth**: JWT with bcrypt password hashing

## Game Rules

Seep is a traditional card game from Northern India/Pakistan:
- **4 players** in partnerships (positions 1&3 vs 2&4)
- **Scoring cards**: 10♦ (6pts), Aces (1pt each), Spades (1pt each)
- **House values**: 9-14, build by combining cards
- **Seep (sweep)**: Capture all floor cards for 50 bonus points
- **Win**: First team to 100 points

## Docker Commands

```bash
docker-compose up          # Start services
docker-compose down        # Stop services
docker-compose logs -f     # View logs
docker-compose build       # Rebuild images
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | Backend port |
| `CLIENT_PORT` | `80` | Frontend port |
| `JWT_SECRET` | (required) | JWT signing key |

## Project Structure

```
seep/
├── packages/
│   ├── shared/     # TypeScript types + game logic
│   ├── server/     # Express backend
│   └── client/     # React frontend
├── docker-compose.yml
├── Dockerfile.server
├── Dockerfile.client
└── nginx.conf
```