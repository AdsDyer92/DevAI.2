let latestAssessment = null;
let latestComparables = [];

function money(v) {
  return "£" + Math.round(v).toLocaleString();
}

function getPayload() {
  return {
    siteAddress: document.getElementById("address").value,
    siteAreaValue: document.getElementById("area").value,
    siteAreaUnit: document.getElementById("unit").value,
    context: document.getElementById("context").value,
    ptal: document.getElementById("ptal").value
  };
}

async function runAssessment() {
  const res = await fetch("/api/assessment", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(getPayload())
  });

  latestAssessment = await res.json();

  document.getElementById("heightValue").textContent =
    `${latestAssessment.minHeight}-${latestAssessment.maxHeight} storeys`;

  document.getElementById("densityValue").textContent =
    `${latestAssessment.lowDensity}-${latestAssessment.highDensity} u/ha`;

  document.getElementById("homesValue").textContent =
    `${latestAssessment.lowHomes}-${latestAssessment.highHomes}`;

  document.getElementById("parkingValue").textContent =
    latestAssessment.maxParking;

  document.getElementById("rlvValue").textContent =
    money(latestAssessment.rlv);

  renderMetrics();
}

async function runComparables() {
  const query = document.getElementById("address").value;

  const res = await fetch(`/api/planit-search?q=${query}`);
  const data = await res.json();

  latestComparables = data.items || [];

  const el = document.getElementById("comparables");

  el.innerHTML = latestComparables.map(c => `
    <div class="item">
      <strong>${c.address}</strong><br>
      ${c.description}<br>
      <em>${c.meta.typology}, ${c.meta.heightBand}, ${c.meta.homesBand}</em><br>
      <a href="${c.link}" target="_blank">View application</a>
    </div>
  `).join("");
}

async function runExplainers() {
  const res = await fetch("/api/explain", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      site: latestAssessment,
      comparables: latestComparables
    })
  });

  const data = await res.json();

  document.getElementById("densityWhy").textContent = data.densityWhy;
  document.getElementById("parkingWhy").textContent = data.parkingWhy;
  document.getElementById("affordableWhy").textContent = data.affordableWhy;
}

function renderMetrics() {
  const m = latestAssessment.metrics;

  document.getElementById("extraMetrics").innerHTML =
    Object.entries(m).map(([k, v]) =>
      `<li><strong>${k}:</strong> ${v}</li>`
    ).join("");
}

async function runAll() {
  await runAssessment();
  await runComparables();
  await runExplainers();
}

window.onload = runAll;
