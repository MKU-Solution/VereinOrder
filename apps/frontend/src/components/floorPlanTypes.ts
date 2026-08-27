export type FloorPlanElementKind =
  | "TABLE_RECTANGLE"
  | "TABLE_ROUND"
  | "TABLE_STANDING"
  | "BAR"
  | "STAGE"
  | "KITCHEN";

export type TableStatus =
  | "FREE"
  | "OCCUPIED"
  | "PREPARING"
  | "READY"
  | "LONG_WAIT";

export interface FloorPlanElement {
  id: string;
  kind: FloorPlanElementKind;
  label: string;
  tableName?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  status?: TableStatus;
  openOrderCount?: number;
  oldestOrderCreatedAt?: string | null;
}

export interface FloorPlan {
  version: 1;
  width: 1000;
  height: 700;
  elements: FloorPlanElement[];
}

export interface AreaFloorPlan {
  id: string;
  name: string;
  sortOrder: number;
  floorPlan: FloorPlan;
}

export const TABLE_KINDS = new Set<FloorPlanElementKind>([
  "TABLE_RECTANGLE",
  "TABLE_ROUND",
  "TABLE_STANDING",
]);

export const TABLE_STATUS_LABELS: Record<TableStatus, string> = {
  FREE: "Frei",
  OCCUPIED: "Belegt / offen",
  PREPARING: "In Zubereitung",
  READY: "Bereit",
  LONG_WAIT: "Lange Wartezeit",
};

export const TABLE_STATUS_CLASSES: Record<TableStatus, string> = {
  FREE: "border-emerald-300 bg-emerald-500 text-emerald-950",
  OCCUPIED: "border-blue-200 bg-blue-500 text-white",
  PREPARING: "border-amber-200 bg-amber-500 text-amber-950",
  READY: "border-purple-200 bg-purple-500 text-white",
  LONG_WAIT: "border-red-200 bg-red-600 text-white",
};

export const FLOOR_PLAN_KIND_LABELS: Record<FloorPlanElementKind, string> = {
  TABLE_RECTANGLE: "Rechteckiger Tisch",
  TABLE_ROUND: "Runder Tisch",
  TABLE_STANDING: "Stehtisch",
  BAR: "Schank",
  STAGE: "Bühne",
  KITCHEN: "Küche",
};
