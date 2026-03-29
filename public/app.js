
const specialistLibrary = {
  planning: {
    firms: ["DP9", "Turley", "Avison Young Planning"],
    rationale: "Strong London planning, committee, and mixed-use / residential experience.",
    scope: [
      "Review site constraints, policy position, and likely planning route.",
      "Prepare planning strategy and pre-application advice note.",
      "Coordinate planning statement and submission package.",
      "Advise on committee risk, objections, and negotiation points."
    ]
  },
  architecture: {
    firms: ["HTA Design", "Morris+Company", "Haworth Tompkins"],
    rationale: "Contextual London housing and mixed-use design experience.",
    scope: [
      "Prepare concept massing options and preferred scheme layout.",
      "Develop DAS and design narrative responsive to local context.",
      "Coordinate consultant inputs into the evolving design.",
      "Support planning visuals, drawings, and committee-facing material."
    ]
  },
  transport: {
    firms: ["Motion", "Vectos", "Stantec"],
    rationale: "Transport, parking, servicing, and car-light London schemes.",
    scope: [
      "Review PTAL, parking strategy, servicing, and access constraints.",
      "Prepare transport statement or assessment as required.",
      "Advise on cycle parking, disabled bays, refuse, and servicing.",
      "Support discussions with highways officers and TfL where relevant."
    ]
  },
  daylight: {
    firms: ["Point 2 Surveyors", "GIA", "Savills Daylight & Sunlight"],
    rationale: "Commonly used on London daylight, sunlight, and neighbour-impact testing.",
    scope: [
      "Review surrounding receptors and likely BRE testing requirements.",
      "Test daylight and sunlight effects on neighbours and proposed units.",
      "Advise on design changes to reduce planning risk.",
      "Prepare technical report for planning submission."
    ]
  },
  cost: {
    firms: ["Alinea", "Rider Levett Bucknall", "Turner & Townsend alinea"],
    rationale: "Development-focused cost planning and option testing.",
    scope: [
      "Prepare elemental cost plan for the preferred option.",
      "Test cost impact of height, façade, and basement / servicing moves.",
      "Advise on risk allowances, abnormal items, and contingencies.",
      "Support appraisal updates as the scheme evolves."
    ]
  },
  viability: {
    firms: ["BNP Paribas Real Estate", "Gerald Eve", "Cushman & Wakefield"],
    rationale: "Affordable housing and planning viability experience.",
    scope: [
      "Prepare first-pass viability testing of the preferred option.",
      "Model affordable housing and review mechanisms.",
      "Support negotiation on viability-sensitive planning obligations.",
      "Provide evidence to accompany planning and committee discussions."
    ]
  }
};

let latestAssessment = null;
let latestCommittee = null;
let latestPlanit = [];

function money(value){ return "£" + Math.round(value).toLocaleString(); }
function itemHtml(title, body, badge) {
  return `<div class="item"><div class="top"><strong>${title}</strong>${badge || ""}</div><div class="small" style="margin-top:8px;">${body}</div></div>`;
}
function showPage(id){
  document.querySelectorAll(".page").forEach(p => p.classList.remove("active"));
  document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
  document.getElementById(id).classList.add("active");
  document.querySelector(`[data-page="${id}"]`).classList.add("active");
}
function getPayload(){
  return {
    siteAddress: document.getElementById("address").value,
    siteAreaValue: document.getElementById("area").value,
    siteAreaUnit: document.getElementById("unit").value,
    borough: "Southwark",
    context: document.getElementById("context").value,
    ptal: document.getElementById("ptal").value,
    existingUse: document.getElementById("use").value,
    heritage: document.getElementById("heritage").checked,
    communityUse: document.getElementById("community").checked,
    tallBuildingZone: document.getElementById("tall").checked,
    floodRisk: document.getElementById("flood").checked,
    protectedEmployment: document.getElementById("employment").checked
  };
}
async function runAssessment(){
  const res = await fetch("/api/assessment", {
    method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify(getPayload())
  });
  latestAssessment = await res.json();
  document.getElementById("heightValue").textContent = `${latestAssessment.minHeight}-${latestAssessment.maxHeight} storeys`;
  document.getElementById("densityValue").textContent = `${latestAssessment.lowDensity}-${latestAssessment.highDensity} u/ha`;
  document.getElementById("homesValue").textContent = `${latestAssessment.lowHomes}-${latestAssessment.highHomes}`;
  document.getElementById("parkingValue").textContent = `${latestAssessment.maxParking}`;
  document.getElementById("amenityValue").textContent = `${latestAssessment.privateAmenity + latestAssessment.communalAmenity}`;
  document.getElementById("rlvValue").textContent = money(latestAssessment.rlv);
  document.getElementById("headlineText").textContent = latestAssessment.headline;
  document.getElementById("dashboardParking").textContent = `${latestAssessment.maxParking} spaces maximum including about ${latestAssessment.disabledBays} disabled bay(s).`;
  document.getElementById("dashboardAmenity").textContent = `${latestAssessment.privateAmenity} sqm private plus ${latestAssessment.communalAmenity} sqm communal.`;
  document.getElementById("gdvText").textContent = money(latestAssessment.gdv);
  document.getElementById("buildCostText").textContent = money(latestAssessment.buildCost);
  document.getElementById("saleableText").textContent = `${latestAssessment.saleableArea} sqm`;
  document.getElementById("rlvText").textContent = money(latestAssessment.rlv);
  renderSensitivity();
}
async function runPlanit(){
  const q = document.getElementById("address").value;
  const res = await fetch(`/api/planit-search?q=${encodeURIComponent(q)}`);
  const data = await res.json();
  latestPlanit = data.items || [];
  const wrap = document.getElementById("planitResults");
  if (latestPlanit.length) {
    wrap.innerHTML = latestPlanit.map(item => itemHtml(
      item.uid || item.altid || "PlanIt application",
      `${item.address || ""}<br>${item.description || ""}<br>${item.start_date || ""}<br><a href="${item.link}" target="_blank" rel="noreferrer">Open PlanIt record</a>`,
      `<span class="badge ok">score ${item.score}</span>`
    )).join("");
  } else if (data.error) {
    wrap.innerHTML = itemHtml("UK PlanIt returned an error", data.error, `<span class="badge warn">Error</span>`);
  } else {
    wrap.innerHTML = itemHtml("No Southwark matches found", "Try a more exact address, postcode, or planning reference.", `<span class="badge warn">No matches</span>`);
  }
}
async function analyseCommittee(){
  if (!latestAssessment) await runAssessment();
  const res = await fetch("/api/committee-analyse", {
    method:"POST",
    headers:{ "Content-Type":"application/json" },
    body: JSON.stringify({
      das: document.getElementById("dasText").value,
      decision: document.getElementById("decisionText").value,
      minutes: document.getElementById("minutesText").value,
      youtubeUrl: document.getElementById("youtubeUrl").value,
      site: latestAssessment
    })
  });
  latestCommittee = await res.json();
  document.getElementById("committeeThemes").innerHTML = latestCommittee.themes.length
    ? latestCommittee.themes.map(t => `<span class="badge">${t}</span>`).join(" ")
    : `<span class="small">No strong themes detected yet.</span>`;
  document.getElementById("committeeDecision").textContent = latestCommittee.decisionRoute;
  document.getElementById("committeeRelevance").innerHTML = latestCommittee.relevance.map(x => `<li>${x}</li>`).join("");
  document.getElementById("committeeMoves").innerHTML = latestCommittee.moves.map(x => `<li>${x}</li>`).join("");
}
function renderSensitivity(){
  if (!latestAssessment) return;
  const rows = [
    ["Base case", latestAssessment.rlv],
    ["-5% GDV", latestAssessment.rlv - (latestAssessment.gdv * 0.05)],
    ["+5% build cost", latestAssessment.rlv - (latestAssessment.buildCost * 0.05)],
    ["-5% GDV and +5% cost", latestAssessment.rlv - (latestAssessment.gdv * 0.05) - (latestAssessment.buildCost * 0.05)]
  ];
  document.getElementById("sensitivity").innerHTML = rows.map(r => `<li>${r[0]}: ${money(r[1])}</li>`).join("");
}
function renderProcurement(){
  const discipline = document.getElementById("disciplineSelect").value;
  const item = specialistLibrary[discipline];
  document.getElementById("specialistMatches").innerHTML = `<p><strong>Why these firms:</strong> ${item.rationale}</p><ul class="list">${item.firms.map(f => `<li>${f}</li>`).join("")}</ul>`;
  document.getElementById("specialistScope").innerHTML = `<p><strong>Draft scope for tailoring:</strong></p><ul class="list">${item.scope.map(s => `<li>${s}</li>`).join("")}</ul>`;
}
function downloadSummary(){
  if (!latestAssessment) return;
  const lines = [
    "Southwark Development Decision Engine v2 summary",
    `Height: ${latestAssessment.minHeight}-${latestAssessment.maxHeight} storeys`,
    `Density: ${latestAssessment.lowDensity}-${latestAssessment.highDensity} u/ha`,
    `Homes: ${latestAssessment.lowHomes}-${latestAssessment.highHomes}`,
    `Parking: ${latestAssessment.maxParking} spaces`,
    `Amenity: ${latestAssessment.privateAmenity + latestAssessment.communalAmenity} sqm`,
    `GDV: ${money(latestAssessment.gdv)}`,
    `Build cost: ${money(latestAssessment.buildCost)}`,
    `Residual land value: ${money(latestAssessment.rlv)}`
  ];
  if (latestCommittee) lines.push("", `Committee themes: ${latestCommittee.themes.join(", ") || "None"}`, `Decision read-out: ${latestCommittee.decisionRoute}`);
  const blob = new Blob([lines.join("\n")], { type:"text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "southwark-decision-engine-v2-summary.txt";
  a.click();
  URL.revokeObjectURL(url);
}
async function runAll(){ await runAssessment(); await runPlanit(); await analyseCommittee(); }
document.addEventListener("DOMContentLoaded", async () => { renderProcurement(); await runAssessment(); await runPlanit(); });
