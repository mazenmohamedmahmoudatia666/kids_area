const express = require("express");
const router = express.Router();
const db = require("../db");

router.get("/stats/points-summary", async (req, res) => {
  try {
    const range = req.query.range || "day";
    let whereClause = "";

    // تحديد الشرط حسب النطاق
    if (range === "day") {
      whereClause = `DATE(s.start_time) = CURRENT_DATE`;
    } else if (range === "week") {
      whereClause = `DATE_TRUNC('week', s.start_time) = DATE_TRUNC('week', CURRENT_DATE)`;
    } else if (range === "month") {
      whereClause = `DATE_TRUNC('month', s.start_time) = DATE_TRUNC('month', CURRENT_DATE)`;
    } else {
      return res
        .status(400)
        .json({ message: "Invalid range (day, week, month)" });
    }

    // 1. إجمالي الجلسات والنقاط
    const totalQuery = `
      SELECT
        COUNT(*) AS total_sessions,
        COALESCE(SUM(s.points_deducted), 0) AS total_points_deducted
      FROM sessions s
      WHERE ${whereClause};
    `;

    const totalResult = await db.query(totalQuery);
    const { total_sessions, total_points_deducted } = totalResult.rows[0];

    // 2. أعلى الأطفال صرفًا للنقاط
    const topKidsQuery = `
  SELECT
    c.name,
    c.entry_id,
    COUNT(s.id) AS session_count,
    SUM(s.points_deducted) AS points_spent
  FROM sessions s
  JOIN children c ON c.id = s.child_id
  WHERE ${whereClause}
  GROUP BY c.id
  ORDER BY points_spent DESC
  LIMIT 5;
`;

    const topKidsResult = await db.query(topKidsQuery);

    res.json({
      range,
      date: new Date().toISOString().slice(0, 10),
      total_sessions: parseInt(total_sessions),
      total_points_deducted: parseInt(total_points_deducted),
      top_kids: topKidsResult.rows,
    });
  } catch (err) {
    console.error("Error in /stats/points-summary:", err);
    res.status(500).json({ error: "Failed to fetch points summary" });
  }
});

module.exports = router;
