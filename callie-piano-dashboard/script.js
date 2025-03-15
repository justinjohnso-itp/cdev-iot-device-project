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
const COLLECTION_NAME = "piano_data";

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

  // Extract distance and volume from the message
  let distanceMatch = message.match(/distance: (\d+)/);
  let volumeMatch = message.match(/volume: (\d+)/);
  if (distanceMatch && volumeMatch) {
    let distance = parseInt(distanceMatch[1]);
    let volume = parseInt(volumeMatch[1]);
    let timestamp = new Date();

    processSensorData(distance, volume, timestamp);
  }
}

// **Handle Errors & Disconnections**
function onError(error) {
  console.error("MQTT Error:", error);
}

function onDisconnect() {
  console.log("Disconnected from MQTT broker.");
}

// **Map ToF sensor values for line chart**
function mapProximity(distance) {
  return Math.max(0, 250 - distance) / 2.5; // Convert range into 0-100 scale
}
// **Process Incoming Sensor Data**
function processSensorData(distance, volume, timestamp) {
  console.log(`Distance: ${distance}, Volume: ${volume}`);

  let entry = {
    time: timestamp.toISOString(),
    distance: mapProximity(distance),
    volume: volume,
  };

  // ✅ Store in Firestore with explicit logging
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

  // ✅ Also keep local real-time data
  proximityData.push(entry);

  // ✅ Trim local data to last 24 hours
  let past24Hours = new Date();
  past24Hours.setHours(past24Hours.getHours() - 24);
  proximityData = proximityData.filter((d) => new Date(d.time) >= past24Hours);

  updatePresence(distance, volume, timestamp);
  updateCharts();
}

// **Track Player Presence & "Longest on Piano"**
function updatePresence(distance, volume, timestamp) {
  let detected = distance < 250; // Threshold for detecting a person
  let presenceElement = document.getElementById("currentPresence");
  let totalPlayersElement = document.getElementById("totalPlayers");
  let longestDurationElement = document.getElementById("longestDuration");

  if (!presenceElement || !totalPlayersElement || !longestDurationElement) {
    console.error("One or more elements not found in DOM.");
    return;
  }

  if (detected && !playerDetected) {
    playerDetected = true;
    presence = true;
    currentPlayerStartTime = timestamp;
    presenceElement.innerText = "Yes!";
    presenceElement.style.color = "#52CF8C"; // Green
  }

  if (!detected && playerDetected) {
    playerDetected = false;
    presence = false;
    presenceElement.innerText = "No";
    presenceElement.style.color = "#EE4848"; // Red

    if (currentPlayerStartTime) {
      let duration = (timestamp - currentPlayerStartTime) / 1000; // Convert to seconds
      if (duration > longestDuration) {
        longestDuration = duration;
        longestDurationElement.innerText = formatTime(longestDuration);
      }
    }
    currentPlayerStartTime = null;
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
  startDate.setDate(startDate.getDate() - (chartMode === "week" ? 7 : 1));
  updateCharts();
}

function nextPeriod() {
  startDate.setDate(startDate.getDate() + (chartMode === "week" ? 7 : 1));
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
  loadHistoricalData(); // ✅ Load stored data on page load
  setInterval(loadHistoricalData, 300000); // ✅ Refresh historical data every 5 minutes
});
