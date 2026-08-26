import { useState } from "react";
import { ArrowUp, ArrowDown } from "lucide-react";

/**
 * Pflege der Auswahlgruppen (Issue #75) im Produktmodal der Verwaltung.
 *
 * Bedienkonzept: docs/product/produktoptionen-bedienkonzept.md, Abschnitt
 * "Verwaltungsmaske". Schnittstelle: docs/development/produktoptionen-schnittstelle.md,
 * Abschnitte "Nutzlast der Pflege" und "Prüfungen im Backend". Datenmodell:
 * docs/development/produktoptionen-datenmodell.md.
 *
 * Formularzustand hält je Gruppe/Antwort eine stabile `clientId` (unabhängig
 * von der Datenbank-`id`), damit neue, noch nicht gespeicherte Einträge eine
 * React-Key haben und beim Speichern zuverlässig von bestehenden Einträgen
 * unterschieden werden können (siehe `buildOptionGroupsPayload`).
 */

export type OptionFormState = {
  clientId: string;
  id?: string;
  name: string;
  euro: string;
  cent: string;
  /** Nur für Aufpreis-Gruppen bedienbar: true = Abschlag (negativer Aufpreis). */
  negative: boolean;
  isActive: boolean;
};

export type OptionGroupFormState = {
  clientId: string;
  id?: string;
  name: string;
  selectionType: "SINGLE" | "MULTIPLE";
  isRequired: boolean;
  minSelect?: number;
  maxSelect?: number | null;
  priceMode: "ABSOLUTE" | "SURCHARGE";
  quickSaleTiles: boolean;
  options: OptionFormState[];
};

const MAX_GROUPS = 10;
const MAX_OPTIONS = 20;

const newClientId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `tmp-${Date.now()}-${Math.random().toString(16).slice(2)}`;

/**
 * "Legt Endpreis fest" und "Im Schnellverkauf eigene Kacheln je Antwort"
 * setzen beide Pflicht + Einfachauswahl voraus (Datenbank-CHECKs). Wird eine
 * Gruppe auf freiwillig oder Mehrfachauswahl umgestellt, müssen beide Felder
 * zwangsläufig zurückgesetzt werden, sonst würde ein späterer Speichern-Klick
 * an der Datenbank scheitern, ohne dass die Maske das vorher gezeigt hätte.
 */
const canBeAbsoluteOrQuickSale = (group: OptionGroupFormState): boolean =>
  group.isRequired && group.selectionType === "SINGLE";

const clampGroupToConstraints = (
  group: OptionGroupFormState,
): OptionGroupFormState => {
  const next = { ...group };
  const activeCount = next.options.filter((o) => o.isActive !== false).length;

  if (next.selectionType === "SINGLE") {
    next.minSelect = next.isRequired ? 1 : 0;
    next.maxSelect = 1;
    if (!canBeAbsoluteOrQuickSale(next)) {
      next.priceMode = "SURCHARGE";
      next.quickSaleTiles = false;
    }
  } else {
    // MULTIPLE
    next.priceMode = "SURCHARGE";
    next.quickSaleTiles = false;

    if (!next.isRequired) {
      next.minSelect = 0;
    } else {
      const currentMin = next.minSelect ?? 1;
      next.minSelect = Math.max(1, currentMin);
    }

    if (next.maxSelect != null) {
      if (next.maxSelect < (next.minSelect ?? 0)) {
        next.maxSelect = next.minSelect ?? 1;
      }
      if (activeCount > 0 && next.maxSelect > activeCount) {
        next.maxSelect = activeCount;
      }
    }

    if (
      next.isRequired &&
      activeCount > 0 &&
      (next.minSelect ?? 1) > activeCount
    ) {
      next.minSelect = activeCount;
      if (next.maxSelect != null && next.maxSelect < next.minSelect) {
        next.maxSelect = next.minSelect;
      }
    }
  }

  return next;
};

// eslint-disable-next-line react-refresh/only-export-components -- Formular-Helfer werden von AdminDashboard.tsx importiert, nicht nur hier gerendert.
export const newOptionGroup = (): OptionGroupFormState => ({
  clientId: newClientId(),
  name: "",
  selectionType: "SINGLE",
  isRequired: true,
  minSelect: 1,
  maxSelect: 1,
  priceMode: "SURCHARGE",
  quickSaleTiles: false,
  options: [],
});

const newOption = (): OptionFormState => ({
  clientId: newClientId(),
  name: "",
  euro: "0",
  cent: "00",
  negative: false,
  isActive: true,
});

/** Lädt die vom Backend gelieferten `optionGroups` eines Produkts in den Formularzustand. */
// eslint-disable-next-line react-refresh/only-export-components -- Formular-Helfer werden von AdminDashboard.tsx importiert, nicht nur hier gerendert.
export const loadOptionGroupsFromProduct = (
  product: any,
): OptionGroupFormState[] => {
  const groups = Array.isArray(product?.optionGroups)
    ? product.optionGroups
    : [];
  return groups.map((g: any): OptionGroupFormState => {
    const isRequired = !!g.isRequired;
    const isSingle = g.selectionType !== "MULTIPLE";
    const minSelect = Number.isInteger(g.minSelect)
      ? g.minSelect
      : isRequired
        ? 1
        : 0;
    const maxSelect = isSingle
      ? 1
      : Number.isInteger(g.maxSelect)
        ? g.maxSelect
        : null;

    return {
      clientId: newClientId(),
      id: g.id,
      name: g.name || "",
      selectionType: isSingle ? "SINGLE" : "MULTIPLE",
      isRequired,
      minSelect,
      maxSelect,
      priceMode: g.priceMode === "ABSOLUTE" ? "ABSOLUTE" : "SURCHARGE",
      quickSaleTiles: !!g.quickSaleTiles,
      options: Array.isArray(g.options)
        ? g.options.map((o: any): OptionFormState => {
            const cents = Number.isInteger(o.priceEffect) ? o.priceEffect : 0;
            const abs = Math.abs(cents);
            return {
              clientId: newClientId(),
              id: o.id,
              name: o.name || "",
              euro: String(Math.floor(abs / 100)),
              cent: String(abs % 100).padStart(2, "0"),
              negative: cents < 0,
              isActive: o.isActive !== false,
            };
          })
        : [],
    };
  });
};

/**
 * Baut die Nutzlast `optionGroups` für POST/PATCH `/products`. Vorhandene
 * Kennungen (`id`) bleiben erhalten, neue Einträge werden ohne `id`
 * gesendet — Bestellungen verweisen auf `ProductOption.id`
 * (produktoptionen-schnittstelle.md, "Nutzlast der Pflege").
 */
// eslint-disable-next-line react-refresh/only-export-components -- Formular-Helfer werden von AdminDashboard.tsx importiert, nicht nur hier gerendert.
export const buildOptionGroupsPayload = (groups: OptionGroupFormState[]) =>
  groups.map((g, groupIndex) => {
    const isSingle = g.selectionType === "SINGLE";
    const minSelect = isSingle
      ? g.isRequired
        ? 1
        : 0
      : g.isRequired
        ? Math.max(1, g.minSelect ?? 1)
        : 0;
    const maxSelect = isSingle
      ? 1
      : g.maxSelect != null && g.maxSelect >= (g.isRequired ? minSelect : 1)
        ? g.maxSelect
        : null;

    return {
      ...(g.id ? { id: g.id } : {}),
      name: g.name.trim(),
      selectionType: g.selectionType,
      isRequired: g.isRequired,
      minSelect,
      maxSelect,
      priceMode: g.priceMode,
      quickSaleTiles: g.quickSaleTiles,
      sortOrder: groupIndex,
      options: g.options.map((o, optionIndex) => {
        const euro = Number(o.euro) || 0;
        const cent = Number(o.cent) || 0;
        const magnitude = euro * 100 + cent;
        return {
          ...(o.id ? { id: o.id } : {}),
          name: o.name.trim(),
          priceEffect:
            g.priceMode === "SURCHARGE" && o.negative ? -magnitude : magnitude,
          isActive: o.isActive,
          sortOrder: optionIndex,
        };
      }),
    };
  });

/** Gruppen ohne jede Antwort — an der Kasse unbrauchbar, blockiert das Speichern (Entscheidung 4). */
// eslint-disable-next-line react-refresh/only-export-components -- Formular-Helfer werden von AdminDashboard.tsx importiert, nicht nur hier gerendert.
export const findEmptyGroupIds = (
  groups: OptionGroupFormState[],
): Set<string> =>
  new Set(groups.filter((g) => g.options.length === 0).map((g) => g.clientId));

/**
 * Preisprüfung je Antwort — dasselbe Muster wie die bestehende Prüfung des
 * Produktpreises in `handleSaveProductModal` (Euro/Cent je eine
 * nichtnegative ganze Zahl, Cent 0–99). `Number("2,50")` (Komma statt
 * Punkt, der wahrscheinlichste Tippfehler) ergibt `NaN` und darf niemals
 * lautlos zu 0 werden — die Antwort wäre sonst ungewollt kostenlos, ohne
 * dass das beim Speichern auffällt.
 */
const isValidPriceComponent = (value: string): boolean =>
  /^\d+$/.test(value.trim());

const isOptionPriceValid = (o: OptionFormState): boolean =>
  isValidPriceComponent(o.euro) &&
  isValidPriceComponent(o.cent) &&
  Number(o.cent) <= 99;

/** Antworten mit ungültiger oder leerer Preiseingabe — blockiert das Speichern. */
// eslint-disable-next-line react-refresh/only-export-components -- Formular-Helfer werden von AdminDashboard.tsx importiert, nicht nur hier gerendert.
export const findInvalidPriceOptionIds = (
  groups: OptionGroupFormState[],
): Set<string> =>
  new Set(
    groups.flatMap((g) =>
      g.options.filter((o) => !isOptionPriceValid(o)).map((o) => o.clientId),
    ),
  );

/**
 * Zusammenfassende `modalError`-Meldung für die erste Antwort mit
 * ungültigem Preis. Nennt den Namen ausdrücklich, sonst sucht man ihn unter
 * bis zu 200 Preisfeldern.
 */
// eslint-disable-next-line react-refresh/only-export-components -- Formular-Helfer werden von AdminDashboard.tsx importiert, nicht nur hier gerendert.
export const findFirstInvalidPriceError = (
  groups: OptionGroupFormState[],
): string | null => {
  for (const g of groups) {
    const invalid = g.options.find((o) => !isOptionPriceValid(o));
    if (invalid) {
      const name = invalid.name.trim() || "diese Antwort";
      return `Bitte prüfe die Preisangaben in den markierten Antworten, zuerst bei „${name}".`;
    }
  }
  return null;
};

const findDuplicateGroupNameIds = (
  groups: OptionGroupFormState[],
): Set<string> => {
  const counts = new Map<string, number>();
  groups.forEach((g) => {
    const key = g.name.trim();
    if (!key) return;
    counts.set(key, (counts.get(key) || 0) + 1);
  });
  return new Set(
    groups
      .filter((g) => {
        const key = g.name.trim();
        return key.length > 0 && (counts.get(key) || 0) > 1;
      })
      .map((g) => g.clientId),
  );
};

const findDuplicateOptionNameIds = (
  group: OptionGroupFormState,
): Set<string> => {
  const counts = new Map<string, number>();
  group.options.forEach((o) => {
    const key = o.name.trim();
    if (!key) return;
    counts.set(key, (counts.get(key) || 0) + 1);
  });
  return new Set(
    group.options
      .filter((o) => {
        const key = o.name.trim();
        return key.length > 0 && (counts.get(key) || 0) > 1;
      })
      .map((o) => o.clientId),
  );
};

/**
 * Findet den ersten doppelten Namen (Gruppe oder Antwort) für die
 * zusammenfassende `modalError`-Meldung. Die Meldung übernimmt wörtlich den
 * Text aus der Backend-Prüfung (produktoptionen-schnittstelle.md), damit
 * Formular und Backend dieselbe Sprache sprechen.
 */
// eslint-disable-next-line react-refresh/only-export-components -- Formular-Helfer werden von AdminDashboard.tsx importiert, nicht nur hier gerendert.
export const findFirstDuplicateNameError = (
  groups: OptionGroupFormState[],
): string | null => {
  const duplicateGroupIds = findDuplicateGroupNameIds(groups);
  if (duplicateGroupIds.size > 0) {
    const dup = groups.find((g) => duplicateGroupIds.has(g.clientId));
    if (dup) return `Der Name „${dup.name.trim()}" kommt zweimal vor.`;
  }
  for (const g of groups) {
    const duplicateOptionIds = findDuplicateOptionNameIds(g);
    if (duplicateOptionIds.size > 0) {
      const dup = g.options.find((o) => duplicateOptionIds.has(o.clientId));
      if (dup) return `Der Name „${dup.name.trim()}" kommt zweimal vor.`;
    }
  }
  return null;
};

function ToggleButton({
  active,
  onClick,
  disabled,
  children,
}: {
  active: boolean;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={`min-h-11 px-3 text-sm font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
        active
          ? "bg-indigo-600 text-white"
          : "bg-slate-800 text-slate-300 hover:bg-slate-700"
      }`}
    >
      {children}
    </button>
  );
}

export function ProductOptionGroupsEditor({
  groups,
  onChange,
  disabled,
  validationAttempted,
}: {
  groups: OptionGroupFormState[];
  onChange: (groups: OptionGroupFormState[]) => void;
  disabled?: boolean;
  validationAttempted?: boolean;
}) {
  const [pendingDelete, setPendingDelete] = useState<{
    groupClientId: string;
    optionClientId: string;
    name: string;
  } | null>(null);

  const hasAbsoluteGroup = groups.some((g) => g.priceMode === "ABSOLUTE");
  const emptyGroupIds = validationAttempted
    ? findEmptyGroupIds(groups)
    : new Set<string>();
  const duplicateGroupIds = validationAttempted
    ? findDuplicateGroupNameIds(groups)
    : new Set<string>();
  const invalidPriceOptionIds = validationAttempted
    ? findInvalidPriceOptionIds(groups)
    : new Set<string>();

  const updateGroup = (
    clientId: string,
    patch: Partial<OptionGroupFormState>,
  ) => {
    onChange(
      groups.map((g) =>
        g.clientId === clientId
          ? clampGroupToConstraints({ ...g, ...patch })
          : g,
      ),
    );
  };

  const setGroupPriceMode = (
    clientId: string,
    mode: "ABSOLUTE" | "SURCHARGE",
  ) => {
    onChange(
      groups.map((g) => {
        if (g.clientId === clientId) return { ...g, priceMode: mode };
        // Höchstens eine Gruppe je Produkt darf den Endpreis festlegen.
        if (mode === "ABSOLUTE" && g.priceMode === "ABSOLUTE") {
          return { ...g, priceMode: "SURCHARGE" };
        }
        return g;
      }),
    );
  };

  const setGroupQuickSaleTiles = (clientId: string, value: boolean) => {
    onChange(
      groups.map((g) => {
        if (g.clientId === clientId) return { ...g, quickSaleTiles: value };
        // Höchstens eine Gruppe je Produkt darf die Kachel-Marke tragen.
        if (value && g.quickSaleTiles) return { ...g, quickSaleTiles: false };
        return g;
      }),
    );
  };

  const moveGroup = (clientId: string, direction: -1 | 1) => {
    const index = groups.findIndex((g) => g.clientId === clientId);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= groups.length) return;
    const next = groups.slice();
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  };

  const removeGroup = (clientId: string) => {
    onChange(groups.filter((g) => g.clientId !== clientId));
  };

  const addGroup = () => {
    if (groups.length >= MAX_GROUPS) return;
    onChange([...groups, newOptionGroup()]);
  };

  const addOption = (groupClientId: string) => {
    onChange(
      groups.map((g) =>
        g.clientId === groupClientId && g.options.length < MAX_OPTIONS
          ? { ...g, options: [...g.options, newOption()] }
          : g,
      ),
    );
  };

  const updateOption = (
    groupClientId: string,
    optionClientId: string,
    patch: Partial<OptionFormState>,
  ) => {
    onChange(
      groups.map((g) =>
        g.clientId !== groupClientId
          ? g
          : {
              ...g,
              options: g.options.map((o) =>
                o.clientId === optionClientId ? { ...o, ...patch } : o,
              ),
            },
      ),
    );
  };

  const moveOption = (
    groupClientId: string,
    optionClientId: string,
    direction: -1 | 1,
  ) => {
    onChange(
      groups.map((g) => {
        if (g.clientId !== groupClientId) return g;
        const index = g.options.findIndex((o) => o.clientId === optionClientId);
        const target = index + direction;
        if (index < 0 || target < 0 || target >= g.options.length) return g;
        const nextOptions = g.options.slice();
        [nextOptions[index], nextOptions[target]] = [
          nextOptions[target],
          nextOptions[index],
        ];
        return { ...g, options: nextOptions };
      }),
    );
  };

  const requestRemoveOption = (
    groupClientId: string,
    optionClientId: string,
    name: string,
  ) => {
    setPendingDelete({ groupClientId, optionClientId, name });
  };

  const confirmRemoveOption = () => {
    if (!pendingDelete) return;
    const { groupClientId, optionClientId } = pendingDelete;
    onChange(
      groups.map((g) =>
        g.clientId !== groupClientId
          ? g
          : {
              ...g,
              options: g.options.filter((o) => o.clientId !== optionClientId),
            },
      ),
    );
    setPendingDelete(null);
  };

  return (
    <div className="space-y-3">
      {groups.length === 0 && (
        <p className="text-sm text-slate-500">
          Noch keine Auswahlgruppen angelegt.
        </p>
      )}

      {groups.map((g, groupIndex) => {
        const requiredSingle = canBeAbsoluteOrQuickSale(g);
        const quickSaleAllowed =
          requiredSingle && (!hasAbsoluteGroup || g.priceMode === "ABSOLUTE");
        const isEmpty = emptyGroupIds.has(g.clientId);
        const isDuplicateName = duplicateGroupIds.has(g.clientId);
        const duplicateOptionIds = validationAttempted
          ? findDuplicateOptionNameIds(g)
          : new Set<string>();
        const priceEuroLabel =
          g.priceMode === "ABSOLUTE" ? "Preis in EUR" : "Aufpreis in EUR";
        const priceCentLabel =
          g.priceMode === "ABSOLUTE" ? "Preis in Cent" : "Aufpreis in Cent";

        return (
          <div
            key={g.clientId}
            className={`rounded-2xl border p-4 space-y-3 ${
              isEmpty || isDuplicateName
                ? "border-rose-500/50 bg-rose-500/10"
                : "border-slate-700 bg-slate-800/40"
            }`}
          >
            <div className="flex items-start gap-2">
              <div className="flex-1">
                <label
                  htmlFor={`group-name-${g.clientId}`}
                  className="text-xs font-bold text-slate-400 block mb-1"
                >
                  Name der Gruppe
                </label>
                <input
                  id={`group-name-${g.clientId}`}
                  type="text"
                  required
                  disabled={disabled}
                  value={g.name}
                  onChange={(e) =>
                    updateGroup(g.clientId, { name: e.target.value })
                  }
                  className="w-full min-h-11 bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 text-white"
                />
                {isDuplicateName && (
                  <p role="alert" className="text-xs text-rose-300 mt-1">
                    Der Name „{g.name.trim()}" kommt zweimal vor.
                  </p>
                )}
              </div>
              <div className="flex gap-1 pt-6 shrink-0">
                <button
                  type="button"
                  aria-label={`${g.name || "Auswahlgruppe"} nach oben verschieben`}
                  disabled={disabled || groupIndex === 0}
                  onClick={() => moveGroup(g.clientId, -1)}
                  className="min-w-11 min-h-11 flex items-center justify-center rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <ArrowUp className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  aria-label={`${g.name || "Auswahlgruppe"} nach unten verschieben`}
                  disabled={disabled || groupIndex === groups.length - 1}
                  onClick={() => moveGroup(g.clientId, 1)}
                  className="min-w-11 min-h-11 flex items-center justify-center rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <ArrowDown className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => removeGroup(g.clientId)}
                  className="min-h-11 px-3 rounded-xl bg-rose-500/20 hover:bg-rose-500/40 text-rose-300 font-bold text-sm disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Entfernen
                </button>
              </div>
            </div>

            <div className="flex flex-wrap gap-3">
              <div className="inline-flex rounded-xl border border-slate-700 overflow-hidden">
                <ToggleButton
                  active={g.isRequired}
                  disabled={disabled}
                  onClick={() => updateGroup(g.clientId, { isRequired: true })}
                >
                  Pflicht
                </ToggleButton>
                <ToggleButton
                  active={!g.isRequired}
                  disabled={disabled}
                  onClick={() => updateGroup(g.clientId, { isRequired: false })}
                >
                  Freiwillig
                </ToggleButton>
              </div>
              <div className="inline-flex rounded-xl border border-slate-700 overflow-hidden">
                <ToggleButton
                  active={g.selectionType === "SINGLE"}
                  disabled={disabled}
                  onClick={() =>
                    updateGroup(g.clientId, { selectionType: "SINGLE" })
                  }
                >
                  Einfachauswahl
                </ToggleButton>
                <ToggleButton
                  active={g.selectionType === "MULTIPLE"}
                  disabled={disabled}
                  onClick={() =>
                    updateGroup(g.clientId, { selectionType: "MULTIPLE" })
                  }
                >
                  Mehrfachauswahl
                </ToggleButton>
              </div>
            </div>

            {g.selectionType === "MULTIPLE" && (
              <div className="rounded-xl border border-slate-700/80 bg-slate-900/60 p-3 space-y-3">
                <p className="text-xs font-bold text-slate-300">
                  Auswahlgrenzen bei Mehrfachauswahl
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label
                      htmlFor={`group-min-select-${g.clientId}`}
                      className="text-xs font-semibold text-slate-400 block mb-1"
                    >
                      Mindestanzahl{" "}
                      {g.isRequired ? "(mind. 1)" : "(Freiwillig: 0)"}
                    </label>
                    {g.isRequired ? (
                      <input
                        id={`group-min-select-${g.clientId}`}
                        type="number"
                        min={1}
                        max={
                          g.maxSelect ??
                          Math.max(
                            1,
                            g.options.filter((o) => o.isActive !== false)
                              .length,
                          )
                        }
                        disabled={disabled}
                        value={g.minSelect ?? 1}
                        onChange={(e) => {
                          const parsed = parseInt(e.target.value, 10);
                          const val = Math.max(1, isNaN(parsed) ? 1 : parsed);
                          const activeCount = g.options.filter(
                            (o) => o.isActive !== false,
                          ).length;
                          const clamped =
                            activeCount > 0 ? Math.min(val, activeCount) : val;
                          let nextMax = g.maxSelect;
                          if (nextMax != null && nextMax < clamped) {
                            nextMax = clamped;
                          }
                          updateGroup(g.clientId, {
                            minSelect: clamped,
                            maxSelect: nextMax,
                          });
                        }}
                        className="w-full min-h-11 bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-white text-sm"
                      />
                    ) : (
                      <input
                        id={`group-min-select-${g.clientId}`}
                        type="number"
                        disabled
                        value={0}
                        className="w-full min-h-11 bg-slate-800/50 border border-slate-700/50 rounded-xl px-3 py-2 text-slate-400 text-sm cursor-not-allowed"
                      />
                    )}
                    <p className="text-xs text-slate-500 mt-1">
                      {g.isRequired
                        ? "Wie viele Antworten an der Kasse mindestens gewählt werden müssen."
                        : "Bei freiwilligen Gruppen ist die Mindestanzahl immer 0."}
                    </p>
                  </div>

                  <div>
                    <label
                      htmlFor={`group-max-select-mode-${g.clientId}`}
                      className="text-xs font-semibold text-slate-400 block mb-1"
                    >
                      Höchstanzahl
                    </label>
                    <div className="flex items-center gap-2">
                      <select
                        id={`group-max-select-mode-${g.clientId}`}
                        disabled={disabled}
                        value={g.maxSelect != null ? "LIMITED" : "UNLIMITED"}
                        onChange={(e) => {
                          if (e.target.value === "UNLIMITED") {
                            updateGroup(g.clientId, { maxSelect: null });
                          } else {
                            const min = g.isRequired ? (g.minSelect ?? 1) : 1;
                            updateGroup(g.clientId, {
                              maxSelect: Math.max(1, min),
                            });
                          }
                        }}
                        className="min-h-11 bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-white text-sm"
                      >
                        <option value="UNLIMITED">Keine Obergrenze</option>
                        <option value="LIMITED">Begrenzen auf</option>
                      </select>
                      {g.maxSelect != null && (
                        <input
                          id={`group-max-select-${g.clientId}`}
                          type="number"
                          min={g.isRequired ? (g.minSelect ?? 1) : 1}
                          max={Math.max(
                            1,
                            g.options.filter((o) => o.isActive !== false)
                              .length,
                          )}
                          disabled={disabled}
                          aria-label="Höchstanzahl der Antworten"
                          value={g.maxSelect}
                          onChange={(e) => {
                            const min = g.isRequired ? (g.minSelect ?? 1) : 1;
                            const parsed = parseInt(e.target.value, 10);
                            const val = Math.max(
                              min,
                              isNaN(parsed) ? min : parsed,
                            );
                            const activeCount = g.options.filter(
                              (o) => o.isActive !== false,
                            ).length;
                            const clamped =
                              activeCount > 0
                                ? Math.min(val, activeCount)
                                : val;
                            updateGroup(g.clientId, { maxSelect: clamped });
                          }}
                          className="w-20 min-h-11 bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-white text-sm"
                        />
                      )}
                    </div>
                    <p className="text-xs text-slate-500 mt-1">
                      {g.maxSelect != null
                        ? `Maximal ${g.maxSelect} Antwort${g.maxSelect === 1 ? "" : "en"} auswählbar.`
                        : "Beliebig viele Antworten auswählbar."}
                    </p>
                  </div>
                </div>
              </div>
            )}

            <div>
              <label
                htmlFor={`group-price-mode-${g.clientId}`}
                className="text-xs font-bold text-slate-400 block mb-1"
              >
                Preisart
              </label>
              <select
                id={`group-price-mode-${g.clientId}`}
                disabled={disabled || !requiredSingle}
                value={g.priceMode}
                onChange={(e) =>
                  setGroupPriceMode(
                    g.clientId,
                    e.target.value as "ABSOLUTE" | "SURCHARGE",
                  )
                }
                className="w-full min-h-11 bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 text-white disabled:cursor-not-allowed disabled:opacity-60"
              >
                <option value="SURCHARGE">Aufpreis je Antwort</option>
                <option value="ABSOLUTE">Legt Endpreis fest</option>
              </select>
              {!requiredSingle && (
                <p className="text-xs text-slate-500 mt-1">
                  Bei Mehrfachauswahl immer Aufpreis je Antwort.
                </p>
              )}
            </div>

            <div>
              <label className="flex items-center gap-2 text-sm text-slate-300">
                <input
                  type="checkbox"
                  disabled={disabled || !quickSaleAllowed}
                  checked={g.quickSaleTiles}
                  onChange={(e) =>
                    setGroupQuickSaleTiles(g.clientId, e.target.checked)
                  }
                  className="w-5 h-5 rounded border-slate-700 bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                />
                Im Schnellverkauf eigene Kacheln je Antwort
              </label>
              {!quickSaleAllowed && (
                <p className="text-xs text-slate-500 mt-1">
                  {!requiredSingle
                    ? "Nur bei einer Pflichtgruppe mit Einfachauswahl möglich."
                    : "Die Kacheln im Schnellverkauf gehören an die Gruppe, die den Endpreis festlegt."}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <p className="text-xs font-bold text-slate-400">Antworten</p>
              {g.options.map((o, optionIndex) => {
                const isDuplicateOptionName = duplicateOptionIds.has(
                  o.clientId,
                );
                const isInvalidPrice = invalidPriceOptionIds.has(o.clientId);
                return (
                  <div
                    key={o.clientId}
                    className={`rounded-xl border p-3 space-y-2 ${
                      isDuplicateOptionName || isInvalidPrice
                        ? "border-rose-500/50 bg-rose-500/10"
                        : "border-slate-700 bg-slate-900/40"
                    }`}
                  >
                    <div className="flex items-center gap-2 flex-wrap">
                      <input
                        type="text"
                        required
                        disabled={disabled}
                        placeholder="Bezeichnung"
                        aria-label="Bezeichnung"
                        value={o.name}
                        onChange={(e) =>
                          updateOption(g.clientId, o.clientId, {
                            name: e.target.value,
                          })
                        }
                        className="flex-1 min-w-[10rem] min-h-11 bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 text-white"
                      />
                      {!o.isActive && (
                        <span className="text-xs font-bold text-amber-300 bg-amber-500/10 border border-amber-500/30 px-2 py-1 rounded-lg">
                          Inaktiv
                        </span>
                      )}
                      {!o.isActive && (
                        <button
                          type="button"
                          disabled={disabled}
                          onClick={() =>
                            updateOption(g.clientId, o.clientId, {
                              isActive: true,
                            })
                          }
                          className="text-xs font-bold text-emerald-300 hover:text-emerald-200 underline disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          Wieder aktivieren
                        </button>
                      )}
                    </div>
                    {isDuplicateOptionName && (
                      <p role="alert" className="text-xs text-rose-300">
                        Der Name „{o.name.trim()}" kommt zweimal vor.
                      </p>
                    )}
                    {isInvalidPrice && (
                      <p role="alert" className="text-xs text-rose-300">
                        Euro muss eine nichtnegative ganze Zahl und Cent ein
                        Wert von 0 bis 99 sein.
                      </p>
                    )}
                    <div className="flex flex-wrap items-end gap-2">
                      {g.priceMode === "SURCHARGE" && (
                        <div className="inline-flex rounded-xl border border-slate-700 overflow-hidden shrink-0">
                          <button
                            type="button"
                            aria-pressed={!o.negative}
                            aria-label="Aufpreis (positiv)"
                            disabled={disabled}
                            onClick={() =>
                              updateOption(g.clientId, o.clientId, {
                                negative: false,
                              })
                            }
                            className={`min-w-11 min-h-11 text-sm font-bold disabled:cursor-not-allowed disabled:opacity-60 ${
                              !o.negative
                                ? "bg-indigo-600 text-white"
                                : "bg-slate-800 text-slate-300 hover:bg-slate-700"
                            }`}
                          >
                            +
                          </button>
                          <button
                            type="button"
                            aria-pressed={o.negative}
                            aria-label="Abschlag (negativ)"
                            disabled={disabled}
                            onClick={() =>
                              updateOption(g.clientId, o.clientId, {
                                negative: true,
                              })
                            }
                            className={`min-w-11 min-h-11 text-sm font-bold disabled:cursor-not-allowed disabled:opacity-60 ${
                              o.negative
                                ? "bg-indigo-600 text-white"
                                : "bg-slate-800 text-slate-300 hover:bg-slate-700"
                            }`}
                          >
                            −
                          </button>
                        </div>
                      )}
                      <div>
                        <label
                          htmlFor={`option-euro-${o.clientId}`}
                          className="text-xs text-slate-500 block mb-1"
                        >
                          {priceEuroLabel}
                        </label>
                        <input
                          id={`option-euro-${o.clientId}`}
                          type="number"
                          min="0"
                          step="1"
                          inputMode="numeric"
                          required
                          disabled={disabled}
                          aria-invalid={isInvalidPrice}
                          value={o.euro}
                          onChange={(e) =>
                            updateOption(g.clientId, o.clientId, {
                              euro: e.target.value,
                            })
                          }
                          className={`w-20 min-h-11 bg-slate-800 border rounded-xl px-3 py-2.5 text-white ${
                            isInvalidPrice
                              ? "border-rose-500"
                              : "border-slate-700"
                          }`}
                        />
                      </div>
                      <div>
                        <label
                          htmlFor={`option-cent-${o.clientId}`}
                          className="text-xs text-slate-500 block mb-1"
                        >
                          {priceCentLabel}
                        </label>
                        <input
                          id={`option-cent-${o.clientId}`}
                          type="number"
                          min="0"
                          max="99"
                          step="1"
                          inputMode="numeric"
                          required
                          disabled={disabled}
                          aria-invalid={isInvalidPrice}
                          value={o.cent}
                          onChange={(e) =>
                            updateOption(g.clientId, o.clientId, {
                              cent: e.target.value,
                            })
                          }
                          className={`w-20 min-h-11 bg-slate-800 border rounded-xl px-3 py-2.5 text-white ${
                            isInvalidPrice
                              ? "border-rose-500"
                              : "border-slate-700"
                          }`}
                        />
                      </div>
                      <div className="flex gap-1 ml-auto shrink-0">
                        <button
                          type="button"
                          aria-label={`${o.name || "Antwort"} nach oben verschieben`}
                          disabled={disabled || optionIndex === 0}
                          onClick={() => moveOption(g.clientId, o.clientId, -1)}
                          className="min-w-11 min-h-11 flex items-center justify-center rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          <ArrowUp className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          aria-label={`${o.name || "Antwort"} nach unten verschieben`}
                          disabled={
                            disabled || optionIndex === g.options.length - 1
                          }
                          onClick={() => moveOption(g.clientId, o.clientId, 1)}
                          className="min-w-11 min-h-11 flex items-center justify-center rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          <ArrowDown className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          disabled={disabled}
                          onClick={() =>
                            requestRemoveOption(
                              g.clientId,
                              o.clientId,
                              o.name.trim() || "diese Antwort",
                            )
                          }
                          className="min-h-11 px-3 rounded-xl bg-rose-500/20 hover:bg-rose-500/40 text-rose-300 font-bold text-sm disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          Entfernen
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
              {isEmpty && (
                <p role="alert" className="text-xs text-rose-300">
                  Diese Gruppe braucht mindestens eine Antwort.
                </p>
              )}
              <button
                type="button"
                disabled={disabled || g.options.length >= MAX_OPTIONS}
                onClick={() => addOption(g.clientId)}
                className="min-h-11 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-sm disabled:cursor-not-allowed disabled:opacity-60"
              >
                + Antwort hinzufügen
              </button>
              {g.options.length >= MAX_OPTIONS && (
                <p className="text-xs text-slate-500">
                  Höchstens 20 Antworten je Auswahlgruppe.
                </p>
              )}
            </div>
          </div>
        );
      })}

      <div>
        <button
          type="button"
          disabled={disabled || groups.length >= MAX_GROUPS}
          onClick={addGroup}
          className="min-h-11 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-sm disabled:cursor-not-allowed disabled:opacity-60"
        >
          + Auswahlgruppe hinzufügen
        </button>
        {groups.length >= MAX_GROUPS && (
          <p className="text-xs text-slate-500 mt-1">
            Höchstens 10 Auswahlgruppen je Produkt.
          </p>
        )}
      </div>

      {pendingDelete && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm"
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              setPendingDelete(null);
            }
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-option-title"
            className="bg-slate-900 border border-slate-800 p-6 rounded-3xl max-w-md w-full shadow-2xl space-y-4"
          >
            <h3
              id="delete-option-title"
              className="text-xl font-bold text-white"
            >
              Antwort löschen?
            </h3>
            <p className="text-sm text-slate-300">
              „{pendingDelete.name}" wird aus dieser Gruppe entfernt und steht
              an der Kasse danach nicht mehr zur Auswahl. Bereits abgeschlossene
              Bestellungen zeigen die Bezeichnung unverändert weiter an.
            </p>
            <div className="flex gap-2 justify-end pt-2">
              <button
                type="button"
                onClick={() => setPendingDelete(null)}
                className="min-h-11 px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold"
              >
                Abbrechen
              </button>
              <button
                type="button"
                onClick={confirmRemoveOption}
                className="min-h-11 px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-bold"
              >
                Löschen
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
