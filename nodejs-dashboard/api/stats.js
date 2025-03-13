import { getDbPool } from "../lib/db";

export default async function handler(req, res) {
  // Set CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  // Handle preflight requests
  if (req.method === "OPTIONS") {
    res.status(200).end();
    return;
  }

  // Only allow GET requests
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const pool = await getDbPool();

    // Get daily player counts for the last week
    const dailyCountsResult = await pool.sql`
      SELECT TO_CHAR(start_time, 'YYYY-MM-DD') as date, COUNT(*) as count 
      FROM player_sessions 
      WHERE start_time > NOW() - INTERVAL '7 days'
      GROUP BY TO_CHAR(start_time, 'YYYY-MM-DD')
      ORDER BY date ASC
    `;

    // Get longest session
    const longestSessionResult = await pool.sql`
      SELECT MAX(duration_seconds) as longest_duration 
      FROM player_sessions 
      WHERE end_time IS NOT NULL
    `;

    // Get total players
    const totalPlayersResult = await pool.sql`
      SELECT COUNT(*) as total 
      FROM player_sessions
    `;

    // Check for current presence
    const currentPresenceResult = await pool.sql`
      SELECT * FROM player_sessions 
      WHERE end_time IS NULL 
      LIMIT 1
    `;

    res.status(200).json({
      dailyCounts: dailyCountsResult.rows,
      longestDuration: longestSessionResult.rows[0]?.longest_duration || 0,
      totalPlayers: totalPlayersResult.rows[0]?.total || 0,
      currentPresence: currentPresenceResult.rows.length > 0,
    });
  } catch (error) {
    console.error("Error fetching stats:", error);
    res.status(500).json({ error: "Server error" });
  }
}
