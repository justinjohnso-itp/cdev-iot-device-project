// Global variables
let playerChart, proximityChart, frequencyChart;
let playerData = {};
let proximityData = [];
let frequencyData = [];
let currentNote = "";
let currentFrequency = 0;
let startDate = new Date();
let chartMode = "week"; // 'week' or 'day'
startDate.setDate(startDate.getDate() - 6); // Start with the last 7 days

// API base URL - auto-detect between local and production environments
const apiBaseUrl =
  window.location.hostname === "localhost"
    ? "http://localhost:8788/api" // For local Wrangler Pages dev server
    : "/api"; // For deployed Cloudflare Pages site

// MQTT Configuration
const mqttBroker = "wss://tigoe.net/mqtt";
const mqttOptions = {
  clean: true,
  connectTimeout: 10000,
  clientId: "dashboard-browser-" + Math.floor(Math.random() * 1000000),
  username: "conndev",
  password: "b4s1l!",
};
const mqttTopic = "conndev/piano";
let mqttClient;

// Initialize Dashboard
async function initDashboard() {
  try {
    updateConnectionStatus("Connecting to API...");
    await fetchStats();
    await fetchData();
    createCharts();
    updateNote();
    updateConnectionStatus("Connected", true);

    // Set up regular data refresh
    setInterval(async () => {
      await fetchStats();
      await fetchData();
      updateCharts();
      updateNote();
    }, 5000);

    setupMQTT();
  } catch (error) {
    console.error("Dashboard initialization error:", error);
    updateConnectionStatus("Connection failed", false);
  }
}

// Fetch stats data from server
async function fetchStats() {
  try {
    const response = await fetch(`${apiBaseUrl}/stats`);
    if (!response.ok) throw new Error(`HTTP error ${response.status}`);

    const data = await response.json();

    // Process daily counts for player data
    data.dailyCounts.forEach((day) => {
      playerData[day.date] = day.count;
    });

    // Update stat cards
    document.getElementById("totalPlayers").innerText = data.totalPlayers;
    document.getElementById("longestDuration").innerText = formatTime(
      data.longestDuration
    );

    const presenceElement = document.getElementById("currentPresence");
    if (data.currentPresence) {
      presenceElement.innerText = "Yes!";
      presenceElement.style.color = "#52CF8C"; // Green
    } else {
      presenceElement.innerText = "No";
      presenceElement.style.color = "#EE4848"; // Red
    }
  } catch (error) {
    console.error("Error fetching stats:", error);
  }
}

// Fetch sensor data
async function fetchData() {
  try {
    const timeframe = chartMode === "week" ? 168 : 24; // Hours (7 days or 1 day)
    const response = await fetch(`${apiBaseUrl}/readings?hours=${timeframe}`);
    if (!response.ok) throw new Error(`HTTP error ${response.status}`);

    const data = await response.json();

    // Process data for charts
    proximityData = data.map((item) => ({
      time: new Date(item.timestamp),
      distance: mapProximity(item.distance),
    }));

    frequencyData = data
      .filter((item) => item.frequency) // Only include readings with frequency data
      .map((item) => ({
        time: new Date(item.timestamp),
        frequency: item.frequency,
        note: item.note,
        octave: item.octave,
      }));

    // Get the most recent note/frequency if available
    if (frequencyData.length > 0) {
      const latest = frequencyData[frequencyData.length - 1];
      currentNote = latest.note || "--";
      currentFrequency = latest.frequency || 0;
      if (latest.octave) {
        currentNote += latest.octave;
      }
    }
  } catch (error) {
    console.error("Error fetching readings:", error);
  }
}

// Create Charts
function createCharts() {
  const ctxPlayer = document.getElementById("playerChart").getContext("2d");
  const ctxProximity = document
    .getElementById("proximityChart")
    .getContext("2d");
  const ctxFrequency = document
    .getElementById("frequencyChart")
    .getContext("2d");

  if (playerChart) playerChart.destroy();
  if (proximityChart) proximityChart.destroy();
  if (frequencyChart) frequencyChart.destroy();

  // Player Count Chart (bar chart)
  playerChart = new Chart(ctxPlayer, {
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
      maintainAspectRatio: false,
      scales: {
        x: { ticks: { autoSkip: false } },
        y: { beginAtZero: true, ticks: { stepSize: 1, precision: 0 } },
      },
    },
  });

  // Proximity Chart (line chart with time on x-axis)
  proximityChart = new Chart(ctxProximity, {
    type: "line",
    data: {
      datasets: [
        {
          label: "Proximity",
          data: proximityData.map((d) => ({ x: d.time, y: d.distance })),
          borderColor: "#52CF8C",
          backgroundColor: "rgba(82, 207, 140, 0.1)",
          fill: true,
          tension: 0.2,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: {
          type: "time",
          time: {
            unit: "hour",
            displayFormats: { hour: "h:mm a" },
          },
          title: { display: true, text: "Time" },
        },
        y: {
          beginAtZero: true,
          title: { display: true, text: "Proximity (%)" },
        },
      },
      plugins: {
        zoom: {
          zoom: {
            wheel: { enabled: true },
            pinch: { enabled: true },
            mode: "x",
          },
          pan: {
            enabled: true,
            mode: "x",
          },
        },
      },
    },
  });

  // Frequency Chart
  frequencyChart = new Chart(ctxFrequency, {
    type: "scatter",
    data: {
      datasets: [
        {
          label: "Note Frequency",
          data: frequencyData.map((d) => ({ x: d.time, y: d.frequency })),
          backgroundColor: "#126aef",
          pointRadius: 3,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: {
          type: "time",
          time: {
            unit: "hour",
            displayFormats: { hour: "h:mm a" },
          },
          title: { display: true, text: "Time" },
        },
        y: {
          beginAtZero: false,
          title: { display: true, text: "Frequency (Hz)" },
        },
      },
      plugins: {
        zoom: {
          zoom: {
            wheel: { enabled: true },
            pinch: { enabled: true },
            mode: "x",
          },
          pan: {
            enabled: true,
            mode: "x",
          },
        },
        tooltip: {
          callbacks: {
            label: function (context) {
              const point = context.raw;
              const dataset = frequencyData.find(
                (d) => d.time.getTime() === point.x && d.frequency === point.y
              );
              let note = dataset?.note || "";
              if (dataset?.octave) note += dataset.octave;
              return `${point.y} Hz ${note ? "(" + note + ")" : ""}`;
            },
          },
        },
      },
    },
  });

  // Initial visibility based on mode
  updateChartVisibility();
}

// Update Charts
function updateCharts() {
  if (!playerChart || !proximityChart || !frequencyChart) return;

  if (chartMode === "week") {
    playerChart.data.labels = getWeekLabels();
    playerChart.data.datasets[0].data = getWeekData();
    playerChart.update();
  } else {
    // Update proximity chart data
    proximityChart.data.datasets[0].data = proximityData
      .filter((d) => isDataInTimeRange(d.time))
      .map((d) => ({ x: d.time, y: d.distance }));
    proximityChart.update();

    // Update frequency chart data
    frequencyChart.data.datasets[0].data = frequencyData
      .filter((d) => isDataInTimeRange(d.time))
      .map((d) => ({ x: d.time, y: d.frequency }));
    frequencyChart.update();
  }

  // Update chart visibility
  updateChartVisibility();
}

// Check if data point is in the selected time range
function isDataInTimeRange(timestamp) {
  if (chartMode === "week") {
    const endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + 7);
    return timestamp >= startDate && timestamp <= endDate;
  } else {
    const dayStart = new Date(startDate);
    const dayEnd = new Date(startDate);
    dayEnd.setDate(dayEnd.getDate() + 1);
    return timestamp >= dayStart && timestamp <= dayEnd;
  }
}

// Update chart visibility based on selected mode
function updateChartVisibility() {
  if (chartMode === "week") {
    document.getElementById("playerChart").style.display = "block";
    document.getElementById("proximityChart").style.display = "none";
    document.getElementById("frequencyChart").style.display = "none";
  } else {
    document.getElementById("playerChart").style.display = "none";
    document.getElementById("proximityChart").style.display = "block";
    document.getElementById("frequencyChart").style.display = "block";
  }

  document.getElementById("periodLabel").innerText = getPeriodLabel();
}

// Update note display
function updateNote() {
  if (currentNote && currentFrequency) {
    document.querySelector(".note-value").innerText = currentNote;
    document.querySelector(".frequency-value").innerText = `${Math.round(
      currentFrequency
    )} Hz`;
  } else {
    document.querySelector(".note-value").innerText = "--";
    document.querySelector(".frequency-value").innerText = "-- Hz";
  }
}

// Generate week labels
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

// Get data for the week view
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

// Get period label (either week range or day)
function getPeriodLabel() {
  if (chartMode === "week") {
    const endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + 6);
    return `${formatDateShort(startDate)} - ${formatDateShort(endDate)}`;
  } else {
    return formatDateFull(startDate);
  }
}

// Format date as MM/DD
function formatDateShort(date) {
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

// Format date as Month DD, YYYY
function formatDateFull(date) {
  return date.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

// Format time for duration
function formatTime(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins} min ${secs} sec`;
}

// Map proximity values for better visualization
function mapProximity(distance) {
  // Convert ToF sensor reading (mm) to proximity percentage
  // Higher value = closer presence, max distance = 250mm
  return Math.max(0, Math.min(100, (250 - distance) / 2.5));
}

// Update connection status
function updateConnectionStatus(message, connected) {
  const statusElem = document.getElementById("connectionStatus");
  statusElem.innerText = `⚫ ${message}`;

  if (connected === true) {
    statusElem.classList.add("connected");
    statusElem.classList.remove("disconnected");
  } else if (connected === false) {
    statusElem.classList.add("disconnected");
    statusElem.classList.remove("connected");
  } else {
    statusElem.classList.remove("connected");
    statusElem.classList.remove("disconnected");
  }
}

// Handle pagination
function prevPeriod() {
  if (chartMode === "week") {
    startDate.setDate(startDate.getDate() - 7);
  } else {
    startDate.setDate(startDate.getDate() - 1);
  }
  updateCharts();
}

function nextPeriod() {
  if (chartMode === "week") {
    startDate.setDate(startDate.getDate() + 7);
  } else {
    startDate.setDate(startDate.getDate() + 1);
  }
  updateCharts();
}

// Toggle between week and day view
function toggleChart(mode) {
  chartMode = mode;
  document
    .getElementById("weekView")
    .classList.toggle("active", mode === "week");
  document.getElementById("dayView").classList.toggle("active", mode === "day");
  updateCharts();
}

// Initialize the dashboard when the page loads
window.addEventListener("DOMContentLoaded", initDashboard);

// Setup MQTT
function setupMQTT() {
  try {
    mqttClient = mqtt.connect(mqttBroker, mqttOptions);

    mqttClient.on("connect", () => {
      console.log("Connected to MQTT broker");
      updateConnectionStatus("Connected to MQTT", true);
      mqttClient.subscribe(mqttTopic);
    });

    mqttClient.on("message", async (topic, payload) => {
      const message = payload.toString();
      console.log("MQTT message received:", message);

      try {
        // Parse MQTT data and post to API
        const distanceMatch = message.match(/distance: (\d+)/);
        const volumeMatch = message.match(/volume: (\d+)/);

        if (distanceMatch && volumeMatch) {
          const data = {
            distance: parseInt(distanceMatch[1]),
            volume: parseInt(volumeMatch[1]),
          };

          // Add optional fields if present
          const frequencyMatch = message.match(/frequency: ([\d.]+)/);
          if (frequencyMatch) data.frequency = parseFloat(frequencyMatch[1]);

          const noteMatch = message.match(/note: ([A-G]#?)/);
          if (noteMatch) data.note = noteMatch[1];

          const octaveMatch = message.match(/octave: (\d+)/);
          if (octaveMatch) data.octave = parseInt(octaveMatch[1]);

          // Post to API
          await fetch(`${apiBaseUrl}/readings`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(data),
          });
        }
      } catch (e) {
        console.error("Error processing MQTT message:", e);
      }
    });
  } catch (e) {
    console.error("MQTT setup failed:", e);
  }
}
