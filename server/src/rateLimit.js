import { query } from "./db.js";

export async function enforceDailyDeviceLimit(deviceId, maxPerDay = 3) {
  const sql = `
    SELECT COUNT(*)::int AS n
    FROM user_report
    WHERE device_id = $1
      AND created_at >= date_trunc('day', now())
      AND created_at <  date_trunc('day', now()) + interval '1 day'
  `;
  const r = await query(sql, [deviceId]);
  const n = r.rows?.[0]?.n ?? 0;

  if (n >= maxPerDay) {
    const err = new Error("Rate limit exceeded: too many reports today for this device.");
    err.status = 429;
    throw err;
  }
}