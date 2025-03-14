let lastMessageTime = Date.now(); // ✅ Stores the last received message timestamp
const messageTimeout = 5000; // ✅ 5 seconds timeout for detecting absence

// MQTT Configuration
const broker = "wss://tigoe.net/mqtt";
let client;
let options = {
  clean: true,
  connectTimeout: 10000,
  clientId: "mqttJsClient-" + Math.floor(Math.random() * 1000000),
  username: "conndev",
  password: "b4s1l!",
};
let topic = "conndev/piano";

// Dashboard Data
let presence = false;
let playing = false;
let playerData = {}; // Stores daily player counts
let proximityData = []; // Stores all sensor readings for "by day" chart
let playerDetected = false;
let currentPlayerStartTime = null;
let longestDuration = 0;
let startDate = new Date();
startDate.setDate(startDate.getDate() - 6); // Default to last 7 days
let chartMode = "week"; // 'week' or 'day'
let playerChart, proximityChart;

// New tracking variables for smoother detection
let recentVolumeReadings = []; // Store last 3 volume readings - reduced from 5
let recentPresenceReadings = []; // Store last 5 presence readings
let volumeThreshold = 165; // Volume threshold for playing detection
const requiredVolumesAboveThreshold = 2; // Need 2 high volumes to consider "playing" - reduced from 3
const requiredPresencesToLeave = 5; // Need 5 consecutive absence readings to consider "left"

// Add this near the other constants at the top
const COLLECTION_NAME = "piano_data-1";

// ✅ Replace with your Firebase config
// ✅ Firebase Config
const firebaseConfig = {
  apiKey: "AIzaSyCBUSirl23Ujv-d1p1UxkkO5f6AyFJ3oyo",
  authDomain: "conndev-piano.firebaseapp.com",
  projectId: "conndev-piano",
  storageBucket: "conndev-piano.firebasestorage.app",
  messagingSenderId: "382160912769",
  appId: "1:382160912769:web:0c718b517ec90122fee880",
  measurementId: "G-QR57S6CVEB"
};

// ✅ Initialize Firebase (with the correct method)
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();

// Format time for display (seconds to MM:SS)
function formatTime(seconds) {
  let minutes = Math.floor(seconds / 60);
  let remainingSeconds = Math.floor(seconds % 60);
  return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
}

// **MQTT Setup**
function setupMQTT() {
  client = mqtt.connect(broker, options);
  client.on("connect", onConnect);
  client.on("message", onMessage);
  client.on("error", onError);
  client.on("close", onDisconnect);
}

// **MQTT Connect Event**
function onConnect() {
  // console.log("Connected to MQTT broker!");
  client.subscribe(topic);
}

// **MQTT Message Handling**
function onMessage(topic, payload) {
  let message = payload.toString();
  // console.log("MQTT Message Received:", message);

  try {
    let data = JSON.parse(message); // ✅ Parse JSON
    lastMessageTime = Date.now(); // ✅ Update last message timestamp

    let timestamp = new Date();
    processSensorData(data, timestamp);
  } catch (error) {
    console.error("🚨 Error parsing MQTT message:", error);
  }
}

function checkPresenceTimeout() {
  let currentTime = Date.now();
  let timeSinceLastMessage = currentTime - lastMessageTime;

  if (timeSinceLastMessage > messageTimeout) {
    // console.log("🚨 No messages received for", messageTimeout / 1000, "seconds. Assuming person has left.");
    updatePresence(false, false, new Date()); // ✅ Manually switch presence to false
  }

  setTimeout(checkPresenceTimeout, 1000); // ✅ Check every second
}

// **Handle Errors & Disconnections**
function onError(error) {
  console.error("MQTT Error:", error);
}

function onDisconnect() {
  // console.log("Disconnected from MQTT broker.");
}

let lastPlayerTime = 0; // ✅ Tracks the last time a player was counted
const playerCooldown = 5000; // ✅ 5 seconds cooldown


async function incrementPlayerCount(timestamp) {
  let currentTime = timestamp.getTime();
  
  if (currentTime - lastPlayerTime > playerCooldown) {
    let currentDate = timestamp.toISOString().split("T")[0]; // Get YYYY-MM-DD format
    if (!playerData[currentDate]) playerData[currentDate] = 0;
    playerData[currentDate]++;

    let totalPlayers = Object.values(playerData).reduce((sum, val) => sum + val, 0);

    // ✅ Update UI
    document.getElementById("totalPlayers").innerText = totalPlayers;

    // console.log(`Player count incremented for ${currentDate}. New total: ${totalPlayers}`);

    // ✅ Store in Firestore - both in global stats and in daily records
    try {
      // Update the global counter
      await db.collection("stats").doc("global").set({
        totalPlayers: totalPlayers
      }, { merge: true });
      
      // Store/update the daily count in a separate collection for persistence
      const dailyRef = db.collection("player_counts").doc(currentDate);
      const dailyDoc = await dailyRef.get();
      
      if (dailyDoc.exists) {
        // Update existing count
        await dailyRef.update({
          count: playerData[currentDate]
        });
      } else {
        // Create new daily record
        await dailyRef.set({
          date: currentDate,
          count: playerData[currentDate]
        });
      }
      
      // console.log(`✅ Updated player count in Firestore for ${currentDate}: ${playerData[currentDate]}`);
    } catch (error) {
      console.error("🚨 Error updating player counts in Firestore:", error);
    }

    updateCharts();
    lastPlayerTime = currentTime;
  }
}

// **Map ToF sensor values for line chart**
function mapProximity(distance) {
  return Math.max(0, 250 - distance) / 2.5; // Convert range into 0-100 scale
}

// **Process Incoming Sensor Data**
function processSensorData(data, timestamp) {
  // console.log(`Distance: ${data.distance}, Volume: ${data.volume}, Presence: ${data.presence}, Playing: ${data.playing}`);

  // Track recent volume readings (keep last 3 - reduced from 5)
  recentVolumeReadings.push(data.volume);
  if (recentVolumeReadings.length > 3) {
    recentVolumeReadings.shift(); // Remove oldest reading
  }
  
  // Track recent presence readings (keep last 5)
  recentPresenceReadings.push(data.presence);
  if (recentPresenceReadings.length > 5) {
    recentPresenceReadings.shift(); // Remove oldest reading
  }
  
  // For very high volumes, immediately consider as playing
  const isVeryHighVolume = data.volume >= volumeThreshold + 20; // 185+ is definitely playing
  
  // Calculate if someone is playing based on volume pattern
  // Need at least 2 out of 3 recent readings above threshold to consider "playing"
  const volumesAboveThreshold = recentVolumeReadings.filter(v => v >= volumeThreshold).length;
  const smoothedPlaying = isVeryHighVolume || volumesAboveThreshold >= requiredVolumesAboveThreshold;
  
  // Calculate if someone is present based on consecutive readings
  // Need all 5 most recent readings to be false to consider "not present"
  const consecutiveAbsences = recentPresenceReadings.filter(p => p === false).length;
  const smoothedPresence = !(consecutiveAbsences >= requiredPresencesToLeave);
  
  // Log the smoothed detection values
  // console.log(`Smoothed detection: presence=${smoothedPresence} (${consecutiveAbsences}/5 absent), playing=${smoothedPlaying} (${volumesAboveThreshold}/3 volumes above ${volumeThreshold})`);
  // if (isVeryHighVolume) console.log("Very high volume detected - immediate playing state!");

  let entry = {
    time: timestamp.toISOString(),
    distance: mapProximity(data.distance),
    volume: data.volume,
    rawPresence: data.presence,  // Store raw values
    rawPlaying: data.playing,    // Store raw values
    smoothedPresence: smoothedPresence, // Store calculated values 
    smoothedPlaying: smoothedPlaying,   // Store calculated values
    frequency: data.frequency || null,
    note: data.note || null,
    octave: data.octave || null
  };

  // Keep local real-time data regardless of presence
  proximityData.push(entry);

  // Trim local data to last 24 hours
  let past24Hours = new Date();
  past24Hours.setHours(past24Hours.getHours() - 24);
  proximityData = proximityData.filter(d => new Date(d.time) >= past24Hours);

  // Only store in Firestore if someone is actually present
  // This saves on database usage
  if (smoothedPresence) {
    db.collection(COLLECTION_NAME).add(entry)
      .then((docRef) => {
        // console.log(`🔥 Firestore: Data saved successfully! Document ID: ${docRef.id}`);
      })
      .catch(error => {
        console.error(`🚨 Firestore Error:`, error);
      });
  } else {
    // console.log("💾 Skipping Firestore storage since no one is present");
  }

  // Update presence using the smoothed values
  updatePresence(smoothedPresence, smoothedPlaying, timestamp);
  updateCharts();
}


// **Track Player Presence & "Longest on Piano"**
async function updatePresence(presenceDetected, isPlaying, timestamp) {
  let presenceElement = document.getElementById("currentPresence");
  let longestDurationElement = document.getElementById("longestDuration");
  if (!presenceElement || !longestDurationElement) return;
 
  // We're now working with smoothed values from processSensorData
  // console.log(`Player status assessment: presence=${presenceDetected}, playing=${isPlaying}`);

  // Handle situation when someone is at the piano (present)
  if (presenceDetected) {
    // Update UI to show someone is present
    presenceElement.innerText = isPlaying ? "Yes!" : "Present, not playing";
    presenceElement.style.color = isPlaying ? "#52CF8C" : "#FFA500"; // Green when playing, Orange when just present
    
    // Track state
    presence = true;
    
    // Handle transition to playing
    if (isPlaying) {
      playing = true;
      
      // If this is a new session (no player detected before)
      if (!playerDetected) {
        // console.log("✨ NEW PLAYER DETECTED!");
        playerDetected = true;
        currentPlayerStartTime = timestamp;
        incrementPlayerCount(timestamp); // Increment player count
      }
      // If player was detected but not playing before, don't count as new player
      // This handles breaks in playing while still present
    }
  } 
  // Handle situation when no one is at the piano (not present)
  else {
    // Only process departure if we previously detected someone
    if (playerDetected || presence) {
      // console.log("👋 PLAYER LEFT");
      playerDetected = false;
      presence = false;
      playing = false;
      
      presenceElement.innerText = "No";
      presenceElement.style.color = "#EE4848"; // Red
      
      // Calculate session duration and update longest time
      if (currentPlayerStartTime) {
        let duration = (timestamp - currentPlayerStartTime) / 1000;
        // console.log(`Session duration: ${duration} seconds`);
        
        if (duration > longestDuration) {
          longestDuration = duration;
          longestDurationElement.innerText = formatTime(longestDuration);
          // console.log(`🏆 New longest duration: ${formatTime(longestDuration)}`);
          
          // Save longest duration in Firestore
          try {
            await db.collection("stats").doc("global").set({
              longestDuration: longestDuration
            }, { merge: true });
            // console.log(`✅ Saved new record to Firestore`);
          } catch (error) {
            console.error("🚨 Error updating longest duration in Firestore:", error);
          }
        }
        
        currentPlayerStartTime = null; // Reset session tracking
      }
    }
  }
}

// **Load Historical Data from Firestore**
async function loadHistoricalData() {
  // console.log("Loading historical data from Firestore...");
  let sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  try {
    // First, load player data by day for the charts
    let playerDataSnapshot = await db.collection("player_counts")
      .where("date", ">=", sevenDaysAgo.toISOString().split("T")[0])
      .get();
      
    // Initialize player data
    playerData = {};
    
    // Process player count data
    playerDataSnapshot.forEach(doc => {
      const data = doc.data();
      playerData[data.date] = data.count;
      // console.log(`Loaded player count for ${data.date}: ${data.count}`);
    });
    
    // Load sensor data for proximity chart
    let sensorSnapshot = await db.collection(COLLECTION_NAME)
      .where("time", ">=", sevenDaysAgo.toISOString())
      .orderBy("time", "asc")
      .limit(1000) // Limit to prevent too much data
      .get();

    proximityData = sensorSnapshot.docs.map(doc => doc.data());
    // console.log(`Loaded ${proximityData.length} sensor data points`);
    
    // ✅ Fetch stored totalPlayers & longestDuration
    let statsDoc = await db.collection("stats").doc("global").get();
    if (statsDoc.exists) {
      let data = statsDoc.data();
      // console.log("Retrieved global stats:", data);
      
      if (data.totalPlayers !== undefined) {
        document.getElementById("totalPlayers").innerText = data.totalPlayers;
        // console.log(`Total players: ${data.totalPlayers}`);
      }

      if (data.longestDuration !== undefined) {
        longestDuration = data.longestDuration;
        document.getElementById("longestDuration").innerText = formatTime(longestDuration);
        // console.log(`Longest duration: ${formatTime(longestDuration)}`);
      }
    } else {
      // console.log("No global stats document found. Creating one...");
      // Initialize the global stats if they don't exist
      await db.collection("stats").doc("global").set({
        totalPlayers: 0,
        longestDuration: 0
      });
    }
    
    updateCharts();
  } catch (error) {
    console.error("🚨 Error loading data from Firestore:", error);
  }
}

// **Update Charts**
function updateCharts() {
  if (!playerChart || !proximityChart) return;

  if (chartMode === "week") {
    // ✅ Show "By Week" bar chart
    playerChart.data.labels = getWeekLabels();
    playerChart.data.datasets[0].data = getWeekData();
    playerChart.update();

    // ✅ Show bar chart, hide line chart
    document.getElementById("playerChart").style.display = "block";
    document.getElementById("proximityChart").style.display = "none";
  } else {
    // ✅ Show "By Day" line chart
    proximityChart.data.labels = proximityData.map(d => new Date(d.time));
    proximityChart.data.datasets[0].data = proximityData.map(d => ({
      x: new Date(d.time),
      y: d.distance
    }));
    proximityChart.data.datasets[1].data = proximityData.map(d => ({
      x: new Date(d.time),
      y: d.volume
    }));
    proximityChart.update();

    // ✅ Show line chart, hide bar chart
    document.getElementById("playerChart").style.display = "none";
    document.getElementById("proximityChart").style.display = "block";
  }
}

// **Generate Week Labels**
function getWeekLabels() {
  let labels = [];
  let tempDate = new Date(startDate);
  for (let i = 0; i < 7; i++) {
    labels.push(tempDate.toLocaleDateString("en-US", { 
      weekday: "short", 
      month: "numeric", 
      day: "numeric" 
    }));
    tempDate.setDate(tempDate.getDate() + 1);
  }
  return labels;
}

// **Get Player Data for Week**
function getWeekData() {
  let data = [];
  let tempDate = new Date(startDate);
  
  for (let i = 0; i < 7; i++) {
    let dateStr = tempDate.toISOString().split("T")[0];
    data.push(playerData[dateStr] || 0);
    tempDate.setDate(tempDate.getDate() + 1);
  }
  return data;
}

// **Pagination Controls: Move to Previous or Next Period**
function prevPeriod() {
  if (chartMode === "week") {
    startDate.setDate(startDate.getDate() - 7); // Move back by a week
  } else {
    startDate.setDate(startDate.getDate() - 1); // Move back by a day
  }
  updateCharts();
}

function nextPeriod() {
  if (chartMode === "week") {
    startDate.setDate(startDate.getDate() + 7); // Move forward by a week
  } else {
    startDate.setDate(startDate.getDate() + 1); // Move forward by a day
  }
  updateCharts();
}

function toggleChart(mode) {
  chartMode = mode;

  // ✅ Toggle button styles
  document.getElementById("weekView").classList.toggle("active", mode === "week");
  document.getElementById("dayView").classList.toggle("active", mode === "day");

  // ✅ Refresh charts after switching modes
  updateCharts();
}

// **Create Charts**
function createCharts() {
  let ctxBar = document.getElementById("playerChart")?.getContext("2d");
  let ctxLine = document.getElementById("proximityChart")?.getContext("2d");

  if (!ctxBar || !ctxLine) {
    console.error("Chart elements not found in DOM.");
    return;
  }

  if (playerChart) playerChart.destroy();
  if (proximityChart) proximityChart.destroy();

  // ✅ Create "By Week" Bar Chart (Player Count)
  playerChart = new Chart(ctxBar, {
    type: "bar",
    data: {
      labels: getWeekLabels(),
      datasets: [{ 
        label: "Player Count", 
        data: getWeekData(), 
        backgroundColor: "#126aef" 
      }]
    },
    options: {
      responsive: true,
      scales: {
        x: { ticks: { autoSkip: false } },
        y: { beginAtZero: true, ticks: { stepSize: 1, precision: 0 } }
      }
    }
  });

  // ✅ Create "By Day" Line Chart (Proximity + Volume)
  proximityChart = new Chart(ctxLine, {
    type: "line",
    data: {
      labels: [],
      datasets: [
        { label: "Proximity", data: [], borderColor: "black", fill: false },
        { label: "Volume", data: [], borderColor: "red", fill: false }
      ]
    },
    options: {
      responsive: true,
      scales: {
        x: {
          type: 'time',
          time: { unit: 'minute', displayFormats: { minute: 'h:mm a' } }
        },
        y: { title: { display: true, text: "Sensor Readings" } }
      }
    }
  });
}

// **Start Everything**
window.addEventListener("DOMContentLoaded", () => {
  setupMQTT();
  createCharts();
  loadHistoricalData(); 
  setInterval(loadHistoricalData, 300000); // ✅ Refresh historical data every 5 minutes
  checkPresenceTimeout(); // ✅ Start absence detection timer
});