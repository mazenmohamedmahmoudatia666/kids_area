const express = require("express");
const router = express.Router();
const db = require("../db");

const FIXED_HOURLY_RATE = 250;
const DISCOUNT_FACTOR = 0.55;

/* ---------- GET /sessions/active (مختصر مع ends_at & points) ---------- */
router.get("/sessions/active", async (req, res) => {
  try {
    // انهاء الجلسات المنتهية
    await db.query(`
      UPDATE sessions
      SET status = 'finished'
      WHERE status = 'active'
        AND (start_time + (duration_min || ' minutes')::interval) <= NOW();
    `);

    const q = `
SELECT 
  s.id AS session_id,
  TO_CHAR(s.start_time AT TIME ZONE 'Africa/Cairo','HH24:MI') AS start_at,
  TO_CHAR((s.start_time + (s.duration_min || ' minutes')::interval) AT TIME ZONE 'Africa/Cairo','HH24:MI') AS end_at,
  s.duration_min,
  s.points_deducted,
  s.price_at_booking,
  s.status,
  s.notified,
  c.name AS child_name,
  c.primary_phone,
  c.entry_id,
  ROUND(
    EXTRACT(EPOCH FROM (s.start_time + (s.duration_min || ' minutes')::interval) - NOW()) / 60
  ) AS remaining_minutes
FROM sessions s
JOIN children c ON s.child_id = c.id
WHERE s.status = 'active'
ORDER BY remaining_minutes ASC;

    `;

    const r = await db.query(q);
    res.json(r.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch active sessions" });
  }
});

/* ---------- PATCH /sessions/:id/extend ---------- */
router.patch("/sessions/:id/extend", async (req, res) => {
  try {
    const sessionId = req.params.id;
    const { extra_minutes } = req.body;

    if (!extra_minutes || extra_minutes <= 0)
      return res.status(400).json({ message: "Invalid extra_minutes value" });

    const sessRes = await db.query("SELECT * FROM sessions WHERE id = $1", [
      sessionId,
    ]);
    if (!sessRes.rows.length)
      return res.status(404).json({ message: "Session not found" });

    const session = sessRes.rows[0];
    if (session.status === "finished")
      return res
        .status(400)
        .json({ message: "Cannot extend a finished session" });

    /* حساب النقاط الإضافية */
    const pointLookup = await db.query(
      "SELECT points FROM points WHERE duration_min = $1",
      [extra_minutes]
    );
    if (!pointLookup.rows.length)
      return res.status(400).json({ message: "Invalid extra duration" });

    const extraPoints = pointLookup.rows[0].points * session.children_count;

    /* حساب السعر الإضافى بنفس المعادلة الثابتة */
    const extraPrice = Math.round(
      (extra_minutes / 60) * FIXED_HOURLY_RATE * DISCOUNT_FACTOR
    );

    /* تحديث الجلسة */
    const newDuration = session.duration_min + extra_minutes;
    const upd = await db.query(
      `UPDATE sessions
       SET duration_min     = $1,
           points_deducted  = points_deducted + $2,
           price_at_booking = price_at_booking + $3
       WHERE id = $4
       RETURNING *;`,
      [newDuration, extraPoints, extraPrice, sessionId]
    );

    /* تحديث الطفل */
    await db.query(
      `UPDATE children
       SET total_points_spent = total_points_spent + $1
       WHERE id = $2`,
      [extraPoints, session.child_id]
    );

    res.json({
      message: "Session extended successfully",
      data: {
        session_id: sessionId,
        new_duration: newDuration,
        extra_points: extraPoints,
        extra_price: extraPrice,
      },
    });
  } catch (err) {
    console.error("extend error:", err);
    res.status(500).json({ error: "Failed to extend session" });
  }
});

/* ---------- GET /sessions/by-entry/:entry_id ---------- */
router.get("/sessions/by-entry/:entry_id", async (req, res) => {
  try {
    const entryId = req.params.entry_id;

    const childRes = await db.query(
      "SELECT id, name FROM children WHERE entry_id = $1",
      [entryId]
    );
    if (!childRes.rows.length)
      return res.status(404).json({ message: "Child not found" });

    const child = childRes.rows[0];

    const sessionsRes = await db.query(
      `SELECT * FROM sessions WHERE child_id = $1 ORDER BY start_time DESC`,
      [child.id]
    );

    res.json({
      child: { name: child.name, entry_id: entryId },
      total_sessions: sessionsRes.rowCount,
      sessions: sessionsRes.rows,
    });
  } catch (err) {
    console.error("by-entry error:", err);
    res.status(500).json({ error: "Failed to fetch sessions for child" });
  }
});

module.exports = router;
