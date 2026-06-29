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
        PRIMARY KEY (lobby_code, seat),
        UNIQUE (lobby_code, user_id)
      );
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_lobby_players_socket_id ON lobby_players(socket_id);
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
        first_turn_completed JSONB NOT NULL DEFAULT '[]'::jsonb,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await client.query(`
      ALTER TABLE game_states ADD COLUMN IF NOT EXISTS first_turn_completed JSONB NOT NULL DEFAULT '[]'::jsonb;
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
