const API_BASE = "http://localhost:4000";
const PARK_ID = 1;

const deviceIdKey = "parkapp_device_id";
let deviceId = localStorage.getItem(deviceIdKey);
if (!deviceId) {
  deviceId = crypto.randomUUID();
  localStorage.setItem(deviceIdKey, deviceId);
}

const map = L.map("map", { zoomControl: false }).setView([38.676, -77.255], 13);
L.control.zoom({ position: "bottomright" }).addTo(map);

const lightTiles = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: "&copy; OpenStreetMap contributors"
}).addTo(map);

const darkTiles = L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
  maxZoom: 19,
  attribution: "&copy; OpenStreetMap & CARTO"
});

let isDark = false;

const trailsLayer = L.geoJSON(null, {
  style: feature => {
    const d = feature.properties.difficulty;
    return {
      weight: 4,
      color:
        d === "easy" ? "#2e8b57" :
        d === "moderate" ? "#d4a017" :
        "#c0392b"
    };
  },
  onEachFeature: (feature, layer) => {
    const p = feature.properties;
    layer.bindPopup(`
      <b>${p.name || "Trail"}</b><br>
      Difficulty: ${p.difficulty || "N/A"}<br>
      Length: ${p.length_mi || "N/A"} mi
    `);
  }
});

const facilitiesLayer = L.geoJSON(null, {
  pointToLayer: (feature, latlng) => L.circleMarker(latlng, {
    radius: 7,
    fillColor: "#2b7cff",
    color: "#ffffff",
    weight: 2,
    fillOpacity: 0.95
  }),
  onEachFeature: (feature, layer) => {
    const p = feature.properties;
    layer.bindPopup(`
      <b>${p.name || p.type || "Facility"}</b><br>
      Type: ${p.type || "N/A"}<br>
      Accessible: ${p.accessible ? "Yes" : "No"}
    `);
  }
});

const parkingLayer = L.geoJSON(null, {
  pointToLayer: (feature, latlng) => L.circleMarker(latlng, {
    radius: 7,
    fillColor: "#6c5ce7",
    color: "#ffffff",
    weight: 2,
    fillOpacity: 0.95
  }),
  onEachFeature: (feature, layer) => {
    const p = feature.properties;
    layer.bindPopup(`
      <b>${p.name || "Parking"}</b><br>
      Capacity: ${p.capacity || "N/A"}
    `);
  }
});

const sensitiveLayer = L.geoJSON(null, {
  style: {
    color: "#16a085",
    weight: 2,
    fillOpacity: 0.25
  },
  onEachFeature: (feature, layer) => {
    const p = feature.properties;
    layer.bindPopup(`
      <b>${p.area_type || "Sensitive Area"}</b><br>
      ${p.note || ""}
    `);
  }
});

const reportsLayer = L.geoJSON(null, {
  pointToLayer: (feature, latlng) => {
    const status = feature.properties.status;
    const color = status === "verified" ? "#00b894" : status === "rejected" ? "#636e72" : "#ff9f43";
    return L.circleMarker(latlng, {
      radius: 8,
      fillColor: color,
      color: "#ffffff",
      weight: 2,
      fillOpacity: 0.95
    });
  },
  onEachFeature: (feature, layer) => {
    const p = feature.properties;
    layer.bindPopup(`
      <b>${p.category}</b> (${p.status})<br>
      ${escapeHtml(p.description)}<br>
      <small>${new Date(p.created_at).toLocaleString()}</small>
    `);
  }
});

const searchLayer = L.geoJSON(null);

let pin = null;
let pinLatLng = null;
let currentDifficulty = "all";
let currentMaxLength = 10;

async function loadStaticLayers() {
  const datasets = [
    { url: "data/trails.geojson", layer: trailsLayer },
    { url: "data/facilities.geojson", layer: facilitiesLayer },
    { url: "data/parking.geojson", layer: parkingLayer },
    { url: "data/sensitive.geojson", layer: sensitiveLayer }
  ];

  for (const item of datasets) {
    try {
      const r = await fetch(item.url);
      const gj = await r.json();
      item.layer.clearLayers();
      item.layer.addData(gj);
    } catch (err) {
      console.error("Failed to load", item.url, err);
    }
  }

  trailsLayer.addTo(map);
  facilitiesLayer.addTo(map);
  parkingLayer.addTo(map);
  sensitiveLayer.addTo(map);
  reportsLayer.addTo(map);
  searchLayer.addTo(map);
}

async function refreshReports() {
  try {
    const b = map.getBounds();
    const bbox = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()].join(",");
    const url = `${API_BASE}/api/reports?park_id=${PARK_ID}&bbox=${encodeURIComponent(bbox)}`;
    const r = await fetch(url);
    const data = await r.json();

    reportsLayer.clearLayers();

    const fc = {
      type: "FeatureCollection",
      features: (data.reports || []).map(r => ({
        type: "Feature",
        properties: r,
        geometry: r.geom
      }))
    };

    reportsLayer.addData(fc);
  } catch (err) {
    console.error(err);
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, m => ({
    "&":"&amp;",
    "<":"&lt;",
    ">":"&gt;",
    '"':"&quot;",
    "'":"&#039;"
  }[m]));
}

function setMsg(text, ok = true) {
  const el = document.getElementById("msg");
  el.textContent = text;
  el.className = `msg ${ok ? "ok" : "err"}`;
}

function setLayerVisible(layer, isVisible) {
  if (isVisible) {
    if (!map.hasLayer(layer)) layer.addTo(map);
  } else {
    if (map.hasLayer(layer)) map.removeLayer(layer);
  }
}

function filterTrails() {
  fetch("data/trails.geojson")
    .then(r => r.json())
    .then(data => {
      const filtered = {
        ...data,
        features: data.features.filter(f => {
          const d = f.properties.difficulty || "";
          const len = Number(f.properties.length_mi || 999);
          const difficultyMatch = currentDifficulty === "all" || d === currentDifficulty;
          const lengthMatch = len <= currentMaxLength;
          return difficultyMatch && lengthMatch;
        })
      };
      trailsLayer.clearLayers();
      trailsLayer.addData(filtered);
    });
}

document.querySelectorAll(".tab-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
    document.querySelectorAll(".tab-panel").forEach(p => p.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById(btn.dataset.tab).classList.add("active");
  });
});

document.getElementById("darkModeBtn").addEventListener("click", () => {
  document.body.classList.toggle("dark");
  isDark = !isDark;
  if (isDark) {
    map.removeLayer(lightTiles);
    darkTiles.addTo(map);
  } else {
    map.removeLayer(darkTiles);
    lightTiles.addTo(map);
  }
});

document.getElementById("toggleTrails").addEventListener("change", e => setLayerVisible(trailsLayer, e.target.checked));
document.getElementById("toggleFacilities").addEventListener("change", e => setLayerVisible(facilitiesLayer, e.target.checked));
document.getElementById("toggleParking").addEventListener("change", e => setLayerVisible(parkingLayer, e.target.checked));
document.getElementById("toggleSensitive").addEventListener("change", e => setLayerVisible(sensitiveLayer, e.target.checked));
document.getElementById("toggleReports").addEventListener("change", e => setLayerVisible(reportsLayer, e.target.checked));

document.querySelectorAll(".chip").forEach(chip => {
  chip.addEventListener("click", () => {
    document.querySelectorAll(".chip").forEach(c => c.classList.remove("active"));
    chip.classList.add("active");
    currentDifficulty = chip.dataset.difficulty;
    filterTrails();
  });
});

document.getElementById("lengthFilter").addEventListener("input", e => {
  currentMaxLength = Number(e.target.value);
  document.getElementById("lengthValue").textContent = `Up to ${currentMaxLength} miles`;
  filterTrails();
});

document.getElementById("searchBtn").addEventListener("click", async () => {
  const q = document.getElementById("searchBox").value.trim();
  if (q.length < 2) return setMsg("Search must be at least 2 characters.", false);

  searchLayer.clearLayers();

  try {
    const r = await fetch(`${API_BASE}/api/search?q=${encodeURIComponent(q)}&park_id=${PARK_ID}`);
    const data = await r.json();

    if (!r.ok) return setMsg(data.error || "Search failed.", false);

    const fc = {
      type: "FeatureCollection",
      features: (data.results || []).map(item => ({
        type: "Feature",
        properties: item,
        geometry: item.geom
      }))
    };

    searchLayer.addData(fc);
    searchLayer.eachLayer(layer => {
      const p = layer.feature.properties;
      layer.bindPopup(`<b>${p.name}</b><br>${p.kind}`);
    });

    const bounds = searchLayer.getBounds();
    if (bounds.isValid()) map.fitBounds(bounds.pad(0.2));

    setMsg(`Found ${(data.results || []).length} result(s).`, true);
  } catch (err) {
    setMsg("Search failed.", false);
  }
});

document.getElementById("nearMeBtn").addEventListener("click", () => {
  if (!navigator.geolocation) return setMsg("Geolocation not supported.", false);

  navigator.geolocation.getCurrentPosition(
    pos => {
      const { latitude, longitude } = pos.coords;
      map.setView([latitude, longitude], 16);
      L.circleMarker([latitude, longitude], {
        radius: 8,
        fillColor: "#111",
        color: "#fff",
        weight: 2,
        fillOpacity: 1
      }).addTo(map).bindPopup("You are here").openPopup();
      setMsg("Centered on your location.", true);
    },
    () => setMsg("Could not access your location.", false),
    { enableHighAccuracy: true, timeout: 7000 }
  );
});

document.getElementById("useMapPointBtn").addEventListener("click", () => {
  setMsg("Tap the map to place your report pin.", true);
  map.once("click", e => {
    pinLatLng = e.latlng;
    if (pin) map.removeLayer(pin);
    pin = L.marker(pinLatLng, { draggable: true }).addTo(map);
    pin.on("dragend", () => {
      pinLatLng = pin.getLatLng();
    });
    setMsg(`Pin placed at ${pinLatLng.lat.toFixed(5)}, ${pinLatLng.lng.toFixed(5)}.`, true);
  });
});

document.getElementById("submitBtn").addEventListener("click", async () => {
  if (!pinLatLng) return setMsg("Please drop a pin first.", false);

  const payload = {
    park_id: PARK_ID,
    category: document.getElementById("category").value,
    description: document.getElementById("description").value.trim(),
    photo_url: document.getElementById("photoUrl").value.trim() || null,
    device_id: deviceId,
    lat: pinLatLng.lat,
    lng: pinLatLng.lng
  };

  try {
    const r = await fetch(`${API_BASE}/api/reports`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    const data = await r.json();

    if (!r.ok) {
      const details = data.details ? ` ${data.details.join(" ")}` : "";
      return setMsg((data.error || "Submit failed.") + details, false);
    }

    document.getElementById("description").value = "";
    document.getElementById("photoUrl").value = "";
    setMsg("Report submitted successfully and marked as pending review.", true);
    refreshReports();
  } catch (err) {
    setMsg("Submit failed.", false);
  }
});

map.on("moveend", refreshReports);

loadStaticLayers();
refreshReports();