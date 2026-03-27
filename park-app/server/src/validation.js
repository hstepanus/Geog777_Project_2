const ALLOWED_CATEGORIES = new Set([
  "downed_tree",
  "flooding",
  "trash",
  "wildlife",
  "safety",
  "other",
]);

export function validateReportPayload(body) {
  const errors = [];

  const category = String(body.category ?? "").trim();
  const description = String(body.description ?? "").trim();
  const parkId = Number(body.park_id);
  const lat = Number(body.lat);
  const lng = Number(body.lng);
  const deviceId = String(body.device_id ?? "").trim();
  const photoUrl = body.photo_url ? String(body.photo_url).trim() : null;

  if (!Number.isInteger(parkId) || parkId <= 0) errors.push("park_id must be a positive integer.");
  if (!ALLOWED_CATEGORIES.has(category)) errors.push("category is invalid.");
  if (description.length < 20) errors.push("description must be at least 20 characters.");
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) errors.push("lat must be a valid latitude.");
  if (!Number.isFinite(lng) || lng < -180 || lng > 180) errors.push("lng must be a valid longitude.");
  if (deviceId.length < 8) errors.push("device_id is required (min 8 chars).");

  // basic photo URL check (optional)
  if (photoUrl && !/^https?:\/\/.+/i.test(photoUrl)) errors.push("photo_url must be an http(s) URL if provided.");

  return {
    ok: errors.length === 0,
    errors,
    data: { category, description, parkId, lat, lng, deviceId, photoUrl },
  };
}