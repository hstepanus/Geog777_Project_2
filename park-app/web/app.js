const API_BASE = "http://localhost:4000"; // change if needed
const PARK_ID = 1;

// Basic device id for rate limit (no login). Stable in this browser.
const deviceIdKey = "parkapp_device_id";
let deviceId = localStorage.getItem(deviceIdKey);
if (!deviceId) {
  deviceId = crypto.randomUUID();
  localStorage.setItem(deviceIdKey, deviceId);
}

// Map
const map = L.map("map").setView([38.676, -77.255], 13); // near Occoquan-ish
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: "&copy; OpenStreetMap contributors",
}).addTo(map);

const searchLayer = L.geoJSON(null).addTo(map);
const reportsLayer = L.geoJSON(null).addTo(map);

let pin = null;
let pinLatLng = null;

function setMsg(text, ok = true) {
  const el = document.getElementById("msg");
  el.textContent = text;
  el.className = "msg " + (ok ? "ok" : "err");
}

function addSearchResultToMap(item) {
  // item.geom is GeoJSON geometry
  const feature = { type: "Feature", properties: item, geometry: item.geom };
  searchLayer.addData(feature);
}

function renderReports(reports) {
  reportsLayer.clearLayers();
  const fc = {
    type: "FeatureCollection",
    features: reports.map(r => ({
      type: "Feature",
      properties: r,
      geometry: r.geom
    }))
  };

  reportsLayer.addData(fc);
  reportsLayer.eachLayer(layer => {
    const p = layer.feature.properties;
    layer.bindPopup(
      `<b>${p.category}</b> (${p.status})<br/>${escapeHtml(p.description)}<br/><small>${new Date(p.created_at).toLocaleString()}</small>`
    );
  });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, m => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
  }[m]));
}

// Load reports within current map bbox (verified + pending for demo)
async function refreshReports() {
  const b = map.getBounds();
  const bbox = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()].join(",");
  const url = `${API_BASE}/api/reports?park_id=${PARK_ID}&bbox=${encodeURIComponent(bbox)}`;
  const r = await fetch(url);
  const data = await r.json();
  renderReports(data.reports ?? []);
}

map.on("moveend", refreshReports);
refreshReports();

// Search
document.getElementById("searchBtn").addEventListener("click", async () => {
  const q = document.getElementById("searchBox").value.trim();
  if (q.length < 2) return setMsg("Search must be at least 2 characters.", false);

  searchLayer.clearLayers();
  const r = await fetch(`${API_BASE}/api/search?q=${encodeURIComponent(q)}&park_id=${PARK_ID}`);
  const data = await r.json();

  if (!r.ok) return setMsg(data.error || "Search failed", false);

  (data.results || []).forEach(addSearchResultToMap);

  // Fit to results if any
  const bounds = searchLayer.getBounds();
  if (bounds.isValid()) map.fitBounds(bounds.pad(0.2));
  setMsg(`Found ${(data.results || []).length} results for "${q}".`, true);
});

// Near Me
document.getElementById("nearMeBtn").addEventListener("click", () => {
  if (!navigator.geolocation) return setMsg("Geolocation not supported.", false);

  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const { latitude, longitude } = pos.coords;
      map.setView([latitude, longitude], 16);
      setMsg("Centered on your location.", true);
    },
    () => setMsg("Could not get your location (permission denied?).", false),
    { enableHighAccuracy: true, timeout: 8000 }
  );
});

// Use map pin location
document.getElementById("useMapPointBtn").addEventListener("click", () => {
  setMsg("Tap the map to place a report pin.", true);
  map.once("click", (e) => {
    pinLatLng = e.latlng;
    if (pin) map.removeLayer(pin);
    pin = L.marker(pinLatLng, { draggable: true }).addTo(map);
    pin.on("dragend", () => { pinLatLng = pin.getLatLng(); });
    setMsg(`Pin set at ${pinLatLng.lat.toFixed(5)}, ${pinLatLng.lng.toFixed(5)}.`, true);
  });
});

// Submit report
document.getElementById("submitBtn").addEventListener("click", async () => {
  const category = document.getElementById("category").value;
  const description = document.getElementById("description").value.trim();
  const photo_url = document.getElementById("photoUrl").value.trim() || null;

  if (!pinLatLng) return setMsg("Set a map pin location first.", false);

  const payload = {
    park_id: PARK_ID,
    category,
    description,
    photo_url,
    device_id: deviceId,
    lat: pinLatLng.lat,
    lng: pinLatLng.lng,
  };

  const r = await fetch(`${API_BASE}/api/reports`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const data = await r.json();

  if (!r.ok) {
    const details = data.details ? ` (${data.details.join("; ")})` : "";
    return setMsg((data.error || "Submit failed") + details, false);
  }

  setMsg(data.message || "Submitted!", true);
  document.getElementById("description").value = "";
  document.getElementById("photoUrl").value = "";
  await refreshReports();
});