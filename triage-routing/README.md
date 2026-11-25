# ReachAid Triage & Hospital Routing

An independent, browser-only hackathon demonstration for pre-hospital triage, hospital resource comparison, and ambulance destination selection.

## Run

Open `index.html` in a modern browser. No server, package installation, web fonts, map tiles, or external API is required.

## Demo flow

1. Choose **Major heart attack**, **Cardiac arrest**, **Severe trauma / accident**, or **Acute stroke**.
2. Select **Raise 108 call** to start an intake for that complaint.
3. Compare ICU capacity, equipment, congestion, condition-specific equipment match, and the three route variants per hospital.
4. Choose a route marked **Possible** or **Congested** and dispatch Ambulance A-12.
5. Confirm patient pickup, watch the ambulance marker travel along the selected route, and complete hospital arrival.
6. Use **Reset demo** to restore the initial cardiac-emergency scenario. **Refresh** changes the simulated crowd levels.

## What the scores mean

Each hospital has three route variants (fastest, balanced, and clear corridor), for exactly 12 route options across four hospital nodes. The equipment match is a weighted checklist for the selected complaint. A missing critical resource or a demo road closure marks the option **Impossible / blocked**. Other options can be **Possible** or **Congested**.

The percentage called **Demo route success score** combines the equipment-match checklist, estimated travel time, congestion, and a route-reliability factor. It is a deterministic presentation heuristic—not a clinical outcome, survival probability, validated dispatch recommendation, live ETA, or medical advice. The hospital information and refresh behavior are simulated.

The map is an illustrative schematic, not GPS navigation. Hospital positions, ICU capacity, equipment, crowding, traffic, route closures, and ambulance state are demo data. This prototype is not connected to 108, hospitals, patient records, dispatch systems, or real emergency services. For a real emergency in India, call 112/108 as locally available.

## Independence

This directory lives in the separately copied `rapid-response-triage-prototype` project. Its files are separate from the original `rapid-response-prototype` directory; it does not write to or import from the original project.
