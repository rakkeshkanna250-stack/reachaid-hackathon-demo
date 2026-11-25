#!/usr/bin/env python3
"""Standalone hospital operations demo API and dashboard server."""

from __future__ import annotations

import csv
from copy import deepcopy
from datetime import date, datetime, timedelta, timezone
import json
import os
from pathlib import Path
import tempfile
import threading
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import Request, urlopen
from uuid import uuid4

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from openpyxl import Workbook, load_workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter
from pydantic import BaseModel, Field


ROOT = Path(__file__).resolve().parent
DATA_DIR = Path(os.environ.get("HOSPITAL_OPS_DATA_DIR", ROOT / "data")).resolve()
STATE_PATH = DATA_DIR / "state.json"
EVENTS_CSV = DATA_DIR / "operations_log.csv"
EVENTS_XLSX = DATA_DIR / "operations_log.xlsx"
LEGACY_API_URL = os.environ.get("LEGACY_API_URL", "").strip().rstrip("/")
LEGACY_TIMEOUT_SECONDS = 2.5

app = FastAPI(
    title="ReachAid Hospital Operations",
    description="Standalone prototype for hospital flow forecasting and resource coordination.",
    version="1.0.0",
)
app.mount("/static", StaticFiles(directory=ROOT / "static"), name="static")
_lock = threading.RLock()

EVENT_HEADERS = ["event_id", "timestamp_utc", "event_type", "hospital_id", "resource", "quantity", "reference_id", "notes"]
SHEET_HEADERS = {
    "Events": EVENT_HEADERS,
    "Emergency Intakes": ["event_id", "timestamp_utc", "intake_id", "hospital_id", "department", "triage_priority", "arrival_mode", "notes"],
    "Bed Allocations": ["event_id", "timestamp_utc", "allocation_id", "hospital_id", "ward", "beds_allocated", "reference_id", "notes"],
    "Inventory Changes": ["event_id", "timestamp_utc", "change_id", "hospital_id", "item", "quantity_delta", "available_after", "notes"],
}

INITIAL_STATE: dict[str, Any] = {
    "hospitals": [
        {
            "id": "srm-kattankulathur",
            "name": "SRM Medical College Hospital & Research Centre",
            "demo_data": True,
            "wards": [
                {"name": "ICU", "total_beds": 24, "occupied_beds": 18, "acuity": "critical"},
                {"name": "Emergency", "total_beds": 18, "occupied_beds": 12, "acuity": "urgent"},
                {"name": "General Medicine", "total_beds": 70, "occupied_beds": 54, "acuity": "routine"},
                {"name": "Pediatrics", "total_beds": 24, "occupied_beds": 16, "acuity": "routine"},
            ],
            "departments": [
                {"name": "Emergency", "queue": 7, "service_minutes": 28, "staff_available": 4},
                {"name": "Imaging", "queue": 5, "service_minutes": 34, "staff_available": 2},
                {"name": "Laboratory", "queue": 4, "service_minutes": 22, "staff_available": 3},
                {"name": "ICU", "queue": 2, "service_minutes": 75, "staff_available": 5},
            ],
            "equipment": [
                {"name": "Ventilators", "available": 4, "total": 10, "safe_minimum": 3},
                {"name": "Oxygen cylinders", "available": 12, "total": 48, "safe_minimum": 14},
                {"name": "Cath lab", "available": 1, "total": 1, "safe_minimum": 1},
                {"name": "CT scanner", "available": 0, "total": 1, "safe_minimum": 1},
                {"name": "IV fluid bottles", "available": 138, "total": 200, "safe_minimum": 60},
                {"name": "Infusion pumps", "available": 25, "total": 36, "safe_minimum": 10},
                {"name": "Cardiac monitors", "available": 19, "total": 28, "safe_minimum": 8},
                {"name": "Portable suction units", "available": 8, "total": 12, "safe_minimum": 3},
            ],
            "daily_consumption": {
                "Ventilators": 2, "Oxygen cylinders": 9, "Cath lab": 0, "CT scanner": 0, "IV fluid bottles": 42,
                "Infusion pumps": 3, "Cardiac monitors": 2, "Portable suction units": 1,
            },
        },
        {
            "id": "srm-global",
            "name": "SRM Global Hospitals",
            "demo_data": True,
            "wards": [
                {"name": "ICU", "total_beds": 18, "occupied_beds": 16, "acuity": "critical"},
                {"name": "Emergency", "total_beds": 14, "occupied_beds": 11, "acuity": "urgent"},
                {"name": "General Medicine", "total_beds": 58, "occupied_beds": 45, "acuity": "routine"},
                {"name": "Pediatrics", "total_beds": 18, "occupied_beds": 13, "acuity": "routine"},
            ],
            "departments": [
                {"name": "Emergency", "queue": 11, "service_minutes": 36, "staff_available": 3},
                {"name": "Imaging", "queue": 8, "service_minutes": 41, "staff_available": 2},
                {"name": "Laboratory", "queue": 6, "service_minutes": 27, "staff_available": 2},
                {"name": "ICU", "queue": 3, "service_minutes": 88, "staff_available": 4},
            ],
            "equipment": [
                {"name": "Ventilators", "available": 0, "total": 8, "safe_minimum": 3},
                {"name": "Oxygen cylinders", "available": 5, "total": 36, "safe_minimum": 12},
                {"name": "Cath lab", "available": 0, "total": 1, "safe_minimum": 1},
                {"name": "CT scanner", "available": 1, "total": 1, "safe_minimum": 1},
                {"name": "IV fluid bottles", "available": 73, "total": 160, "safe_minimum": 48},
                {"name": "Infusion pumps", "available": 12, "total": 30, "safe_minimum": 9},
                {"name": "Cardiac monitors", "available": 11, "total": 22, "safe_minimum": 7},
                {"name": "Portable suction units", "available": 5, "total": 10, "safe_minimum": 3},
            ],
            "daily_consumption": {
                "Ventilators": 2, "Oxygen cylinders": 8, "Cath lab": 0, "CT scanner": 0, "IV fluid bottles": 35,
                "Infusion pumps": 3, "Cardiac monitors": 2, "Portable suction units": 1,
            },
        },
        {
            "id": "deepam-guduvancheri",
            "name": "Deepam Hospital · Demo node",
            "demo_data": True,
            "wards": [
                {"name": "ICU", "total_beds": 12, "occupied_beds": 9, "acuity": "critical"},
                {"name": "Emergency", "total_beds": 12, "occupied_beds": 8, "acuity": "urgent"},
                {"name": "General Medicine", "total_beds": 44, "occupied_beds": 30, "acuity": "routine"},
                {"name": "Pediatrics", "total_beds": 14, "occupied_beds": 9, "acuity": "routine"},
            ],
            "departments": [
                {"name": "Emergency", "queue": 4, "service_minutes": 24, "staff_available": 3},
                {"name": "Imaging", "queue": 3, "service_minutes": 29, "staff_available": 2},
                {"name": "Laboratory", "queue": 3, "service_minutes": 19, "staff_available": 2},
                {"name": "ICU", "queue": 1, "service_minutes": 67, "staff_available": 3},
            ],
            "equipment": [
                {"name": "Ventilators", "available": 3, "total": 6, "safe_minimum": 2},
                {"name": "Oxygen cylinders", "available": 18, "total": 28, "safe_minimum": 9},
                {"name": "Cath lab", "available": 1, "total": 1, "safe_minimum": 1},
                {"name": "CT scanner", "available": 1, "total": 1, "safe_minimum": 1},
                {"name": "IV fluid bottles", "available": 95, "total": 130, "safe_minimum": 40},
                {"name": "Infusion pumps", "available": 15, "total": 23, "safe_minimum": 7},
                {"name": "Cardiac monitors", "available": 10, "total": 18, "safe_minimum": 6},
                {"name": "Portable suction units", "available": 4, "total": 8, "safe_minimum": 2},
            ],
            "daily_consumption": {
                "Ventilators": 1, "Oxygen cylinders": 5, "Cath lab": 0, "CT scanner": 0, "IV fluid bottles": 25,
                "Infusion pumps": 2, "Cardiac monitors": 1, "Portable suction units": 1,
            },
        },
        {
            "id": "tagore-rathinamangalam",
            "name": "Tagore Medical College Hospital · Demo node",
            "demo_data": True,
            "wards": [
                {"name": "ICU", "total_beds": 20, "occupied_beds": 13, "acuity": "critical"},
                {"name": "Emergency", "total_beds": 16, "occupied_beds": 8, "acuity": "urgent"},
                {"name": "General Medicine", "total_beds": 60, "occupied_beds": 38, "acuity": "routine"},
                {"name": "Pediatrics", "total_beds": 20, "occupied_beds": 11, "acuity": "routine"},
            ],
            "departments": [
                {"name": "Emergency", "queue": 3, "service_minutes": 23, "staff_available": 4},
                {"name": "Imaging", "queue": 3, "service_minutes": 27, "staff_available": 3},
                {"name": "Laboratory", "queue": 2, "service_minutes": 18, "staff_available": 3},
                {"name": "ICU", "queue": 1, "service_minutes": 65, "staff_available": 5},
            ],
            "equipment": [
                {"name": "Ventilators", "available": 8, "total": 10, "safe_minimum": 3},
                {"name": "Oxygen cylinders", "available": 27, "total": 42, "safe_minimum": 13},
                {"name": "Cath lab", "available": 1, "total": 1, "safe_minimum": 1},
                {"name": "CT scanner", "available": 1, "total": 1, "safe_minimum": 1},
                {"name": "IV fluid bottles", "available": 144, "total": 180, "safe_minimum": 54},
                {"name": "Infusion pumps", "available": 22, "total": 32, "safe_minimum": 9},
                {"name": "Cardiac monitors", "available": 18, "total": 26, "safe_minimum": 8},
                {"name": "Portable suction units", "available": 7, "total": 11, "safe_minimum": 3},
            ],
            "daily_consumption": {
                "Ventilators": 2, "Oxygen cylinders": 7, "Cath lab": 0, "CT scanner": 0, "IV fluid bottles": 38,
                "Infusion pumps": 3, "Cardiac monitors": 2, "Portable suction units": 1,
            },
        },
    ],
    "demo_resource_profile_version": 2,
    "intakes": [],
    "bed_allocations": [],
    "events": [],
}


class IntakeCreate(BaseModel):
    hospital_id: str
    department: str = Field(min_length=1, max_length=80)
    triage_priority: str = Field(pattern="^(critical|urgent|routine)$")
    arrival_mode: str = Field(default="ambulance", pattern="^(ambulance|walk-in|referral)$")
    notes: str = Field(default="", max_length=300)


class BedAllocationCreate(BaseModel):
    hospital_id: str
    ward: str = Field(min_length=1, max_length=80)
    beds_allocated: int = Field(ge=1, le=20)
    reference_id: str = Field(default="", max_length=80)
    notes: str = Field(default="", max_length=300)


class InventoryChangeCreate(BaseModel):
    hospital_id: str
    item: str = Field(min_length=1, max_length=80)
    quantity_delta: int = Field(ge=-10000, le=10000)
    notes: str = Field(default="", max_length=300)


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def timestamp() -> str:
    return utc_now().isoformat(timespec="seconds").replace("+00:00", "Z")


def atomic_write(path: Path, content: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temp_name = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    try:
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(content)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temp_name, path)
    except Exception:
        try:
            os.unlink(temp_name)
        except FileNotFoundError:
            pass
        raise


def serialize_state(state: dict[str, Any]) -> bytes:
    return (json.dumps(state, ensure_ascii=False, indent=2) + "\n").encode("utf-8")


def append_csv_rows(path: Path, headers: list[str], rows: list[dict[str, Any]]) -> bytes:
    from io import StringIO

    output = StringIO(newline="")
    writer = csv.DictWriter(output, fieldnames=headers, extrasaction="ignore")
    writer.writeheader()
    writer.writerows(rows)
    return output.getvalue().encode("utf-8-sig")


def create_workbook(events: list[dict[str, Any]]) -> bytes:
    from io import BytesIO

    workbook = Workbook()
    workbook.remove(workbook.active)
    for sheet_name, headers in SHEET_HEADERS.items():
        sheet = workbook.create_sheet(sheet_name)
        sheet.append(headers)
        sheet.freeze_panes = "A2"
        sheet.auto_filter.ref = f"A1:{get_column_letter(len(headers))}1"
        for cell in sheet[1]:
            cell.font = Font(bold=True, color="FFFFFF")
            cell.fill = PatternFill("solid", fgColor="18384B")
            cell.alignment = Alignment(vertical="center")
        sheet.row_dimensions[1].height = 26
        for event in events:
            if sheet_name == "Events":
                sheet.append([event.get(header, "") for header in headers])
            elif sheet_name == "Emergency Intakes" and event["event_type"] == "emergency_intake":
                sheet.append([
                    event["event_id"], event["timestamp_utc"], event["reference_id"],
                    event["hospital_id"], event["resource"], event["priority"],
                    event["arrival_mode"], event["notes"],
                ])
            elif sheet_name == "Bed Allocations" and event["event_type"] == "bed_allocation":
                sheet.append([
                    event["event_id"], event["timestamp_utc"], event["allocation_id"],
                    event["hospital_id"], event["resource"], event["quantity"],
                    event["reference_id"], event["notes"],
                ])
            elif sheet_name == "Inventory Changes" and event["event_type"] == "inventory_change":
                sheet.append([
                    event["event_id"], event["timestamp_utc"], event["reference_id"],
                    event["hospital_id"], event["resource"], event["quantity"],
                    event["available_after"], event["notes"],
                ])
        for column_cells in sheet.columns:
            max_width = max((len(str(cell.value or "")) for cell in column_cells), default=10)
            sheet.column_dimensions[get_column_letter(column_cells[0].column)].width = min(max(max_width + 2, 12), 48)
    buffer = BytesIO()
    workbook.save(buffer)
    return buffer.getvalue()


def persist_state(state: dict[str, Any]) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    atomic_write(STATE_PATH, serialize_state(state))


def persist_logs(events: list[dict[str, Any]]) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    atomic_write(EVENTS_CSV, append_csv_rows(EVENTS_CSV, EVENT_HEADERS, events))
    atomic_write(EVENTS_XLSX, create_workbook(events))


def initialize_storage() -> dict[str, Any]:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    state = deepcopy(INITIAL_STATE)
    resource_profile_migrated = True
    if STATE_PATH.exists():
        try:
            saved = json.loads(STATE_PATH.read_text("utf-8"))
            for key in ("hospitals", "intakes", "bed_allocations", "events"):
                if isinstance(saved.get(key), list):
                    state[key] = saved[key]
            resource_profile_migrated = saved.get("demo_resource_profile_version", 0) >= 2
        except (OSError, json.JSONDecodeError):
            raise RuntimeError(f"Could not load persisted data from {STATE_PATH}")
    if not resource_profile_migrated:
        for hospital in state["hospitals"]:
            baseline = next(item for item in INITIAL_STATE["hospitals"] if item["id"] == hospital["id"])
            by_name = {item["name"]: item for item in hospital["equipment"]}
            for item in baseline["equipment"]:
                if item["name"] not in by_name:
                    hospital["equipment"].append(deepcopy(item))
            by_name = {item["name"]: item for item in hospital["equipment"]}
            hospital["daily_consumption"].update({
                name: amount for name, amount in baseline["daily_consumption"].items()
                if name not in hospital["daily_consumption"]
            })
            if hospital["id"] == "srm-kattankulathur":
                next(ward for ward in hospital["wards"] if ward["name"] == "ICU")["occupied_beds"] = 18
                by_name["Ventilators"]["available"] = 4
                by_name["Oxygen cylinders"]["available"] = 12
                by_name["Cath lab"]["available"] = 1
                by_name["CT scanner"]["available"] = 0
            elif hospital["id"] == "srm-global":
                by_name["Ventilators"]["available"] = 0
                by_name["Oxygen cylinders"]["available"] = 5
                by_name["Cath lab"]["available"] = 0
                by_name["CT scanner"]["available"] = 1
        state["demo_resource_profile_version"] = 2
    persist_state(state)
    persist_logs(state["events"])
    return state


_state = initialize_storage()


def get_hospital(hospital_id: str) -> dict[str, Any]:
    hospital = next((h for h in _state["hospitals"] if h["id"] == hospital_id), None)
    if hospital is None:
        raise HTTPException(status_code=404, detail="Hospital not found.")
    return hospital


def add_event(
    state: dict[str, Any],
    event_type: str,
    hospital_id: str,
    resource: str,
    quantity: int | str,
    reference_id: str,
    notes: str,
    **extra: Any,
) -> dict[str, Any]:
    event = {
        "event_id": f"EV-{uuid4().hex[:10].upper()}",
        "timestamp_utc": timestamp(),
        "event_type": event_type,
        "hospital_id": hospital_id,
        "resource": resource,
        "quantity": quantity,
        "reference_id": reference_id,
        "notes": notes,
        **extra,
    }
    state["events"].append(event)
    return event


def commit_state(candidate: dict[str, Any]) -> None:
    """Persist state and both export formats before publishing in-memory changes."""
    persist_state(candidate)
    persist_logs(candidate["events"])
    _state.clear()
    _state.update(candidate)


def build_forecast(state: dict[str, Any]) -> dict[str, Any]:
    """Deterministic planning estimate; not a clinical prediction."""
    today = date.today()
    weekday_factor = (0.93, 0.98, 1.02, 1.04, 1.08, 1.03, 0.91)[today.weekday()]
    history = [53, 57, 55, 61, 58, 64, 60, 62, 66, 63, 68, 65, 71, 67]
    historical_mean = sum(history) / len(history)
    expected = round(historical_mean * weekday_factor)
    recent_mean = sum(history[-7:]) / 7
    trend_percent = round(((recent_mean - sum(history[:7]) / 7) / (sum(history[:7]) / 7)) * 100, 1)
    hour_weights = (0.035, 0.026, 0.022, 0.02, 0.022, 0.028, 0.042, 0.057, 0.066, 0.064, 0.061, 0.058, 0.057, 0.056, 0.057, 0.06, 0.064, 0.068, 0.067, 0.058, 0.047, 0.04, 0.035, 0.031)
    hourly = []
    remaining = expected
    for hour, weight in enumerate(hour_weights):
        count = round(expected * weight)
        hourly.append({"hour": f"{hour:02d}:00", "expected_arrivals": count})
        remaining -= count
    if hourly:
        hourly[-1]["expected_arrivals"] += remaining

    departments = []
    for hospital in state["hospitals"]:
        for department in hospital["departments"]:
            utilization = round(min(100, department["queue"] * department["service_minutes"] / max(1, department["staff_available"] * 60) * 100))
            wait = round(department["queue"] * department["service_minutes"] / max(1, department["staff_available"]))
            risk = "high" if wait >= 45 or utilization >= 85 else "watch" if wait >= 25 or utilization >= 65 else "stable"
            departments.append({
                "hospital_id": hospital["id"],
                "hospital_name": hospital["name"],
                "department": department["name"],
                "queue": department["queue"],
                "staff_available": department["staff_available"],
                "estimated_wait_minutes": wait,
                "utilization_percent": utilization,
                "bottleneck_risk": risk,
            })

    return {
        "as_of_date": today.isoformat(),
        "mode": "deterministic_demo_estimate",
        "note": "Illustrative forecast built from bundled synthetic admissions history and appointments; not hospital records or clinical prediction.",
        "arrivals_today": expected,
        "historical_daily_arrivals_14d": history,
        "appointments_today": round(expected * 0.36),
        "unscheduled_arrivals_estimate": round(expected * 0.64),
        "trend_percent_7d_vs_prior_7d": trend_percent,
        "hourly_arrivals": hourly,
        "department_bottlenecks": departments,
    }


def equipment_metrics(hospital: dict[str, Any], events: list[dict[str, Any]] | None = None) -> list[dict[str, Any]]:
    metrics = []
    for item in hospital["equipment"]:
        baseline = hospital["daily_consumption"].get(item["name"], 0)
        today = date.today().isoformat()
        recorded_use = sum(
            abs(int(event["quantity"]))
            for event in events or []
            if event["event_type"] == "inventory_change"
            and event["hospital_id"] == hospital["id"]
            and event["resource"] == item["name"]
            and int(event["quantity"]) < 0
            and event["timestamp_utc"][:10] == today
        )
        consumption = recorded_use if recorded_use else baseline
        days_cover = round(item["available"] / consumption, 1) if consumption else None
        ratio = item["available"] / item["total"] if item["total"] else 0
        status = "critical" if item["available"] < item["safe_minimum"] else "watch" if ratio < 0.3 else "adequate"
        metrics.append({
            **item,
            "daily_consumption": consumption,
            "days_of_cover": days_cover,
            "status": status,
            "consumption_basis": "recorded withdrawals today" if recorded_use else "synthetic 24-hour average",
        })
    return metrics


def emergency_readiness(wards: list[dict[str, Any]], equipment: list[dict[str, Any]]) -> dict[str, Any]:
    equipment_by_name = {item["name"]: item for item in equipment}
    icu = next((ward for ward in wards if ward["name"] == "ICU"), None)
    resources = [
        {"name": "ICU beds", "available": max(0, icu["free_beds"]) if icu else 0, "unit": "free beds"},
        {"name": "Oxygen cylinders", "available": equipment_by_name.get("Oxygen cylinders", {}).get("available", 0), "unit": "cylinders"},
        {"name": "Ventilators", "available": equipment_by_name.get("Ventilators", {}).get("available", 0), "unit": "units"},
        {"name": "Cath lab", "available": equipment_by_name.get("Cath lab", {}).get("available", 0), "unit": "units"},
        {"name": "CT scanner", "available": equipment_by_name.get("CT scanner", {}).get("available", 0), "unit": "units"},
    ]
    for resource in resources:
        resource["status"] = "available" if resource["available"] > 0 else "not_available"
    ready_count = sum(resource["available"] > 0 for resource in resources)
    return {
        "available_resources": ready_count,
        "total_resources": len(resources),
        "readiness_percent": round(ready_count / len(resources) * 100) if resources else 0,
        "resources": resources,
        "note": "Illustrative readiness indicator only; not a clinical suitability, route, or survival prediction.",
    }


def compute_alerts(state: dict[str, Any]) -> list[dict[str, Any]]:
    alerts = []
    for hospital in state["hospitals"]:
        for item in equipment_metrics(hospital, state["events"]):
            if item["status"] == "critical":
                alerts.append({
                    "severity": "critical",
                    "type": "stock_below_safe_minimum",
                    "hospital_id": hospital["id"],
                    "hospital": hospital["name"],
                    "resource": item["name"],
                    "available": item["available"],
                    "safe_minimum": item["safe_minimum"],
                    "message": f"RESTOCK WARNING: {hospital['name']} — {item['name']} stock is {item['available']}, below safe minimum {item['safe_minimum']}.",
                })
        for ward in hospital["wards"]:
            free = ward["total_beds"] - ward["occupied_beds"]
            if ward["acuity"] == "critical" and free <= 2:
                alerts.append({
                    "severity": "high",
                    "type": "critical_bed_capacity",
                    "hospital_id": hospital["id"],
                    "hospital": hospital["name"],
                    "resource": f"{ward['name']} free beds",
                    "available": free,
                    "safe_minimum": 3,
                    "message": f"Capacity watch: {hospital['name']} has {free} free {ward['name']} beds. Confirm suitability and staffing before reallocation.",
                })
        for department in hospital["departments"]:
            wait = round(department["queue"] * department["service_minutes"] / max(1, department["staff_available"]))
            if wait >= 45:
                alerts.append({
                    "severity": "high",
                    "type": "department_wait_bottleneck",
                    "hospital_id": hospital["id"],
                    "hospital": hospital["name"],
                    "resource": f"{department['name']} wait",
                    "available": wait,
                    "safe_minimum": 45,
                    "message": f"Flow bottleneck: {hospital['name']} {department['name']} estimated wait is {wait} minutes; review staffing and pending diagnostics.",
                })
    return alerts


def build_dashboard(state: dict[str, Any]) -> dict[str, Any]:
    hospitals = []
    total_beds = total_occupied = total_icu_free = 0
    stock = []
    staff_total = staff_util_sum = 0
    for hospital in state["hospitals"]:
        wards = []
        for ward in hospital["wards"]:
            free = max(0, ward["total_beds"] - ward["occupied_beds"])
            total_beds += ward["total_beds"]
            total_occupied += ward["occupied_beds"]
            if ward["name"] == "ICU":
                total_icu_free += free
            wards.append({**ward, "free_beds": free, "occupancy_percent": round(ward["occupied_beds"] / ward["total_beds"] * 100) if ward["total_beds"] else 0})
        equipment = equipment_metrics(hospital, state["events"])
        for metric in equipment:
            stock.append({"hospital_id": hospital["id"], "hospital_name": hospital["name"], **metric})
        departments = []
        for department in hospital["departments"]:
            utilization = round(min(100, department["queue"] * department["service_minutes"] / max(1, department["staff_available"] * 60) * 100))
            wait = round(department["queue"] * department["service_minutes"] / max(1, department["staff_available"]))
            departments.append({**department, "estimated_wait_minutes": wait, "utilization_percent": utilization})
            staff_total += department["staff_available"]
            staff_util_sum += utilization * department["staff_available"]
        hospitals.append({
            **hospital,
            "wards": wards,
            "departments": departments,
            "equipment": equipment,
            "emergency_readiness": emergency_readiness(wards, equipment),
            "total_free_beds": sum(ward["free_beds"] for ward in wards),
            "icu_free_beds": next((ward["free_beds"] for ward in wards if ward["name"] == "ICU"), 0),
        })
    arrivals_today = sum(1 for intake in state["intakes"] if intake["timestamp_utc"][:10] == date.today().isoformat())
    return {
        "generated_at": timestamp(),
        "data_mode": "DEMO DATA — not live hospital operations",
        "integration": legacy_status(),
        "summary": {
            "hospitals": len(hospitals),
            "total_beds": total_beds,
            "occupied_beds": total_occupied,
            "free_beds": total_beds - total_occupied,
            "icu_free_beds": total_icu_free,
            "staffed_positions": staff_total,
            "staff_utilization_percent": round(staff_util_sum / staff_total) if staff_total else 0,
            "active_alerts": len(compute_alerts(state)),
            "intakes_today": arrivals_today,
        },
        "forecast": build_forecast(state),
        "hospitals": hospitals,
        "stock": stock,
        "alerts": compute_alerts(state),
        "recent_events": state["events"][-25:][::-1],
    }


_legacy_cache: dict[str, Any] = {
    "checked_at": None, "connected": False, "incident": None, "active_actors": None, "error": None,
}
_legacy_checked = 0.0

for _alert in compute_alerts(_state):
    if _alert["severity"] == "critical":
        print(f"[RESOURCE ALERT] {_alert['message']}", flush=True)


def legacy_status() -> dict[str, Any]:
    """Read only the configured legacy API; never accept a URL from the request."""
    global _legacy_checked, _legacy_cache
    if not LEGACY_API_URL:
        return {
            "configured": False,
            "connected": False,
            "source": None,
            "note": "Optional legacy link is not configured; operations dashboard uses isolated demo data.",
        }
    parsed = urlparse(LEGACY_API_URL)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        return {"configured": True, "connected": False, "source": "configured URL", "error": "LEGACY_API_URL must be an http(s) URL."}
    if datetime.now().timestamp() - _legacy_checked < 5:
        return deepcopy(_legacy_cache)
    endpoint = f"{LEGACY_API_URL}/api/state"
    try:
        request = Request(endpoint, headers={"Accept": "application/json", "User-Agent": "ReachAid-HospitalOps/1.0"})
        with urlopen(request, timeout=LEGACY_TIMEOUT_SECONDS) as response:
            if response.status != 200:
                raise URLError(f"legacy API returned HTTP {response.status}")
            state = json.loads(response.read(1_000_001))
        incident = state.get("incident") if isinstance(state, dict) else None
        actors = state.get("actors", []) if isinstance(state, dict) else []
        if not isinstance(actors, list):
            actors = []
        _legacy_cache = {
            "configured": True,
            "connected": True,
            "source": endpoint,
            "checked_at": timestamp(),
            "incident": incident,
            "active_actors": sum(1 for actor in actors if actor.get("connected")),
            "note": "Read-only snapshot; no data is written to the legacy system.",
        }
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        _legacy_cache = {
            "configured": True,
            "connected": False,
            "source": endpoint,
            "checked_at": timestamp(),
            "incident": None,
            "active_actors": None,
            "error": f"Legacy API unavailable: {type(exc).__name__}. Demo operations data remains available.",
        }
    _legacy_checked = datetime.now().timestamp()
    return deepcopy(_legacy_cache)


@app.get("/", include_in_schema=False)
def index() -> FileResponse:
    return FileResponse(ROOT / "static" / "index.html")


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "hospital-ops", "mode": "standalone-demo"}


@app.get("/api/v1/dashboard")
def dashboard() -> dict[str, Any]:
    with _lock:
        return build_dashboard(_state)


@app.get("/api/v1/hospitals")
def hospitals() -> list[dict[str, Any]]:
    with _lock:
        return build_dashboard(_state)["hospitals"]


@app.get("/api/v1/alerts")
def alerts() -> list[dict[str, Any]]:
    with _lock:
        return compute_alerts(_state)


@app.get("/api/v1/legacy-status")
def legacy_integration_status() -> dict[str, Any]:
    return legacy_status()


@app.post("/api/v1/intakes", status_code=201)
def create_intake(payload: IntakeCreate) -> dict[str, Any]:
    with _lock:
        candidate = deepcopy(_state)
        hospital = next((h for h in candidate["hospitals"] if h["id"] == payload.hospital_id), None)
        if hospital is None:
            raise HTTPException(status_code=404, detail="Hospital not found.")
        department = next((d for d in hospital["departments"] if d["name"].lower() == payload.department.lower()), None)
        if department is None:
            raise HTTPException(status_code=400, detail="Department is not configured for this hospital.")
        department["queue"] += 1
        intake = {
            "id": f"IN-{uuid4().hex[:8].upper()}",
            "timestamp_utc": timestamp(),
            "hospital_id": hospital["id"],
            "department": department["name"],
            "triage_priority": payload.triage_priority,
            "arrival_mode": payload.arrival_mode,
            "notes": payload.notes.strip(),
        }
        candidate["intakes"].append(intake)
        event = add_event(
            candidate, "emergency_intake", hospital["id"], department["name"], 1,
            intake["id"], intake["notes"], priority=intake["triage_priority"],
            arrival_mode=intake["arrival_mode"],
        )
        try:
            commit_state(candidate)
        except OSError as exc:
            raise HTTPException(status_code=500, detail="Could not persist intake and audit logs.") from exc
        return {"intake": intake, "event": event}


@app.post("/api/v1/bed-allocations", status_code=201)
def allocate_beds(payload: BedAllocationCreate) -> dict[str, Any]:
    with _lock:
        candidate = deepcopy(_state)
        hospital = next((h for h in candidate["hospitals"] if h["id"] == payload.hospital_id), None)
        if hospital is None:
            raise HTTPException(status_code=404, detail="Hospital not found.")
        ward = next((w for w in hospital["wards"] if w["name"].lower() == payload.ward.lower()), None)
        if ward is None:
            raise HTTPException(status_code=400, detail="Ward is not configured for this hospital.")
        free = ward["total_beds"] - ward["occupied_beds"]
        if payload.beds_allocated > free:
            raise HTTPException(status_code=409, detail=f"Only {free} beds are currently free in {ward['name']}; no allocation was made.")
        allocation = {
            "id": f"BA-{uuid4().hex[:8].upper()}",
            "timestamp_utc": timestamp(),
            "hospital_id": hospital["id"],
            "ward": ward["name"],
            "beds_allocated": payload.beds_allocated,
            "reference_id": payload.reference_id.strip(),
            "notes": payload.notes.strip(),
        }
        ward["occupied_beds"] += payload.beds_allocated
        candidate["bed_allocations"].append(allocation)
        event = add_event(
            candidate, "bed_allocation", hospital["id"], ward["name"],
            payload.beds_allocated, allocation["reference_id"] or allocation["id"], allocation["notes"],
            allocation_id=allocation["id"], free_after=ward["total_beds"] - ward["occupied_beds"],
        )
        try:
            commit_state(candidate)
        except OSError as exc:
            raise HTTPException(status_code=500, detail="Could not persist bed allocation and audit logs.") from exc
        return {"allocation": allocation, "event": event, "free_beds_after": ward["total_beds"] - ward["occupied_beds"]}


@app.post("/api/v1/inventory-changes", status_code=201)
def change_inventory(payload: InventoryChangeCreate) -> dict[str, Any]:
    if payload.quantity_delta == 0:
        raise HTTPException(status_code=400, detail="Quantity change cannot be zero.")
    with _lock:
        candidate = deepcopy(_state)
        hospital = next((h for h in candidate["hospitals"] if h["id"] == payload.hospital_id), None)
        if hospital is None:
            raise HTTPException(status_code=404, detail="Hospital not found.")
        item = next((i for i in hospital["equipment"] if i["name"].lower() == payload.item.lower()), None)
        if item is None:
            raise HTTPException(status_code=400, detail="Inventory item is not configured for this hospital.")
        updated = item["available"] + payload.quantity_delta
        if updated < 0:
            raise HTTPException(status_code=409, detail="Inventory cannot be reduced below zero.")
        if updated > item["total"]:
            raise HTTPException(status_code=409, detail=f"Change exceeds configured storage capacity ({item['total']}).")
        item["available"] = updated
        reference = f"ST-{uuid4().hex[:8].upper()}"
        event = add_event(
            candidate, "inventory_change", hospital["id"], item["name"],
            payload.quantity_delta, reference, payload.notes.strip(),
            available_after=updated, safe_minimum=item["safe_minimum"],
        )
        try:
            commit_state(candidate)
        except OSError as exc:
            raise HTTPException(status_code=500, detail="Could not persist inventory change and audit logs.") from exc
        new_alerts = [
            alert for alert in compute_alerts(candidate)
            if alert["type"] == "stock_below_safe_minimum" and alert["hospital_id"] == hospital["id"] and alert["resource"] == item["name"]
        ]
        for alert in new_alerts:
            print(f"[RESOURCE ALERT] {alert['message']}", flush=True)
        return {
            "hospital_id": hospital["id"],
            "item": item["name"],
            "available": updated,
            "safe_minimum": item["safe_minimum"],
            "daily_consumption": next(
                metric["daily_consumption"] for metric in equipment_metrics(hospital, candidate["events"])
                if metric["name"] == item["name"]
            ),
            "days_of_cover": next(
                metric["days_of_cover"] for metric in equipment_metrics(hospital, candidate["events"])
                if metric["name"] == item["name"]
            ),
            "alerts": new_alerts,
            "event": event,
        }


@app.get("/api/v1/exports/operations.xlsx")
def export_xlsx() -> FileResponse:
    if not EVENTS_XLSX.exists():
        with _lock:
            persist_logs(_state["events"])
    return FileResponse(
        EVENTS_XLSX,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        filename="hospital_operations_log.xlsx",
    )


@app.get("/api/v1/exports/operations.csv")
def export_csv() -> Response:
    if not EVENTS_CSV.exists():
        with _lock:
            persist_logs(_state["events"])
    return FileResponse(EVENTS_CSV, media_type="text/csv; charset=utf-8", filename="hospital_operations_log.csv")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("app:app", host=os.environ.get("HOST", "127.0.0.1"), port=int(os.environ.get("PORT", "8010")), reload=False)
