import { useEffect, useMemo, useRef, useState } from "react";
import { X, Check, ArrowRight, AlertTriangle } from "lucide-react";

export interface SelectedProductOption {
  id: string;
  name: string;
  priceEffect: number;
  groupId: string;
  groupName: string;
  priceMode: "ABSOLUTE" | "SURCHARGE";
}

interface ProductOptionsModalProps {
  product: any | null;
  isOpen: boolean;
  onClose: () => void;
  onAdd: (product: any, selectedOptions: SelectedProductOption[]) => void;
}

const formatAbsPrice = (cents: number) => `€ ${(cents / 100).toFixed(2)}`;

const formatSurchargeLabel = (cents: number) => {
  if (cents === 0) return "Kostenlos";
  if (cents > 0) return `+ € ${(cents / 100).toFixed(2)}`;
  return `− € ${(Math.abs(cents) / 100).toFixed(2)}`;
};

export const ProductOptionsModal = ({
  product,
  isOpen,
  onClose,
  onAdd,
}: ProductOptionsModalProps) => {
  // Kennung der Gruppe -> Liste der gewählten Antwort-Kennungen.
  const [selections, setSelections] = useState<Record<string, string[]>>({});
  const [errorGroupIds, setErrorGroupIds] = useState<Set<string>>(new Set());
  const [flashGroupId, setFlashGroupId] = useState<string | null>(null);
  const [ariaMessage, setAriaMessage] = useState("");

  const groupRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const firstOptionRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  // Keine stille Vorauswahl: jede Pflichtgruppe startet unbeantwortet.
  useEffect(() => {
    if (isOpen && product) {
      setSelections({});
      setErrorGroupIds(new Set());
      setFlashGroupId(null);
      setAriaMessage("");
    }
  }, [isOpen, product]);

  const groups = useMemo(
    () => (product?.optionGroups as any[]) || [],
    [product],
  );

  // Fehleranzeige einer Gruppe verschwindet automatisch, sobald sie erfüllt ist.
  useEffect(() => {
    setErrorGroupIds((prev) => {
      if (prev.size === 0) return prev;
      const next = new Set<string>();
      prev.forEach((id) => {
        const group = groups.find((g) => g.id === id);
        if (group && (selections[id] || []).length < group.minSelect) {
          next.add(id);
        }
      });
      return next;
    });
  }, [selections, groups]);

  if (!isOpen || !product) return null;

  const missingRequiredGroups = groups.filter(
    (g) => (selections[g.id] || []).length < g.minSelect,
  );

  const absoluteGroup = groups.find((g) => g.priceMode === "ABSOLUTE");
  const absoluteUnanswered =
    !!absoluteGroup && (selections[absoluteGroup.id] || []).length === 0;

  let basePrice = product.price;
  if (absoluteGroup) {
    const selectedId = (selections[absoluteGroup.id] || [])[0];
    const selectedOption = (absoluteGroup.options || []).find(
      (o: any) => o.id === selectedId,
    );
    if (selectedOption) basePrice = selectedOption.priceEffect;
  }

  let surcharge = 0;
  groups.forEach((g) => {
    if (g.priceMode !== "SURCHARGE") return;
    const ids = selections[g.id] || [];
    ids.forEach((id) => {
      const option = (g.options || []).find((o: any) => o.id === id);
      if (option) surcharge += option.priceEffect;
    });
  });
  const total = basePrice + surcharge;

  const selectedOptions: SelectedProductOption[] = groups.flatMap((g) =>
    (selections[g.id] || [])
      .map((id) => {
        const option = (g.options || []).find((o: any) => o.id === id);
        if (!option) return null;
        return {
          id: option.id,
          name: option.name,
          priceEffect: option.priceEffect,
          groupId: g.id,
          groupName: g.name,
          priceMode: g.priceMode,
        } as SelectedProductOption;
      })
      .filter((x): x is SelectedProductOption => x !== null),
  );

  const statusText =
    missingRequiredGroups.length === 0
      ? "Alle Pflichtangaben ausgewählt"
      : missingRequiredGroups.length === 1
        ? `Noch 1 Pflichtangabe offen: ${missingRequiredGroups[0].name}`
        : `Noch ${missingRequiredGroups.length} Pflichtangaben offen: ${missingRequiredGroups.map((g) => g.name).join(", ")}`;

  const mainButtonLabel =
    missingRequiredGroups.length > 0
      ? `Weiter zu: ${missingRequiredGroups[0].name}`
      : `Hinzufügen · ${formatAbsPrice(total)}`;

  const scrollToGroup = (group: any) => {
    groupRefs.current[group.id]?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
    firstOptionRefs.current[group.id]?.focus();
    setFlashGroupId(group.id);
    setTimeout(() => setFlashGroupId(null), 900);
  };

  const toggleOption = (group: any, option: any) => {
    setSelections((prev) => {
      const current = prev[group.id] || [];
      const isSelected = current.includes(option.id);
      let next: string[];
      if (group.selectionType === "MULTIPLE") {
        if (isSelected) {
          next = current.filter((id) => id !== option.id);
        } else {
          if (group.maxSelect != null && current.length >= group.maxSelect) {
            return prev;
          }
          next = [...current, option.id];
        }
      } else {
        next = isSelected ? [] : [option.id];
      }
      return { ...prev, [group.id]: next };
    });
  };

  const handleMainButtonClick = () => {
    if (missingRequiredGroups.length > 0) {
      scrollToGroup(missingRequiredGroups[0]);
      return;
    }

    // Absicherung gegen Wettlaufsituationen (z. B. Doppel-Tipp): erneut prüfen,
    // bevor tatsächlich hinzugefügt wird. Im Normalbetrieb nie sichtbar, da der
    // Button hier nur erreichbar ist, wenn oben bereits alles beantwortet ist.
    const stillMissing = groups.filter(
      (g) => (selections[g.id] || []).length < g.minSelect,
    );
    if (stillMissing.length > 0) {
      setErrorGroupIds(new Set(stillMissing.map((g) => g.id)));
      setAriaMessage(
        `Bitte fehlende Pflichtangaben ergänzen: ${stillMissing.map((g) => g.name).join(", ")}`,
      );
      scrollToGroup(stillMissing[0]);
      return;
    }

    onAdd(product, selectedOptions);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-950/60 backdrop-blur-sm p-4">
      <div className="bg-slate-900 rounded-3xl w-full max-w-md relative animate-in slide-in-from-bottom-10 sm:zoom-in-95 duration-200 shadow-2xl border border-slate-700 flex flex-col max-h-[90vh]">
        <div aria-live="polite" className="sr-only">
          {ariaMessage}
        </div>

        <div className="sticky top-0 z-10 bg-slate-900 rounded-t-3xl px-6 pt-6 shrink-0">
          <button
            onClick={onClose}
            aria-label="Schließen"
            className="absolute right-4 top-4 text-slate-400 hover:text-white p-2 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900"
          >
            <X className="w-6 h-6" />
          </button>

          <h2 className="text-2xl font-bold mb-1 text-white pr-10">
            {product.name}
          </h2>
          <div className="text-indigo-400 font-bold mb-3">
            Basis: {formatAbsPrice(product.price)}
          </div>

          <div
            className={`mb-4 flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-bold ${
              missingRequiredGroups.length === 0
                ? "bg-emerald-500/10 text-emerald-300"
                : "bg-slate-800 text-slate-200"
            }`}
          >
            {missingRequiredGroups.length === 0 && (
              <Check className="w-4 h-4 shrink-0" />
            )}
            <span>{statusText}</span>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-6">
          {groups.map((group) => {
            const selectedIds = selections[group.id] || [];
            const isMulti = group.selectionType === "MULTIPLE";
            const activeOptions = (group.options || []).filter(
              (o: any) => o.isActive !== false,
            );
            const reachedMax =
              isMulti &&
              group.maxSelect != null &&
              selectedIds.length >= group.maxSelect;
            const hasError = errorGroupIds.has(group.id);
            const isFlashing = flashGroupId === group.id;

            return (
              <div
                key={group.id}
                ref={(el) => {
                  groupRefs.current[group.id] = el;
                }}
                className={`mb-6 rounded-2xl border-2 p-2 transition-colors ${
                  hasError
                    ? "border-rose-500"
                    : isFlashing
                      ? "border-indigo-400"
                      : "border-transparent"
                }`}
              >
                <div className="flex items-center gap-2 mb-1">
                  <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider">
                    {group.name}
                  </h3>
                  <span
                    className={`text-[11px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full border ${
                      group.isRequired
                        ? "text-amber-300 bg-amber-500/15 border-amber-400/60"
                        : "text-slate-300 bg-slate-700/40 border-slate-600"
                    }`}
                  >
                    {group.isRequired ? "Pflicht" : "Freiwillig"}
                  </span>
                </div>

                {reachedMax && (
                  <p className="text-xs text-slate-400 mb-2">
                    Maximal {group.maxSelect} ausgewählt.
                  </p>
                )}

                {hasError && (
                  <div
                    className="flex items-center gap-2 mb-2 text-sm font-semibold text-rose-200 bg-rose-500/10 rounded-lg px-3 py-2"
                    role="alert"
                  >
                    <AlertTriangle className="w-4 h-4 shrink-0" />
                    Bitte eine Option auswählen.
                  </div>
                )}

                <div className="space-y-2 mt-2">
                  {activeOptions.map((option: any, index: number) => {
                    const isSelected = selectedIds.includes(option.id);
                    const isDisabled = !isSelected && reachedMax;
                    const priceLabel =
                      group.priceMode === "ABSOLUTE"
                        ? formatAbsPrice(option.priceEffect)
                        : formatSurchargeLabel(option.priceEffect);

                    return (
                      <button
                        key={option.id}
                        type="button"
                        ref={(el) => {
                          if (index === 0) {
                            firstOptionRefs.current[group.id] = el;
                          }
                        }}
                        disabled={isDisabled}
                        aria-disabled={isDisabled}
                        onClick={() => toggleOption(group, option)}
                        className={`w-full min-h-14 flex justify-between items-center gap-3 rounded-xl border-2 px-4 py-3 text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900 ${
                          isSelected
                            ? isMulti
                              ? "border-emerald-500 bg-emerald-500/20 text-white"
                              : "border-indigo-500 bg-indigo-500/20 text-white"
                            : "border-slate-700 bg-slate-800 text-slate-300"
                        } ${isDisabled ? "opacity-40 cursor-not-allowed" : ""}`}
                      >
                        <span className="font-bold">{option.name}</span>
                        <span className="flex items-center gap-2 text-sm opacity-90 shrink-0">
                          {priceLabel}
                          <span
                            className={`w-5 h-5 rounded flex items-center justify-center border ${
                              isSelected
                                ? isMulti
                                  ? "bg-emerald-500 border-emerald-500"
                                  : "bg-indigo-500 border-indigo-500"
                                : "border-slate-500"
                            }`}
                          >
                            {isSelected && (
                              <Check className="w-3 h-3 text-white" />
                            )}
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        <div className="sticky bottom-0 z-10 bg-slate-900 rounded-b-3xl px-6 pb-6 pt-3 border-t border-slate-800 shrink-0">
          <div className="text-center text-slate-200 font-bold mb-3">
            Gesamtpreis: {absoluteUnanswered ? "—" : formatAbsPrice(total)}
          </div>
          <button
            onClick={handleMainButtonClick}
            className="w-full bg-gradient-to-r from-orange-500 to-orange-600 hover:from-orange-400 hover:to-orange-500 text-white font-bold py-4 rounded-2xl shadow-lg active:scale-95 transition-all flex justify-center items-center gap-2 text-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900"
          >
            {mainButtonLabel}
            {missingRequiredGroups.length === 0 ? (
              <Check className="w-5 h-5" />
            ) : (
              <ArrowRight className="w-5 h-5" />
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
