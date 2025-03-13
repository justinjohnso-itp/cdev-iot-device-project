import { getDbPool, initializeDatabase } from "../lib/db";
import mqtt from "mqtt";

// MQTT Client Setup
const broker = "wss://tigoe.net/mqtt";
const options = {
  clean: true,
  connectTimeout: 10000,
  clientId: "vercel-serverless-" + Math.floor(Math.random() * 1000000),
  username: process.env.MQTT_USER || "conndev",
  password: process.env.MQTT_PASSWORD || "b4s1l!",
};
const topic = "conndev/piano";

// Connect to MQTT broker
let client;
let currentSessionId = null;

async function connectMqtt() {
  if (client && client.connected) return client;

  client = mqtt.connect(broker, options);

  client.on("connect", () => {
    console.log("Connected to MQTT broker");
    client.subscribe(topic);
  });

  client.on("message", async (topic, payload) => {
    try {
      const message = payload.toString();
      console.log("Received message:", message);

      // Parse message
      const distanceMatch = message.match(/distance: (\d+)/);
      const volumeMatch = message.match(/volume: (\d+)/);
      const frequencyMatch = message.match(/frequency: (\d+)/);
      const noteMatch = message.match(/note: ([A-G]#?)/);
      const octaveMatch = message.match(/octave: (\d+)/);

      if (distanceMatch && volumeMatch) {
        const distance = parseInt(distanceMatch[1]);
        const volume = parseInt(volumeMatch[1]);
        const frequency = frequencyMatch ? parseFloat(frequencyMatch[1]) : null;
        const note = noteMatch ? noteMatch[1] : null;
        const octave = octaveMatch ? parseInt(octaveMatch[1]) : null;

        // Insert data into database
        await saveReading(distance, volume, frequency, note, octave);

        // Track player sessions
        const pool = await getDbPool();
        if (distance < 250) {
          // Person detected
          if (!currentSessionId) {
            const result = await pool.sql`
              INSERT INTO player_sessions (start_time) 
              VALUES (NOW()) 
              RETURNING id
            `;
            currentSessionId = result.rows[0].id;
            console.log("New session started:", currentSessionId);
          }
        } else if (currentSessionId) {
          // Person left
          await pool.sql`
            UPDATE player_sessions 
            SET 
              end_time = NOW(), 
              duration_seconds = EXTRACT(EPOCH FROM NOW() - start_time)::INTEGER
            WHERE id = ${currentSessionId}
          `;
          console.log("Session ended:", currentSessionId);
          currentSessionId = null;
        }
      }
    } catch (error) {
      console.error("Error processing message:", error);
    }
  });

  client.on("error", (error) => {
    console.error("MQTT Error:", error);
    if (client) client.end();
    client = null;
  });

  client.on("close", () => {
    console.log("MQTT connection closed");
    client = null;
  });

  return client;
}

// Save reading to database
async function saveReading(distance, volume, frequency, note, octave) {
  try {
    const pool = await getDbPool();
    await pool.sql`
      INSERT INTO readings (distance, volume, frequency, note, octave) 
      VALUES (${distance}, ${volume}, ${frequency}, ${note}, ${octave})
    `;
  } catch (error) {
    console.error("Error saving reading:", error);
  }
}

// Initialize database when called
export default async function handler(req, res) {
  try {
    await initializeDatabase();
    const client = await connectMqtt();

    if (!client || !client.connected) {
      await connectMqtt();
      res.status(200).json({ status: "MQTT connection reestablished" });
    } else {
      res.status(200).json({ status: "MQTT connection active" });
    }
  } catch (error) {
    console.error("Error in MQTT listener:", error);
    res.status(500).json({ error: "Failed to initialize MQTT connection" });
  }
}
