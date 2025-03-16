-- Schema for Cloudflare D1 (SQLite based)

CREATE TABLE IF NOT EXISTS readings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp TEXT DEFAULT (datetime('now')),
  distance INTEGER,
  volume INTEGER,
  frequency REAL,
  note TEXT,
  octave INTEGER
);

CREATE TABLE IF NOT EXISTS player_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT, 
  start_time TEXT DEFAULT (datetime('now')),
  end_time TEXT,
  duration_seconds INTEGER
);