const PARK_ID = 1;

const deviceIdKey = "parkapp_device_id";
let deviceId = localStorage.getItem(deviceIdKey);
if (!deviceId) {
  deviceId = crypto.randomUUID();
  localStorage.setItem(deviceIdKey, deviceId);
}

const map = L.map("map", { zoomControl: false }).setView([38.7612, -77.3067], 14);
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
      Surface: ${p.surface || "N/A"}<br>
      Length: ${p.length_mi || "N/A"} mi<br>
      Allowed Uses: ${p.allowed_uses || "N/A"}
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
      Hours: ${p.hours || "N/A"}<br>
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
      Capacity: ${p.capacity || "N/A"}<br>
      Accessible Spaces: ${p.accessible_spaces || "N/A"}<br>
      Hours: ${p.hours || "N/A"}
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
    const color =
      status === "verified" ? "#00b894" :
      status === "rejected" ? "#636e72" :
      "#ff9f43";

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
      <b>${p.category || "Report"}</b> (${p.status || "pending"})<br>
      ${escapeHtml(p.description || "")}<br>
      <small>${p.created_at ? new Date(p.created_at).toLocaleString() : ""}</small>
    `);
  }
});

const searchLayer = L.geoJSON(null, {
  pointToLayer: (feature, latlng) => L.circleMarker(latlng, {
    radius: 9,
    fillColor: "#111111",
    color: "#ffffff",
    weight: 2,
    fillOpacity: 1
  }),
  onEachFeature: (feature, layer) => {
    const p = feature.properties;
    layer.bindPopup(`<b>${p.name || "Result"}</b><br>${p.kind || ""}`);
  }
});

let pin = null;
let pinLatLng = null;
let currentDifficulty = "all";
let currentMaxLength = 10;

let burkeTrailsData = null;
let burkeFacilitiesData = null;
let burkeParkingData = null;
let burkeSensitiveData = null;
let burkeReportsData = null;
let burkeBoundaryData = null;

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
  if (!el) return;
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

async function fetchGeoJSON(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Failed to load ${url}`);
  return await r.json();
}

async function loadStaticLayers() {
  try {
    const [
      trails,
      facilities,
      parking,
      sensitive,
      reports,
      boundary
    ] = await Promise.all([
      fetchGeoJSON("data/burke_lake_trails.geojson"),
      fetchGeoJSON("data/burke_lake_facilities.geojson"),
      fetchGeoJSON("data/burke_lake_parking.geojson"),
      fetchGeoJSON("data/burke_lake_sensitive_areas.geojson"),
      fetchGeoJSON("data/burke_lake_sample_reports.geojson"),
      fetchGeoJSON("data/burke_lake_boundary.geojson")
    ]);

    burkeTrailsData = trails;
    burkeFacilitiesData = facilities;
    burkeParkingData = parking;
    burkeSensitiveData = sensitive;
    burkeReportsData = reports;
    burkeBoundaryData = boundary;

    trailsLayer.clearLayers();
    facilitiesLayer.clearLayers();
    parkingLayer.clearLayers();
    sensitiveLayer.clearLayers();
    reportsLayer.clearLayers();

    trailsLayer.addData(burkeTrailsData);
    facilitiesLayer.addData(burkeFacilitiesData);
    parkingLayer.addData(burkeParkingData);
    sensitiveLayer.addData(burkeSensitiveData);
    reportsLayer.addData(burkeReportsData);

    trailsLayer.addTo(map);
    facilitiesLayer.addTo(map);
    parkingLayer.addTo(map);
    sensitiveLayer.addTo(map);
    reportsLayer.addTo(map);
    searchLayer.addTo(map);

    if (burkeBoundaryData) {
      const boundaryLayer = L.geoJSON(burkeBoundaryData);
      map.fitBounds(boundaryLayer.getBounds(), { padding: [20, 20] });
    }
  } catch (err) {
    console.error(err);
    setMsg("Failed to load one or more Burke Lake data layers.", false);
  }
}

async function refreshReports() {
  try {
    if (!burkeReportsData) {
      burkeReportsData = await fetchGeoJSON("data/burke_lake_sample_reports.geojson");
    }
    reportsLayer.clearLayers();
    reportsLayer.addData(burkeReportsData);
  } catch (err) {
    console.error("Failed to load reports", err);
  }
}

function filterTrails() {
  if (!burkeTrailsData) return;

  const filtered = {
    ...burkeTrailsData,
    features: burkeTrailsData.features.filter(f => {
      const d = f.properties.difficulty || "";
      const len = Number(f.properties.length_mi || 999);
      const difficultyMatch = currentDifficulty === "all" || d === currentDifficulty;
      const lengthMatch = len <= currentMaxLength;
      return difficultyMatch && lengthMatch;
    })
  };

  trailsLayer.clearLayers();
  trailsLayer.addData(filtered);
}

function searchStaticData(queryText) {
  const q = queryText.toLowerCase();

  const results = [];

  if (burkeTrailsData) {
    burkeTrailsData.features.forEach(f => {
      const name = String(f.properties.name || "").toLowerCase();
      if (name.includes(q)) {
        const coords = f.geometry.coordinates[0];
        results.push({
          type: "Feature",
          properties: {
            name: f.properties.name,
            kind: "trail"
          },
          geometry: {
            type: "Point",
            coordinates: coords
          }
        });
      }
    });
  }

  if (burkeFacilitiesData) {
    burkeFacilitiesData.features.forEach(f => {
      const name = String(f.properties.name || "").toLowerCase();
      const type = String(f.properties.type || "").toLowerCase();
      if (name.includes(q) || type.includes(q)) {
        results.push({
          type: "Feature",
          properties: {
            name: f.properties.name || f.properties.type,
            kind: "facility"
          },
          geometry: f.geometry
        });
      }
    });
  }

  if (burkeParkingData) {
    burkeParkingData.features.forEach(f => {
      const name = String(f.properties.name || "").toLowerCase();
      if (name.includes(q) || "parking".includes(q)) {
        results.push({
          type: "Feature",
          properties: {
            name: f.properties.name || "Parking",
            kind: "parking"
          },
          geometry: f.geometry
        });
      }
    });
  }

  return {
    type: "FeatureCollection",
    features: results
  };
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

document.getElementById("toggleTrails").addEventListener("change", e => {
  setLayerVisible(trailsLayer, e.target.checked);
});

document.getElementById("toggleFacilities").addEventListener("change", e => {
  setLayerVisible(facilitiesLayer, e.target.checked);
});

document.getElementById("toggleParking").addEventListener("change", e => {
  setLayerVisible(parkingLayer, e.target.checked);
});

document.getElementById("toggleSensitive").addEventListener("change", e => {
  setLayerVisible(sensitiveLayer, e.target.checked);
});

document.getElementById("toggleReports").addEventListener("change", e => {
  setLayerVisible(reportsLayer, e.target.checked);
});

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

document.getElementById("searchBtn").addEventListener("click", () => {
  const q = document.getElementById("searchBox").value.trim();
  if (q.length < 2) return setMsg("Search must be at least 2 characters.", false);

  searchLayer.clearLayers();

  const results = searchStaticData(q);
  searchLayer.addData(results);

  const bounds = searchLayer.getBounds();
  if (bounds.isValid()) {
    map.fitBounds(bounds.pad(0.2));
    setMsg(`Found ${results.features.length} result(s).`, true);
  } else {
    setMsg("No matching trails or facilities found.", false);
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

document.getElementById("submitBtn").addEventListener("click", () => {
  if (!pinLatLng) return setMsg("Please drop a pin first.", false);

  const category = document.getElementById("category").value;
  const description = document.getElementById("description").value.trim();
  const photoUrl = document.getElementById("photoUrl").value.trim() || null;

  if (description.length < 20) {
    return setMsg("Description must be at least 20 characters.", false);
  }

  const newReport = {
    type: "Feature",
    properties: {
      report_id: Date.now(),
      park_id: PARK_ID,
      category,
      description,
      photo_url: photoUrl,
      device_id: deviceId,
      status: "pending",
      created_at: new Date().toISOString()
    },
    geometry: {
      type: "Point",
      coordinates: [pinLatLng.lng, pinLatLng.lat]
    }
  };

  if (!burkeReportsData) {
    burkeReportsData = {
      type: "FeatureCollection",
      features: []
    };
  }

  burkeReportsData.features.unshift(newReport);
  reportsLayer.clearLayers();
  reportsLayer.addData(burkeReportsData);

  document.getElementById("description").value = "";
  document.getElementById("photoUrl").value = "";

  setMsg("Report submitted locally and marked as pending review.", true);
});

map.on("moveend", refreshReports);

loadStaticLayers();
refreshReports();