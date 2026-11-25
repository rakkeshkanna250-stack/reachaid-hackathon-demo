# ReachAid Hospital Operations

A standalone, server-backed hospital capacity and patient-flow demonstration. It does not modify or import Python code from the legacy ReachAid server.

## Start the dedicated server

```sh
cd hospital-ops-platform
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python app.py
```

Open <http://127.0.0.1:8010>. Interactive API documentation is at <http://127.0.0.1:8010/docs>. The default bind address is loopback. To make it available on a trusted private LAN, start with `HOST=0.0.0.0 python app.py`; do not expose this unauthenticated demo to the public internet.

## Standalone and optional legacy link

The operations application runs independently on port 8010. It uses a local JSON state file and bundled synthetic hospital data; the dashboard, audit log, Excel exports, stock alerts, and operation entry remain available if the legacy server is stopped.

To show a **read-only** snapshot from the old sandbox, start this server with the legacy server's base URL, for example:

```sh
LEGACY_API_URL=http://127.0.0.1:8000 python app.py
```

The companion makes a bounded-time `GET <LEGACY_API_URL>/api/state` request from the server and shows only the incident and count of connected actors. It never posts to the legacy API, and its URLs cannot be overridden through a browser request. If unreachable, the status is marked unavailable and the local dashboard continues operating. The legacy response is not used as a source for hospital beds, equipment, admissions, or clinical decisions.

## Dashboard and operations API

| Action | Endpoint | Purpose |
|---|---|---|
| Dashboard | `GET /api/v1/dashboard` | Summary, deterministic arrivals estimate, queues, beds, stock, alerts and recent events |
| Hospital resources | `GET /api/v1/hospitals` | Ward capacity, departments, inventory and illustrative emergency resource-readiness indicators |
| Operations alerts | `GET /api/v1/alerts` | Current low-stock, low-ICU-capacity and long-wait warnings |
| Legacy link status | `GET /api/v1/legacy-status` | Read-only configured source status |
| Record emergency intake | `POST /api/v1/intakes` | Add intake and department queue count |
| Allocate occupied beds | `POST /api/v1/bed-allocations` | Allocate only available beds in an existing ward |
| Update inventory | `POST /api/v1/inventory-changes` | Record a positive restock or negative stock issue/adjustment |
| Download audit workbook | `GET /api/v1/exports/operations.xlsx` | Excel workbook with four named, timestamped sheets |
| Download audit CSV | `GET /api/v1/exports/operations.csv` | Flat timestamped event log |

Example requests:

```sh
curl -X POST http://127.0.0.1:8010/api/v1/intakes \
  -H 'Content-Type: application/json' \
  -d '{"hospital_id":"srm-kattankulathur","department":"Emergency","triage_priority":"urgent","arrival_mode":"ambulance","notes":"Demo intake"}'

curl -X POST http://127.0.0.1:8010/api/v1/bed-allocations \
  -H 'Content-Type: application/json' \
  -d '{"hospital_id":"srm-kattankulathur","ward":"ICU","beds_allocated":1,"reference_id":"DEMO-001"}'

curl -X POST http://127.0.0.1:8010/api/v1/inventory-changes \
  -H 'Content-Type: application/json' \
  -d '{"hospital_id":"srm-global","item":"Oxygen cylinders","quantity_delta":5,"notes":"Demo restock"}'
```

## Excel / CSV registry

The service saves its writable demo state under `data/state.json`. Each successful intake, bed allocation, or stock change is timestamped in UTC and updates both:

- `data/operations_log.csv`: one row per operation.
- `data/operations_log.xlsx`: `Events`, `Emergency Intakes`, `Bed Allocations`, and `Inventory Changes` sheets with column headings, filters, frozen headers, event IDs, resource quantities and timestamps.

The dashboard download links export the same logs. Do not put real names, patient identifiers, or confidential medical information in demo notes. Back up the `data/` folder if the prototype is used for a demo that needs to retain records.

## Forecast, resource use and safety boundaries

The current arrival forecast is a repeatable planning estimate derived from a bundled 14-day **synthetic** count series, day-of-week factor and a fixed hour-of-day profile. It is not trained on hospital admissions or appointments. Department wait is an illustrative queue/service-time/staff arithmetic estimate, not a validated wait-time model. Inventory consumption uses same-day negative inventory adjustments when logged; before any are available it shows the bundled synthetic daily-use baseline. Days of cover is on-hand quantity divided by that estimate.

The bundled values for named facilities, free/occupied beds, ICU, available staff, queues, equipment, safe-stock minimums, appointments, admissions, consumption and alerts are **fictional demo data** and are not confirmed facility facts. Replace them only with authorized, verified sources before relying on them. Server alerts are operational prompts to verify stock/capacity, not orders or clinical advice. The system never automatically transfers patients, reallocates staff, decides triage, or overrides clinician judgment. Bed allocations are rejected if they exceed current demo free capacity.

This prototype has no user authentication, role-based access, audit signing, clinical validation, or production reliability controls; run only in a private, trusted development environment. It is not a live hospital system, emergency service, medical device, or source of patient-care decisions.
