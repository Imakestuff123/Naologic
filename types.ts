/**
 * Document envelope and entity types for the reflow scheduler.
 * All startDate/endDate use ISO strings; parse with Luxon in UTC where required.
 */

/** Document envelope: docId, docType, and typed data payload. */
export interface Envelope<T> {
  docId: string;
  docType: string;
  data: T;
}

/** Work order entity (docType: "workOrder"). Dates are ISO strings. */
export interface WorkOrder {
  docType: 'workOrder';
  workOrderNumber: string;
  manufacturingOrderId: string;
  workCenterId: string;
  startDate: string;
  endDate: string;
  durationMinutes: number;
  isMaintenance: boolean;
  dependsOnWorkOrderIds: string[];
}

/** Shift window: dayOfWeek 0–6 (Sunday=0), startHour/endHour 0–23. */
export interface Shift {
  dayOfWeek: number;
  startHour: number;
  endHour: number;
}

/** Maintenance window: blocked time range; reason optional. */
export interface MaintenanceWindow {
  startDate: string;
  endDate: string;
  reason?: string;
}

/** Work center entity (docType: "workCenter") with shifts and maintenance windows. */
export interface WorkCenter {
  docType: 'workCenter';
  name: string;
  shifts: Shift[];
  maintenanceWindows: MaintenanceWindow[];
}

/** Manufacturing order entity (docType: "manufacturingOrder"). dueDate is ISO string. */
export interface ManufacturingOrder {
  docType: 'manufacturingOrder';
  manufacturingOrderNumber: string;
  itemId: string;
  quantity: number;
  dueDate: string;
}

/** Field name for a reflow change (start or end date). */
export type ChangeField = 'startDate' | 'endDate';

/** One recorded change from reflow: workOrderId, field, old/new value, optional reason. */
export interface Change {
  workOrderId: string;
  field: ChangeField;
  oldValue: unknown;
  newValue: unknown;
  reason?: string;
}

/** Reflow API result: updated work orders, list of changes, and explanation. */
export interface ReflowResult {
  updatedWorkOrders: WorkOrder[];
  changes: Change[];
  explanation: string;
}

/** Input to the reflow API: work orders, work centers, and manufacturing orders. */
export interface ReflowInput {
  workOrders: WorkOrder[];
  workCenters: WorkCenter[];
  manufacturingOrders: ManufacturingOrder[];
}
