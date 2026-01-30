/**
 * Date utilities for shift-aware duration and scheduling.
 * Uses Luxon; dates interpreted in UTC where required.
 *
 * Shift-walk logic: we count only minutes that fall inside work center shifts.
 * Work "pauses" outside shift hours and resumes at the next shift window.
 */

import { DateTime } from 'luxon';
import type { Shift } from '../reflow/types';

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
