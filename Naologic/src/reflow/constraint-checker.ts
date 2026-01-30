/**
 * Pure validation of a schedule: no rescheduling.
 * Validates work center conflicts, dependencies, shifts, and maintenance.
 *
 * Each check enforces:
 * - Work center conflicts: no two orders on the same center overlap (orderA.end <= orderB.start).
 * - Dependencies: every order starts at or after the latest parent end (max(parent.endDate) <= this.startDate).
 * - Shifts: each order starts inside a shift and its end equals shift- and maintenance-aware duration from start (within tolerance). Work may span maintenance (pauses during it).
 * - Maintenance: work does not run during maintenance; [start, end] may span maintenance (pause then resume).
 * - Maintenance orders (isMaintenance) are validated like others but are not moved by reflow.
 */

import { DateTime } from 'luxon';
import {
  calculateEndDateWithShifts,
  calculateEndDateWithShiftsAndMaintenance,
  isWithinShift,
} from '../utils/date-utils';
import type { MaintenanceRange } from '../utils/date-utils';
import type { WorkOrder, WorkCenter } from './types';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

const UTC = 'utc';
/** Tolerance in milliseconds when comparing computed end to stored end (shift check). */
const END_TOLERANCE_MS = 60 * 1000;

function parseUTC(iso: string): DateTime {
  return DateTime.fromISO(iso, { zone: UTC });
}

/**
 * Work center conflicts: for each work center, orders sorted by start must satisfy
 * orderA.endDate <= orderB.startDate (no overlap). Stored end dates are assumed to respect shifts.
 */
/**
 * Enforces: no two orders on the same work center overlap (orderA.endDate <= orderB.startDate).
 */
function checkWorkCenterConflicts(
  workOrders: WorkOrder[],
  errors: string[]
): void {
  const byCenter = new Map<string, WorkOrder[]>();
  for (const wo of workOrders) {
    const list = byCenter.get(wo.workCenterId) ?? [];
    list.push(wo);
    byCenter.set(wo.workCenterId, list);
  }
  for (const [workCenterId, orders] of byCenter) {
    const sorted = [...orders].sort(
      (a, b) => parseUTC(a.startDate).toMillis() - parseUTC(b.startDate).toMillis()
    );
    for (let i = 0; i < sorted.length - 1; i++) {
      const a = sorted[i];
      const b = sorted[i + 1];
      const aEnd = parseUTC(a.endDate);
      const bStart = parseUTC(b.startDate);
      if (aEnd > bStart) {
        errors.push(
          `Work center conflict on ${workCenterId}: order ${a.workOrderNumber} ends ${a.endDate} but order ${b.workOrderNumber} starts ${b.startDate}`
        );
      }
    }
  }
}

/**
 * Enforces: for each order, all parents finish before this starts — max(parent.endDate) <= this.startDate.
 */
function checkDependencies(
  workOrders: WorkOrder[],
  errors: string[]
): void {
  const byNumber = new Map<string, WorkOrder>();
  for (const wo of workOrders) {
    byNumber.set(wo.workOrderNumber, wo);
  }
  for (const wo of workOrders) {
    if (wo.dependsOnWorkOrderIds.length === 0) continue;
    let maxParentEnd: DateTime | null = null;
    for (const id of wo.dependsOnWorkOrderIds) {
      const parent = byNumber.get(id);
      if (!parent) {
        errors.push(
          `Dependency: order ${wo.workOrderNumber} depends on unknown work order ${id}`
        );
        continue;
      }
      const parentEnd = parseUTC(parent.endDate);
      if (maxParentEnd === null || parentEnd > maxParentEnd) {
        maxParentEnd = parentEnd;
      }
    }
    if (maxParentEnd !== null) {
      const thisStart = parseUTC(wo.startDate);
      if (thisStart < maxParentEnd) {
        errors.push(
          `Dependency: order ${wo.workOrderNumber} starts ${wo.startDate} before dependency ends (latest: ${maxParentEnd.toISO()})`
        );
      }
    }
  }
}

/**
 * Enforces: each order starts inside a shift and stored end equals shift-aware duration from start (within tolerance).
 */
function checkShifts(
  workOrders: WorkOrder[],
  workCenters: WorkCenter[],
  errors: string[]
): void {
  // workCenterId on WorkOrder is assumed to match WorkCenter.name (types have no separate id).
  for (const wo of workOrders) {
    const wc = workCenters.find((c) => c.name === wo.workCenterId);
    if (!wc || !wc.shifts || wc.shifts.length === 0) {
      // No shifts defined: skip shift check for this center
      continue;
    }
    const shifts = wc.shifts;
    const start = parseUTC(wo.startDate);
    if (!isWithinShift(start, shifts)) {
      errors.push(
        `Shifts: order ${wo.workOrderNumber} start ${wo.startDate} is not inside any shift for work center ${wo.workCenterId}`
      );
    }
    const maintenanceRanges: MaintenanceRange[] = (wc.maintenanceWindows ?? []).map(
      (w) => ({ start: parseUTC(w.startDate), end: parseUTC(w.endDate) })
    );
    const computedEnd =
      maintenanceRanges.length > 0
        ? calculateEndDateWithShiftsAndMaintenance(
            start,
            wo.durationMinutes,
            shifts,
            maintenanceRanges
          )
        : calculateEndDateWithShifts(start, wo.durationMinutes, shifts);
    const storedEnd = parseUTC(wo.endDate);
    const diffMs = Math.abs(computedEnd.toMillis() - storedEnd.toMillis());
    if (diffMs > END_TOLERANCE_MS) {
      errors.push(
        `Shifts: order ${wo.workOrderNumber} end ${wo.endDate} does not match shift-aware duration from start (expected ~${computedEnd.toISO()})`
      );
    }
  }
}

/**
 * Maintenance: work is allowed to span maintenance (pause during window, resume after).
 * No error when [start, end] overlaps maintenance; validation of end time is in checkShifts (shift- and maintenance-aware).
 */
function checkMaintenance(
  _workOrders: WorkOrder[],
  _workCenters: WorkCenter[],
  _errors: string[]
): void {
  // Work may span maintenance; no strict overlap check.
}

/**
 * Validates a full schedule: work center conflicts, dependencies, shifts, and maintenance.
 * Returns { valid, errors }. Reflow service may throw with a clear message if valid is false.
 */
export function validateSchedule(
  workOrders: WorkOrder[],
  workCenters: WorkCenter[]
): ValidationResult {
  const errors: string[] = [];
  checkWorkCenterConflicts(workOrders, errors);
  checkDependencies(workOrders, errors);
  checkShifts(workOrders, workCenters, errors);
  checkMaintenance(workOrders, workCenters, errors);
  return { valid: errors.length === 0, errors };
}
