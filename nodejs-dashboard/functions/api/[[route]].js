import { Router } from "itty-router";

// Create a new router
const router = Router();

// Readings endpoint
router.get("/readings", async (request, env) => {
  try {
    const { searchParams } = new URL(request.url);
    const period = searchParams.get("period") || "day";

    let readings;
    if (period === "week") {
      readings = await env.DB.prepare(
        `
        SELECT * FROM readings 
        WHERE created_at > datetime('now', '-7 days')
        ORDER BY created_at DESC
      `
      ).all();
    } else {
      readings = await env.DB.prepare(
        `
        SELECT * FROM readings 
        WHERE created_at > datetime('now', '-24 hours')
        ORDER BY created_at DESC
      `
      ).all();
    }

    return new Response(JSON.stringify(readings), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});

// Statistics endpoint
router.get("/stats", async (request, env) => {
  try {
    // Get current presence
    const currentPresence = await env.DB.prepare(
      `
      SELECT EXISTS (
        SELECT 1 FROM readings 
        WHERE created_at > datetime('now', '-2 minutes') 
        AND distance < 250
        LIMIT 1
      ) as is_present
    `
    ).first();

    // Get total players
    const totalPlayers = await env.DB.prepare(
      `
      SELECT COUNT(*) as count FROM player_sessions
    `
    ).first();

    // Get longest duration
    const longestDuration = await env.DB.prepare(
      `
      SELECT MAX(duration_seconds) as seconds FROM player_sessions
    `
    ).first();

    return new Response(
      JSON.stringify({
        currentPresence: currentPresence.is_present === 1,
        totalPlayers: totalPlayers.count,
        longestDuration: longestDuration.seconds || 0,
      }),
      {
        headers: { "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});

// POST endpoint for readings
router.post("/readings", async (request, env) => {
  try {
    const { distance, volume, frequency, note, octave } = await request.json();

    // Insert reading
    await env.DB.prepare(
      `
      INSERT INTO readings (distance, volume, frequency, note, octave, created_at) 
      VALUES (?, ?, ?, ?, ?, datetime('now'))
    `
    )
      .bind(distance, volume, frequency || null, note || null, octave || null)
      .run();

    // Session management
    if (distance < 250) {
      // Check for active session
      const activeSessions = await env.DB.prepare(
        `
        SELECT id FROM player_sessions WHERE end_time IS NULL LIMIT 1
      `
      ).all();

      if (activeSessions.results.length === 0) {
        // Start new session
        await env.DB.prepare(
          `
          INSERT INTO player_sessions (start_time) 
          VALUES (datetime('now'))
        `
        ).run();
      }
    } else {
      // End any open sessions
      await env.DB.prepare(
        `
        UPDATE player_sessions 
        SET 
          end_time = datetime('now'), 
          duration_seconds = CAST(
            (julianday(datetime('now')) - julianday(start_time)) * 86400 AS INTEGER
          )
        WHERE end_time IS NULL
      `
      ).run();
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});

// MQTT listener endpoint that will be called by the scheduled worker
router.get("/mqtt-listener", async (request, env) => {
  try {
    // This endpoint just returns OK
    // The actual worker runs as a separate scheduled function
    return new Response(JSON.stringify({ status: "MQTT listener active" }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});

// All other routes
router.all("*", () => new Response("Not Found", { status: 404 }));

export default {
  fetch: router.handle,

  // This is the scheduled function that runs every 5 minutes
  async scheduled(event, env, ctx) {
    // This code runs on the scheduled cron trigger
    // Connect to MQTT broker and handle messages
    ctx.waitUntil(handleMQTT(env));
  },
};

// MQTT handling function
async function handleMQTT(env) {
  // This function would be implemented in a production environment
  // using a serverless approach that can connect to MQTT

  // For Cloudflare, we need a different approach since Workers can't
  // maintain persistent connections. Consider:
  // 1. Using a webhook from your MQTT broker to your API
  // 2. Setting up a small proxy server elsewhere that forwards messages
  // 3. Using client-side MQTT in the browser (as shown in updated app.js)

  console.log("MQTT listener activated");
  return { success: true };
}
