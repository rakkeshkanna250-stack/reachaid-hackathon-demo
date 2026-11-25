"use strict";

const COMPLAINTS = {
  "heart-attack": {
    name: "Major heart attack",
    title: "Cardiac emergency · Major heart attack",
    resources: [
      { key: "cathLab", label: "Cath lab", weight: 55, critical: true },
      { key: "icuBeds", label: "ICU bed", weight: 25, critical: true },
      { key: "ventilators", label: "Ventilator", weight: 20, critical: false },
    ],
  },
  "cardiac-arrest": {
    name: "Cardiac arrest",
    title: "Cardiac emergency · Cardiac arrest",
    resources: [
      { key: "ventilators", label: "Ventilator", weight: 45, critical: true },
      { key: "icuBeds", label: "ICU bed", weight: 35, critical: true },
      { key: "cathLab", label: "Cath lab", weight: 20, critical: false },
    ],
  },
  trauma: {
    name: "Severe trauma / accident",
    title: "Major trauma · Severe accident",
    resources: [
      { key: "traumaBay", label: "Trauma bay", weight: 45, critical: true },
      { key: "icuBeds", label: "ICU bed", weight: 30, critical: true },
      { key: "ventilators", label: "Ventilator", weight: 25, critical: false },
    ],
  },
  stroke: {
    name: "Acute stroke",
    title: "Neurological emergency · Acute stroke",
    resources: [
      { key: "strokeUnit", label: "Stroke unit", weight: 50, critical: true },
      { key: "icuBeds", label: "ICU bed", weight: 30, critical: true },
      { key: "ventilators", label: "Ventilator", weight: 20, critical: false },
    ],
  },
};

const HOSPITALS = [
  {
    id: "srm-medical",
    name: "SRM Medical College Hospital & Research Centre",
    shortName: "SRM Medical College",
    location: "Potheri · 7.2 km",
    x: 157, y: 91, icuFree: 5, icuTotal: 12, crowd: 64,
    resources: { cathLab: true, ventilators: 3, strokeUnit: true, traumaBay: true },
    message: "Cath lab ready · ICU accepting · ED moderate",
    distance: 7.2,
  },
  {
    id: "srm-global",
    name: "SRM Global Hospitals",
    shortName: "SRM Global",
    location: "Kattankulathur · 9.6 km", x: 583, y: 107, icuFree: 2, icuTotal: 10, crowd: 86,
    resources: { cathLab: false, ventilators: 2, strokeUnit: true, traumaBay: true },
    message: "ICU limited · ED high congestion · Cath lab unavailable",
    distance: 9.6,
  },
  {
    id: "deepam",
    name: "Deepam Hospital · Demo node",
    shortName: "Deepam Hospital",
    location: "Guduvancheri · 11.3 km", x: 144, y: 342, icuFree: 3, icuTotal: 8, crowd: 43,
    resources: { cathLab: false, ventilators: 1, strokeUnit: false, traumaBay: true },
    message: "Trauma bay ready · ED low congestion · No cath lab",
    distance: 11.3,
  },
  {
    id: "tagore",
    name: "Tagore Medical College Hospital · Demo node",
    shortName: "Tagore Medical College",
    location: "Rathinamangalam · 14.8 km", x: 594, y: 343, icuFree: 7, icuTotal: 14, crowd: 36,
    resources: { cathLab: true, ventilators: 4, strokeUnit: true, traumaBay: true },
    message: "Full equipment set ready · ICU capacity good · ED low congestion",
    distance: 14.8,
  },
];

const VARIANTS = [
  { id: "fast", name: "Fastest", detail: "Shortest path · variable traffic", extraMinutes: [0, 0, 1, 1], traffic: [76, 92, 61, 68], reliability: 91 },
  { id: "balanced", name: "Balanced", detail: "Main-road alternative", extraMinutes: [2, 2, 2, 2], traffic: [39, 51, 32, 28], reliability: 96 },
  { id: "clear", name: "Clear corridor", detail: "Priority-ready · longer path", extraMinutes: [4, 3, 4, 4], traffic: [21, 28, 18, 16], reliability: 98 },
];

const INCIDENT = { x: 370, y: 216 };
const HOSPITAL_CHAT = {
  cathLab: "Cath lab",
  ventilators: "Ventilator",
  strokeUnit: "Stroke unit",
  traumaBay: "Trauma bay",
};
const SVG_NS = "http://www.w3.org/2000/svg";
const complaintSelect = document.getElementById("complaint");
const hospitalList = document.getElementById("hospital-list");
const routeBody = document.getElementById("route-table-body");
const routeLines = document.getElementById("route-lines");
const mapMarkers = document.getElementById("map-markers");
const ambulanceLayer = document.getElementById("ambulance-layer");
const transportMessage = document.getElementById("transport-message");

let activeComplaint = "heart-attack";
let selectedRouteId = null;
let routeOptions = [];
let stage = "intake";
let incidentNumber = 2408;
let routeAnimation = null;
let refreshCount = 0;

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}

function resourceAvailable(hospital, key) {
  if (key === "icuBeds") return hospital.icuFree > 0;
  if (key === "ventilators") return hospital.resources.ventilators > 0;
  return hospital.resources[key] === true;
}

function getEquipmentMatch(hospital, complaint) {
  const required = COMPLAINTS[complaint].resources;
  const score = Math.round(required.reduce((total, item) => (
    total + (resourceAvailable(hospital, item.key) ? item.weight : 0)
  ), 0));
  const criticalMissing = required.some((item) => item.critical && !resourceAvailable(hospital, item.key));
  return { score, criticalMissing, required };
}

function makeRoutes() {
  const complaint = COMPLAINTS[activeComplaint];
  return HOSPITALS.flatMap((hospital, hospitalIndex) => VARIANTS.map((variant, variantIndex) => {
    const equipment = getEquipmentMatch(hospital, activeComplaint);
    const time = Math.round((hospital.distance * 1.3 + 7 + variant.extraMinutes[hospitalIndex]) * 10) / 10;
    const traffic = Math.min(99, Math.max(8, variant.traffic[hospitalIndex] + Math.round((hospital.crowd - 50) * 0.2)));
    const roadBlocked = hospital.id === "deepam" && variant.id === "clear";
    const impossible = equipment.criticalMissing || roadBlocked;
    const congestion = !impossible && (traffic >= 70 || hospital.crowd >= 80);
    const status = impossible ? "impossible" : congestion ? "congested" : "possible";
    const timeScore = Math.max(15, 100 - Math.max(0, time - 8) * 2.4);
    const score = impossible
      ? Math.min(24, Math.max(8, Math.round(equipment.score * 0.18 + variant.reliability * 0.04)))
      : Math.min(98, Math.round(
        equipment.score * 0.55 + timeScore * 0.2 + (100 - traffic) * 0.15 + variant.reliability * 0.1,
      ));
    const route = {
      id: `${hospital.id}-${variant.id}`,
      hospitalId: hospital.id,
      hospitalIndex,
      hospitalName: hospital.shortName,
      variantId: variant.id,
      variantName: variant.name,
      variantDetail: variant.detail,
      time,
      traffic,
      equipmentMatch: equipment.score,
      criticalMissing: equipment.criticalMissing,
      status,
      score,
      reason: equipment.criticalMissing
        ? `Critical ${equipment.required.filter((item) => item.critical && !resourceAvailable(hospital, item.key)).map((item) => item.label.toLowerCase()).join(" / ")} unavailable`
        : roadBlocked ? "Road segment blocked in this demo scenario" : "",
      tier: impossible ? "dim" : congestion ? "dark" : "bright",
      variantIndex,
    };
    route.geometry = routeGeometry(route);
    return route;
  }));
}

function routeGeometry(route) {
  const hospital = HOSPITALS[route.hospitalIndex];
  const offset = [-54, 0, 58][route.variantIndex];
  const centerX = (INCIDENT.x + hospital.x) / 2;
  const centerY = (INCIDENT.y + hospital.y) / 2;
  const deltaX = hospital.x - INCIDENT.x;
  const deltaY = hospital.y - INCIDENT.y;
  const length = Math.sqrt(deltaX * deltaX + deltaY * deltaY) || 1;
  const control = {
    x: centerX - (deltaY / length) * offset,
    y: centerY + (deltaX / length) * offset,
  };
  return { start: INCIDENT, control, end: { x: hospital.x, y: hospital.y } };
}

function selectedRoute() {
  return routeOptions.find((route) => route.id === selectedRouteId) || null;
}

function getRecommendedRoute() {
  return routeOptions
    .filter((route) => route.status !== "impossible")
    .sort((first, second) => second.score - first.score || first.time - second.time)[0]
    || routeOptions.slice().sort((first, second) => second.score - first.score)[0];
}

function equipmentChips(hospital) {
  return Object.entries(HOSPITAL_CHAT).map(([key, label]) => {
    const available = key === "ventilators" ? hospital.resources.ventilators > 0 : hospital.resources[key];
    const value = key === "ventilators"
      ? (available ? `${hospital.resources.ventilators} vents` : "No ventilator")
      : label;
    return `<span class="equip-chip ${available ? "ready" : "missing"}">${available ? "✓" : "×"} ${escapeHtml(value)}</span>`;
  }).join("");
}

function renderHospitals() {
  const selected = selectedRoute();
  hospitalList.innerHTML = HOSPITALS.map((hospital, index) => {
    const match = getEquipmentMatch(hospital, activeComplaint);
    const crowdClass = hospital.crowd >= 75 ? "high" : hospital.crowd >= 50 ? "medium" : "low";
    const crowdText = hospital.crowd >= 75 ? "HIGH" : hospital.crowd >= 50 ? "MODERATE" : "LOW";
    const chosen = selected?.hospitalId === hospital.id;
    return `<article class="hospital-card ${chosen ? "selected" : ""}" data-hospital-id="${hospital.id}">
      <span class="hospital-number">H${index + 1}</span>
      <h3>${escapeHtml(hospital.name)}</h3>
      <div class="hospital-location">${escapeHtml(hospital.location)} <span class="crowd-label ${crowdClass}">${crowdText} CROWD</span></div>
      <div class="capacity-row"><span>ICU beds free</span><b>${hospital.icuFree} <span style="color:#8091a0;font-weight:400">/ ${hospital.icuTotal}</span></b></div>
      <div class="capacity-meter"><i style="width:${Math.round((hospital.icuFree / hospital.icuTotal) * 100)}%"></i></div>
      <div class="capacity-row"><span>ED congestion</span><b>${hospital.crowd}%</b></div>
      <div class="equipments">${equipmentChips(hospital)}</div>
      <div class="match-row"><span>CONDITION EQUIPMENT MATCH</span><b class="match-score ${match.score < 60 ? "low" : ""}">${match.score}%</b></div>
      <div class="mini-chat"><b>Hospital status · just now</b><br>${escapeHtml(hospital.message)}</div>
    </article>`;
  }).join("");
}

function routeStatusLabel(route) {
  if (route.status === "impossible") return "Impossible / blocked";
  if (route.status === "congested") return "Congested";
  return "Possible";
}

function renderRoutes() {
  const recommended = getRecommendedRoute();
  const selected = selectedRoute();
  routeBody.innerHTML = routeOptions.map((route) => {
    const isSelected = route.id === selectedRouteId;
    const isRecommended = route.id === recommended?.id;
    const disabled = route.status === "impossible" || stage !== "intake";
    return `<tr class="route-row ${isSelected ? "selected" : ""} ${route.status === "impossible" ? "unavailable" : ""}" data-route-id="${route.id}">
      <td><div class="route-dest"><span class="route-hospital-dot">H${route.hospitalIndex + 1}</span><span class="route-hospital-text"><b>${escapeHtml(route.hospitalName)}${isRecommended ? ' <span style="color:#79deba;font-size:7px">· RECOMMENDED</span>' : ""}</b><small>${escapeHtml(route.variantName)} · ${escapeHtml(route.variantDetail)}${route.reason ? ` · ${escapeHtml(route.reason)}` : ""}</small></span></div></td>
      <td><span class="status-pill ${route.status}">${routeStatusLabel(route)}</span></td>
      <td><div class="match-cell"><span>${route.equipmentMatch}%</span><span class="match-bar ${route.equipmentMatch < 60 ? "low" : ""}"><i style="width:${route.equipmentMatch}%"></i></span></div></td>
      <td class="time-cell">${route.time} min</td>
      <td><span class="score-pill ${route.score < 50 ? "low" : ""}">${route.score}%</span><div class="route-variant">Demo route success score</div></td>
      <td><button class="route-action" type="button" data-select-route="${route.id}" ${disabled ? "disabled" : ""}>${isSelected ? "Selected" : route.status === "impossible" ? "Unavailable" : stage === "intake" ? "Choose route" : "Locked"}</button></td>
    </tr>`;
  }).join("");
  const count = routeOptions.length;
  document.getElementById("map-live-label").textContent = `${count} route options`;
  if (selected) {
    document.getElementById("selected-plan").textContent = `${selected.hospitalName} · ${selected.variantName}`;
    document.getElementById("selected-subtitle").textContent = `${selected.time} min · ${selected.equipmentMatch}% equipment match · ${selected.score}% route score`;
    document.getElementById("dispatch-hint").textContent = selected.status === "congested"
      ? "Congested route selected; dispatcher can choose it with delay risk."
      : "Route selected. Compare alternatives, then dispatch.";
  } else {
    document.getElementById("selected-plan").textContent = "Awaiting route choice";
    document.getElementById("selected-subtitle").textContent = "Choose a possible or congested option below";
    document.getElementById("dispatch-hint").textContent = "Select a route to prepare the dispatch.";
  }
  document.getElementById("dispatch-button").disabled = !selected || selected.status === "impossible" || stage !== "intake";
}

function svgElement(tag, attributes = {}) {
  const element = document.createElementNS(SVG_NS, tag);
  Object.entries(attributes).forEach(([key, value]) => element.setAttribute(key, String(value)));
  return element;
}

function renderMap() {
  routeLines.replaceChildren();
  mapMarkers.replaceChildren();
  ambulanceLayer.replaceChildren();
  for (const route of routeOptions) {
    const { start, control, end } = route.geometry;
    const path = svgElement("path", {
      d: `M ${start.x} ${start.y} Q ${control.x} ${control.y} ${end.x} ${end.y}`,
      class: `map-route tier-${route.tier} ${route.id === selectedRouteId ? "is-selected" : ""} ${selectedRouteId && route.id !== selectedRouteId ? "is-unselected" : ""}`,
      "data-route-id": route.id,
      "aria-label": `${route.hospitalName} ${route.variantName}, ${routeStatusLabel(route)}, ${route.score}% demo routing score`,
    });
    path.addEventListener("click", () => selectRoute(route.id));
    routeLines.appendChild(path);
  }

  const incidentHalo = svgElement("circle", { cx: INCIDENT.x, cy: INCIDENT.y, r: 16, class: "incident-map-halo" });
  const incidentCore = svgElement("circle", { cx: INCIDENT.x, cy: INCIDENT.y, r: 6, class: "incident-map-core" });
  mapMarkers.append(incidentHalo, incidentCore);

  HOSPITALS.forEach((hospital, index) => {
    const group = svgElement("g", { "data-hospital-id": hospital.id });
    group.appendChild(svgElement("circle", { cx: hospital.x, cy: hospital.y, r: 12, class: "hospital-map-ring" }));
    const cross = svgElement("text", { x: hospital.x, y: hospital.y + 1, class: "hospital-map-cross" });
    cross.textContent = "+";
    group.appendChild(cross);
    const label = svgElement("text", { x: hospital.x, y: hospital.y + 25, class: "hospital-map-label" });
    label.textContent = `H${index + 1} · ${hospital.shortName}`;
    group.appendChild(label);
    mapMarkers.appendChild(group);
  });

  if (stage === "dispatched" || stage === "picked-up" || stage === "en-route" || stage === "arrived") {
    const selected = selectedRoute();
    const position = stage === "dispatched" ? INCIDENT : stage === "arrived"
      ? (selected?.geometry.end || INCIDENT) : (routeAnimation?.position || INCIDENT);
    const ambulance = svgElement("text", { x: position.x, y: position.y - 13, class: "map-ambulance", "text-anchor": "middle" });
    ambulance.textContent = "🚑";
    ambulanceLayer.appendChild(ambulance);
    if (selected) {
      const label = svgElement("text", { x: position.x, y: position.y + 2, class: "hospital-map-label", "text-anchor": "middle" });
      label.textContent = "A-12";
      ambulanceLayer.appendChild(label);
    }
  }
  updateRouteSelectionStyles();
}

function updateRouteSelectionStyles() {
  document.querySelectorAll(".map-route").forEach((path) => {
    const isSelected = path.getAttribute("data-route-id") === selectedRouteId;
    path.classList.toggle("is-selected", isSelected);
    path.classList.toggle("is-unselected", Boolean(selectedRouteId) && !isSelected);
  });
}

function renderAll() {
  routeOptions = makeRoutes();
  if (!selectedRouteId || !routeOptions.some((route) => route.id === selectedRouteId && route.status !== "impossible")) {
    selectedRouteId = getRecommendedRoute()?.id || null;
  }
  complaintSelect.disabled = stage !== "intake";
  document.getElementById("intake-title").textContent = COMPLAINTS[activeComplaint].title;
  document.getElementById("incident-id").textContent = `108 · RA-${incidentNumber}`;
  document.getElementById("incident-state").textContent = ({
    intake: "INTAKE", dispatched: "DISPATCHED", "picked-up": "PICKUP", "en-route": "EN ROUTE", arrived: "ARRIVED",
  })[stage];
  renderHospitals();
  renderRoutes();
  renderMap();
  updateFlow();
  updateTransportButtons();
}

function updateFlow() {
  const activeStep = ({ intake: 1, dispatched: 2, "picked-up": 2, "en-route": 3, arrived: 4 })[stage];
  const stepKeys = ["call", "dispatch", "pickup", "transport"];
  document.querySelectorAll(".flow-step").forEach((step, index) => {
    step.classList.toggle("complete", index < activeStep);
    step.classList.toggle("current", index === activeStep);
    const symbol = step.querySelector("i");
    symbol.textContent = index < activeStep ? "✓" : String(index + 1);
  });
  if (stepKeys[activeStep]) {
    document.querySelector(`.flow-step[data-step="${stepKeys[activeStep]}"]`)?.classList.add("current");
  }
  document.getElementById("intake-detail").textContent = ({
    intake: "Caller connected · Location pinned near SRM Kattankulathur",
    dispatched: "Ambulance A-12 assigned · Driver en route to pickup",
    "picked-up": "Patient pickup confirmed · Preparing destination route",
    "en-route": `Patient onboard · Routing to ${selectedRoute()?.hospitalName || "selected hospital"}`,
    arrived: `Demo transport completed · ${selectedRoute()?.hospitalName || "hospital"}`,
  })[stage];
}

function updateTransportButtons() {
  const dispatch = document.getElementById("dispatch-button");
  const pickup = document.getElementById("pickup-button");
  const arrive = document.getElementById("arrive-button");
  dispatch.hidden = stage !== "intake";
  pickup.hidden = stage !== "dispatched";
  arrive.hidden = stage !== "en-route";
  if (stage === "dispatched") document.getElementById("dispatch-hint").textContent = "Driver assigned. Confirm pickup to begin patient transport.";
  if (stage === "picked-up") document.getElementById("dispatch-hint").textContent = "Patient is onboard. Route animation will begin.";
  if (stage === "en-route") document.getElementById("dispatch-hint").textContent = "Ambulance is on the selected route to the receiving hospital.";
  if (stage === "arrived") document.getElementById("dispatch-hint").textContent = "Demo transport is complete. Reset or raise another call.";
}

function selectRoute(routeId) {
  if (stage !== "intake") return;
  const route = routeOptions.find((option) => option.id === routeId);
  if (!route || route.status === "impossible") return;
  selectedRouteId = routeId;
  renderHospitals();
  renderRoutes();
  renderMap();
}

function raiseCall() {
  activeComplaint = complaintSelect.value;
  incidentNumber += 1;
  stage = "intake";
  selectedRouteId = null;
  routeAnimation = null;
  transportMessage.textContent = `${COMPLAINTS[activeComplaint].name} intake opened. Review all 12 destination routes; simulated data only.`;
  renderAll();
}

function dispatchAmbulance() {
  const selected = selectedRoute();
  if (!selected || selected.status === "impossible" || stage !== "intake") return;
  stage = "dispatched";
  transportMessage.textContent = `Ambulance A-12 dispatched for ${COMPLAINTS[activeComplaint].name} · ${selected.hospitalName} selected · ${selected.time} min demo ETA.`;
  renderAll();
}

function startTransportAnimation() {
  if (routeAnimation?.timer) window.clearInterval(routeAnimation.timer);
  routeAnimation = { startedAt: Date.now(), position: INCIDENT, timer: null };
  routeAnimation.timer = window.setInterval(() => {
    const selected = selectedRoute();
    if (!selected || stage !== "en-route") {
      window.clearInterval(routeAnimation?.timer);
      return;
    }
    const elapsed = (Date.now() - routeAnimation.startedAt) / 1000;
    const progress = Math.min(1, elapsed / 12);
    const { start, control, end } = selected.geometry;
    const inverse = 1 - progress;
    routeAnimation.position = {
      x: inverse * inverse * start.x + 2 * inverse * progress * control.x + progress * progress * end.x,
      y: inverse * inverse * start.y + 2 * inverse * progress * control.y + progress * progress * end.y,
    };
    renderMap();
    if (progress >= 1) {
      window.clearInterval(routeAnimation.timer);
      routeAnimation.timer = null;
      transportMessage.textContent = `Ambulance reached ${selected.hospitalName}. Confirm arrival to finish the demo transport flow.`;
    }
  }, 220);
}

function confirmPickup() {
  if (stage !== "dispatched") return;
  stage = "picked-up";
  transportMessage.textContent = "Patient pickup confirmed by the ambulance crew. Starting the selected road-route animation.";
  renderAll();
  window.setTimeout(() => {
    if (stage !== "picked-up") return;
    stage = "en-route";
    renderAll();
    startTransportAnimation();
  }, 700);
}

function completeArrival() {
  if (stage !== "en-route") return;
  if (routeAnimation?.timer) window.clearInterval(routeAnimation.timer);
  if (routeAnimation && selectedRoute()) routeAnimation.position = selectedRoute().geometry.end;
  stage = "arrived";
  const selected = selectedRoute();
  transportMessage.textContent = `Demo transport complete at ${selected?.hospitalName || "selected hospital"}. No real dispatch or patient record was created.`;
  renderAll();
}

function resetDemo() {
  if (routeAnimation?.timer) window.clearInterval(routeAnimation.timer);
  activeComplaint = "heart-attack";
  complaintSelect.value = activeComplaint;
  incidentNumber += 1;
  stage = "intake";
  selectedRouteId = null;
  routeAnimation = null;
  refreshCount = 0;
  HOSPITALS[0].crowd = 64;
  HOSPITALS[1].crowd = 86;
  HOSPITALS[2].crowd = 43;
  HOSPITALS[3].crowd = 36;
  transportMessage.textContent = "Demo reset. A new simulated major heart-attack intake is ready.";
  renderAll();
}

function refreshCapacity() {
  refreshCount += 1;
  const shifts = [1, -2, 1, -1];
  HOSPITALS.forEach((hospital, index) => {
    hospital.crowd = Math.max(20, Math.min(96, hospital.crowd + shifts[(index + refreshCount) % shifts.length]));
  });
  renderAll();
  transportMessage.textContent = "Simulated hospital status feed refreshed · no live hospital system is connected.";
}

function updateClock() {
  document.getElementById("clock").textContent = new Intl.DateTimeFormat("en-IN", {
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  }).format(new Date());
}

document.getElementById("raise-call").addEventListener("click", raiseCall);
document.getElementById("reset-demo").addEventListener("click", resetDemo);
document.getElementById("refresh-data").addEventListener("click", refreshCapacity);
document.getElementById("dispatch-button").addEventListener("click", dispatchAmbulance);
document.getElementById("pickup-button").addEventListener("click", confirmPickup);
document.getElementById("arrive-button").addEventListener("click", completeArrival);
routeBody.addEventListener("click", (event) => {
  const button = event.target.closest("[data-select-route]");
  if (button && !button.disabled) selectRoute(button.dataset.selectRoute);
  const row = event.target.closest("[data-route-id]");
  if (!button && row) selectRoute(row.dataset.routeId);
});
complaintSelect.addEventListener("change", () => {
  activeComplaint = complaintSelect.value;
  selectedRouteId = null;
  renderAll();
});

renderAll();
updateClock();
window.setInterval(updateClock, 1000);
