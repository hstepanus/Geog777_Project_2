import express from "express";
import { query } from "../db.js";
import { validateReportPayload } from "../validation.js";
import { enforceDailyDeviceLimit } from "../rateLimit.js";

export const reportsRouter = express.Router();

/**
 * GET /api/reports?park_id=1&status=verified|pending|rejected&bbox=minLng,minLat,maxLng,maxLat
 * bbox optional; if provided, spatially filters.
 */
reportsRouter.get("/", async (req, res) => {
  const parkId = Number(req.query.park_id ?? 1);
  const status = req.query.status ? String(req.query.status) : null;
  const bbox = req.query.bbox ? String(req.query.bbox) : null;

  if (!Number.isInteger(parkId) || parkId <= 0) return res.status(400).json({ error: "park_id must be a positive integer" });

  const params = [parkId];
  let where = `WHERE park_id = $1`;
  let i = 1;

  if (status) {
    i += 1;
    params.push(status);
    where += ` AND status = $${i}`;
  }

  if (bbox) {
    const parts = bbox.split(",").map(Number);
    if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) {
      return res.status(400).json({ error: "bbox must be minLng,minLat,maxLng,maxLat" });
    }
    const [minLng, minLat, maxLng, maxLat] = parts;
    i += 1;
    params.push(minLng, minLat, maxLng, maxLat);
    where += ` AND geom && ST_MakeEnvelope($${i}, $${i + 1}, $${i + 2}, $${i + 3}, 4326)`;
  }

  const sql = `
    SELECT
      report_id,
      park_id,
      category,
      description,
      photo_url,
      status,
      created_at,
      ST_AsGeoJSON(geom)::json AS geom
    FROM user_report
    ${where}
    ORDER BY created_at DESC
    LIMIT 500
  `;

  const r = await query(sql, params);
  res.json({ park_id: parkId, count: r.rowCount, reports: r.rows });
});

/**
 * POST /api/reports
 * Body: { park_id, category, description, lat, lng, device_id, photo_url? }
 */
reportsRouter.post("/", async (req, res) => {
  const v = validateReportPayload(req.body);
  if (!v.ok) return res.status(400).json({ error: "Validation failed", details: v.errors });

  const { category, description, parkId, lat, lng, deviceId, photoUrl } = v.data;

  try {
    await enforceDailyDeviceLimit(deviceId, 3);
  } catch (e) {
    return res.status(e.status ?? 500).json({ error: e.message ?? "Rate limit error" });
  }

  const sql = `
    INSERT INTO user_report (park_id, category, description, photo_url, status, device_id, geom)
    VALUES ($1, $2, $3, $4, 'pending', $5, ST_SetSRID(ST_MakePoint($6, $7), 4326))
    RETURNING report_id, status, created_at
  `;
  const r = await query(sql, [parkId, category, description, photoUrl, deviceId, lng, lat]);

  res.status(201).json({
    message: "Report submitted (pending review).",
    report: r.rows[0],
  });
});