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

// **Process Incoming Sensor Data**
function processSensorData(distance, volume, timestamp) {
  console.log(`Distance: ${distance}, Volume: ${volume}`);

  // **Log every incoming sensor reading**
  proximityData.push({ time: timestamp, distance: mapProximity(distance) });

  // **Keep only last 24 hours of data**
  let past24Hours = new Date();
  past24Hours.setHours(past24Hours.getHours() - 24);
  proximityData = proximityData.filter((d) => d.time >= past24Hours);

  updatePresence(distance, volume, timestamp);
  updateCharts();
}

// **Track Player Presence & "Longest on Piano"**
function updatePresence(distance, volume, timestamp) {
  let detected = distance < 250; // Threshold for detecting a person

  if (detected && !playerDetected) {
    playerDetected = true;
    presence = true;
    currentPlayerStartTime = timestamp;
    document.getElementById("currentPresence").innerText = "Yes!";
    document.getElementById("currentPresence").style.color = "#52CF8C"; // Green

    let currentDate = timestamp.toISOString().split("T")[0];
    if (!playerData[currentDate]) playerData[currentDate] = 0;
    playerData[currentDate]++;
    document.getElementById("totalPlayers").innerText = Object.values(playerData).reduce((sum, val) => sum + val, 0);
  }

  if (!detected && playerDetected) {
    playerDetected = false;
    presence = false;
    document.getElementById("currentPresence").innerText = "No";
    document.getElementById("currentPresence").style.color = "#EE4848"; // Red

    // **Calculate longest session & update record**
    if (currentPlayerStartTime) {
      let duration = (timestamp - currentPlayerStartTime) / 1000; // Convert to seconds
      if (duration > longestDuration) {
        longestDuration = duration;
        document.getElementById("longestDuration").innerText = formatTime(longestDuration);
      }
    }
    currentPlayerStartTime = null; // Reset tracking
  }
}

// **Format time for longest duration**
function formatTime(seconds) {
  let minutes = Math.floor(seconds / 60);
  let sec = Math.floor(seconds % 60);
  return `${minutes} min ${sec} sec`;
}

// **Map ToF sensor values for line chart**
function mapProximity(distance) {
  return Math.max(0, 250 - distance) / 2.5; // Convert range into 0-100 scale
}

// **Create Charts**
function createCharts() {
  let ctxBar = document.getElementById("playerChart").getContext("2d");
  let ctxLine = document.getElementById("proximityChart").getContext("2d");

  if (playerChart) playerChart.destroy();
  if (proximityChart) proximityChart.destroy();

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

  proximityChart = new Chart(ctxLine, {
    type: "line",
    data: {
      labels: [],
      datasets: [{ 
        label: "Proximity", 
        data: [], 
        borderColor: "black", 
        fill: false 
      }]
    },
    options: {
      responsive: true,
      scales: {
        x: {
          type: 'time',
          time: {
            unit: 'minute',
            displayFormats: { minute: 'h:mm a' },
            min: new Date()
          }
        },
        y: { display: false }
      }
    }
  });
}

// **Update Charts**
function updateCharts() {
  if (!playerChart || !proximityChart) return;

  if (chartMode === "week") {
    playerChart.data.labels = getWeekLabels();
    playerChart.data.datasets[0].data = getWeekData();
    playerChart.update();
    document.getElementById("playerChart").style.display = "block";
    document.getElementById("proximityChart").style.display = "none";
  } else {
    proximityChart.data.labels = proximityData.map(d => d.time);
    proximityChart.data.datasets[0].data = proximityData.map(d => ({
      x: d.time,
      y: d.distance
    }));
    proximityChart.update();
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

// **Pagination**
function prevPeriod() {
  startDate.setDate(startDate.getDate() - (chartMode === "week" ? 7 : 1));
  updateCharts();
}

function nextPeriod() {
  startDate.setDate(startDate.getDate() + (chartMode === "week" ? 7 : 1));
  updateCharts();
}

// **Toggle Between Week & Day View**
function toggleChart(mode) {
  chartMode = mode;
  document.getElementById("weekView").classList.toggle("active", mode === "week");
  document.getElementById("dayView").classList.toggle("active", mode === "day");
  updateCharts();
}

// **Start Everything**
window.addEventListener("DOMContentLoaded", () => {
  setupMQTT();
  createCharts();
});