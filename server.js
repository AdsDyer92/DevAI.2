const express = require("express");
const cors = require("cors");
const path = require("path");

const app = express();

app.use(cors());
app.use(express.json({ limit: "2mb" }));
app.use(express.static(path.join(__dirname, "public")));

const PORT = process.env.PORT || 3000;

const PLANIT_FIELDS = [
  "name",
  "uid",
  "altid",
  "area_name",
  "area_id",
  "start_date",
  "address",
  "description",
  "location",
  "link",
  "last_scraped"
];

function acresToHa(acres) {
  return acres * 0.404686;
}

function sqmToHa(sqm) {
  return sqm / 10000;
}

function parseCsvRows(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];

    if (inQuotes) {
      if (ch === '"' && next === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        field += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ",") {
        row.push(field);
        field = "";
      } else if (ch === "\n") {
        row.push(field);
        rows.push(row);
        row = [];
        field = "";
      } else if (ch !== "\r") {
        field += ch;
      }
    }
  }

  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter((r) => r.some((v) => String(v || "").trim().length > 0));
}

function rowsToObjects(rows) {
  const first = rows[0] || [];
  const looksLikeHeader = first.some((v) =>
    PLANIT_FIELDS.includes(String(v || "").trim())
  );

  if (looksLikeHeader) {
    const headers = first.map((v) => String(v || "").trim());
    return rows.slice(1).map((r) =>
      Object.fromEntries(headers.map((h, i) => [h, r[i] || ""]))
    );
  }

  return rows.map((r) =>
    Object.fromEntries(PLANIT_FIELDS.map((h, i) => [h, r[i] || ""]))
  );
}

function tokenize(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s/,-]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function scoreMatch(query, row) {
  const q = tokenize(query);
  const hay = `${row.address || ""} ${row.description || ""} ${row.uid || ""} ${row.altid || ""}`.toLowerCase();

  let score = 0;
  q.forEach((token) => {
    if (hay.includes(token)) score += 1;
  });

  if ((row.area_name || "").toLowerCase() === "southwark") score += 2;

  return score;
}

function inferComparableMeta(row) {
  const text = `${row.description || ""} ${row.address || ""}`.toLowerCase();

  let homesBand = "Homes not clear";
  const homesMatch = text.match(/(\d+)\s+(home|homes|dwelling|dwellings|unit|units)/);
  if (homesMatch) homesBand = `${homesMatch[1]} homes`;

  let heightBand = "Height not clear";
  const heightMatch = text.match(/(\d+)(-| to )?(\d+)?\s*(storey|storeys|story|stories)/);
  if (heightMatch) {
    heightBand = heightMatch[3]
      ? `${heightMatch[1]}-${heightMatch[3]} storeys`
      : `${heightMatch[1]} storeys`;
  }

  let typology = "Residential / mixed-use";
  if (/community/.test(text)) typology = "Community-related redevelopment";
  else if (/office|workspace|retail|commercial/.test(text)) typology = "Mixed-use / commercial-led";
  else if (/residential|apartment|flat/.test(text)) typology = "Residential-led";

  return { homesBand, heightBand, typology };
}

function buildAssessment(input) {
  const areaHa =
    input.siteAreaUnit === "ha"
      ? Number(input.siteAreaValue || 0)
      : input.siteAreaUnit === "acres"
      ? acresToHa(Number(input.siteAreaValue || 0))
      : sqmToHa(Number(input.siteAreaValue || 0));

  let lowDensity = 180;
  let highDensity = 320;
  let minHeight = 3;
  let maxHeight = 5;
  let buildCostPerSqm = 3000;
  let gdvPerSqm = 8500;

  if (input.context === "town") {
    lowDensity = 240;
    highDensity = 420;
    minHeight = 4;
    maxHeight = 7;
    buildCostPerSqm = 3200;
  }

  if (input.context === "suburban") {
    lowDensity = 80;
    highDensity = 170;
    minHeight = 2;
    maxHeight = 4;
  }

  if (input.context === "growth") {
    lowDensity = 320;
    highDensity = 600;
    minHeight = 6;
    maxHeight = 12;
    buildCostPerSqm = 3400;
  }

  if (input.ptal === "high") {
    lowDensity *= 1.1;
    highDensity *= 1.1;
    maxHeight += 1;
  }

  if (input.ptal === "very-high") {
    lowDensity *= 1.18;
    highDensity *= 1.18;
    maxHeight += 1;
  }

  if (input.ptal === "low") {
    lowDensity *= 0.9;
    highDensity *= 0.9;
  }

  lowDensity = Math.round(lowDensity);
  highDensity = Math.round(highDensity);

  const sweetSpotDensity = Math.round((lowDensity + highDensity) / 2);
  const lowHomes = Math.max(1, Math.floor(areaHa * lowDensity));
  const highHomes = Math.max(lowHomes, Math.floor(areaHa * highDensity));
  const targetHomes = Math.max(lowHomes, Math.round(areaHa * sweetSpotDensity));

  const parkingRatio =
    input.ptal === "very-high" ? 0 :
    input.ptal === "high" ? 0.1 :
    input.ptal === "medium" ? 0.35 :
    0.75;

  const maxParking = Math.round(targetHomes * parkingRatio);
  const privateAmenity = targetHomes * 5;
  const communalAmenity = targetHomes * 7;

  const saleableArea = Math.round(targetHomes * 70);
  const buildCost = Math.round((saleableArea / 0.8) * buildCostPerSqm);
  const gdv = Math.round(saleableArea * gdvPerSqm);
  const rlv = Math.round(gdv - buildCost * 1.4);

  const metrics = {
    density: `${lowDensity}-${highDensity} u/ha`,
    homes: `${lowHomes}-${highHomes}`,
    height: `${minHeight}-${maxHeight} storeys`,
    parking: `${maxParking} spaces max`,
    amenity: `${privateAmenity + communalAmenity} sqm total`,
    daylightSunlight: "Check neighbour and future occupier daylight / sunlight impacts",
    overlookingPrivacy: "Check privacy distances and overlooking risk",
    servicingRefuse: "Test refuse, servicing and fire access early",
    urbanDesignTownscape: "Check scale, local character and frontage rhythm",
    sustainabilityEnergy: "Expect an energy and overheating response",
    floodDrainage: "Test drainage and SuDS even where flood risk seems low"
  };

  return {
    areaHa,
    lowDensity,
    highDensity,
    lowHomes,
    highHomes,
    minHeight,
    maxHeight,
    maxParking,
    privateAmenity,
    communalAmenity,
    saleableArea,
    gdv,
    buildCost,
    rlv,
    metrics,
    headline: `A Southwark-focused first option to test is around ${minHeight}-${maxHeight} storeys at roughly ${sweetSpotDensity} units/ha, suggesting about ${targetHomes} homes.`
  };
}

function explainRecommendations(site, comparables) {
  const comps = (comparables || []).slice(0, 5);
  const compText = comps
    .map((c) => `${c.address || "Comparable"}: ${c.meta?.typology || ""}, ${c.meta?.heightBand || ""}, ${c.meta?.homesBand || ""}`)
    .join(" | ");

  return {
    densityWhy: `The density recommendation of ${site.lowDensity}-${site.highDensity} u/ha is driven by site context, accessibility, and comparable Southwark schemes. ${compText ? "Shortlisted comparables include: " + compText : ""}`,
    parkingWhy: `The parking recommendation of up to ${site.maxParking} spaces is mainly driven by accessibility and a lower-car assumption for better-connected sites.`,
    affordableWhy: `Affordable housing should be read as policy baseline versus real-world comparable outcome. Differences often come from viability, existing-use constraints, or planning balance.`
  };
}

app.get("/api/health", (req, res) => {
  res.json({ ok: true });
});

app.post("/api/assessment", (req, res) => {
  res.json(buildAssessment(req.body || {}));
});

app.post("/api/explain", (req, res) => {
  res.json(explainRecommendations(req.body.site || {}, req.body.comparables || []));
});

app.get("/api/planit-search", async (req, res) => {
  try {
    const query = String(req.query.q || "").trim();

    const params = new URLSearchParams({
      compress: "off",
      max_recs: "2000",
      pg_sz: "2000",
      recent: String(req.query.recent || "3650"),
      select: PLANIT_FIELDS.join(","),
      sort: "start_date.desc.nullslast,last_scraped.desc.nullslast"
    });

    const response = await fetch(
      `https://www.planit.org.uk/api/applics/csv?${params.toString()}`,
      {
        headers: {
          "user-agent": "southwark-decision-engine-v3/3.1"
        }
      }
    );

    if (!response.ok) {
      return res.status(502).json({
        error: `PlanIt fetch failed with ${response.status}`,
        items: []
      });
    }

    const rows = parseCsvRows(await response.text());
    const objects = rowsToObjects(rows);

    const items = objects
      .filter((row) => String(row.area_name || "").toLowerCase() === "southwark")
      .map((row) => ({
        ...row,
        score: scoreMatch(query, row),
        meta: inferComparableMeta(row)
      }))
      .filter((row) => (query ? row.score > 0 : true))
      .sort((a, b) => b.score - a.score)
      .slice(0, 12)
      .map((row) => ({
        uid: row.uid,
        altid: row.altid,
        address: row.address,
        description: row.description,
        start_date: row.start_date,
        area_name: row.area_name,
        link: row.link,
        score: row.score,
        meta: row.meta
      }));

    res.json({
      source: "Southwark comparable prototype via UK PlanIt",
      query,
      count: items.length,
      items
    });
  } catch (error) {
    res.status(500).json({
      error: String(error),
      items: []
    });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
