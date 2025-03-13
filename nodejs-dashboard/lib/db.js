import { createPool } from "@vercel/postgres";

// Create a connection pool
let pool;

export async function getDbPool() {
  if (!pool) {
    pool = createPool({
      connectionString: process.env.POSTGRES_URL,
      ssl: process.env.NODE_ENV === "production",
    });
  }
  return pool;
}

// Initialize database tables
export async function initializeDatabase() {
  try {
    const pool = await getDbPool();

    // Create readings table
    await pool.sql`
      CREATE TABLE IF NOT EXISTS readings (
        id SERIAL PRIMARY KEY,
        timestamp TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        distance INTEGER,
        volume INTEGER,
        frequency FLOAT,
        note VARCHAR(3),
        octave INTEGER
      )
    `;

    // Create player_sessions table
    await pool.sql`
      CREATE TABLE IF NOT EXISTS player_sessions (
        id SERIAL PRIMARY KEY,
        start_time TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        end_time TIMESTAMPTZ,
        duration_seconds INTEGER
      )
    `;

    console.log("Database initialized");
  } catch (error) {
    console.error("Database initialization error:", error);
  }
}
