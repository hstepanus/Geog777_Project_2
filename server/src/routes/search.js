import express from "express";
import { query } from "../db.js";

export const searchRouter = express.Router();

/**
 * GET /api/search?q=...&park_id=1
 * Searches trails and facilities by name/type.
 */
searchRouter.get("/", async (req, res) => {
  const q = String(req.query.q ?? "").trim();
  const parkId = Number(req.query.park_id ?? 1);

  if (!q || q.length < 2) return res.status(400).json({ error: "q must be at least 2 characters" });
  if (!Number.isInteger(parkId) || parkId <= 0) return res.status(400).json({ error: "park_id must be a positive integer" });

  // ILIKE search with prefix wildcards; keep it simple for starter
  const like = `%${q}%`;

  const trailsSql = `
    SELECT
      'trail' AS kind,
      trail_id AS id,
      name,
      difficulty,
      length_mi,
      ST_AsGeoJSON(ST_StartPoint(geom))::json AS geom
    FROM trail
    WHERE park_id = $1
      AND name ILIKE $2
    LIMIT 25
  `;

  const facilitiesSql = `
    SELECT
      'facility' AS kind,
      facility_id AS id,
      COALESCE(name, type) AS name,
      type,
      accessible,
      ST_AsGeoJSON(geom)::json AS geom
    FROM facility
    WHERE park_id = $1
      AND (COALESCE(name,'') ILIKE $2 OR type ILIKE $2)
    LIMIT 25
  `;

  const [trails, facilities] = await Promise.all([
    query(trailsSql, [parkId, like]),
    query(facilitiesSql, [parkId, like]),
  ]);

  res.json({
    q,
    park_id: parkId,
    results: [...trails.rows, ...facilities.rows],
  });
});