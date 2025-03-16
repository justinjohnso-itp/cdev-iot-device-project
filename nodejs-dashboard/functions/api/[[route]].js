import { Router } from "itty-router";

// Create a new router
const router = Router();

// Add CORS headers to all responses
function addCorsHeaders(response) {
  response.headers.set("Access-Control-Allow-Origin", "*");
  response.headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  response.headers.set("Access-Control-Allow-Headers", "Content-Type");
  return response;
}

// Handle OPTIONS requests (CORS preflight)
router.options("*", () => {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
});

// Readings endpoint
router.get("/readings", async (request, env) => {
  try {
    const { searchParams } = new URL(request.url);
    const hours = parseInt(searchParams.get("hours") || 24);

    // Use parameterized query for safety
    const readings = await env.DB.prepare(
      `SELECT * FROM readings 
       WHERE timestamp > datetime('now', ?) 
       ORDER BY timestamp ASC`
    )
      .bind(`-${hours} hours`)
      .all();

    // Enhance returned data similar to old API
    // This ensures compatibility with existing frontend
    const resultsWithFormattedDates = readings.results.map((reading) => {
      // Format the timestamps to match old API format
      return {
        ...reading,
        // Add any transformations needed for compatibility
        formattedDate: new Date(reading.timestamp).toLocaleString(),
      };
    });

    // Format response to match what frontend expects
    return addCorsHeaders(
      new Response(JSON.stringify(readings.results), {
        headers: { "Content-Type": "application/json" },
      })
    );
  } catch (error) {
    console.error("Error in readings endpoint:", error);
    return addCorsHeaders(
      new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      })
    );
  }
});

// Sessions endpoint
router.get("/sessions", async (request, env) => {
  try {
    const { searchParams } = new URL(request.url);
    const days = parseInt(searchParams.get("days") || 7);

    const sessions = await env.DB.prepare(
      `SELECT * FROM player_sessions 
       WHERE start_time > datetime('now', ?) 
       AND end_time IS NOT NULL 
       ORDER BY start_time ASC`
    )
      .bind(`-${days} days`)
      .all();

    return addCorsHeaders(
      new Response(JSON.stringify(sessions.results), {
        headers: { "Content-Type": "application/json" },
      })
    );
  } catch (error) {
    console.error("Error in sessions endpoint:", error);
    return addCorsHeaders(
      new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      })
    );
  }
});

// Statistics endpoint
router.get("/stats", async (request, env) => {
  try {
    // Get daily counts for the last week
    const dailyCounts = await env.DB.prepare(
      `SELECT date(start_time) as date, COUNT(*) as count 
       FROM player_sessions
       WHERE start_time > datetime('now', '-7 days')
       GROUP BY date(start_time) 
       ORDER BY date ASC`
    ).all();

    // Get current presence
    const currentPresence = await env.DB.prepare(
      `SELECT EXISTS (
         SELECT 1 FROM player_sessions 
         WHERE end_time IS NULL LIMIT 1
       ) as is_present`
    ).first();

    // Get total players
    const totalPlayers = await env.DB.prepare(
      `SELECT COUNT(*) as count FROM player_sessions`
    ).first();

    // Get longest duration
    const longestDuration = await env.DB.prepare(
      `SELECT MAX(duration_seconds) as longest_duration 
       FROM player_sessions
       WHERE end_time IS NOT NULL`
    ).first();

    // Get most recent reading for real-time data
    const latestReading = await env.DB.prepare(
      `SELECT * FROM readings 
       ORDER BY timestamp DESC LIMIT 1`
    ).first();

    return addCorsHeaders(
      new Response(
        JSON.stringify({
          dailyCounts: dailyCounts.results,
          currentPresence: currentPresence.is_present === 1,
          totalPlayers: totalPlayers.count || 0,
          longestDuration: longestDuration.longest_duration || 0,
          latestReading: latestReading || null,
        }),
        { headers: { "Content-Type": "application/json" } }
      )
    );
  } catch (error) {
    console.error("Error in stats endpoint:", error);
    return addCorsHeaders(
      new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      })
    );
  }
});

// Status endpoint with enhanced information like the original API
router.get("/status", async (request, env) => {
  try {
    // Check DB status
    let dbStatus = "disconnected";
    let readingsCount = 0;
    let sessionsCount = 0;

    try {
      await env.DB.prepare("SELECT 1").first();
      dbStatus = "connected";

      // If DB is connected, get counts
      const countReadings = await env.DB.prepare(
        "SELECT COUNT(*) as count FROM readings"
      ).first();
      const countSessions = await env.DB.prepare(
        "SELECT COUNT(*) as count FROM player_sessions"
      ).first();

      readingsCount = countReadings.count || 0;
      sessionsCount = countSessions.count || 0;
    } catch (dbError) {
      console.error("Database check error:", dbError);
    }

    return addCorsHeaders(
      new Response(
        JSON.stringify({
          database: dbStatus,
          server: "running",
          readings_count: readingsCount,
          sessions_count: sessionsCount,
          uptime: new Date().toISOString(),
          version: "1.0.0",
        }),
        { headers: { "Content-Type": "application/json" } }
      )
    );
  } catch (error) {
    console.error("Error in status endpoint:", error);
    return addCorsHeaders(
      new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      })
    );
  }
});

// Add endpoint to get summary data like the old API had
router.get("/summary", async (request, env) => {
  try {
    // Get recent activity summary
    const recentActivity = await env.DB.prepare(
      `SELECT COUNT(*) as count, 
              AVG(duration_seconds) as avg_duration,
              MAX(duration_seconds) as max_duration
       FROM player_sessions
       WHERE start_time > datetime('now', '-24 hours')`
    ).first();

    return addCorsHeaders(
      new Response(
        JSON.stringify({
          today_count: recentActivity.count || 0,
          avg_duration: recentActivity.avg_duration || 0,
          max_duration: recentActivity.max_duration || 0,
          timestamp: new Date().toISOString(),
        }),
        { headers: { "Content-Type": "application/json" } }
      )
    );
  } catch (error) {
    console.error("Error in summary endpoint:", error);
    return addCorsHeaders(
      new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      })
    );
  }
});

// POST endpoint for readings - enhanced with validation
router.post("/readings", async (request, env) => {
  try {
    const data = await request.json();

    // Enhanced validation like the old API had
    if (
      !data ||
      typeof data.distance === "undefined" ||
      typeof data.volume === "undefined"
    ) {
      return addCorsHeaders(
        new Response(
          JSON.stringify({
            error: "Missing required fields: distance and volume",
          }),
          {
            status: 400,
            headers: { "Content-Type": "application/json" },
          }
        )
      );
    }

    // Extract values from JSON
    const distance = data.distance;
    const volume = data.volume;
    const frequency = data.frequency;
    const note = data.note;
    const octave = data.octave;
    const presence = data.presence === true;
    const playing = data.playing === true;

    // Insert reading
    const result = await env.DB.prepare(
      `INSERT INTO readings 
        (distance, volume, frequency, note, octave, timestamp) 
       VALUES (?, ?, ?, ?, ?, datetime('now'))`
    )
      .bind(
        distance,
        volume,
        frequency === null ? null : frequency,
        note === null ? null : note,
        octave === null ? null : octave
      )
      .run();

    // Handle session management based on presence
    if (presence) {
      // Check for active session
      const activeSessions = await env.DB.prepare(
        `SELECT id FROM player_sessions 
         WHERE end_time IS NULL LIMIT 1`
      ).all();

      // Start new session if none exists and the person is playing
      if (activeSessions.results.length === 0 && playing) {
        await env.DB.prepare(
          `INSERT INTO player_sessions (start_time) 
           VALUES (datetime('now'))`
        ).run();
      }
    } else {
      // End any open sessions when presence is false
      await env.DB.prepare(
        `UPDATE player_sessions 
         SET 
           end_time = datetime('now'), 
           duration_seconds = CAST(
             (julianday(datetime('now')) - julianday(start_time)) * 86400 AS INTEGER
           )
         WHERE end_time IS NULL`
      ).run();
    }

    return addCorsHeaders(
      new Response(
        JSON.stringify({
          success: true,
          message: "Reading recorded successfully",
          id: result.id || null,
        }),
        { headers: { "Content-Type": "application/json" } }
      )
    );
  } catch (error) {
    console.error("Error in POST readings endpoint:", error);
    return addCorsHeaders(
      new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      })
    );
  }
});

// All other routes
router.all("*", () => {
  return addCorsHeaders(new Response("Not Found", { status: 404 }));
});

export default {
  fetch: (request, env, ctx) => {
    return router.handle(request, env, ctx);
  },

  // This is the scheduled function that runs on the cron trigger
  async scheduled(event, env, ctx) {
    console.log("MQTT listener scheduled event triggered");

    try {
      // Log scheduled event in database for monitoring
      await env.DB.prepare(
        `INSERT INTO logs (event_type, message, timestamp)
         VALUES ('scheduled', 'MQTT listener triggered', datetime('now'))`
      ).run();

      console.log("Scheduled event logged successfully");
    } catch (error) {
      console.error("Error logging scheduled event:", error);
    }
  },
};
