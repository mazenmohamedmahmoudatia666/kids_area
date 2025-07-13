const express = require("express");
const router = express.Router();
const db = require("../db");

// GET /dashboard/summary
router.get("/dashboard/summary", async (req, res) => {
  try {
    // 1. الكروت العلوية (اليوم الحالي)
    const statsQ = `
      SELECT 
        COUNT(*) AS total_sessions,
        COALESCE(SUM(points_deducted),0) AS total_points,
        COALESCE(SUM(price_at_booking),0) AS total_revenue,
        ROUND(AVG(duration_min)/60.0, 2) AS avg_session_duration
      FROM sessions
      WHERE DATE(start_time) = CURRENT_DATE;
    `;
    const statsR = await db.query(statsQ);
    const stats = statsR.rows[0];

    // 2. activity_flow (الرسم البياني الأسبوعي)
    const weekQ = `
      SELECT 
        TO_CHAR(start_time, 'Day') AS day_name,
        TO_CHAR(start_time, 'YYYY-MM-DD') AS date,
        COUNT(*) AS sessions,
        ROUND(SUM(duration_min)/60.0, 2) AS hours,
        COALESCE(SUM(points_deducted),0) AS total_points,
        COALESCE(SUM(price_at_booking),0) AS revenue,
        ROUND(AVG(duration_min), 0) AS avg_time
      FROM sessions
      WHERE DATE_TRUNC('week', start_time) = DATE_TRUNC('week', CURRENT_DATE)
      GROUP BY day_name, date
      ORDER BY date ASC;
    `;
    const weekR = await db.query(weekQ);
    const activity_flow = weekR.rows;

    // 3. daily_table (نفس بيانات الرسم البياني)
    const daily_table = activity_flow.map((row) => ({
      day: row.day_name.trim(),
      date: row.date,
      sessions: parseInt(row.sessions),
      hours: row.hours,
      total_points: parseInt(row.total_points),
      revenue: parseFloat(row.revenue),
      avg_time: row.avg_time,
    }));

    res.json({
      stats: {
        total_sessions: parseInt(stats.total_sessions),
        total_points: parseInt(stats.total_points),
        total_revenue: parseFloat(stats.total_revenue),
        avg_session_duration: parseFloat(stats.avg_session_duration),
      },
      activity_flow,
      daily_table,
    });
  } catch (err) {
    console.error("dashboard summary error:", err);
    res.status(500).json({ error: "Failed to fetch dashboard summary" });
  }
});

module.exports = router;
