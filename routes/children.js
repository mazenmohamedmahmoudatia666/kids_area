const express = require("express");
const router = express.Router();
const db = require("../db");

// GET /children/:entry_id
router.get("/children/:entry_id", async (req, res) => {
  try {
    const entryId = req.params.entry_id;

    /* ❶ نجلب بيانات الطفل + إجمالى ما صرفه من جدول sessions */
    const query = `
      SELECT
        c.*,
        COALESCE(SUM(s.points_deducted), 0) AS total_points_spent
      FROM children c
      LEFT JOIN sessions s
        ON s.child_id = c.id
      WHERE c.entry_id = $1
      GROUP BY c.id;
    `;

    const result = await db.query(query, [entryId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Child not found" });
    }

    /* ❷ نرجّع بيانات الطفل ومعها التراكُمى الصحيح */
    res.json(result.rows[0]);
  } catch (err) {
    console.error("Error in GET /children/:entry_id:", err);
    res.status(500).json({ error: "Failed to fetch child data" });
  }
});

module.exports = router;
