import { config } from "dotenv";
import express from "express";
import cors from "cors";
import mqtt from "mqtt";
import mysql from "mysql2/promise";

// Initialize environment variables
config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static("public"));

// MySQL Connection Pool with improved configuration
let pool;

async function setupDatabaseConnection() {
  try {
    pool = mysql.createPool({
      host: process.env.DB_HOST || "localhost",
      user: process.env.DB_USER || "root",
      password: process.env.DB_PASSWORD || "",
      database: process.env.DB_NAME || "piano_dashboard",
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
      connectTimeout: 10000, // 10 second timeout
      acquireTimeout: 10000,
      // Enable connection retry
      enableKeepAlive: true,
      keepAliveInitialDelay: 10000,
    });

    // Test the connection
    const connection = await pool.getConnection();
    connection.release();
    console.log("Database connection successful");
    return true;
  } catch (error) {
    console.error("Database connection error:", error.message);
    // Schedule a reconnection attempt
    setTimeout(setupDatabaseConnection, 5000);
    return false;
  }
}

// In-memory storage as backup when DB is unavailable
const inMemoryReadings = [];
const inMemorySessions = [];
let isDbConnected = false;

// Initialize database tables
async function initializeDatabase() {
  if (!pool) {
    console.log("Waiting for database connection...");
    return false;
  }

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
    return true;
  } catch (error) {
    console.error("Database initialization error:", error.message);
    return false;
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

      // Try to parse JSON first
      try {
        const data = JSON.parse(message);

        // Extract data from JSON format
        const distance = data.distance;
        const volume = data.volume;
        const frequency = data.frequency;
        const note = data.note;
        const octave = data.octave;

        // Store in memory regardless of DB connection
        inMemoryReadings.push({
          timestamp: new Date(),
          distance,
          volume,
          frequency,
          note,
          octave,
        });

        // Keep memory storage manageable (max 1000 readings)
        if (inMemoryReadings.length > 1000) {
          inMemoryReadings.shift();
        }

        // Try to save to DB if connected
        if (isDbConnected) {
          await saveReading(distance, volume, frequency, note, octave);
        }

        // Process presence data for session tracking
        const presence = data.presence || false;

        if (presence) {
          if (!currentSessionId && isDbConnected) {
            try {
              const [result] = await pool.execute(
                "INSERT INTO player_sessions (start_time) VALUES (NOW())"
              );
              currentSessionId = result.insertId;
              console.log("New session started:", currentSessionId);
            } catch (error) {
              console.error("Failed to start session in DB:", error.message);
            }
          }
        } else if (currentSessionId && isDbConnected) {
          try {
            await pool.execute(
              "UPDATE player_sessions SET end_time = NOW(), " +
                "duration_seconds = TIMESTAMPDIFF(SECOND, start_time, NOW()) " +
                "WHERE id = ?",
              [currentSessionId]
            );
            console.log("Session ended:", currentSessionId);
            currentSessionId = null;
          } catch (error) {
            console.error("Failed to end session in DB:", error.message);
          }
        }
      } catch (jsonError) {
        // Legacy format parsing (fallback)
        console.log("Falling back to regex parsing for non-JSON message");

        const distanceMatch = message.match(/distance: (\d+)/);
        const volumeMatch = message.match(/volume: (\d+)/);
        const frequencyMatch = message.match(/frequency: (\d+)/);
        const noteMatch = message.match(/note: ([A-G]#?)/);
        const octaveMatch = message.match(/octave: (\d+)/);

        if (distanceMatch && volumeMatch) {
          const distance = parseInt(distanceMatch[1]);
          const volume = parseInt(volumeMatch[1]);
          const frequency = frequencyMatch
            ? parseFloat(frequencyMatch[1])
            : null;
          const note = noteMatch ? noteMatch[1] : null;
          const octave = octaveMatch ? parseInt(octaveMatch[1]) : null;

          // Store in memory regardless of DB connection
          inMemoryReadings.push({
            timestamp: new Date(),
            distance,
            volume,
            frequency,
            note,
            octave,
          });

          // Keep memory storage manageable
          if (inMemoryReadings.length > 1000) {
            inMemoryReadings.shift();
          }

          // Try to save to DB if connected
          if (isDbConnected) {
            await saveReading(distance, volume, frequency, note, octave);
          }
        }
      }
    } catch (error) {
      console.error("Error processing message:", error.message);
    }
  });

  client.on("error", (error) => {
    console.error("MQTT Error:", error.message);
    isConnected = false;
  });

  client.on("close", () => {
    console.log("MQTT connection closed");
    isConnected = false;
    setTimeout(connectMqtt, 5000); // Reconnect after 5 seconds
  });

  return client;
}

// Save reading to database with error handling
async function saveReading(distance, volume, frequency, note, octave) {
  if (!isDbConnected) {
    return false;
  }

  try {
    await pool.execute(
      "INSERT INTO readings (distance, volume, frequency, note, octave) VALUES (?, ?, ?, ?, ?)",
      [distance, volume, frequency, note, octave]
    );
    return true;
  } catch (error) {
    console.error("Error saving reading:", error.message);
    // Schedule a database reconnection attempt on failure
    isDbConnected = false;
    setupDatabaseConnection();
    return false;
  }
}

// API routes with fallbacks to in-memory data
app.get("/api/readings", async (req, res) => {
  try {
    const { hours = 24 } = req.query;

    if (!isDbConnected) {
      console.log("Database not connected. Using in-memory readings.");
      // Filter in-memory readings by timestamp
      const cutoffTime = new Date(Date.now() - hours * 60 * 60 * 1000);
      const filteredReadings = inMemoryReadings.filter(
        (r) => r.timestamp > cutoffTime
      );
      return res.json(filteredReadings);
    }

    const [rows] = await pool.execute(
      "SELECT * FROM readings WHERE timestamp > DATE_SUB(NOW(), INTERVAL ? HOUR) ORDER BY timestamp ASC",
      [parseInt(hours)]
    );
    res.json(rows);
  } catch (error) {
    console.error("Error fetching readings:", error.message);
    // Return in-memory data as fallback
    const cutoffTime = new Date(
      Date.now() - parseInt(req.query.hours || 24) * 60 * 60 * 1000
    );
    const filteredReadings = inMemoryReadings.filter(
      (r) => r.timestamp > cutoffTime
    );
    res.json(filteredReadings);
  }
});

app.get("/api/sessions", async (req, res) => {
  try {
    if (!isDbConnected) {
      console.log("Database not connected. Using in-memory sessions.");
      return res.json(inMemorySessions);
    }

    const { days = 7 } = req.query;
    const [rows] = await pool.execute(
      "SELECT * FROM player_sessions WHERE start_time > DATE_SUB(NOW(), INTERVAL ? DAY) " +
        "AND end_time IS NOT NULL ORDER BY start_time ASC",
      [parseInt(days)]
    );
    res.json(rows);
  } catch (error) {
    console.error("Error fetching sessions:", error.message);
    res.json(inMemorySessions);
  }
});

app.get("/api/stats", async (req, res) => {
  try {
    if (!isDbConnected) {
      console.log("Database not connected. Using default stats.");
      return res.json({
        dailyCounts: [],
        longestDuration: 0,
        totalPlayers: 0,
        currentPresence: false,
      });
    }

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
    console.error("Error fetching stats:", error.message);
    res.status(200).json({
      dailyCounts: [],
      longestDuration: 0,
      totalPlayers: inMemorySessions.length,
      currentPresence: currentSessionId !== null,
    });
  }
});

// Status endpoint with database status
app.get("/status", (req, res) => {
  res.json({
    mqtt: isConnected ? "connected" : "disconnected",
    database: isDbConnected ? "connected" : "disconnected",
    server: "running",
    readings_count: inMemoryReadings.length,
    sessions_count: inMemorySessions.length,
  });
});

// Start server
async function startServer() {
  // First attempt to connect to database
  isDbConnected = await setupDatabaseConnection();

  if (isDbConnected) {
    // Try to initialize tables
    await initializeDatabase();
  } else {
    console.log(
      "Starting server with no database connection. Will retry connecting..."
    );
  }

  // Connect to MQTT regardless of DB status
  const mqttClient = connectMqtt();

  // Start Express server
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });

  // Periodically attempt to reconnect to database if disconnected
  setInterval(async () => {
    if (!isDbConnected) {
      console.log("Attempting to reconnect to database...");
      isDbConnected = await setupDatabaseConnection();
      if (isDbConnected) {
        await initializeDatabase();
      }
    }
  }, 30000); // Try every 30 seconds

  // Handle graceful shutdown
  process.on("SIGINT", async () => {
    console.log("Shutting down server...");
    mqttClient.end();
    if (pool) {
      await pool.end();
    }
    process.exit(0);
  });
}

startServer();
