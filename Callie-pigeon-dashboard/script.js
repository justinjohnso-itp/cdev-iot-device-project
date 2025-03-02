let presence = false;
let pigeonData = {}; // Stores daily pigeon counts
let proximityData = []; // Stores all sensor readings for "by day" chart
let pigeonDetected = false;
let currentPigeonStartTime = null;
let longestDuration = 0;
let startDate = new Date();
startDate.setDate(startDate.getDate() - 6); // Default to last 7 days
let chartMode = "week"; // 'week' or 'day'
let pigeonChart, proximityChart;

// **Start tracking immediately**
function setup() {
  createCharts();
  setInterval(fetchText, 2000);
}

// **Fetch log.json safely**
function fetchText() {
  fetch('log.json?nocache=' + new Date().getTime(), { cache: "no-store" })
    .then(response => response.text())
    .then(data => processSensorData(data))
    .catch(error => console.error("Error fetching data:", error));
}

// **Process incoming sensor data**
function processSensorData(data) {
  let lines = data.trim().split("\n").filter(line => line.trim() !== "");

  if (lines.length > 0) {
    try {
      let lastEntry = JSON.parse(lines[lines.length - 1]);
      let distance = lastEntry.sensor;
      let timestamp = new Date();
      console.log("Latest Distance:", distance);

      // **Always log every incoming sensor reading**
      proximityData.push({ time: timestamp, distance: mapProximity(distance) });

      // **Ensure we only keep the last 24 hours of data**
      let past24Hours = new Date();
      past24Hours.setHours(past24Hours.getHours() - 24);
      proximityData = proximityData.filter(d => d.time >= past24Hours);

      updatePresence(distance, timestamp);
      updateCharts();
    } catch (e) {
      console.error("Error parsing JSON:", e);
    }
  }
}

// **Track pigeon detection & "Longest on Windowsill" correctly**
function updatePresence(distance, timestamp) {
  let detected = distance < 4000;

  if (detected && !pigeonDetected) {
    pigeonDetected = true;
    presence = true;
    currentPigeonStartTime = timestamp; // Start tracking
    document.getElementById("currentPresence").innerText = "Yes!";
    document.getElementById("currentPresence").style.color = "#52CF8C"; // Green

    let currentDate = timestamp.toISOString().split("T")[0];
    if (!pigeonData[currentDate]) pigeonData[currentDate] = 0;
    pigeonData[currentDate]++;
    document.getElementById("totalPigeons").innerText = Object.values(pigeonData).reduce((sum, val) => sum + val, 0);
  }

  if (!detected && pigeonDetected) {
    pigeonDetected = false;
    presence = false;
    document.getElementById("currentPresence").innerText = "No";
    document.getElementById("currentPresence").style.color = "#EE4848"; // Red

    // **Calculate time spent on windowsill & update record**
    if (currentPigeonStartTime) {
      let duration = (timestamp - currentPigeonStartTime) / 1000; // Convert to seconds
      if (duration > longestDuration) {
        longestDuration = duration;
        document.getElementById("longestDuration").innerText = formatTime(longestDuration);
      }
    }
    currentPigeonStartTime = null; // Reset tracking
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
  return Math.max(0, 4000 - distance) / 40; // Convert range into 0-100 scale
}

// **Create Charts - Completely refreshed logic**
function createCharts() {
  let ctxBar = document.getElementById("pigeonChart").getContext("2d");
  let ctxLine = document.getElementById("proximityChart").getContext("2d");

  if (pigeonChart) pigeonChart.destroy();
  if (proximityChart) proximityChart.destroy();

  pigeonChart = new Chart(ctxBar, {
    type: "bar",
    data: {
      labels: getWeekLabels(),
      datasets: [{ 
        label: "Pigeon Count", 
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
            min: new Date() // **Start charting from first logged reading**
          }
        },
        y: { display: false } // Hide Y-axis
      }
    }
  });
}

// **Update Charts with ALL incoming sensor data**
function updateCharts() {
  if (!pigeonChart || !proximityChart) return;

  if (chartMode === "week") {
    pigeonChart.data.labels = getWeekLabels();
    pigeonChart.data.datasets[0].data = getWeekData();
    pigeonChart.update();
    document.getElementById("pigeonChart").style.display = "block";
    document.getElementById("proximityChart").style.display = "none";
  } else {
    // **Plot every single sensor reading over time**
    proximityChart.data.labels = proximityData.map(d => d.time);
    proximityChart.data.datasets[0].data = proximityData.map(d => ({
      x: d.time,
      y: d.distance
    }));
    proximityChart.update();
    document.getElementById("pigeonChart").style.display = "none";
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

// **Get Pigeon Data for Week**
function getWeekData() {
  let data = [];
  let tempDate = new Date(startDate);
  
  for (let i = 0; i < 7; i++) {
    let dateStr = tempDate.toISOString().split("T")[0];
    data.push(pigeonData[dateStr] || 0);
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

// **Attach Event Listeners**
document.getElementById("weekView").addEventListener("click", () => toggleChart("week"));
document.getElementById("dayView").addEventListener("click", () => toggleChart("day"));
document.getElementById("prevButton").addEventListener("click", prevPeriod);
document.getElementById("nextButton").addEventListener("click", nextPeriod);

window.addEventListener("DOMContentLoaded", setup);