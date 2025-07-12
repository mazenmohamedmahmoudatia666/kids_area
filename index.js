const express = require("express");
const checkinRoute = require("./routes/checkin");
const sessionRoutes = require("./routes/sessions");
const summaryRoutes = require("./routes/summary");
const childrenRoutes = require("./routes/children");
const statsRoutes = require("./routes/stats");
const pointsRoutes = require("./routes/points");

const app = express();

app.use(express.json());

const port = process.env.PORT || 5000;
app.get("/", (req, res) => {
  res.send("Kids Area System is running!");
});

const db = require("./db");

db.query("SELECT NOW()", (err, res) => {
  if (err) {
    console.error("DB connection error:", err);
  } else {
    console.log("DB time:", res.rows[0]);
  }
});
app.use("/", checkinRoute);
app.use("/", sessionRoutes);
app.use("/", summaryRoutes);
app.use("/", childrenRoutes);
app.use("/", statsRoutes);
app.use("/", pointsRoutes);

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
