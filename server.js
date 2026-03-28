const express = require("express");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static("public"));

const PORT = process.env.PORT || 3000;

app.get("/api/health", (req, res) => {
  res.json({ ok: true });
});

app.get("/api/planit", async (req, res) => {
  try {
    const response = await fetch("https://www.planit.org.uk/api/applics/csv?max_recs=200");
    const text = await response.text();

    res.json({
      message: "PlanIt working",
      preview: text.substring(0, 1000)
    });

  } catch (e) {
    res.status(500).json({ error: e.toString() });
  }
});

app.post("/api/committee-analyse", (req, res) => {
  const { das, decision, minutes } = req.body;
  const text = `${das} ${decision} ${minutes}`.toLowerCase();

  const themes = [];

  if (text.includes("height")) themes.push("Height");
  if (text.includes("overlooking")) themes.push("Neighbour impact");
  if (text.includes("parking")) themes.push("Transport");
  if (text.includes("design")) themes.push("Design");
  if (text.includes("community")) themes.push("Community");

  let decisionResult = "Unclear";
  if (text.includes("approved")) decisionResult = "Approved";
  if (text.includes("refused")) decisionResult = "Refused";

  res.json({
    themes,
    decision: decisionResult
  });
});

app.listen(PORT, () => {
  console.log("Server running");
});
