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

    // استعلام الجلسات النشطة
    const q = `
SELECT 
  s.id AS session_id,
  TO_CHAR(s.start_time AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS') AS start_at,
  TO_CHAR((s.start_time + (s.duration_min || ' minutes')::interval) AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS') AS end_at,
  s.duration_min,
  s.points_deducted,
  s.price_at_booking,
  s.status,
  s.notified,
  c.name AS child_name,
  c.primary_phone,
  c.card_number,
  TO_CHAR(s.start_time AT TIME ZONE 'Africa/Cairo', 'Day') AS day_name,
  ROUND(s.duration_min/60.0, 1) AS entry_time_hours,
  ROUND(
    EXTRACT(EPOCH FROM (s.start_time + (s.duration_min || ' minutes')::interval) - NOW()) / 60
  ) AS remaining_minutes
FROM sessions s
JOIN children c ON s.child_id = c.id
WHERE s.status = 'active'
ORDER BY remaining_minutes ASC;
    `;
    const r = await db.query(q);
    const sessions = r.rows;

    // current_sessions
    const current_sessions = sessions.length;
    // ending_soon (الجلسات التي ستنتهي خلال 10 دقائق أو أقل)
    const ending_soon = sessions.filter(
      (s) => s.remaining_minutes <= 10
    ).length;

    // total_points_today & total_sessions_today
    const todayStatsQ = `
      SELECT COUNT(*) AS total_sessions_today, COALESCE(SUM(points_deducted),0) AS total_points_today
      FROM sessions
      WHERE DATE(start_time) = CURRENT_DATE;
    `;
    const todayStatsR = await db.query(todayStatsQ);
    const total_sessions_today = parseInt(
      todayStatsR.rows[0].total_sessions_today
    );
    const total_points_today = parseInt(todayStatsR.rows[0].total_points_today);

    res.json({
      stats: {
        current_sessions,
        ending_soon,
        total_points_today,
        total_sessions_today,
      },
      sessions,
    });
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

router.patch("/sessions/:id/finish", async (req, res) => {
  try {
    const sessionId = req.params.id;
    // 1. هات بيانات الجلسة
    const sessionRes = await db.query(`SELECT * FROM sessions WHERE id = $1`, [
      sessionId,
    ]);
    if (!sessionRes.rows.length) {
      return res.status(404).json({ message: "Session not found" });
    }
    const session = sessionRes.rows[0];

    // 2. لو الجلسة منتهية بالفعل
    if (session.status === "finished") {
      return res.status(400).json({ message: "Session already finished" });
    }

    // 3. احسب وقت الخروج الفعلي
    const actual_checkout = new Date();

    // 4. احسب مدة التمديد (لو فيه)
    const scheduled_end = new Date(session.start_time);
    scheduled_end.setMinutes(scheduled_end.getMinutes() + session.duration_min);
    const extension_minutes = Math.max(
      Math.round((actual_checkout - scheduled_end) / 60000),
      0
    );

    // 5. لو فيه تمديد، احسب بوينتس وسعر التمديد
    let extension_points = 0;
    let extension_price = 0;
    if (extension_minutes > 0) {
      const points_per_minute = session.points_deducted / session.duration_min;
      extension_points = Math.round(points_per_minute * extension_minutes);
      extension_price = (extension_points * 0.55).toFixed(2);
    }

    // 6. اجمع البوينتس الكلي والسعر الكلي
    const total_points = session.points_deducted + extension_points;
    const total_price = (
      parseFloat(session.price_at_booking) + parseFloat(extension_price)
    ).toFixed(2);

    // 7. حدث حالة الجلسة
    await db.query(
      `UPDATE sessions SET status = 'finished', actual_checkout = $1, points_deducted = $2, price_at_booking = $3 WHERE id = $4`,
      [actual_checkout, total_points, total_price, sessionId]
    );

    // 8. حدث الطفل بالنقاط الإضافية
    if (extension_points > 0) {
      await db.query(
        `UPDATE children SET total_points_spent = total_points_spent + $1 WHERE id = $2`,
        [extension_points, session.child_id]
      );
    }

    // هات بيانات الطفل
    const childRes = await db.query(
      `SELECT name, entry_id, primary_phone FROM children WHERE id = $1`,
      [session.child_id]
    );
    const child = childRes.rows[0];

    // هات كل جلسات الطفل
    const allSessionsRes = await db.query(
      `SELECT id, start_time, duration_min, points_deducted, price_at_booking, status FROM sessions WHERE child_id = $1 ORDER BY start_time DESC`,
      [session.child_id]
    );
    const all_sessions = allSessionsRes.rows;

    res.json({
      message: "Session checked out successfully",
      session_id: sessionId,
      child_id: session.child_id,
      child_name: child?.name,
      entry_id: child?.entry_id,
      parent_phone: child?.primary_phone,
      actual_checkout,
      scheduled_end,
      extension_minutes,
      extension_points,
      extension_price,
      total_points,
      total_price,
      total_sessions: all_sessions.length,
      sessions: all_sessions,
    });
  } catch (err) {
    console.error("finish session error:", err);
    res
      .status(500)
      .json({ error: "Something went wrong during session finish" });
  }
});

module.exports = router;
