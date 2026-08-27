import {
  Armchair,
  Circle,
  CookingPot,
  Grab,
  Mic2,
  RectangleHorizontal,
  Save,
  Trash2,
  Wine,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";

import { api } from "../../lib/api";
import {
  FLOOR_PLAN_KIND_LABELS,
  type FloorPlanElement,
  type FloorPlanElementKind,
  TABLE_KINDS,
} from "../floorPlanTypes";

interface AdminFloorPlanEditorProps {
  area: any;
  onClose: () => void;
  onSaved: () => void;
}

const DEFAULT_SIZE: Record<
  FloorPlanElementKind,
  { width: number; height: number }
> = {
  TABLE_RECTANGLE: { width: 150, height: 90 },
  TABLE_ROUND: { width: 110, height: 110 },
  TABLE_STANDING: { width: 80, height: 80 },
  BAR: { width: 260, height: 80 },
  STAGE: { width: 300, height: 130 },
  KITCHEN: { width: 240, height: 120 },
};

const PALETTE: {
  kind: FloorPlanElementKind;
  label: string;
  icon: typeof Circle;
}[] = [
  { kind: "TABLE_RECTANGLE", label: "Tisch", icon: RectangleHorizontal },
  { kind: "TABLE_ROUND", label: "Rund", icon: Circle },
  { kind: "TABLE_STANDING", label: "Stehtisch", icon: Armchair },
  { kind: "BAR", label: "Schank", icon: Wine },
  { kind: "STAGE", label: "Bühne", icon: Mic2 },
  { kind: "KITCHEN", label: "Küche", icon: CookingPot },
];

const readElements = (area: any): FloorPlanElement[] => {
  const elements = area?.floorPlan?.elements;
  return Array.isArray(elements) ? elements : [];
};

export const AdminFloorPlanEditor = ({
  area,
  onClose,
  onSaved,
}: AdminFloorPlanEditorProps) => {
  const [elements, setElements] = useState<FloorPlanElement[]>(() =>
    readElements(area),
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selected = useMemo(
    () => elements.find((element) => element.id === selectedId) ?? null,
    [elements, selectedId],
  );

  const addElement = (kind: FloorPlanElementKind) => {
    const number =
      elements.filter((element) => TABLE_KINDS.has(element.kind)).length + 1;
    const isTable = TABLE_KINDS.has(kind);
    const size = DEFAULT_SIZE[kind];
    const element: FloorPlanElement = {
      id: crypto.randomUUID(),
      kind,
      label: isTable ? `Tisch ${number}` : FLOOR_PLAN_KIND_LABELS[kind],
      ...(isTable ? { tableName: String(number) } : {}),
      x: Math.min(900, 60 + ((elements.length * 95) % 760)),
      y: Math.min(600, 60 + (Math.floor(elements.length / 8) % 5) * 115),
      width: size.width,
      height: size.height,
      rotation: 0,
    };
    setElements((current) => [...current, element]);
    setSelectedId(element.id);
    setError(null);
  };

  const updateSelected = (patch: Partial<FloorPlanElement>) => {
    if (!selectedId) return;
    setElements((current) =>
      current.map((element) =>
        element.id === selectedId ? { ...element, ...patch } : element,
      ),
    );
  };

  const deleteSelected = () => {
    if (!selectedId) return;
    setElements((current) =>
      current.filter((element) => element.id !== selectedId),
    );
    setSelectedId(null);
  };

  const moveElement = (
    event: React.PointerEvent<HTMLButtonElement>,
    element: FloorPlanElement,
  ) => {
    if (draggingId !== element.id) return;
    const canvas = event.currentTarget.parentElement;
    if (!canvas) return;
    const bounds = canvas.getBoundingClientRect();
    const nextX = Math.round(
      ((event.clientX - bounds.left) / bounds.width) * 1000 - element.width / 2,
    );
    const nextY = Math.round(
      ((event.clientY - bounds.top) / bounds.height) * 700 - element.height / 2,
    );
    setElements((current) =>
      current.map((item) =>
        item.id === element.id
          ? {
              ...item,
              x: Math.max(0, Math.min(1000 - item.width, nextX)),
              y: Math.max(0, Math.min(700 - item.height, nextY)),
            }
          : item,
      ),
    );
  };

  const save = async () => {
    setIsSaving(true);
    setError(null);
    try {
      await api.put(`/areas/${area.id}/floor-plan`, { elements });
      onSaved();
      onClose();
    } catch (saveError: any) {
      const message = saveError?.response?.data?.message;
      setError(
        Array.isArray(message)
          ? message.join(" ")
          : typeof message === "string"
            ? message
            : "Der Raumplan konnte nicht gespeichert werden.",
      );
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex flex-col bg-slate-950 text-white">
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-800 px-4 py-3">
        <div className="min-w-0">
          <p className="text-xs font-bold uppercase tracking-wider text-indigo-300">
            Raumplan bearbeiten
          </p>
          <h2 className="truncate text-xl font-black">{area.name}</h2>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onClose}
            className="min-h-11 rounded-xl border border-slate-700 bg-slate-800 px-4 font-bold text-slate-200 hover:bg-slate-700"
          >
            Abbrechen
          </button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={isSaving}
            className="flex min-h-11 items-center gap-2 rounded-xl bg-indigo-500 px-4 font-black text-white hover:bg-indigo-400 disabled:opacity-50"
          >
            <Save className="h-4 w-4" aria-hidden="true" />
            {isSaving ? "Speichert …" : "Plan speichern"}
          </button>
        </div>
      </header>

      {error ? (
        <p
          role="alert"
          className="m-3 rounded-xl border border-rose-500/50 bg-rose-500/10 px-4 py-3 text-sm font-bold text-rose-200"
        >
          {error}
        </p>
      ) : null}

      <div className="grid min-h-0 flex-1 lg:grid-cols-[190px_minmax(0,1fr)_270px]">
        <aside className="overflow-x-auto border-b border-slate-800 bg-slate-900 p-3 lg:overflow-y-auto lg:border-b-0 lg:border-r">
          <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-400">
            Elemente
          </h3>
          <div className="flex gap-2 lg:flex-col">
            {PALETTE.map(({ kind, label, icon: Icon }) => (
              <button
                key={kind}
                type="button"
                onClick={() => addElement(kind)}
                className="flex min-h-11 shrink-0 items-center gap-2 rounded-xl border border-slate-700 bg-slate-800 px-3 text-sm font-bold text-slate-200 hover:border-indigo-400 hover:bg-slate-700"
              >
                <Icon className="h-4 w-4 text-indigo-300" aria-hidden="true" />
                {label}
              </button>
            ))}
          </div>
        </aside>

        <main className="min-h-0 overflow-auto bg-slate-950 p-3 touch-pan-x touch-pan-y">
          <div
            className="relative mx-auto min-w-[700px] max-w-[1100px] overflow-hidden rounded-2xl border border-slate-700 bg-[radial-gradient(circle_at_center,_rgba(148,163,184,0.16)_1px,_transparent_1px)] bg-[length:24px_24px] shadow-inner"
            style={{ aspectRatio: "10 / 7" }}
            aria-label={`Arbeitsfläche für ${area.name}`}
          >
            {elements.map((element) => {
              const isTable = TABLE_KINDS.has(element.kind);
              return (
                <button
                  key={element.id}
                  type="button"
                  onPointerDown={(event) => {
                    setSelectedId(element.id);
                    setDraggingId(element.id);
                    event.currentTarget.setPointerCapture(event.pointerId);
                  }}
                  onPointerMove={(event) => moveElement(event, element)}
                  onPointerUp={(event) => {
                    setDraggingId(null);
                    event.currentTarget.releasePointerCapture(event.pointerId);
                  }}
                  style={{
                    left: `${(element.x / 1000) * 100}%`,
                    top: `${(element.y / 700) * 100}%`,
                    width: `${(element.width / 1000) * 100}%`,
                    height: `${(element.height / 700) * 100}%`,
                    transform: `rotate(${element.rotation}deg)`,
                  }}
                  className={`absolute flex min-h-10 min-w-10 touch-none items-center justify-center border-2 px-1 text-center text-xs font-black shadow-lg ${
                    selectedId === element.id
                      ? "z-10 border-white bg-indigo-500 text-white outline outline-4 outline-indigo-400/30"
                      : isTable
                        ? "border-indigo-300 bg-indigo-950 text-indigo-100"
                        : "border-slate-500 bg-slate-800 text-slate-200"
                  } ${element.kind === "TABLE_ROUND" ? "rounded-full" : "rounded-xl"}`}
                  aria-label={`${element.label} verschieben`}
                >
                  <Grab
                    className="mr-1 h-3 w-3 shrink-0 opacity-60"
                    aria-hidden="true"
                  />
                  <span className="truncate">{element.label}</span>
                </button>
              );
            })}
            {elements.length === 0 ? (
              <div className="absolute inset-0 flex items-center justify-center p-8 text-center text-sm text-slate-500">
                Wähle links ein Element. Danach kannst du es auf dem Plan
                verschieben und rechts benennen.
              </div>
            ) : null}
          </div>
        </main>

        <aside className="overflow-y-auto border-t border-slate-800 bg-slate-900 p-4 lg:border-l lg:border-t-0">
          {selected ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="font-black">Element bearbeiten</h3>
                <button
                  type="button"
                  onClick={() => setSelectedId(null)}
                  className="flex min-h-11 min-w-11 items-center justify-center rounded-xl text-slate-400 hover:bg-slate-800"
                  aria-label="Auswahl schließen"
                >
                  <X className="h-5 w-5" aria-hidden="true" />
                </button>
              </div>
              <label className="block text-sm font-bold text-slate-300">
                Beschriftung
                <input
                  value={selected.label}
                  maxLength={80}
                  onChange={(event) =>
                    updateSelected({ label: event.target.value })
                  }
                  className="mt-1 min-h-11 w-full rounded-xl border border-slate-700 bg-slate-800 px-3 text-white"
                />
              </label>
              {TABLE_KINDS.has(selected.kind) ? (
                <label className="block text-sm font-bold text-slate-300">
                  Tischbezeichnung für Bestellungen
                  <input
                    value={selected.tableName ?? ""}
                    maxLength={80}
                    onChange={(event) =>
                      updateSelected({ tableName: event.target.value })
                    }
                    className="mt-1 min-h-11 w-full rounded-xl border border-slate-700 bg-slate-800 px-3 text-white"
                  />
                </label>
              ) : null}
              <div className="grid grid-cols-2 gap-3">
                <label className="text-xs font-bold text-slate-400">
                  Breite
                  <input
                    type="number"
                    min="40"
                    max="400"
                    value={selected.width}
                    onChange={(event) =>
                      updateSelected({ width: Number(event.target.value) })
                    }
                    className="mt-1 min-h-11 w-full rounded-xl border border-slate-700 bg-slate-800 px-2 text-white"
                  />
                </label>
                <label className="text-xs font-bold text-slate-400">
                  Höhe
                  <input
                    type="number"
                    min="40"
                    max="300"
                    value={selected.height}
                    onChange={(event) =>
                      updateSelected({ height: Number(event.target.value) })
                    }
                    className="mt-1 min-h-11 w-full rounded-xl border border-slate-700 bg-slate-800 px-2 text-white"
                  />
                </label>
              </div>
              <label className="block text-sm font-bold text-slate-300">
                Drehung: {selected.rotation}°
                <input
                  type="range"
                  min="-180"
                  max="180"
                  step="15"
                  value={selected.rotation}
                  onChange={(event) =>
                    updateSelected({ rotation: Number(event.target.value) })
                  }
                  className="mt-2 min-h-11 w-full accent-indigo-400"
                />
              </label>
              <button
                type="button"
                onClick={deleteSelected}
                className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-rose-500/40 bg-rose-500/10 font-bold text-rose-200 hover:bg-rose-500/20"
              >
                <Trash2 className="h-4 w-4" aria-hidden="true" />
                Element entfernen
              </button>
            </div>
          ) : (
            <p className="text-sm leading-relaxed text-slate-400">
              Tippe ein Element im Plan an, um Beschriftung, Größe und Drehung
              zu bearbeiten.
            </p>
          )}
        </aside>
      </div>
    </div>
  );
};
