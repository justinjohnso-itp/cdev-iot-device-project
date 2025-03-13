#!/usr/bin/env node
import { execSync } from "child_process";
import readline from "readline";
import fs from "fs";
import path from "path";

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

function question(query) {
  return new Promise((resolve) => {
    rl.question(query, resolve);
  });
}

setup().catch(console.error);
