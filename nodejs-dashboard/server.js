require("dotenv").config();
const express = require("express");
const cors = require("cors");
const mqtt = require("mqtt");
const mysql = require("mysql2/promise");

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static("public"));

// MySQL Connection Pool
const pool = mysql.createPool({
  host: process.env.DB_HOST || "localhost",
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "",
  database: process.env.DB_NAME || "piano_dashboard",
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

// Initialize database tables
async function initializeDatabase() {
  try {
    const connection = await pool.getConnection();

    // Create readings table
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS readings (
        id INT AUTO_INCREMENT PRIMARY KEY,
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        distance INT,
        volume INT,
        frequency FLOAT NULL,
        note VARCHAR(3) NULL,
        octave INT NULL
      )
    `);

    // Create player_sessions table
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS player_sessions (
        id INT AUTO_INCREMENT PRIMARY KEY,
        start_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        end_time TIMESTAMP NULL,
        duration_seconds INT NULL
      )
    `);

    connection.release();
    console.log("Database initialized");
  } catch (error) {
    console.error("Database initialization error:", error);
  }
}

// MQTT Client Setup
const broker = "wss://tigoe.net/mqtt";
const options = {
  clean: true,
  connectTimeout: 10000,
  clientId: "nodejs-server-" + Math.floor(Math.random() * 1000000),
  username: process.env.MQTT_USER || "conndev",
  password: process.env.MQTT_PASSWORD || "b4s1l!",
};
const topic = "conndev/piano";
let isConnected = false;
let currentSessionId = null;

// Connect to MQTT broker
function connectMqtt() {
  const client = mqtt.connect(broker, options);

  client.on("connect", () => {
    console.log("Connected to MQTT broker");
    client.subscribe(topic);
    isConnected = true;
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
        if (distance < 250) {
          // Person detected
          if (!currentSessionId) {
            const [result] = await pool.execute(
              "INSERT INTO player_sessions (start_time) VALUES (NOW())"
            );
            currentSessionId = result.insertId;
            console.log("New session started:", currentSessionId);
          }
        } else if (currentSessionId) {
          // Person left
          await pool.execute(
            "UPDATE player_sessions SET end_time = NOW(), " +
              "duration_seconds = TIMESTAMPDIFF(SECOND, start_time, NOW()) " +
              "WHERE id = ?",
            [currentSessionId]
          );
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
    isConnected = false;
  });

  client.on("close", () => {
    console.log("MQTT connection closed");
    isConnected = false;
    setTimeout(connectMqtt, 5000); // Reconnect after 5 seconds
  });

  return client;
}

// Save reading to database
async function saveReading(distance, volume, frequency, note, octave) {
  try {
    await pool.execute(
      "INSERT INTO readings (distance, volume, frequency, note, octave) VALUES (?, ?, ?, ?, ?)",
      [distance, volume, frequency, note, octave]
    );
  } catch (error) {
    console.error("Error saving reading:", error);
  }
}

// API routes
app.get("/api/readings", async (req, res) => {
  try {
    const { hours = 24 } = req.query;
    const [rows] = await pool.execute(
      "SELECT * FROM readings WHERE timestamp > DATE_SUB(NOW(), INTERVAL ? HOUR) ORDER BY timestamp ASC",
      [parseInt(hours)]
    );
    res.json(rows);
  } catch (error) {
    console.error("Error fetching readings:", error);
    res.status(500).json({ error: "Server error" });
  }
});

app.get("/api/sessions", async (req, res) => {
  try {
    const { days = 7 } = req.query;
    const [rows] = await pool.execute(
      "SELECT * FROM player_sessions WHERE start_time > DATE_SUB(NOW(), INTERVAL ? DAY) " +
        "AND end_time IS NOT NULL ORDER BY start_time ASC",
      [parseInt(days)]
    );
    res.json(rows);
  } catch (error) {
    console.error("Error fetching sessions:", error);
    res.status(500).json({ error: "Server error" });
  }
});

app.get("/api/stats", async (req, res) => {
  try {
    // Get daily player counts for the last week
    const [dailyCounts] = await pool.execute(
      "SELECT DATE(start_time) as date, COUNT(*) as count FROM player_sessions " +
        "WHERE start_time > DATE_SUB(NOW(), INTERVAL 7 DAY) " +
        "GROUP BY DATE(start_time) ORDER BY date ASC"
    );

    // Get longest session
    const [longestSession] = await pool.execute(
      "SELECT MAX(duration_seconds) as longest_duration FROM player_sessions " +
        "WHERE end_time IS NOT NULL"
    );

    // Get total players
    const [totalPlayers] = await pool.execute(
      "SELECT COUNT(*) as total FROM player_sessions"
    );

    // Check for current presence
    const [currentPresence] = await pool.execute(
      "SELECT * FROM player_sessions WHERE end_time IS NULL LIMIT 1"
    );

    res.json({
      dailyCounts,
      longestDuration: longestSession[0].longest_duration || 0,
      totalPlayers: totalPlayers[0].total || 0,
      currentPresence: currentPresence.length > 0,
    });
  } catch (error) {
    console.error("Error fetching stats:", error);
    res.status(500).json({ error: "Server error" });
  }
});

// Status endpoint
app.get("/status", (req, res) => {
  res.json({
    mqtt: isConnected ? "connected" : "disconnected",
    server: "running",
  });
});

// Start server
async function startServer() {
  await initializeDatabase();
  const mqttClient = connectMqtt();

  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });

  // Handle graceful shutdown
  process.on("SIGINT", async () => {
    console.log("Shutting down server...");
    mqttClient.end();
    await pool.end();
    process.exit(0);
  });
}

startServer();
