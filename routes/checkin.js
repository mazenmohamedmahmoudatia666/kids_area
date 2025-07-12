const express = require("express");
const router = express.Router();
const db = require("../db");

// POST /checkin
router.post("/checkin", async (req, res) => {
  try {
    const {
      name,
      entry_id,
      primary_phone,
      secondary_phone,
      children_count,
      duration_min,
      start_time,
      manual_points_per_hour,
    } = req.body;

    if (!manual_points_per_hour || manual_points_per_hour <= 0) {
      return res.status(400).json({
        message: "manual_points_per_hour is required and must be > 0",
      });
    }

    // 1. إدخال الطفل أو التحقق إذا كان موجود مسبقًا
    const findChildQuery = `SELECT * FROM children WHERE entry_id = $1`;
    const childResult = await db.query(findChildQuery, [entry_id]);

    let child;
    if (childResult.rows.length > 0) {
      child = childResult.rows[0];
    } else {
      const insertChildQuery = `
        INSERT INTO children (name, entry_id, primary_phone, secondary_phone, children_count, points, total_points_spent)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING *;
      `;
      const newChildResult = await db.query(insertChildQuery, [
        name,
        entry_id,
        primary_phone,
        secondary_phone,
        children_count,
        0,
        0,
      ]);
      child = newChildResult.rows[0];
    }

    // 2. حساب عدد النقاط يدويًا
    const pointsDeducted = Math.round(
      manual_points_per_hour * (duration_min / 60) * children_count
    );

    // 3. السعر (بناءً على النقاط × 0.55 قرش)
    const priceAtBooking = (pointsDeducted * 0.55).toFixed(2);

    // 4. وقت البداية
    let sessionStartTime;
    if (start_time) {
      const [hours, minutes] = start_time.split(":").map(Number);
      const today = new Date();
      today.setHours(hours, minutes || 0, 0, 0);
      sessionStartTime = today;
    } else {
      sessionStartTime = new Date();
    }

    // 5. نحدث total_points_spent للطفل
    await db.query(
      `UPDATE children SET total_points_spent = total_points_spent + $1 WHERE id = $2`,
      [pointsDeducted, child.id]
    );

    // 6. نسجل الجلسة
    const insertSessionQuery = `
      INSERT INTO sessions (child_id, start_time, duration_min, price_at_booking, points_deducted, children_count)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *;
    `;

    const sessionResult = await db.query(insertSessionQuery, [
      child.id,
      sessionStartTime,
      duration_min,
      priceAtBooking,
      pointsDeducted,
      children_count,
    ]);

    const session = sessionResult.rows[0];

    res.status(201).json({
      message: "Child checked in successfully.",
      points_deducted: pointsDeducted,
      total_points_spent: child.total_points_spent + pointsDeducted,
      child,
      session,
    });
  } catch (err) {
    console.error("checkin error:", err);
    res.status(500).json({ error: "Something went wrong during check-in" });
  }
});

module.exports = router;
