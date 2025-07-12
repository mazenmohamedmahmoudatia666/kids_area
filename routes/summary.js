const express = require("express");
const router = express.Router();
const db = require("../db"); // الاتصال بقاعدة البيانات

router.get("/summary", async (req, res) => {
  try {
    const range = req.query.range || "day"; // القيمة الافتراضية هي اليوم
    let whereClause = "";

    // نبني شرط التاريخ حسب نوع التقرير
    if (range === "day") {
      whereClause = `DATE(s.start_time) = CURRENT_DATE`;
    } else if (range === "week") {
      whereClause = `DATE_TRUNC('week', s.start_time) = DATE_TRUNC('week', CURRENT_DATE)`;
    } else if (range === "month") {
      whereClause = `DATE_TRUNC('month', s.start_time) = DATE_TRUNC('month', CURRENT_DATE)`;
    } else {
      return res
        .status(400)
        .json({ error: "Invalid range. Use day, week, or month." });
    }

    // 1. الإحصائيات العامة
    const summaryQuery = `
      SELECT
        COUNT(DISTINCT c.id) AS total_kids,
        COUNT(s.id) AS total_sessions,
        SUM(s.duration_min) AS total_minutes,
        SUM(s.duration_min * 1) AS total_points
      FROM sessions s
      JOIN children c ON s.child_id = c.id
      WHERE ${whereClause};
    `;

    const summaryResult = await db.query(summaryQuery);
    const summary = summaryResult.rows[0];

    // 2. تفاصيل الأطفال
    const kidsQuery = `
  SELECT
    c.name,
    c.entry_id,
    COUNT(s.id) AS session_count,
    COALESCE(SUM(s.points_deducted), 0) AS points_spent,
    MAX(s.start_time) AS last_session
  FROM sessions s
  JOIN children c ON s.child_id = c.id
  WHERE ${whereClause}
  GROUP BY c.id
  ORDER BY points_spent DESC;
`;

    const kidsResult = await db.query(kidsQuery);

    res.json({
      range,
      date: new Date().toISOString().slice(0, 10),
      total_kids: parseInt(summary.total_kids),
      total_sessions: parseInt(summary.total_sessions),
      total_points_earned: parseInt(summary.total_points),
      kids: kidsResult.rows,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch summary" });
  }
});

module.exports = router;
