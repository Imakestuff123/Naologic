# Production Schedule Reflow

Reschedules work orders to satisfy hard constraints: no work center overlaps, dependencies satisfied, work only in shift hours, and no work during maintenance. Maintenance work orders are fixed; all others may be moved.

## Setup

```bash
npm install
```

## Build

```bash
npm run build
```

Compiles TypeScript from `src/` to `dist/`.

## Run

Run all sample scenarios (loads JSON from `sample-data/`, runs reflow, prints updated work orders, changes, and explanation):

```bash
npm run start
```

Or directly:

```bash
npx ts-node src/run-scenarios.ts
```

## Algorithm

1. **Topological sort by dependencies**  
   Build a dependency graph from `dependsOnWorkOrderIds` and sort work orders (Kahn’s algorithm). If a cycle is detected, throw with the involved work order IDs. Parents are always processed before children.

2. **Per–work-center conflict-free placement**  
   Non-maintenance orders are grouped by work center. For each order (in topological order), the **earliest possible start** is the maximum of:
   - End of the last scheduled order on the same work center (no overlap),
   - Latest end of all parent orders (dependencies),
   - Start of the next available shift slot (if the candidate time is outside shift hours or inside a maintenance window).

3. **Shift-aware end time (Luxon)**  
   End time is computed with `calculateEndDateWithShifts(start, durationMinutes, shifts)`: only minutes inside work center shifts count. Work “pauses” outside shift hours and resumes at the next shift window (e.g. 120 min starting Mon 4 PM with Mon–Fri 8–17 → 60 min Mon, resume Tue 8 AM, end Tue 9 AM).

4. **Maintenance windows as blocked ranges**  
   If the computed [start, end] overlaps a maintenance window, the start is pushed to after that window and the end is recomputed until there is no overlap. Maintenance work orders are never moved.

5. **Result**  
   The service returns `updatedWorkOrders` (with new `startDate`/`endDate` where changed), a `changes` list (field, old/new value, reason), and an `explanation` string. The schedule is validated with the constraint checker before returning; if invalid, reflow throws with a clear message.

## Sample Scenarios

| Scenario | File | What it demonstrates |
|----------|------|----------------------|
| **Delay cascade** | `sample-data/scenario-delay-cascade.json` | Three orders on the same work center (Line1) with a chain A → B → C. WO-002 depends on WO-001 and WO-003 depends on WO-002. Initial times overlap; reflow moves B and C to the right so each starts after its parent ends and after the previous order on the center, with explanation citing dependency and work center conflict. |
| **Shift / maintenance** | `sample-data/scenario-shift-maintenance.json` | One 120-minute order on Line2 starting at 4 PM (16:00) with shift Mon–Fri 8–17. Only 60 minutes fall on the first day; the rest resume next day at 8 AM. A maintenance window on the next morning can cause the end time to land after the window. Demonstrates shift-boundary and maintenance-aware scheduling. |
| **Complex** | `sample-data/scenario-complex.json` | Multiple orders on Line3 with dependencies (WO-X → WO-Y → WO-Z) and a mid-morning maintenance window. Reflow places all orders without overlapping the window or each other and with dependencies satisfied. |

## Project layout

```
src/
├── reflow/
│   ├── reflow.service.ts   # Main reflow algorithm
│   ├── constraint-checker.ts  # Validates schedule (conflicts, deps, shifts, maintenance)
│   └── types.ts            # Document and result types
├── utils/
│   └── date-utils.ts       # Shift-aware calculateEndDateWithShifts and helpers
└── run-scenarios.ts        # Loads sample-data/*.json, runs reflow, prints results
sample-data/
├── scenario-delay-cascade.json
├── scenario-shift-maintenance.json
└── scenario-complex.json
```

## Inputs / outputs

- **Inputs:** `workOrders`, `workCenters`, `manufacturingOrders` (envelope-style docs with `docType`, etc.). All dates are ISO strings (UTC).
- **Output:** `ReflowResult`: `{ updatedWorkOrders, changes, explanation }`. Use the constraint checker to validate any schedule (e.g. after reflow).
