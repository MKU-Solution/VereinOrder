import { Minus, Plus, RotateCcw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import {
  type AreaFloorPlan,
  type FloorPlanElement,
  TABLE_KINDS,
  TABLE_STATUS_CLASSES,
  TABLE_STATUS_LABELS,
  type TableStatus,
} from "./floorPlanTypes";

interface FloorPlanViewerProps {
  plans: AreaFloorPlan[];
  onSelectTable: (tableName: string, areaId: string) => void;
}

const STATUS_ORDER: TableStatus[] = [
  "FREE",
  "OCCUPIED",
  "PREPARING",
  "READY",
  "LONG_WAIT",
];

const fixtureClasses: Record<string, string> = {
  BAR: "border-cyan-300/60 bg-cyan-950/80 text-cyan-100",
  STAGE: "border-fuchsia-300/60 bg-fuchsia-950/80 text-fuchsia-100",
  KITCHEN: "border-orange-300/60 bg-orange-950/80 text-orange-100",
};

const shapeClass = (element: FloorPlanElement) => {
  if (element.kind === "TABLE_ROUND") return "rounded-full";
  if (element.kind === "TABLE_STANDING") return "rounded-[45%]";
  return "rounded-xl";
};

export const FloorPlanViewer = ({
  plans,
  onSelectTable,
}: FloorPlanViewerProps) => {
  const plansWithContent = useMemo(
    () => plans.filter((plan) => plan.floorPlan.elements.length > 0),
    [plans],
  );
  const [selectedAreaId, setSelectedAreaId] = useState(
    plansWithContent[0]?.id ?? "",
  );
  const [zoom, setZoom] = useState(1);

  useEffect(() => {
    if (!plansWithContent.some((plan) => plan.id === selectedAreaId)) {
      setSelectedAreaId(plansWithContent[0]?.id ?? "");
    }
  }, [plansWithContent, selectedAreaId]);

  const selectedPlan =
    plansWithContent.find((plan) => plan.id === selectedAreaId) ??
    plansWithContent[0];

  if (!selectedPlan) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-600 bg-slate-800/40 p-6 text-center">
        <p className="font-bold text-slate-200">Noch kein Raumplan vorhanden</p>
        <p className="mt-1 text-sm text-slate-400">
          Nutze solange die Listenansicht oder lasse in der Verwaltung einen
          Plan anlegen.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div
          className="flex max-w-full gap-2 overflow-x-auto pb-1"
          aria-label="Bereich im Raumplan"
        >
          {plansWithContent.map((plan) => (
            <button
              key={plan.id}
              type="button"
              onClick={() => setSelectedAreaId(plan.id)}
              aria-pressed={plan.id === selectedPlan.id}
              className={`min-h-11 shrink-0 rounded-xl border px-4 py-2 text-sm font-bold transition-colors ${
                plan.id === selectedPlan.id
                  ? "border-indigo-300 bg-indigo-500 text-white"
                  : "border-slate-700 bg-slate-800 text-slate-300"
              }`}
            >
              {plan.name}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1 rounded-xl border border-slate-700 bg-slate-800 p-1">
          <button
            type="button"
            onClick={() => setZoom((value) => Math.max(0.75, value - 0.25))}
            disabled={zoom <= 0.75}
            className="flex min-h-11 min-w-11 items-center justify-center rounded-lg text-slate-200 hover:bg-slate-700 disabled:opacity-40"
            aria-label="Raumplan verkleinern"
          >
            <Minus className="h-5 w-5" aria-hidden="true" />
          </button>
          <span className="w-14 text-center font-mono text-xs text-slate-300">
            {Math.round(zoom * 100)} %
          </span>
          <button
            type="button"
            onClick={() => setZoom((value) => Math.min(2, value + 0.25))}
            disabled={zoom >= 2}
            className="flex min-h-11 min-w-11 items-center justify-center rounded-lg text-slate-200 hover:bg-slate-700 disabled:opacity-40"
            aria-label="Raumplan vergrößern"
          >
            <Plus className="h-5 w-5" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => setZoom(1)}
            className="flex min-h-11 min-w-11 items-center justify-center rounded-lg text-slate-200 hover:bg-slate-700"
            aria-label="Zoom zurücksetzen"
          >
            <RotateCcw className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-300">
        {STATUS_ORDER.map((status) => (
          <span key={status} className="inline-flex items-center gap-1.5">
            <span
              className={`h-2.5 w-2.5 rounded-full ${TABLE_STATUS_CLASSES[status].split(" ").find((name) => name.startsWith("bg-"))}`}
              aria-hidden="true"
            />
            {TABLE_STATUS_LABELS[status]}
          </span>
        ))}
      </div>

      <div
        className="max-h-[55vh] overflow-auto rounded-2xl border border-slate-700 bg-slate-950/80 shadow-inner touch-pan-x touch-pan-y"
        aria-label={`Raumplan ${selectedPlan.name}`}
      >
        <div
          className="relative min-h-[320px] bg-[radial-gradient(circle_at_center,_rgba(148,163,184,0.12)_1px,_transparent_1px)] bg-[length:24px_24px]"
          style={{ width: `${zoom * 100}%`, aspectRatio: "10 / 7" }}
        >
          {selectedPlan.floorPlan.elements.map((element) => {
            const isTable = TABLE_KINDS.has(element.kind);
            const status = element.status ?? "FREE";
            const style = {
              left: `${(element.x / 1000) * 100}%`,
              top: `${(element.y / 700) * 100}%`,
              width: `${(element.width / 1000) * 100}%`,
              height: `${(element.height / 700) * 100}%`,
              transform: `rotate(${element.rotation}deg)`,
            };

            if (!isTable) {
              return (
                <div
                  key={element.id}
                  style={style}
                  className={`absolute flex items-center justify-center border-2 px-1 text-center text-[10px] font-black uppercase tracking-wide sm:text-xs ${shapeClass(element)} ${fixtureClasses[element.kind]}`}
                  aria-label={element.label}
                >
                  {element.label}
                </div>
              );
            }

            return (
              <button
                key={element.id}
                type="button"
                style={style}
                onClick={() =>
                  onSelectTable(
                    element.tableName ?? element.label,
                    selectedPlan.id,
                  )
                }
                className={`absolute flex min-h-11 min-w-11 flex-col items-center justify-center border-2 px-1 text-center font-black shadow-lg transition hover:brightness-110 focus-visible:z-10 focus-visible:outline focus-visible:outline-4 focus-visible:outline-white ${shapeClass(element)} ${TABLE_STATUS_CLASSES[status]}`}
                aria-label={`${element.label}, ${TABLE_STATUS_LABELS[status]}${element.openOrderCount ? `, ${element.openOrderCount} offene Bestellungen` : ""}`}
              >
                <span className="max-w-full truncate text-[10px] leading-tight sm:text-xs">
                  {element.label}
                </span>
                {element.openOrderCount ? (
                  <span className="text-[9px] leading-tight opacity-80">
                    {element.openOrderCount} offen
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      </div>
      <p className="text-xs text-slate-500">
        Zum Verschieben des Ausschnitts wischen oder scrollen. Einen Tisch
        antippen, um ihn für die Bestellung zu übernehmen.
      </p>
    </div>
  );
};
