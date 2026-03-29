const PARK_ID = 1;

const deviceIdKey = "parkapp_device_id";
let deviceId = localStorage.getItem(deviceIdKey);
if (!deviceId) {
  deviceId = crypto.randomUUID();
  localStorage.setItem(deviceIdKey, deviceId);
}

const map = L.map("map", { zoomControl: false }).setView([38.7660, -77.3070], 16);
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
  return String(s || "").replace(/[&<>"']/g, m => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
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

function getTrailColor(difficulty) {
  const d = String(difficulty || "").toLowerCase();
  if (d === "easy") return "#2e8b57";
  if (d === "moderate") return "#d4a017";
  return "#c0392b";
}

function getSensitiveStyle(areaType) {
  const t = String(areaType || "").toLowerCase();

  if (t.includes("wildlife")) {
    return { color: "#00897b", fillColor: "#26a69a", weight: 2, fillOpacity: 0.22, dashArray: "4 4" };
  }
  if (t.includes("wetland")) {
    return { color: "#1e88e5", fillColor: "#64b5f6", weight: 2, fillOpacity: 0.18, dashArray: "3 5" };
  }
  if (t.includes("restoration")) {
    return { color: "#43a047", fillColor: "#81c784", weight: 2, fillOpacity: 0.18 };
  }
  if (t.includes("restricted")) {
    return { color: "#ef6c00", fillColor: "#ffb74d", weight: 2, fillOpacity: 0.18, dashArray: "6 4" };
  }

  return { color: "#16a085", fillColor: "#16a085", weight: 2, fillOpacity: 0.16 };
}

function makeEmojiIcon(emoji, bg = "#ffffff", size = 30) {
  return L.divIcon({
    className: "facility-icon",
    html: `
      <div style="
        width:${size}px;
        height:${size}px;
        border-radius:50%;
        background:${bg};
        border:2px solid #ffffff;
        box-shadow:0 2px 8px rgba(0,0,0,0.28);
        display:flex;
        align-items:center;
        justify-content:center;
        font-size:${Math.round(size * 0.55)}px;
        line-height:1;
      ">${emoji}</div>
    `,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -size / 2]
  });
}

function classifyFacility(props) {
  const name = String(props.name || "").toLowerCase();
  const type = String(props.type || "").toLowerCase();

  if (type.includes("bathroom") || name.includes("bathroom") || name.includes("restroom")) {
    return { type: "bathroom", emoji: "🚻", bg: "#2563eb", label: "Restroom" };
  }
  if (type.includes("visitor_info") || name.includes("camp store") || name.includes("information") || name.includes("visitor")) {
    return { type: "visitor_info", emoji: "ℹ️", bg: "#0ea5e9", label: "Visitor Info" };
  }
  if (type.includes("playground") || name.includes("mini golf") || name.includes("golf")) {
    return { type: "playground", emoji: "🎯", bg: "#f59e0b", label: "Activity Area" };
  }
  if (name.includes("train")) {
    return { type: "train", emoji: "🚂", bg: "#6d4c41", label: "Train Stop" };
  }
  if (type.includes("water") || name.includes("water")) {
    return { type: "water", emoji: "💧", bg: "#06b6d4", label: "Water" };
  }
  if (type.includes("scenic") || name.includes("fishing") || name.includes("pier") || name.includes("overlook")) {
    return { type: "scenic_overlook", emoji: "🎣", bg: "#10b981", label: "Fishing / Scenic Spot" };
  }

  return { type: "facility", emoji: "📍", bg: "#475569", label: "Facility" };
}

function parkingPopupHTML(props) {
  return `
    <b>🅿️ ${escapeHtml(props.name || "Parking")}</b><br>
    Capacity: ${props.capacity ?? "N/A"}<br>
    Accessible Spaces: ${props.accessible_spaces ?? "N/A"}<br>
    Hours: ${escapeHtml(props.hours || "N/A")}
  `;
}

async function fetchGeoJSON(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Failed to load ${url}`);
  return await r.json();
}

function getFeatureSearchPoint(feature) {
  const geom = feature.geometry;
  if (!geom) return null;

  if (geom.type === "Point") return geom.coordinates;
  if (geom.type === "LineString" && geom.coordinates.length) return geom.coordinates[0];
  if (geom.type === "Polygon" && geom.coordinates.length && geom.coordinates[0].length) return geom.coordinates[0][0];
  if (geom.type === "MultiPolygon" && geom.coordinates.length && geom.coordinates[0][0].length) return geom.coordinates[0][0][0];

  return null;
}

const trailsLayer = L.geoJSON(null, {
  style: feature => ({
    weight: 4,
    color: getTrailColor(feature.properties.difficulty),
    opacity: 0.95
  }),
  onEachFeature: (feature, layer) => {
    const p = feature.properties;
    layer.bindPopup(`
      <b>${escapeHtml(p.name || "Trail")}</b><br>
      Difficulty: ${escapeHtml(p.difficulty || "N/A")}<br>
      Surface: ${escapeHtml(p.surface || "N/A")}<br>
      Length: ${p.length_mi ?? "N/A"} mi<br>
      Allowed Uses: ${escapeHtml(p.allowed_uses || "N/A")}
    `);

    layer.on("mouseover", () => layer.setStyle({ weight: 6, opacity: 1 }));
    layer.on("mouseout", () => layer.setStyle({ weight: 4, opacity: 0.95 }));
  }
});

const facilitiesLayer = L.geoJSON(null, {
  style: {
    color: "#2b7cff",
    weight: 2,
    fillColor: "#2b7cff",
    fillOpacity: 0.18
  },
  pointToLayer: (feature, latlng) => {
    const sym = classifyFacility(feature.properties);
    return L.marker(latlng, {
      icon: makeEmojiIcon(sym.emoji, sym.bg, 30)
    });
  },
  onEachFeature: (feature, layer) => {
    const p = feature.properties;
    const sym = classifyFacility(p);

    layer.bindPopup(`
      <b>${sym.emoji} ${escapeHtml(p.name || sym.label)}</b><br>
      Type: ${escapeHtml(p.type || sym.type)}<br>
      Hours: ${escapeHtml(p.hours || "Park hours")}<br>
      Accessible: ${p.accessible === true ? "Yes" : p.accessible === false ? "No" : "N/A"}
    `);
  }
});

const parkingLayer = L.geoJSON(null, {
  style: {
    color: "#6c5ce7",
    weight: 2,
    fillColor: "#6c5ce7",
    fillOpacity: 0.22
  },
  pointToLayer: (feature, latlng) => L.marker(latlng, {
    icon: makeEmojiIcon("🅿️", "#6c5ce7", 30)
  }),
  onEachFeature: (feature, layer) => {
    const p = feature.properties;
    layer.bindPopup(parkingPopupHTML(p));

    if (feature.geometry && (feature.geometry.type === "Polygon" || feature.geometry.type === "MultiPolygon")) {
      layer.on("mouseover", () => layer.setStyle({ weight: 3, fillOpacity: 0.3 }));
      layer.on("mouseout", () => layer.setStyle({ weight: 2, fillOpacity: 0.22 }));
    }
  }
});

const sensitiveLayer = L.geoJSON(null, {
  style: feature => getSensitiveStyle(feature.properties.area_type),
  onEachFeature: (feature, layer) => {
    const p = feature.properties;
    layer.bindPopup(`
      <b>${escapeHtml(p.name || p.area_type || "Sensitive Area")}</b><br>
      Type: ${escapeHtml(p.area_type || "N/A")}<br>
      ${escapeHtml(p.note || "")}
    `);

    layer.on("mouseover", () => {
      const s = getSensitiveStyle(p.area_type);
      layer.setStyle({ ...s, weight: (s.weight || 2) + 1, fillOpacity: Math.min((s.fillOpacity || 0.16) + 0.08, 0.35) });
    });

    layer.on("mouseout", () => {
      layer.setStyle(getSensitiveStyle(p.area_type));
    });
  }
});

const reportsLayer = L.geoJSON(null, {
  pointToLayer: (feature, latlng) => {
    const status = String(feature.properties.status || "").toLowerCase();
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
      <b>${escapeHtml(p.category || "Report")}</b> (${escapeHtml(p.status || "pending")})<br>
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
    layer.bindPopup(`<b>${escapeHtml(p.name || "Result")}</b><br>${escapeHtml(p.kind || "")}`);
  }
});

async function loadStaticLayers() {
  try {
    const [trails, facilities, parking, sensitive, reports, boundary] = await Promise.all([
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
      const bounds = boundaryLayer.getBounds();
      if (bounds.isValid()) {
        map.fitBounds(bounds, { paddingTopLeft: [80, 120], paddingBottomRight: [40, 220] });
      }
    }

    setMsg("Burke Lake layers loaded.", true);
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
      const d = String(f.properties.difficulty || "").toLowerCase();
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
        const coords = getFeatureSearchPoint(f);
        if (coords) {
          results.push({
            type: "Feature",
            properties: {
              name: f.properties.name || "Trail",
              kind: "trail"
            },
            geometry: {
              type: "Point",
              coordinates: coords
            }
          });
        }
      }
    });
  }

  if (burkeFacilitiesData) {
    burkeFacilitiesData.features.forEach(f => {
      const name = String(f.properties.name || "").toLowerCase();
      const type = String(f.properties.type || "").toLowerCase();
      if (name.includes(q) || type.includes(q)) {
        const coords = getFeatureSearchPoint(f);
        if (coords) {
          results.push({
            type: "Feature",
            properties: {
              name: f.properties.name || f.properties.type || "Facility",
              kind: "facility"
            },
            geometry: {
              type: "Point",
              coordinates: coords
            }
          });
        }
      }
    });
  }

  if (burkeParkingData) {
    burkeParkingData.features.forEach(f => {
      const name = String(f.properties.name || "").toLowerCase();
      if (name.includes(q) || q.includes("parking")) {
        const coords = getFeatureSearchPoint(f);
        if (coords) {
          results.push({
            type: "Feature",
            properties: {
              name: f.properties.name || "Parking",
              kind: "parking"
            },
            geometry: {
              type: "Point",
              coordinates: coords
            }
          });
        }
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
  if (q.length < 2) {
    setMsg("Search must be at least 2 characters.", false);
    return;
  }

  searchLayer.clearLayers();
  const results = searchStaticData(q);
  searchLayer.addData(results);

  const bounds = searchLayer.getBounds();
  if (bounds.isValid()) {
    map.fitBounds(bounds.pad(0.2));
    setMsg(`Found ${results.features.length} result(s).`, true);
  } else {
    setMsg("No matching trails, facilities, or parking found.", false);
  }
});

document.getElementById("nearMeBtn").addEventListener("click", () => {
  if (!navigator.geolocation) {
    setMsg("Geolocation not supported.", false);
    return;
  }

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
  if (!pinLatLng) {
    setMsg("Please drop a pin first.", false);
    return;
  }

  const category = document.getElementById("category").value;
  const description = document.getElementById("description").value.trim();
  const photoUrl = document.getElementById("photoUrl").value.trim() || null;

  if (description.length < 20) {
    setMsg("Description must be at least 20 characters.", false);
    return;
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