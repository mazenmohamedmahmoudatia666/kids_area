router.patch("/sessions/:id/extend", async (req, res) => {
  try {
    const sessionId = req.params.id;
    const { extra_minutes } = req.body;

    if (!extra_minutes || extra_minutes <= 0) {
      return res.status(400).json({ message: "Invalid extra_minutes value" });
    }

    // تحقق إن الجلسة موجودة ومش منتهية
    const checkQuery = `SELECT * FROM sessions WHERE id = $1`;
    const checkResult = await db.query(checkQuery, [sessionId]);

    if (checkResult.rows.length === 0) {
      return res.status(404).json({ message: "Session not found" });
    }

    const session = checkResult.rows[0];

    if (session.status === "finished") {
      return res
        .status(400)
        .json({ message: "Cannot extend a finished session" });
    }

    const newDuration = session.duration_min + extra_minutes;

    // نحدث المدة
    const updateQuery = `
      UPDATE sessions
      SET duration_min = $1
      WHERE id = $2
      RETURNING *;
    `;

    const updateResult = await db.query(updateQuery, [newDuration, sessionId]);

    res.json({
      message: "Session extended successfully",
      data: {
        session_id: sessionId,
        old_duration: session.duration_min,
        new_duration: newDuration,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to extend session" });
  }
});
