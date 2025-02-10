import { Chart } from "chart.js/auto";

// Fetch data
async function fetchData(url) {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Response status: ${response.status}`);
    }
    const text = await response.text();
    const json = text
      .split("\n")
      .filter((line) => line.trim() !== "") // Remove empty lines
      .map((line) => JSON.parse(line.replace(/\\\"/g, '"'))); // Parse each line as JSON
    return json;
  } catch (error) {
    console.error(error.message);
  }
}

// Chart.js
(async function (url) {
  const sensorData = await fetchData("log.json");
  const labels = sensorData.map((data) => data.time);
  new Chart(document.getElementById("tof-sensor"), {
    type: "line",
    data: {
      labels: labels,
      datasets: [
        {
          label: "My First Dataset",
          data: sensorData.map((data) => data.sensor),
          fill: false,
          borderColor: "rgb(75, 192, 192)",
          tension: 0.1,
        },
      ],
    },
  });
})();
