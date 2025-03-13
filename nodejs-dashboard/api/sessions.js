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
    const days = req.query.days || 7;

    const result = await pool.sql`
      SELECT * FROM player_sessions 
      WHERE start_time > NOW() - INTERVAL '${days} days'
      AND end_time IS NOT NULL 
      ORDER BY start_time ASC
    `;

    res.status(200).json(result.rows);
  } catch (error) {
    console.error("Error fetching sessions:", error);
    res.status(500).json({ error: "Server error" });
  }
}
