/**
 * Entry point: load sample data, run reflow, print results.
 * Loads each scenario from sample-data/, runs reflow, and prints updatedWorkOrders, changes, and explanation.
 */

import * as fs from 'fs';
import * as path from 'path';
import { DateTime } from 'luxon';
import { reflow } from './reflow/reflow.service';
import type { ReflowInput } from './reflow/types';
import { getWorkingSegments } from './utils/date-utils';
import type { MaintenanceRange } from './utils/date-utils';

const SAMPLE_DIR = path.join(__dirname, '..', 'sample-data');
const SCENARIOS = [
  'scenario-delay-cascade.json',
  'scenario-shift-maintenance.json',
  'scenario-complex.json',
];

function loadScenario(filename: string): ReflowInput {
  const filePath = path.join(SAMPLE_DIR, filename);
  const raw = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(raw) as ReflowInput;
}

async function main(): Promise<void> {
  for (const filename of SCENARIOS) {
    const scenarioName = filename.replace('.json', '');
    console.log('\n' + '='.repeat(60));
    console.log(`Scenario: ${scenarioName}`);
    console.log('='.repeat(60));

    const input = loadScenario(filename);
    const result = reflow(input);

    console.log('\n--- Maintenance Windows ---');
    let anyMaintenance = false;
    for (const wc of input.workCenters) {
      if (wc.maintenanceWindows && wc.maintenanceWindows.length > 0) {
        anyMaintenance = true;
        console.log(`  [${wc.name}]`);
        for (const m of wc.maintenanceWindows) {
          const reason = m.reason ? ` — ${m.reason}` : '';
          console.log(`    ${m.startDate} → ${m.endDate}${reason}`);
        }
      }
    }
    if (!anyMaintenance) {
      console.log('  (none)');
    }

    console.log('\n--- Original Work Orders ---');
    for (const wo of input.workOrders) {
      console.log(
        `  ${wo.workOrderNumber} [${wo.workCenterId}]: ${wo.startDate} → ${wo.endDate} (${wo.durationMinutes} min)`
      );
    }

    console.log('\n--- Updated Work Orders ---');
    const parseUTC = (iso: string) => DateTime.fromISO(iso, { zone: 'utc' });
    for (const wo of result.updatedWorkOrders) {
      const wc = input.workCenters.find((c) => c.name === wo.workCenterId);
      const maintenanceRanges: MaintenanceRange[] = (wc?.maintenanceWindows ?? []).map(
        (w) => ({ start: parseUTC(w.startDate), end: parseUTC(w.endDate) })
      );
      const segments = getWorkingSegments(
        parseUTC(wo.startDate),
        wo.durationMinutes,
        wc?.shifts ?? [],
        maintenanceRanges
      );
      for (const seg of segments) {
        const segMinutes = Math.floor(seg.end.diff(seg.start, 'minutes').minutes);
        const startIso = seg.start.toISO() ?? '';
        const endIso = seg.end.toISO() ?? '';
        console.log(
          `  ${wo.workOrderNumber} [${wo.workCenterId}]: ${startIso} → ${endIso} (${segMinutes} min)`
        );
      }
    }

    console.log('\n--- Changes ---');
    if (result.changes.length === 0) {
      console.log('  (none)');
    } else {
      for (const c of result.changes) {
        console.log(
          `  ${c.workOrderId} ${c.field}: ${c.oldValue} → ${c.newValue}${c.reason ? ` [${c.reason}]` : ''}`
        );
        if (c.howCreated) {
          console.log(`    → ${c.howCreated}`);
        }
      }
    }

    console.log('\n--- Explanation ---');
    console.log('  ' + result.explanation);
  }
  console.log('\n');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
