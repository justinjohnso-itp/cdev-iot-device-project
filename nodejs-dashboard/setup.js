#!/usr/bin/env node
import { execSync } from "child_process";
import readline from "readline";
import fs from "fs";
import path from "path";
import { config } from "dotenv";
import mysql from "mysql2/promise";
import pg from "pg";

const { Pool } = pg;

// Load environment variables
config();

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

/**
 * Setup wizard for the Piano Dashboard application
 */
async function setup() {
  console.log("\n🎹 Piano Dashboard Setup\n");

  // Step 1: Install dependencies
  console.log("📦 Installing dependencies...");
  try {
    execSync("npm install", { stdio: "inherit" });
    console.log("✅ Dependencies installed successfully!\n");
  } catch (error) {
    console.error("❌ Failed to install dependencies:", error);
    process.exit(1);
  }

  // Step 2: Build the frontend
  console.log("🏗️  Building the frontend...");
  try {
    execSync("npm run build", { stdio: "inherit" });
    console.log("✅ Frontend built successfully!\n");
  } catch (error) {
    console.error("❌ Failed to build frontend:", error);
    process.exit(1);
  }

  // Step 3: Ask if user wants to deploy to Vercel
  const deployToVercel = await question(
    "Do you want to deploy to Vercel? (y/n): "
  );

  if (
    deployToVercel.toLowerCase() === "y" ||
    deployToVercel.toLowerCase() === "yes"
  ) {
    console.log("🚀 Preparing for Vercel deployment...");

    // Check if Vercel CLI is installed
    try {
      execSync("vercel --version", { stdio: "pipe" });
    } catch (error) {
      console.log("📥 Installing Vercel CLI...");
      execSync("npm install -g vercel", { stdio: "inherit" });
    }

    console.log("\n🚀 Deploying to Vercel...");
    console.log("Follow these steps during the Vercel CLI setup:");
    console.log("1. Link to an existing project or create a new one");
    console.log("2. After deployment, go to the Vercel dashboard");
    console.log("3. Add a Postgres database from the Storage tab");
    console.log("4. The database connection will be automatically configured");
    console.log("\nStarting Vercel deployment now...");

    execSync("vercel", { stdio: "inherit" });
  }

  console.log("\n🎉 Setup completed successfully!");
  console.log(
    "For local development, you'll need to set up a Postgres database."
  );
  console.log("Add the connection string to your .env file as POSTGRES_URL.");
  rl.close();
}

async function setupMySQL() {
  console.log("Setting up MySQL database...");
  try {
    const pool = mysql.createPool({
      host: process.env.DB_HOST || "localhost",
      user: process.env.DB_USER || "root",
      password: process.env.DB_PASSWORD || "",
      database: process.env.DB_NAME || "piano_dashboard",
      waitForConnections: true,
      connectionLimit: 5,
      queueLimit: 0,
    });

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
    console.log("MySQL readings table created or already exists.");

    // Create player_sessions table
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS player_sessions (
        id INT AUTO_INCREMENT PRIMARY KEY,
        start_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        end_time TIMESTAMP NULL,
        duration_seconds INT NULL
      )
    `);
    console.log("MySQL player_sessions table created or already exists.");

    connection.release();
    await pool.end();
    console.log("MySQL setup completed.");
  } catch (error) {
    console.error("Error setting up MySQL:", error);
  }
}

async function setupPostgres() {
  console.log("Setting up PostgreSQL database...");
  try {
    const pool = new Pool({
      connectionString: process.env.POSTGRES_URL,
      ssl: false, // No SSL for local development
    });

    await pool.query(`
      CREATE TABLE IF NOT EXISTS readings (
        id SERIAL PRIMARY KEY,
        timestamp TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        distance INTEGER,
        volume INTEGER,
        frequency FLOAT,
        note VARCHAR(3),
        octave INTEGER
      )
    `);
    console.log("PostgreSQL readings table created or already exists.");

    await pool.query(`
      CREATE TABLE IF NOT EXISTS player_sessions (
        id SERIAL PRIMARY KEY,
        start_time TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        end_time TIMESTAMPTZ,
        duration_seconds INTEGER
      )
    `);
    console.log("PostgreSQL player_sessions table created or already exists.");

    await pool.end();
    console.log("PostgreSQL setup completed.");
  } catch (error) {
    console.error("Error setting up PostgreSQL:", error);
  }
}

async function main() {
  // Setup both MySQL and PostgreSQL (depending on what's configured)
  if (process.env.DB_HOST) {
    await setupMySQL();
  }

  if (process.env.POSTGRES_URL) {
    await setupPostgres();
  }

  console.log("Database setup complete!");
  process.exit(0);
}

function question(query) {
  return new Promise((resolve) => {
    rl.question(query, resolve);
  });
}

setup().catch(console.error);
main();
