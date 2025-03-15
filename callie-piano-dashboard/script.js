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
let playerData = {}; // Stores daily player counts
let proximityData = []; // Stores all sensor readings for "by day" chart
let playerDetected = false;
let currentPlayerStartTime = null;
let longestDuration = 0;
let startDate = new Date();
startDate.setDate(startDate.getDate() - 6); // Default to last 7 days
let chartMode = "week"; // 'week' or 'day'
let playerChart, proximityChart;

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
  measurementId: "G-QR57S6CVEB",
};

// ✅ Initialize Firebase (with the correct method)
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();

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
  console.log("Connected to MQTT broker!");
  client.subscribe(topic);
}

// **MQTT Message Handling**
function onMessage(topic, payload) {
  let message = payload.toString();
  console.log("MQTT Message Received:", message);

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
    console.log(
      "🚨 No messages received for",
      messageTimeout / 1000,
      "seconds. Assuming person has left."
    );
    updatePresence(false, new Date()); // ✅ Manually switch presence to false
  }

  setTimeout(checkPresenceTimeout, 1000); // ✅ Check every second
}

// **Handle Errors & Disconnections**
function onError(error) {
  console.error("MQTT Error:", error);
}

function onDisconnect() {
  console.log("Disconnected from MQTT broker.");
}

let lastPlayerTime = 0; // ✅ Tracks the last time a player was counted
const playerCooldown = 5000; // ✅ 5 seconds cooldown

async function incrementPlayerCount(timestamp) {
  let currentTime = timestamp.getTime();

  if (currentTime - lastPlayerTime > playerCooldown) {
    let currentDate = timestamp.toISOString().split("T")[0]; // Get YYYY-MM-DD format
    if (!playerData[currentDate]) playerData[currentDate] = 0;
    playerData[currentDate]++;

    let totalPlayers = Object.values(playerData).reduce(
      (sum, val) => sum + val,
      0
    );

    // ✅ Update UI
    document.getElementById("totalPlayers").innerText = totalPlayers;

    // ✅ Store in Firestore
    try {
      await db.collection("stats").doc("global").set(
        {
          totalPlayers: totalPlayers,
        },
        { merge: true }
      );
    } catch (error) {
      console.error("🚨 Error updating total players in Firestore:", error);
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
  console.log(
    `Distance: ${data.distance}, Volume: ${data.volume}, Presence: ${data.presence}, Playing: ${data.playing}`
  );

  let entry = {
    time: timestamp.toISOString(),
    distance: mapProximity(data.distance),
    volume: data.volume,
    presence: data.presence,
    playing: data.playing,
    frequency: data.frequency || null,
    note: data.note || null,
    octave: data.octave || null,
  };

  // ✅ Store in Firestore
  db.collection(COLLECTION_NAME)
    .add(entry)
    .then((docRef) => {
      console.log(
        `🔥 Firestore: Data saved successfully! Document ID: ${docRef.id}`
      );
    })
    .catch((error) => {
      console.error(`🚨 Firestore Error:`, error);
    });

  // ✅ Keep local real-time data
  proximityData.push(entry);

  // ✅ Trim local data to last 24 hours
  let past24Hours = new Date();
  past24Hours.setHours(past24Hours.getHours() - 24);
  proximityData = proximityData.filter((d) => new Date(d.time) >= past24Hours);

  updatePresence(data.presence, timestamp);
  updateCharts();
}

// **Track Player Presence & "Longest on Piano"**
async function updatePresence(presenceDetected, timestamp) {
  let presenceElement = document.getElementById("currentPresence");
  let longestDurationElement = document.getElementById("longestDuration");
  if (!presenceElement || !longestDurationElement) return;

  if (presenceDetected) {
    if (!playerDetected) {
      // ✅ Transition from No → Yes (new session detected)
      playerDetected = true;
      presence = true;
      currentPlayerStartTime = timestamp;

      incrementPlayerCount(timestamp); // ✅ Counts player only if cooldown allows

      presenceElement.innerText = "Yes!";
      presenceElement.style.color = "#52CF8C"; // Green
    }
  } else {
    if (playerDetected) {
      // ✅ Transition from Yes → No (player left)
      playerDetected = false;
      presence = false;
      presenceElement.innerText = "No";
      presenceElement.style.color = "#EE4848"; // Red

      // ✅ Calculate session duration and update longest time
      if (currentPlayerStartTime) {
        let duration = (timestamp - currentPlayerStartTime) / 1000;

        if (duration > longestDuration) {
          longestDuration = duration;
          longestDurationElement.innerText = formatTime(longestDuration);

          // ✅ Save longest duration in Firestore
          try {
            await db.collection("stats").doc("global").set(
              {
                longestDuration: longestDuration,
              },
              { merge: true }
            );
          } catch (error) {
            console.error(
              "🚨 Error updating longest duration in Firestore:",
              error
            );
          }
        }

        currentPlayerStartTime = null; // ✅ Reset session tracking
      }
    }
  }
}

// **Load Historical Data from Firestore**
async function loadHistoricalData() {
  let sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  let snapshot = await db
    .collection(COLLECTION_NAME)
    .where("time", ">=", sevenDaysAgo.toISOString())
    .orderBy("time", "asc")
    .get();

  proximityData = snapshot.docs.map((doc) => doc.data());
  updateCharts();

  // ✅ Fetch stored totalPlayers & longestDuration
  try {
    let statsDoc = await db.collection("stats").doc("global").get();
    if (statsDoc.exists) {
      let data = statsDoc.data();

      if (data.totalPlayers !== undefined) {
        document.getElementById("totalPlayers").innerText = data.totalPlayers;
      }

      if (data.longestDuration !== undefined) {
        longestDuration = data.longestDuration;
        document.getElementById("longestDuration").innerText =
          formatTime(longestDuration);
      }
    }
  } catch (error) {
    console.error("🚨 Error fetching stats from Firestore:", error);
  }
}

// **Update Charts to Include Volume**
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
    proximityChart.data.labels = proximityData.map((d) => new Date(d.time));
    proximityChart.data.datasets[0].data = proximityData.map((d) => ({
      x: new Date(d.time),
      y: d.distance,
    }));
    proximityChart.data.datasets[1].data = proximityData.map((d) => ({
      x: new Date(d.time),
      y: d.volume,
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
    labels.push(
      tempDate.toLocaleDateString("en-US", {
        weekday: "short",
        month: "numeric",
        day: "numeric",
      })
    );
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
  document
    .getElementById("weekView")
    .classList.toggle("active", mode === "week");
  document.getElementById("dayView").classList.toggle("active", mode === "day");

  // ✅ Refresh charts after switching modes
  updateCharts();
}

// **Create Charts**
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
      datasets: [
        {
          label: "Player Count",
          data: getWeekData(),
          backgroundColor: "#126aef",
        },
      ],
    },
    options: {
      responsive: true,
      scales: {
        x: { ticks: { autoSkip: false } },
        y: { beginAtZero: true, ticks: { stepSize: 1, precision: 0 } },
      },
    },
  });

  // ✅ Create "By Day" Line Chart (Proximity + Volume)
  proximityChart = new Chart(ctxLine, {
    type: "line",
    data: {
      labels: [],
      datasets: [
        { label: "Proximity", data: [], borderColor: "black", fill: false },
        { label: "Volume", data: [], borderColor: "red", fill: false },
      ],
    },
    options: {
      responsive: true,
      scales: {
        x: {
          type: "time",
          time: { unit: "minute", displayFormats: { minute: "h:mm a" } },
        },
        y: { title: { display: true, text: "Sensor Readings" } },
      },
    },
  });
}

// **Start Everything**
window.addEventListener("DOMContentLoaded", () => {
  setupMQTT();
  createCharts();
  loadHistoricalData();
  setInterval(loadHistoricalData, 300000); // ✅ Refresh historical data every 5 minutes
  // checkPresenceTimeout(); // ✅ Start absence detection timer
});
