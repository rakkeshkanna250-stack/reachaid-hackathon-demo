# ReachAid — Emergency Response Coordination Prototype

ReachAid is a hackathon and portfolio prototype exploring how emergency dispatch teams could compare hospital readiness, triage needs, routes, and operational capacity in one workflow. It is designed to make the coordination problem easy to demonstrate and discuss—not to make clinical decisions or run real emergency services.

## The problem and idea

During an emergency, choosing a destination based only on distance may not show whether a hospital has the right resources or capacity. ReachAid demonstrates a possible coordination view: present simulated incident details, compare hospital readiness and route options, and track a sample transport workflow. A separate operations dashboard demonstrates how hospital teams might review capacity, queues, inventory, and recorded operational changes.

This repository contains three **independent demos**, not one integrated production system. They do not share live data or depend on one another.

## Projects

| Project | Location | Run |
|---|---|---|
| **SRM ambulance dispatch sandbox** | [`villupuram-dispatch/`](villupuram-dispatch/) | Open `villupuram-dispatch/index.html` in a modern browser. Keep `srm-road-data.js` beside it. |
| **Triage and hospital route comparison** | [`triage-routing/`](triage-routing/) | Open `triage-routing/index.html` in a modern browser. |
| **Hospital operations dashboard and API** | [`hospital-ops-platform/`](hospital-ops-platform/) | Follow [`hospital-ops-platform/README.md`](hospital-ops-platform/README.md); default URL is `http://127.0.0.1:8010/`. |

### What the demos show

- **Dispatch sandbox:** a simulated dispatch interface and route/map presentation for a local scenario.
- **Triage and routing:** four sample emergency complaint paths; comparison of hospital equipment match, capacity, congestion, and route alternatives; and a simulated dispatch, pickup, and arrival flow.
- **Hospital operations:** a local dashboard and API for sample hospital capacity, department queues, stock alerts, intakes, bed allocations, inventory changes, and CSV/Excel event exports.

The browser demos need no package installation. The hospital operations app uses Python; its setup, endpoints, and example requests are documented in its own README.

## How to evaluate

1. Open either browser demo using the instructions above and explore its controls.
2. For the backend-backed operations demo, follow its setup guide and visit `http://127.0.0.1:8010/`.
3. Review each project's README for the workflow, API, data assumptions, and limitations.

The code is a prototype intended for demonstration and discussion. It has not been validated with emergency responders or hospitals and is not suitable for real-world deployment.

## Safety and data

All hospital capacity, equipment availability, traffic, response, and route-match values in these demos are illustrative or synthetic. Any percentage is a prototype coordination score, not a probability of survival or a validated clinical recommendation. The demos are not connected to 108, hospitals, patient records, GPS navigation, or production dispatch systems. They do not diagnose, make treatment decisions, or replace clinician judgment. For a real emergency, contact local emergency services.

The hospital operations service initializes its own demo state and writes editable state and logs under `hospital-ops-platform/data/`. Do not enter real patient names, identifiers, or confidential medical information. Runtime data, generated workbooks, Python caches, and virtual environments are excluded from this repository.

## Repository structure

Each application can be run and developed independently. The dispatch and triage demos are browser-based; the hospital operations app is a Python API and dashboard. This combined repository does not include or alter the original `rapid-response-prototype` project.

## Third-party software

The dispatch demo bundles Leaflet 1.9.4. Its copyright and BSD 2-Clause license are included in [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md). Third-party components remain subject to their own licenses.

## Usage and rights

This repository is public for viewing and project evaluation. **All rights reserved for the original ReachAid code and materials; no license is granted to copy, modify, redistribute, or commercially use them without the author's prior permission.** There is no general license for the original project. Third-party components are excluded from this restriction and remain available under their own licenses.

Public visibility does not make the project exclusive or prevent others from viewing or copying the general idea. GitHub's terms also permit certain actions, such as forking a public repository. This notice is not a guarantee of legal protection; seek qualified legal advice if you need enforceable protection for the project or idea.
