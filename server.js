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

  let likelyOutcome = "Outcome unclear";
  if (/refus/.test(text)) likelyOutcome = "Likely refusal-related wording";
  if (/approv|grant/.test(text)) likelyOutcome = "Likely approval-related wording";

  return { homesBand, heightBand, typology, likelyOutcome };
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

  if (input.existingUse === "community" || input.communityUse) {
    lowDensity *= 0.92;
    highDensity *= 0.92;
  }

  if (input.existingUse === "industrial" || input.protectedEmployment) {
    lowDensity *= 0.9;
    highDensity *= 0.9;
  }

  if (input.heritage) {
    lowDensity *= 0.88;
    highDensity *= 0.88;
    maxHeight -= 1;
  }

  if (input.floodRisk) {
    lowDensity *= 0.95;
    highDensity *= 0.95;
  }

  if (input.tallBuildingZone) {
    highDensity *= 1.15;
    maxHeight += 3;
  }

  lowDensity = Math.round(lowDensity);
  highDensity = Math.round(highDensity);
  minHeight = Math.max(2, minHeight);
  maxHeight = Math.max(minHeight, maxHeight);

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
  const disabledBays = targetHomes >= 10 ? Math.max(1, Math.ceil(maxParking * 0.1)) : (maxParking > 0 ? 1 : 0);

  const privateAmenity = targetHomes * 5;
  const communalAmenity = targetHomes * 7;

  const avgUnitSize =
    input.context === "town"
      ? 62
      : (input.existingUse === "community" || input.communityUse)
      ? 68
      : 70;

  const saleableArea = Math.round(targetHomes * avgUnitSize);
  const grossArea = Math.round(saleableArea / 0.8);
  const buildCost = grossArea * buildCostPerSqm;
  const gdv = saleableArea * gdvPerSqm;

  const externalWorks = buildCost * 0.08;
  const fees = buildCost * 0.12;
  const contingency = buildCost * 0.05;
  const finance = (buildCost + externalWorks + fees) * 0.07;
  const marketing = gdv * 0.03;
  const communityAllowance =
    input.existingUse === "community" || input.communityUse ? 1250000 : 0;

  const totalCost =
    buildCost +
    externalWorks +
    fees +
    contingency +
    finance +
    marketing +
    communityAllowance;

  const profit = gdv * 0.18;
  const rlv = gdv - totalCost - profit;

  const metrics = {
    density: `${lowDensity}-${highDensity} u/ha`,
    homes: `${lowHomes}-${highHomes}`,
    height: `${minHeight}-${maxHeight} storeys`,
    parking: `${maxParking} spaces max`,
    amenity: `${privateAmenity + communalAmenity} sqm total`,
    affordableHousing: targetHomes >= 10 ? "Affordable housing likely policy-relevant" : "Below common major-scheme threshold",
    tenureMix: targetHomes >= 10 ? "Tenure mix likely material" : "Tenure still relevant but less likely to drive the whole scheme",
    daylightSunlight: "Check neighbour and future occupier daylight / sunlight impacts",
    overlookingPrivacy: "Check rear relationships and privacy distances",
    servicingRefuse: "Test refuse, servicing, deliveries and fire access early",
    urbanDesignTownscape: "Check massing, frontage rhythm, local character and materials",
    heritageContext: input.heritage ? "Heritage constraint flagged" : "Still test nearby heritage and townscape sensitivity",
    playSpaceFamilyMix: "Check if family housing triggers child play / larger communal-space expectations",
    sustainabilityEnergy: "Expect a stronger energy, overheating and sustainability response",
    treesBiodiversity: "Check trees, greening and biodiversity implications",
    floodDrainage: input.floodRisk ? "Flood-risk and SuDS response likely important" : "Still test surface-water drainage and SuDS",
    employmentCommunityUse:
      (input.existingUse === "community" ||
        input.communityUse ||
        input.existingUse === "industrial" ||
        input.protectedEmployment)
        ? "Potential reprovision / loss-justification issue"
        : "No major existing-use protection issue assumed",
    committeeRisk: "Review comparable committee outcomes where available",
    viabilityPressure: "Compare policy ask with likely viability and comparable outcomes"
  };

  return {
    areaHa,
    lowDensity,
    highDensity,
    targetHomes,
    lowHomes,
    highHomes,
    minHeight,
    maxHeight,
    maxParking,
    disabledBays,
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
    .map(
      (c) =>
        `${c.address || "Comparable"}: ${c.meta?.typology || ""}, ${c.meta?.heightBand || ""}, ${c.meta?.homesBand || ""}`
    )
    .join(" | ");

  return {
    densityWhy: `The density recommendation of ${site.lowDensity}-${site.highDensity} units/ha is driven first by Southwark context and transport accessibility, then moderated for site constraints such as community use, heritage, flood risk, and employment sensitivity. Use the Southwark Plan, any neighbourhood-plan context, and comparable Southwark applications together. ${compText ? "Current shortlisted comparables include: " + compText : "Comparable applications should be used to test whether similar Southwark schemes were accepted at similar scale."}`,
    parkingWhy: `The parking recommendation of up to ${site.maxParking} spaces is driven mainly by accessibility and a Southwark-first assumption that more accessible sites should tend toward lower-car outcomes. It should then be checked against local transport policy, servicing realities, disabled parking requirements, and what comparable Southwark schemes actually delivered in practice.`,
    affordableWhy: `Affordable housing should be explained as a policy baseline versus a real-world outcome. If policy points one way but a comparable delivered less, the likely reasons are viability, existing-use constraints, tenure negotiation, or wider planning balance rather than the policy position simply disappearing.`
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
      return res
        .status(502)
        .json({ error: `PlanIt fetch failed with ${response.status}`, items: [] });
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
    res.status(500).json({ error: String(error), items: [] });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
"""
(base / "server.js").write_text(server_js, encoding="utf-8")

index_html = """<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Southwark Development Decision Engine v3</title>
  <link rel="stylesheet" href="/styles.css" />
</head>
<body>
  <div class="wrap">
    <div class="hero">
      <span class="eyebrow">Southwark-only prototype • comparable finder + explainable recommendations</span>
      <h1>Southwark Development Decision Engine v3</h1>
      <p>This version focuses on identifying Southwark comparable applications, recommending which ones to look at, and explaining why the engine recommends a given density, parking outcome, and affordable-housing position.</p>
    </div>

    <div class="grid">
      <div class="card">
        <h2>Target site</h2>

        <label>Southwark site address</label>
        <input id="address" value="55 Nigel Road, SE15 4NP" />

        <label>Site area</label>
        <input id="area" type="number" step="0.001" value="0.391" />

        <label>Area unit</label>
        <select id="unit">
          <option value="acres">Acres</option>
          <option value="ha">Hectares</option>
          <option value="sqm">Sq m</option>
        </select>

        <label>Planning context</label>
        <select id="context">
          <option value="urban">Urban residential</option>
          <option value="town">Town centre / high street</option>
          <option value="suburban">Suburban / low-rise</option>
          <option value="growth">Growth area / opportunity area</option>
        </select>

        <label>Transport accessibility</label>
        <select id="ptal">
          <option value="medium">Medium</option>
          <option value="high">High</option>
          <option value="very-high">Very high</option>
          <option value="low">Low</option>
        </select>

        <label>Existing use</label>
        <select id="use">
          <option value="community">Community</option>
          <option value="residential">Residential</option>
          <option value="commercial">Commercial</option>
          <option value="industrial">Industrial</option>
          <option value="other">Other</option>
        </select>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:12px">
          <label><input id="heritage" type="checkbox"> Heritage</label>
          <label><input id="community" type="checkbox" checked> Community use</label>
          <label><input id="tall" type="checkbox"> Tall-building location</label>
          <label><input id="flood" type="checkbox"> Flood-risk</label>
          <label><input id="employment" type="checkbox"> Employment flag</label>
        </div>

        <button onclick="runAll()">Refresh engine</button>
      </div>

      <div>
        <div class="metrics">
          <div class="metric"><div class="label">Suggested height</div><div class="value" id="heightValue">—</div><div class="subtext">contextual envelope</div></div>
          <div class="metric"><div class="label">Recommended density</div><div class="value" id="densityValue">—</div><div class="subtext">units per hectare</div></div>
          <div class="metric"><div class="label">Estimated homes</div><div class="value" id="homesValue">—</div><div class="subtext">target option</div></div>
          <div class="metric"><div class="label">Parking</div><div class="value" id="parkingValue">—</div><div class="subtext">max spaces</div></div>
          <div class="metric"><div class="label">Amenity</div><div class="value" id="amenityValue">—</div><div class="subtext">sqm total</div></div>
          <div class="metric"><div class="label">Residual land value</div><div class="value" id="rlvValue">—</div><div class="subtext">first pass only</div></div>
        </div>

        <div class="tabs">
          <button class="tab active" data-page="dashboard" onclick="showPage('dashboard')">Dashboard</button>
          <button class="tab" data-page="comparables" onclick="showPage('comparables')">Comparable apps</button>
          <button class="tab" data-page="procurement" onclick="showPage('procurement')">Procurement</button>
        </div>

        <div id="dashboard" class="page active">
          <div class="card">
            <h3>Recommendation</h3>
            <p id="headlineText"></p>
          </div>

          <div class="three" style="margin-top:16px;">
            <div class="soft">
              <strong>Why this density?</strong>
              <p id="densityWhy" class="small"></p>
            </div>
            <div class="soft">
              <strong>Why this parking level?</strong>
              <p id="parkingWhy" class="small"></p>
            </div>
            <div class="soft">
              <strong>Why might affordable housing differ from policy?</strong>
              <p id="affordableWhy" class="small"></p>
            </div>
          </div>

          <div class="card" style="margin-top:16px;">
            <h3>Other key planning considerations</h3>
            <ul class="list" id="extraMetrics"></ul>
          </div>
        </div>

        <div id="comparables" class="page">
          <div class="card">
            <h3>Southwark comparable applications</h3>
            <div id="comparableResults"></div>
          </div>
        </div>

        <div id="procurement" class="page">
          <div class="card">
            <h3>Specialist procurement</h3>

            <div class="two">
              <div>
                <label>Discipline</label>
                <select id="disciplineSelect" onchange="renderProcurement()">
                  <option value="planning">Planning consultant</option>
                  <option value="architecture">Architect</option>
                  <option value="transport">Transport consultant</option>
                </select>
              </div>

              <div class="soft">
                <strong>How to use this</strong>
                <p class="small">Use the comparable applications and recommendation explainers to tailor the scope and shortlist.</p>
              </div>
            </div>

            <div class="two" style="margin-top:16px;">
              <div class="soft">
                <strong>Suggested specialists</strong>
                <div id="specialistMatches"></div>
              </div>
              <div class="soft">
                <strong>Draft scope</strong>
                <div id="specialistScope"></div>
              </div>
            </div>
          </div>
        </div>

      </div>
    </div>
  </div>

  <script src="/app.js"></script>
</body>
</html>
"""
(base / "public" / "index.html").write_text(index_html, encoding="utf-8")

(base / "README.txt").write_text(
    "Southwark Development Decision Engine v3 with comparables and expanded planning metrics.\n",
    encoding="utf-8"
)

zip_path = Path("/mnt/data/southwark-decision-engine-v3-metrics.zip")
with ZipFile(zip_path, "w", ZIP_DEFLATED) as zf:
    for f in [
        base / "package.json",
        base / "server.js",
        base / "README.txt",
        base / "public" / "styles.css",
        base / "public" / "app.js",
        base / "public" / "index.html",
    ]:
        zf.write(f, arcname=str(f.relative_to(base)))

print(zip_path)
าคาร่า to=python_user_visible.exec code
