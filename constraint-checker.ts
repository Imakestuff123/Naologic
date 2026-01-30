/**
 * Pure validation of a schedule: no rescheduling.
 * Validates work center conflicts, dependencies, shifts, and maintenance.
 *
 * Each check enforces:
 * - Work center conflicts: no two orders on the same center overlap (orderA.end <= orderB.start).
 * - Dependencies: every order starts at or after the latest parent end (max(parent.endDate) <= this.startDate).
 * - Shifts: each order starts inside a shift and its end equals shift-aware duration from start (within tolerance).
 * - Maintenance: no order's [start, end] overlaps any of its work center's maintenance windows.
 * - Maintenance orders (isMaintenance) are validated like others but are not moved by reflow.
 */

import { DateTime } from 'luxon';
import {
  calculateEndDateWithShifts,
  isWithinShift,
} from '../utils/date-utils';
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
    const computedEnd = calculateEndDateWithShifts(
      start,
      wo.durationMinutes,
      shifts
    );
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
 * Enforces: no order's [start, end] overlaps any of its work center's maintenance windows.
 */
function checkMaintenance(
  workOrders: WorkOrder[],
  workCenters: WorkCenter[],
  errors: string[]
): void {
  const centerByKey = new Map<string, WorkCenter>();
  for (const wc of workCenters) {
    centerByKey.set((wc as WorkCenter).name, wc as WorkCenter);
  }
  for (const wo of workOrders) {
    const wc = centerByKey.get(wo.workCenterId);
    if (!wc || !wc.maintenanceWindows || wc.maintenanceWindows.length === 0) {
      continue;
    }
    const orderStart = parseUTC(wo.startDate);
    const orderEnd = parseUTC(wo.endDate);
    for (const win of wc.maintenanceWindows) {
      const winStart = parseUTC(win.startDate);
      const winEnd = parseUTC(win.endDate);
      if (orderStart < winEnd && orderEnd > winStart) {
        errors.push(
          `Maintenance: order ${wo.workOrderNumber} [${wo.startDate}, ${wo.endDate}] overlaps maintenance window [${win.startDate}, ${win.endDate}] on ${wo.workCenterId}${win.reason ? ` (${win.reason})` : ''}`
        );
      }
    }
  }
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
