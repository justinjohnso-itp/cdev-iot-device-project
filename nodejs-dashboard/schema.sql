-- Schema for Cloudflare D1 (SQLite based)

CREATE TABLE readings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  distance INTEGER NOT NULL,
  volume INTEGER NOT NULL,
  frequency REAL,
  note TEXT,
  octave INTEGER,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE player_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  start_time DATETIME NOT NULL,
  end_time DATETIME,
  duration_seconds INTEGER,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for faster queries
CREATE INDEX idx_readings_created_at ON readings(created_at);
CREATE INDEX idx_sessions_start_time ON player_sessions(start_time);