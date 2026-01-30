/**
 * Reflow service: reschedules work orders to satisfy constraints.
 * Topological order, per–work-center conflict-free placement, shift-aware end time, maintenance windows.
 *
 * Algorithm:
 * 1. Topological sort by dependencies (Kahn); throw on cycle.
 * 2. Maintenance orders are fixed; others are rescheduled.
 * 3. Per work center: earliest possible start = max(last end on center, max parent end, next available shift/maintenance).
 * 4. End = calculateEndDateWithShiftsAndMaintenance(start, durationMinutes, shifts, maintenance); work pauses at shift end or maintenance, resumes after.
 * 5. Build updatedWorkOrders, changes, and explanation.
 */

import { DateTime } from 'luxon';
import {
  calculateEndDateWithShiftsAndMaintenance,
  getNextShiftStart,
  isWithinShift,
} from '../utils/date-utils';
import type { MaintenanceRange } from '../utils/date-utils';
import { validateSchedule } from './constraint-checker';
import type {
  Change,
  MaintenanceWindow,
  ReflowInput,
  ReflowResult,
  Shift,
  WorkCenter,
  WorkOrder,
} from './types';

const UTC = 'utc';
/** Max iterations when advancing past maintenance to avoid infinite loop. */
const MAX_MAINTENANCE_ITERATIONS = 500;

function parseUTC(iso: string): DateTime {
  return DateTime.fromISO(iso, { zone: UTC });
}

function toISO(dt: DateTime): string {
  return dt.toISO() ?? '';
}

/** True if dt is inside any maintenance window [start, end). */
function isInMaintenance(
  dt: DateTime,
  windows: MaintenanceWindow[]
): boolean {
  for (const w of windows) {
    const start = parseUTC(w.startDate);
    const end = parseUTC(w.endDate);
    if (dt >= start && dt < end) return true;
  }
  return false;
}

/**
 * Next moment >= dt that is inside a shift and not inside any maintenance window.
 * Used for "earliest possible start" when we're after shift end or in maintenance.
 */
function getNextAvailableStart(
  dt: DateTime,
  shifts: Shift[],
  windows: MaintenanceWindow[]
): DateTime {
  let current = dt;
  // Only snap to next shift *start* when we're outside any shift (e.g. after 17:00 or on weekend).
  // If we're already in shift (e.g. 10:00 right after parent), keep it so jobs run as soon as possible.
  if (shifts.length > 0 && !isWithinShift(current, shifts)) {
    current = getNextShiftStart(current, shifts);
  }
  let iterations = 0;
  while (isInMaintenance(current, windows) && iterations < MAX_MAINTENANCE_ITERATIONS) {
    for (const w of windows) {
      const wStart = parseUTC(w.startDate);
      const wEnd = parseUTC(w.endDate);
      if (current >= wStart && current < wEnd) {
        current = wEnd;
        if (shifts.length > 0 && !isWithinShift(current, shifts)) {
          current = getNextShiftStart(current, shifts);
        }
        break;
      }
    }
    iterations++;
  }
  return current;
}

/**
 * Topological sort (Kahn) by dependsOnWorkOrderIds. Returns order IDs (workOrderNumber) in schedule order.
 * Throws if a cycle is detected, with message including involved ids.
 */
function topologicalOrder(workOrders: WorkOrder[]): string[] {
  const byNumber = new Map<string, WorkOrder>();
  for (const wo of workOrders) {
    byNumber.set(wo.workOrderNumber, wo);
  }
  const inDegree = new Map<string, number>();
  const children = new Map<string, string[]>();
  for (const wo of workOrders) {
    inDegree.set(wo.workOrderNumber, 0);
    children.set(wo.workOrderNumber, []);
  }
  for (const wo of workOrders) {
    for (const depId of wo.dependsOnWorkOrderIds) {
      if (!byNumber.has(depId)) continue;
      inDegree.set(wo.workOrderNumber, (inDegree.get(wo.workOrderNumber) ?? 0) + 1);
      const list = children.get(depId) ?? [];
      list.push(wo.workOrderNumber);
      children.set(depId, list);
    }
  }
  const queue: string[] = [];
  for (const [id, d] of inDegree) {
    if (d === 0) queue.push(id);
  }
  const result: string[] = [];
  while (queue.length > 0) {
    const n = queue.shift()!;
    result.push(n);
    for (const c of children.get(n) ?? []) {
      const d = (inDegree.get(c) ?? 1) - 1;
      inDegree.set(c, d);
      if (d === 0) queue.push(c);
    }
  }
  if (result.length !== workOrders.length) {
    const inCycle = workOrders
      .map((wo) => wo.workOrderNumber)
      .filter((id) => !result.includes(id));
    throw new Error(
      `Circular dependency detected involving work order(s): ${inCycle.join(', ')}`
    );
  }
  return result;
}

export function reflow(input: ReflowInput): ReflowResult {
  const { workOrders, workCenters } = input;

  const orderIds = topologicalOrder(workOrders);
  const byNumber = new Map<string, WorkOrder>();
  for (const wo of workOrders) {
    byNumber.set(wo.workOrderNumber, wo);
  }
  const workCenterByName = new Map<string, WorkCenter>();
  for (const wc of workCenters) {
    workCenterByName.set(wc.name, wc);
  }

  /** Per work center: list of { start, end } for already-scheduled non-maintenance orders. */
  const scheduledByCenter = new Map<string, { start: DateTime; end: DateTime }[]>();
  /** New start/end for each rescheduled order (workOrderNumber -> { start, end }). */
  const newSchedule = new Map<string, { start: DateTime; end: DateTime }>();
  const changes: Change[] = [];
  const explanationParts: string[] = [];

  const nonMaintenanceIds = orderIds.filter(
    (id) => !byNumber.get(id)!.isMaintenance
  );

  for (const woId of nonMaintenanceIds) {
    const wo = byNumber.get(woId)!;
    const wc = workCenterByName.get(wo.workCenterId);
    const shifts = wc?.shifts ?? [];
    const maintenanceWindows = wc?.maintenanceWindows ?? [];

    // --- Earliest possible start: no work center overlap ---
    const lastEndOnCenter = (() => {
      const list = scheduledByCenter.get(wo.workCenterId) ?? [];
      if (list.length === 0) return null;
      return DateTime.max(...list.map((x) => x.end));
    })();

    // --- Earliest possible start: dependencies (all parents must finish first) ---
    let maxParentEnd: DateTime | null = null;
    for (const depId of wo.dependsOnWorkOrderIds) {
      const parent = byNumber.get(depId);
      if (!parent) continue;
      const parentEnd = parent.isMaintenance
        ? parseUTC(parent.endDate)
        : (newSchedule.get(parent.workOrderNumber)?.end ?? parseUTC(parent.endDate));
      if (maxParentEnd === null || parentEnd > maxParentEnd) {
        maxParentEnd = parentEnd;
      }
    }

    // Earliest possible start = max(last end on same center, max parent end, order's own start); then align to next shift/maintenance slot.
    // Use the order's start date as floor so we keep the same year/day when nothing else constrains (no 1970 fallback).
    const orderStartFloor = parseUTC(wo.startDate);
    let candidateStart = DateTime.max(
      lastEndOnCenter ?? orderStartFloor,
      maxParentEnd ?? orderStartFloor,
      orderStartFloor
    );
    candidateStart = getNextAvailableStart(
      candidateStart,
      shifts,
      maintenanceWindows
    );

    // End = shift- and maintenance-aware: count only minutes in shift AND not in maintenance.
    // Work pauses at end of day or at maintenance, resumes after (same as prompt example).
    const maintenanceRanges: MaintenanceRange[] = maintenanceWindows.map(
      (w) => ({ start: parseUTC(w.startDate), end: parseUTC(w.endDate) })
    );
    const end = calculateEndDateWithShiftsAndMaintenance(
      candidateStart,
      wo.durationMinutes,
      shifts,
      maintenanceRanges
    );

    newSchedule.set(woId, { start: candidateStart, end });
    const list = scheduledByCenter.get(wo.workCenterId) ?? [];
    list.push({ start: candidateStart, end });
    scheduledByCenter.set(wo.workCenterId, list);

    const oldStart = parseUTC(wo.startDate);
    const oldEnd = parseUTC(wo.endDate);
    if (candidateStart.toMillis() !== oldStart.toMillis()) {
      const startReason =
        maxParentEnd != null && candidateStart.equals(maxParentEnd)
          ? 'dependency'
          : lastEndOnCenter != null && candidateStart.equals(lastEndOnCenter)
            ? 'work center conflict'
            : 'shift or maintenance';
      const startHow =
        maxParentEnd != null && candidateStart.equals(maxParentEnd)
          ? 'Earliest slot after dependency finished; aligned to shift/maintenance.'
          : lastEndOnCenter != null && candidateStart.equals(lastEndOnCenter)
            ? 'Earliest slot after prior order on same center; aligned to shift/maintenance.'
            : 'Aligned to next available shift start (or after maintenance).';
      changes.push({
        workOrderId: wo.workOrderNumber,
        field: 'startDate',
        oldValue: wo.startDate,
        newValue: toISO(candidateStart),
        reason: startReason,
        howCreated: startHow,
      });
      explanationParts.push(
        `Order ${wo.workOrderNumber} start moved to ${toISO(candidateStart)} (${maxParentEnd != null && candidateStart.equals(maxParentEnd) ? 'dependency on parent' : lastEndOnCenter != null ? 'after prior order on same center' : 'shift/maintenance'}).`
      );
    }
    if (end.toMillis() !== oldEnd.toMillis()) {
      const endReason =
        maxParentEnd != null || lastEndOnCenter != null
          ? 'cascade from new start'
          : 'shift or maintenance';
      const endHow =
        maxParentEnd != null || lastEndOnCenter != null
          ? 'Recalculated from new start: duration counted only in shift and outside maintenance (work pauses at shift end or during maintenance, resumes after).'
          : 'Recalculated: duration counted only in shift and outside maintenance; work pauses at shift end or during maintenance, resumes after, so end can be later.';
      changes.push({
        workOrderId: wo.workOrderNumber,
        field: 'endDate',
        oldValue: wo.endDate,
        newValue: toISO(end),
        reason: endReason,
        howCreated: endHow,
      });
      explanationParts.push(
        `Order ${wo.workOrderNumber} end moved to ${toISO(end)} (${endReason === 'cascade from new start' ? 'recalculated from new start' : 'shift- and maintenance-aware: work paused at cutoff, resumed after'}).`
      );
    }
  }

  const updatedWorkOrders: WorkOrder[] = workOrders.map((wo) => {
    if (wo.isMaintenance) return wo;
    const next = newSchedule.get(wo.workOrderNumber);
    if (!next) return wo;
    return {
      ...wo,
      startDate: toISO(next.start),
      endDate: toISO(next.end),
    };
  });

  const validation = validateSchedule(updatedWorkOrders, workCenters);
  if (!validation.valid) {
    throw new Error(
      `Reflow produced invalid schedule: ${validation.errors.join('; ')}`
    );
  }

  const explanation =
    explanationParts.length > 0
      ? explanationParts.join(' ')
      : 'No changes required; schedule already satisfies constraints.';

  return {
    updatedWorkOrders,
    changes,
    explanation,
  };
}
