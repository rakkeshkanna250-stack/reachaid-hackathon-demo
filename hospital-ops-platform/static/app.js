"use strict";

const $ = (selector) => document.querySelector(selector);
const hospitalFilter = $("#hospital-filter");
let dashboardData = null;
let activeAction = null;
let toastTimer = null;

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}

function formatTime(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    cache: "no-store",
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = body.detail || body.message || `Request failed (${response.status})`;
    throw new Error(typeof detail === "string" ? detail : JSON.stringify(detail));
  }
  return body;
}

function showToast(message, isError = false) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.toggle("error", isError);
  toast.classList.add("show");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove("show"), 3600);
}

function renderSummary(data) {
  const { summary, forecast } = data;
  $("#metric-arrivals").textContent = forecast.arrivals_today;
  $("#metric-arrivals-sub").textContent = `${forecast.appointments_today} appointments · ${forecast.unscheduled_arrivals_estimate} unscheduled estimate`;
  $("#metric-beds").textContent = summary.free_beds;
  $("#metric-beds-sub").textContent = `${summary.occupied_beds} occupied of ${summary.total_beds} tracked beds`;
  $("#metric-icu").textContent = summary.icu_free_beds;
  $("#metric-icu-sub").textContent = `Free ICU beds · ${summary.hospitals} hospitals`;
  $("#metric-alerts").textContent = summary.active_alerts;
  $("#metric-alerts-sub").textContent = `Intakes logged today: ${summary.intakes_today}`;
  const occupancy = summary.total_beds ? (summary.occupied_beds / summary.total_beds) * 100 : 0;
  $("#bed-progress").style.width = `${Math.min(100, occupancy)}%`;
  $("#icu-progress").style.width = `${Math.min(100, (summary.icu_free_beds / Math.max(1, summary.hospitals * 10)) * 100)}%`;
  $("#forecast-total").textContent = forecast.arrivals_today;
  $("#appointments-count").textContent = forecast.appointments_today;
  $("#unscheduled-count").textContent = forecast.unscheduled_arrivals_estimate;
  const trend = forecast.trend_percent_7d_vs_prior_7d;
  $("#trend-number").textContent = `${trend > 0 ? "+" : ""}${trend}%`;
  $("#trend-number").style.color = trend > 0 ? "#a47531" : "#438261";
  $("#forecast-date").textContent = `Planning date · ${forecast.as_of_date}`;
  $("#last-updated").textContent = formatTime(data.generated_at);
  renderSparkline(forecast.historical_daily_arrivals_14d);
  renderArrivalChart(forecast.hourly_arrivals);
}

function renderSparkline(values) {
  const host = $("#arrivals-sparkline");
  const maximum = Math.max(...values, 1);
  const points = values.map((value, index) => {
    const x = (index / Math.max(1, values.length - 1)) * 70;
    const y = 18 - (value / maximum) * 16;
    return `${x},${y}`;
  }).join(" ");
  host.innerHTML = `<svg viewBox="0 0 70 20" preserveAspectRatio="none" aria-hidden="true"><polyline points="${points}" fill="none" stroke="#44b396" stroke-width="1.6" vector-effect="non-scaling-stroke"/></svg>`;
}

function renderArrivalChart(hours) {
  const host = $("#arrival-chart");
  const maximum = Math.max(...hours.map((item) => item.expected_arrivals), 1);
  host.innerHTML = hours.map((item, index) => {
    const height = Math.max(2, item.expected_arrivals / maximum * 100);
    const label = index % 3 === 0 ? item.hour.slice(0, 2) : "";
    return `<div class="hour-bar" title="${escapeHtml(item.hour)} · ${item.expected_arrivals} estimated arrivals"><i style="height:${height}%"></i>${label ? `<span>${label}</span>` : ""}</div>`;
  }).join("");
}

function renderAlerts(alerts) {
  const host = $("#alert-banner");
  const highPriority = alerts.filter((alert) => alert.severity === "critical" || alert.severity === "high").slice(0, 4);
  host.innerHTML = highPriority.map((alert) => `<div class="alert-banner-item ${alert.severity === "critical" ? "critical" : ""}">
    <b>${alert.severity === "critical" ? "RESTOCK" : "REVIEW"}</b>
    <span>${escapeHtml(alert.message)}</span>
    <small>${escapeHtml(alert.type.replaceAll("_", " "))}</small>
  </div>`).join("");
}

function renderBottlenecks(items) {
  const filtered = [...items].sort((a, b) => (
    ({ high: 0, watch: 1, stable: 2 }[a.bottleneck_risk] - { high: 0, watch: 1, stable: 2 }[b.bottleneck_risk])
    || b.estimated_wait_minutes - a.estimated_wait_minutes
  ));
  const top = filtered.slice(0, 7);
  $("#bottleneck-list").innerHTML = top.length ? top.map((item) => `<div class="bottleneck-row">
    <i class="risk-dot ${item.bottleneck_risk}"></i>
    <div class="bottleneck-name"><b>${escapeHtml(item.department)} · ${escapeHtml(item.hospital_name.replace(" Hospital & Research Centre", ""))}</b><small>${item.queue} waiting · ${item.staff_available} staff available</small></div>
    <span class="util-label">${item.utilization_percent}% load</span>
    <span class="wait-label">${item.estimated_wait_minutes} min</span>
  </div>`).join("") : `<div class="empty-row">No department flow data.</div>`;
}

function renderCapacity(hospitals) {
  $("#hospital-capacity").innerHTML = hospitals.map((hospital) => {
    const occupied = hospital.wards.reduce((sum, ward) => sum + ward.occupied_beds, 0);
    const total = hospital.wards.reduce((sum, ward) => sum + ward.total_beds, 0);
    const occupiedWidth = total ? occupied / total * 100 : 0;
    const wardLines = hospital.wards.map((ward) => `<div class="ward-line">
      <span>${escapeHtml(ward.name)}${ward.acuity === "critical" ? '<span class="ward-priority">CRITICAL CARE</span>' : ""}</span>
      <b>${ward.free_beds} free · ${ward.occupied_beds}/${ward.total_beds}</b>
    </div>`).join("");
    const readiness = hospital.emergency_readiness;
    const readinessRows = (readiness?.resources || []).map((resource) => `<div class="readiness-line">
      <span>${escapeHtml(resource.name)}</span>
      <b class="${resource.status === "available" ? "resource-in-stock" : "resource-out-of-stock"}">${resource.available > 0 ? `${resource.available} ${escapeHtml(resource.unit)} · IN STOCK` : "NOT AVAILABLE"}</b>
    </div>`).join("");
    return `<article class="hospital-cap-card">
      <div class="hospital-cap-head"><h3>${escapeHtml(hospital.name)}</h3><span class="hospital-type">DEMO</span></div>
      <div class="hospital-cap-sub">Ward-specific capacity · bed counts are synthetic</div>
      <div class="bed-total"><strong>${hospital.total_free_beds}</strong><span>free of ${total} beds</span></div>
      <div class="bed-stack" aria-label="${occupied} occupied and ${hospital.total_free_beds} free beds"><i class="occupied" style="width:${occupiedWidth}%"></i><i class="free" style="width:${100 - occupiedWidth}%"></i></div>
      <div class="ward-list">${wardLines}</div>
      <div class="icu-highlight"><span>ICU capacity · ${hospital.icu_free_beds} free</span><b>${hospital.wards.find((ward) => ward.name === "ICU")?.occupancy_percent ?? 0}% occupied</b></div>
      <div class="readiness-heading"><span>EMERGENCY RESOURCE READINESS</span><b>${readiness?.readiness_percent ?? 0}%</b></div>
      <div class="readiness-list">${readinessRows}</div>
      <div class="readiness-note">${escapeHtml(readiness?.note || "Illustrative resource readiness only.")}</div>
    </article>`;
  }).join("");
}

function renderInventory(stock) {
  const filter = hospitalFilter.value;
  const selected = stock.filter((item) => filter === "all" || item.hospital_id === filter);
  $("#inventory-count").textContent = `(${selected.length} items)`;
  $("#inventory-body").innerHTML = selected.map((item) => {
    const percentage = item.total ? Math.min(100, item.available / item.total * 100) : 0;
    const cover = item.days_of_cover === null ? "—" : `${item.days_of_cover} days`;
    const statusText = item.status === "critical" ? "Below safe minimum" : item.status === "watch" ? "Watch" : "Adequate";
    return `<tr>
      <td class="stock-item">${escapeHtml(item.name)}<span class="stock-hospital">${escapeHtml(item.hospital_name)}</span></td>
      <td><span class="quantity-main ${item.status === "critical" ? "low" : ""}">${item.available}</span> / ${item.total}
        <div class="stock-meter"><i class="${item.status === "critical" ? "low" : ""}" style="width:${percentage}%"></i></div></td>
      <td>${item.safe_minimum}</td>
      <td>${item.daily_consumption} <span class="stock-hospital">units / 24h · synthetic baseline</span></td>
      <td>${cover}</td>
      <td><span class="status-chip ${item.status}">${statusText}</span></td>
    </tr>`;
  }).join("") || `<tr><td colspan="6" class="empty-row">No matching stock items.</td></tr>`;
}

function renderActivity(events) {
  const hospitalNames = new Map((dashboardData?.hospitals || []).map((hospital) => [hospital.id, hospital.name]));
  const tbody = $("#activity-body");
  tbody.innerHTML = events.length ? events.map((event) => {
    let detail = event.notes || "";
    if (event.event_type === "emergency_intake") detail = `${event.priority} · ${event.arrival_mode} · ${event.resource}${detail ? ` · ${detail}` : ""}`;
    if (event.event_type === "bed_allocation") detail = `${event.quantity} beds allocated · ${detail}`;
    if (event.event_type === "inventory_change") detail = `${event.quantity > 0 ? "+" : ""}${event.quantity} ${event.resource} · stock now ${event.available_after} · ${detail}`;
    return `<tr><td>${escapeHtml(event.timestamp_utc)}</td><td class="event-type">${escapeHtml(event.event_type.replaceAll("_", " "))}</td><td>${escapeHtml(hospitalNames.get(event.hospital_id) || event.hospital_id)}</td><td class="event-notes" title="${escapeHtml(detail)}">${escapeHtml(detail)}</td><td>${escapeHtml(event.reference_id)}</td></tr>`;
  }).join("") : `<tr><td colspan="5" class="empty-row">No operations recorded yet. Intake, bed and inventory updates will be logged here.</td></tr>`;
}

function renderHospitalFilter(hospitals) {
  const current = hospitalFilter.value;
  const options = ['<option value="all">All hospitals</option>', ...hospitals.map((hospital) => `<option value="${escapeHtml(hospital.id)}">${escapeHtml(hospital.name)}</option>`)];
  hospitalFilter.innerHTML = options.join("");
  if ([...hospitalFilter.options].some((option) => option.value === current)) hospitalFilter.value = current;
}

function renderLegacyLink(integration) {
  const status = $("#legacy-status");
  if (!integration?.configured) {
    status.textContent = "· Legacy system not linked";
  } else if (integration.connected) {
    const active = integration.active_actors;
    status.textContent = `· Legacy API connected${active === null ? "" : ` · ${active} active actors`}`;
  } else {
    status.textContent = "· Legacy API unavailable · isolated demo data active";
    status.title = integration.error || integration.note || "";
  }
}

async function refreshDashboard(showError = false) {
  try {
    const data = await api("/api/v1/dashboard");
    dashboardData = data;
    renderSummary(data);
    renderAlerts(data.alerts);
    renderBottlenecks(data.forecast.department_bottlenecks);
    renderCapacity(data.hospitals);
    renderHospitalFilter(data.hospitals);
    renderInventory(data.stock);
    renderActivity(data.recent_events);
    renderLegacyLink(data.integration);
  } catch (error) {
    if (showError || !dashboardData) {
      $("#alert-banner").innerHTML = `<div class="alert-banner-item critical"><b>SERVER</b><span>${escapeHtml(error.message)} · Check that the operations server is running.</span></div>`;
    }
  }
}

function field(label, name, control, required = true, hint = "") {
  return `<div class="form-field"><label for="field-${escapeHtml(name)}">${escapeHtml(label)}${required ? " *" : ""}</label>${control}${hint ? `<small class="stock-hospital">${escapeHtml(hint)}</small>` : ""}</div>`;
}

function selectControl(name, options) {
  return `<select id="field-${escapeHtml(name)}" name="${escapeHtml(name)}" required>${options.map((option) => `<option value="${escapeHtml(option.value)}">${escapeHtml(option.label)}</option>`).join("")}</select>`;
}

function openAction(type) {
  activeAction = type;
  const dialog = $("#action-dialog");
  const hospitalOptions = dashboardData.hospitals.map((hospital) => ({ value: hospital.id, label: hospital.name }));
  const firstHospital = dashboardData.hospitals[0];
  $("#dialog-error").textContent = "";
  if (type === "intake") {
    $("#dialog-kicker").textContent = "PATIENT FLOW · EMERGENCY INTAKE";
    $("#dialog-title").textContent = "Record emergency intake";
    $("#dialog-fields").innerHTML = [
      field("Receiving hospital", "hospital_id", selectControl("hospital_id", hospitalOptions)),
      field("Department", "department", selectControl("department", firstHospital.departments.map((department) => ({ value: department.name, label: department.name })))),
      field("Triage priority", "triage_priority", selectControl("triage_priority", [
        { value: "critical", label: "Critical — immediate clinical assessment" },
        { value: "urgent", label: "Urgent — prompt clinical review" },
        { value: "routine", label: "Routine — based on local triage policy" },
      ])),
      field("Arrival mode", "arrival_mode", selectControl("arrival_mode", [
        { value: "ambulance", label: "Ambulance" }, { value: "walk-in", label: "Walk-in" }, { value: "referral", label: "Referral" },
      ])),
      field("Demo reference / notes", "notes", '<textarea id="field-notes" name="notes" maxlength="300" placeholder="Do not enter a real patient name or identifying details"></textarea>', false, "Use demo details only; avoid personally identifiable health information."),
    ].join("");
  } else if (type === "bed") {
    $("#dialog-kicker").textContent = "CAPACITY · WARD BED ALLOCATION";
    $("#dialog-title").textContent = "Record bed allocation";
    $("#dialog-fields").innerHTML = [
      field("Hospital", "hospital_id", selectControl("hospital_id", hospitalOptions)),
      field("Ward", "ward", selectControl("ward", firstHospital.wards.map((ward) => ({ value: ward.name, label: `${ward.name} · ${ward.total_beds - ward.occupied_beds} free` })))),
      field("Beds to allocate", "beds_allocated", '<input id="field-beds_allocated" type="number" name="beds_allocated" min="1" max="20" step="1" value="1" required>', true, "Server rejects any allocation above reported free capacity."),
      field("Demo reference", "reference_id", '<input id="field-reference_id" name="reference_id" maxlength="80" placeholder="Optional demo case ID">', false),
      field("Notes", "notes", '<textarea id="field-notes" name="notes" maxlength="300" placeholder="Use demo text only"></textarea>', false),
    ].join("");
    attachHospitalWardOptions();
  } else {
    $("#dialog-kicker").textContent = "SUPPLY · INVENTORY LEDGER";
    $("#dialog-title").textContent = "Log inventory change";
    $("#dialog-fields").innerHTML = [
      field("Hospital", "hospital_id", selectControl("hospital_id", hospitalOptions)),
      field("Supply / equipment", "item", selectControl("item", firstHospital.equipment.map((item) => ({ value: item.name, label: `${item.name} · ${item.available} available` })))),
      field("Quantity change", "quantity_delta", '<input id="field-quantity_delta" type="number" name="quantity_delta" min="-10000" max="10000" step="1" placeholder="Positive restock · negative use/adjustment" required>', true, "Use a positive number for a delivery; negative for a recorded issue/adjustment."),
      field("Notes", "notes", '<textarea id="field-notes" name="notes" maxlength="300" placeholder="Demo purchase order or stock movement"></textarea>', false),
    ].join("");
    attachHospitalInventoryOptions();
  }
  $("#action-dialog").showModal();
}

function attachHospitalWardOptions() {
  const hospitalSelect = $("#field-hospital_id");
  const update = () => {
    const hospital = dashboardData.hospitals.find((entry) => entry.id === hospitalSelect.value);
    const wardSelect = $("#field-ward");
    if (!hospital || !wardSelect) return;
    wardSelect.innerHTML = hospital.wards.map((ward) => `<option value="${escapeHtml(ward.name)}">${escapeHtml(ward.name)} · ${ward.total_beds - ward.occupied_beds} free</option>`).join("");
    $("#field-beds_allocated").max = String(Math.max(1, Math.min(20, hospital.wards.find((ward) => ward.name === wardSelect.value)?.free_beds || 1)));
  };
  hospitalSelect.addEventListener("change", update);
  $("#field-ward").addEventListener("change", update);
  $("#field-beds_allocated").addEventListener("input", update);
  update();
}

function attachHospitalInventoryOptions() {
  $("#field-hospital_id").addEventListener("change", () => {
    const hospital = dashboardData.hospitals.find((entry) => entry.id === $("#field-hospital_id").value);
    $("#field-item").innerHTML = (hospital?.equipment || []).map((item) => `<option value="${escapeHtml(item.name)}">${escapeHtml(item.name)} · ${item.available} available · min ${item.safe_minimum}</option>`).join("");
  });
}

async function submitAction(event) {
  event.preventDefault();
  const form = event.currentTarget;
  if (!form.reportValidity()) return;
  const values = Object.fromEntries(new FormData(form).entries());
  const submit = $("#dialog-submit");
  submit.disabled = true;
  submit.textContent = "Saving…";
  $("#dialog-error").textContent = "";
  const endpoints = { intake: "/api/v1/intakes", bed: "/api/v1/bed-allocations", inventory: "/api/v1/inventory-changes" };
  for (const numberField of ["beds_allocated", "quantity_delta"]) {
    if (numberField in values) values[numberField] = Number(values[numberField]);
  }
  try {
    const result = await api(endpoints[activeAction], { method: "POST", body: JSON.stringify(values) });
    $("#action-dialog").close();
    const toastText = activeAction === "inventory" && result.alerts.length
      ? result.alerts.map((alert) => alert.message).join(" ")
      : "Saved and written to the timestamped CSV and Excel logs.";
    showToast(toastText);
    await refreshDashboard(true);
  } catch (error) {
    $("#dialog-error").textContent = error.message;
  } finally {
    submit.disabled = false;
    submit.textContent = "Save & log";
  }
}

$("#refresh-button").addEventListener("click", () => refreshDashboard(true));
$("#intake-action").addEventListener("click", () => dashboardData && openAction("intake"));
$("#bed-action").addEventListener("click", () => dashboardData && openAction("bed"));
$("#stock-action").addEventListener("click", () => dashboardData && openAction("inventory"));
$("#dialog-close").addEventListener("click", () => $("#action-dialog").close());
$("#dialog-cancel").addEventListener("click", () => $("#action-dialog").close());
$("#action-form").addEventListener("submit", submitAction);
hospitalFilter.addEventListener("change", () => dashboardData && renderInventory(dashboardData.stock));
document.addEventListener("click", (event) => {
  const link = event.target.closest('a[href="#flow"]');
  if (link) document.querySelector("#flow")?.scrollIntoView({ behavior: "smooth" });
});

$("#action-dialog").addEventListener("close", () => {
  $("#dialog-error").textContent = "";
});

refreshDashboard(true);
window.setInterval(() => refreshDashboard(false), 15000);
