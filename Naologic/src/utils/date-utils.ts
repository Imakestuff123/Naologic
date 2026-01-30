/**
 * Date utilities for shift-aware duration and scheduling.
 * Uses Luxon; dates interpreted in UTC where required.
 *
 * Shift-walk logic: we count only minutes that fall inside work center shifts.
 * Work "pauses" outside shift hours and resumes at the next shift window.
 * With maintenance: work also pauses during maintenance windows and resumes after.
 */

import { DateTime } from 'luxon';
import type { Shift } from '../reflow/types';

/** Maintenance window as a time range (caller parses ISO to DateTime). */
export interface MaintenanceRange {
  start: DateTime;
  end: DateTime;
}

/** Map Luxon weekday (1=Mon, 7=Sun) to plan dayOfWeek (0=Sun, 1=Mon, ..., 6=Sat). */
function toPlanDayOfWeek(luxonWeekday: number): number {
  return luxonWeekday === 7 ? 0 : luxonWeekday;
}

/** Single-shift check: [startHour, endHour) in hours; dayOfWeek must match. */
function isInShift(dt: DateTime, s: Shift): boolean {
  const day = toPlanDayOfWeek(dt.weekday);
  if (s.dayOfWeek !== day) return false;
  const h = dt.hour;
  const m = dt.minute;
  if (h > s.startHour && h < s.endHour) return true;
  if (h === s.startHour && h < s.endHour) return true;
  if (h === s.endHour && m === 0) return false; // end is exclusive
  return false;
}

/**
 * True if the given UTC moment falls inside any shift window.
 * Shift uses dayOfWeek 0-6 (Sunday=0), startHour/endHour 0-23; range is [startHour, endHour).
 */
export function isWithinShift(dt: DateTime, shifts: Shift[]): boolean {
  return shifts.some((s) => isInShift(dt, s));
}

/**
 * Returns the end of the shift segment that contains dt (must be in shift).
 * That is, the moment when this shift window ends (start of day + endHour, same day).
 */
function getShiftSegmentEnd(dt: DateTime, shifts: Shift[]): DateTime {
  const day = toPlanDayOfWeek(dt.weekday);
  for (const s of shifts) {
    if (s.dayOfWeek !== day) continue;
    const h = dt.hour;
    if (h >= s.startHour && h < s.endHour) {
      return dt.startOf('day').set({ hour: s.endHour, minute: 0, second: 0, millisecond: 0 });
    }
  }
  return dt; // fallback
}

/**
 * Next moment at or after dt when a shift starts (i.e. startHour on a shift dayOfWeek).
 * Used to jump to the next available slot when current time is outside shifts.
 */
export function getNextShiftStart(dt: DateTime, shifts: Shift[]): DateTime {
  if (shifts.length === 0) return dt;
  let best: DateTime | null = null;
  // Check next 8 days to cover full week
  for (let d = 0; d <= 7; d++) {
    const day = dt.plus({ days: d });
    const dow = toPlanDayOfWeek(day.weekday);
    const startOfDay = day.startOf('day');
    for (const s of shifts) {
      if (s.dayOfWeek !== dow) continue;
      const candidate = startOfDay.set({
        hour: s.startHour,
        minute: 0,
        second: 0,
        millisecond: 0,
      });
      if (candidate >= dt && (best === null || candidate < best)) {
        best = candidate;
      }
    }
  }
  return best ?? dt;
}

function isInMaintenanceRange(dt: DateTime, ranges: MaintenanceRange[]): boolean {
  for (const r of ranges) {
    if (dt >= r.start && dt < r.end) return true;
  }
  return false;
}

/** End of the maintenance window that contains dt, or null. */
function getMaintenanceRangeEnd(dt: DateTime, ranges: MaintenanceRange[]): DateTime | null {
  for (const r of ranges) {
    if (dt >= r.start && dt < r.end) return r.end;
  }
  return null;
}

/**
 * Next moment >= dt that is in shift and not in any maintenance range.
 */
function getNextWorkingMoment(
  dt: DateTime,
  shifts: Shift[],
  maintenanceRanges: MaintenanceRange[]
): DateTime {
  const MAX_ITER = 1000;
  let current = dt;
  for (let i = 0; i < MAX_ITER; i++) {
    if (shifts.length > 0 && !isWithinShift(current, shifts)) {
      current = getNextShiftStart(current, shifts);
      continue;
    }
    if (maintenanceRanges.length > 0 && isInMaintenanceRange(current, maintenanceRanges)) {
      const end = getMaintenanceRangeEnd(current, maintenanceRanges);
      if (end) current = end;
      else break;
      continue;
    }
    return current;
  }
  return current;
}

/**
 * End of the current "working" segment containing dt (in shift and not in maintenance).
 * Segment ends at the earlier of: shift end, or start of a maintenance window in this segment.
 */
function getWorkingSegmentEnd(
  dt: DateTime,
  shifts: Shift[],
  maintenanceRanges: MaintenanceRange[]
): DateTime {
  const shiftSegmentEnd = getShiftSegmentEnd(dt, shifts);
  let segmentEnd = shiftSegmentEnd;
  for (const r of maintenanceRanges) {
    if (r.start > dt && r.start < segmentEnd) {
      segmentEnd = r.start;
    }
  }
  return segmentEnd;
}

/**
 * Shift- and maintenance-aware end time: from startDate, count only minutes that are
 * inside shifts AND not inside maintenance; when durationMinutes of working time has
 * elapsed, return that moment. Work pauses at end of day or at maintenance, resumes after.
 * Example: 120 min order, start Mon 4PM, shift Mon–Fri 8–17 → 60 min Mon (4PM–5PM),
 * pause → resume Tue 8AM → complete 9AM.
 */
export function calculateEndDateWithShiftsAndMaintenance(
  startDate: DateTime,
  durationMinutes: number,
  shifts: Shift[],
  maintenanceRanges: MaintenanceRange[]
): DateTime {
  if (shifts.length === 0) {
    return startDate.plus({ minutes: durationMinutes });
  }
  let current = getNextWorkingMoment(startDate, shifts, maintenanceRanges);
  let remaining = durationMinutes;
  const MAX_ITER = 5000;
  for (let i = 0; i < MAX_ITER && remaining > 0; i++) {
    const segmentEnd = getWorkingSegmentEnd(current, shifts, maintenanceRanges);
    const minutesInSegment = Math.floor(
      segmentEnd.diff(current, 'minutes').minutes
    );
    if (minutesInSegment <= 0) {
      current = getNextWorkingMoment(segmentEnd, shifts, maintenanceRanges);
      continue;
    }
    if (remaining <= minutesInSegment) {
      return current.plus({ minutes: remaining });
    }
    remaining -= minutesInSegment;
    current = getNextWorkingMoment(segmentEnd, shifts, maintenanceRanges);
  }
  return current;
}

/** One contiguous block of working time (in shift and not in maintenance). */
export interface WorkingSegment {
  start: DateTime;
  end: DateTime;
}

/**
 * Returns the list of working segments for an order: from startDate, consuming durationMinutes
 * of working time (in shift and not in maintenance). Each segment is a contiguous [start, end].
 * Example: 120 min from Mon 16:00, shift 8–17, maintenance Tue 08–09 → two segments:
 * Mon 16:00–17:00, Tue 09:00–10:00.
 */
export function getWorkingSegments(
  startDate: DateTime,
  durationMinutes: number,
  shifts: Shift[],
  maintenanceRanges: MaintenanceRange[]
): WorkingSegment[] {
  const segments: WorkingSegment[] = [];
  if (shifts.length === 0) {
    const end = startDate.plus({ minutes: durationMinutes });
    segments.push({ start: startDate, end });
    return segments;
  }
  let current = getNextWorkingMoment(startDate, shifts, maintenanceRanges);
  let remaining = durationMinutes;
  const MAX_ITER = 5000;
  for (let i = 0; i < MAX_ITER && remaining > 0; i++) {
    const segmentEnd = getWorkingSegmentEnd(current, shifts, maintenanceRanges);
    const minutesInSegment = Math.floor(
      segmentEnd.diff(current, 'minutes').minutes
    );
    if (minutesInSegment <= 0) {
      current = getNextWorkingMoment(segmentEnd, shifts, maintenanceRanges);
      continue;
    }
    if (remaining <= minutesInSegment) {
      segments.push({
        start: current,
        end: current.plus({ minutes: remaining }),
      });
      return segments;
    }
    segments.push({ start: current, end: segmentEnd });
    remaining -= minutesInSegment;
    current = getNextWorkingMoment(segmentEnd, shifts, maintenanceRanges);
  }
  return segments;
}

/**
 * Shift-aware end time: from startDate, count only minutes inside shifts;
 * when durationMinutes of working time has elapsed, return that moment.
 * Example: 120 min order, start Mon 4PM, shift Mon–Fri 8–17 → 60 min Mon,
 * resume Tue 8AM, end Tue 9AM.
 */
export function calculateEndDateWithShifts(
  startDate: DateTime,
  durationMinutes: number,
  shifts: Shift[]
): DateTime {
  if (shifts.length === 0) {
    return startDate.plus({ minutes: durationMinutes });
  }
  // Shift-walk: count only minutes inside shifts; "pause" outside and resume at next shift start.
  let current = startDate;
  if (!isWithinShift(current, shifts)) {
    current = getNextShiftStart(current, shifts);
  }
  let remaining = durationMinutes;
  while (remaining > 0) {
    const segmentEnd = getShiftSegmentEnd(current, shifts);
    const minutesInSegment = Math.floor(
      segmentEnd.diff(current, 'minutes').minutes
    );
    if (minutesInSegment <= 0) {
      current = getNextShiftStart(current, shifts);
      continue;
    }
    if (remaining <= minutesInSegment) {
      return current.plus({ minutes: remaining });
    }
    remaining -= minutesInSegment;
    current = segmentEnd;
  }
  return current;
}

/**
 * Working minutes in [start, end] that fall inside any shift.
 * Used for overlap checks or validation.
 */
export function minutesInRange(
  start: DateTime,
  end: DateTime,
  shifts: Shift[]
): number {
  if (start >= end || shifts.length === 0) return 0;
  let total = 0;
  let current = start;
  if (!isWithinShift(current, shifts)) {
    current = getNextShiftStart(current, shifts);
  }
  while (current < end) {
    const segmentEnd = getShiftSegmentEnd(current, shifts);
    const segmentEndClamped = segmentEnd > end ? end : segmentEnd;
    if (segmentEndClamped > current) {
      total += Math.floor(
        segmentEndClamped.diff(current, 'minutes').minutes
      );
    }
    if (segmentEnd >= end) break;
    current = getNextShiftStart(segmentEnd, shifts);
  }
  return total;
}
