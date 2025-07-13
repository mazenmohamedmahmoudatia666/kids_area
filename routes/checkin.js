const express = require("express");
const router = express.Router();
const db = require("../db");

// POST /checkin
router.post("/checkin", async (req, res) => {
  try {
    const {
      name,
      card_number,
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
    const findChildQuery = `SELECT * FROM children WHERE card_number = $1`;
    const childResult = await db.query(findChildQuery, [card_number]);

    let child;
    if (childResult.rows.length > 0) {
      child = childResult.rows[0];
    } else {
      const insertChildQuery = `
        INSERT INTO children (name, card_number, primary_phone, secondary_phone, children_count, points, total_points_spent)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING *;
      `;
      const newChildResult = await db.query(insertChildQuery, [
        name,
        card_number,
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
      // إذا أرسل start_time كتاريخ ووقت كامل، استخدمه كما هو
      sessionStartTime = new Date(start_time);
    } else {
      sessionStartTime = new Date();
    }

    // حساب ترتيب الدخول في اليوم
    const todayStr = sessionStartTime.toISOString().slice(0, 10); // yyyy-mm-dd
    const countQuery = `SELECT COUNT(*) FROM sessions WHERE DATE(start_time) = $1`;
    const countResult = await db.query(countQuery, [todayStr]);
    const todayOrder = parseInt(countResult.rows[0].count) + 1; // القادم هو التالي
    const receipt_number = `${todayStr.replace(/-/g, "")}${todayOrder}`;

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

    const checkoutDate = new Date(session.start_time);
    checkoutDate.setMinutes(checkoutDate.getMinutes() + session.duration_min);

    res.status(201).json({
      message: "تم تسجيل الدخول بنجاح",
      data: {
        child_name: child.name,
        parent_phone: child.primary_phone,
        session_receipt: receipt_number,
        card_number: child.card_number,
        checkin_time: session.start_time,
        duration_minutes: session.duration_min,
        children_count: session.children_count,
        points_used: session.points_deducted,
        expected_checkout: checkoutDate,
      },
    });
  } catch (err) {
    console.error("checkin error:", err);
    res.status(500).json({ error: "Something went wrong during check-in" });
  }
});

module.exports = router;
