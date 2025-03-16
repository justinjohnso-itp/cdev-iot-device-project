-- Schema for Cloudflare D1 (SQLite based)

CREATE TABLE IF NOT EXISTS readings (
  id SERIAL PRIMARY KEY,
  timestamp TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  distance INTEGER,
  volume INTEGER,
  frequency FLOAT,
  note VARCHAR(3),
  octave INTEGER
);

CREATE TABLE IF NOT EXISTS player_sessions (
  id SERIAL PRIMARY KEY,
  start_time TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  end_time TIMESTAMPTZ,
  duration_seconds INTEGER
);