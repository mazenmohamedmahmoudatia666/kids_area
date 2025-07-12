const express = require("express");
const router = express.Router();
const db = require("../db");

router.get("/points", async (req, res) => {
  const duration = parseInt(req.query.duration);

  if (!duration || duration <= 0) {
    return res.status(400).json({ message: "Invalid duration" });
  }

  try {
    const result = await db.query(
      "SELECT points FROM points WHERE duration_min = $1",
      [duration]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Duration not found" });
    }

    res.json({
      duration_min: duration,
      points_required: result.rows[0].points,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch points" });
  }
});

module.exports = router;
