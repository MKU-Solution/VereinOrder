import React, { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, ShieldAlert } from "lucide-react";
import type { EventItem } from "./adminDomainTypes";
import type { OpenOfflineQueueSummary } from "../../lib/offlineQueueDb";
import { formatCurrency } from "./adminFormatters";

export interface AdminEventCompleteModalProps {
  event: EventItem;
  openQueueSummary: OpenOfflineQueueSummary;
  isSubmitting?: boolean;
  onClose: () => void;
  onConfirm: (confirmedWithWarning: boolean) => void;
}

export const AdminEventCompleteModal: React.FC<
  AdminEventCompleteModalProps
> = ({ event, openQueueSummary, isSubmitting = false, onClose, onConfirm }) => {
  const [acknowledged, setAcknowledged] = useState(false);
  const hasOpenOrders = openQueueSummary.count > 0;

  useEffect(() => {
    setAcknowledged(false);
  }, [event.id]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape" && !isSubmitting) {
      onClose();
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fade-in"
      onKeyDown={handleKeyDown}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="event-complete-modal-title"
        className="bg-slate-900 border border-slate-700 p-6 sm:p-8 rounded-3xl max-w-xl w-full shadow-2xl space-y-6 animate-scale-up"
      >
        <div className="flex items-start gap-4">
          <div
            className={`p-3 rounded-2xl border shrink-0 ${
              hasOpenOrders
                ? "bg-amber-500/20 text-amber-400 border-amber-500/30"
                : "bg-indigo-500/20 text-indigo-400 border-indigo-500/30"
            }`}
          >
            {hasOpenOrders ? (
              <ShieldAlert className="w-8 h-8" />
            ) : (
              <CheckCircle2 className="w-8 h-8" />
            )}
          </div>
          <div>
            <h3
              id="event-complete-modal-title"
              className="text-xl font-bold text-white"
            >
              Veranstaltung abschließen
            </h3>
            <p className="text-sm text-slate-400 mt-1">
              Veranstaltung:{" "}
              <span className="text-slate-200 font-semibold">{event.name}</span>
            </p>
          </div>
        </div>

        {hasOpenOrders ? (
          <div
            data-testid="event-complete-offline-warning"
            className="space-y-4"
          >
            <div className="bg-amber-500/10 border border-amber-500/30 p-4 rounded-2xl text-xs sm:text-sm text-amber-200 space-y-2.5 leading-relaxed">
              <div className="font-semibold text-amber-300 flex items-center gap-1.5 text-sm sm:text-base">
                <AlertTriangle className="w-5 h-5 shrink-0 text-amber-400" />
                <span>
                  Achtung: {openQueueSummary.count} offene Vormerkung
                  {openQueueSummary.count === 1 ? "" : "en"} (
                  {formatCurrency(openQueueSummary.totalCents)}) auf diesem
                  Gerät!
                </span>
              </div>
              <p className="text-slate-300">
                Auf diesem Gerät liegen noch nicht übertragene Vormerkungen für
                diese Veranstaltung. Wenn die Veranstaltung abgeschlossen wird,
                können keine weiteren Bestellungen mehr erfasst oder
                nachgesendet werden.
              </p>
              <p className="text-amber-200/90 font-medium">
                Handlungsempfehlung: Bitte stelle sicher, dass alle Geräte
                online sind und alle Vormerkungen vollständig an den Server
                übermittelt wurden.
              </p>
              <div className="text-slate-400 text-[11px] pt-1 italic border-t border-amber-500/20">
                Hinweis zur Grenze: Es werden ausschließlich die offenen
                Vormerkungen auf diesem Gerät geprüft. Der Abschluss mit offenen
                Vormerkungen wird im Audit-Log vermerkt.
              </div>
            </div>

            <label className="flex items-start gap-3 p-3 bg-slate-800/40 hover:bg-slate-800/70 rounded-2xl border border-slate-700/50 cursor-pointer transition">
              <input
                type="checkbox"
                checked={acknowledged}
                onChange={(e) => setAcknowledged(e.target.checked)}
                className="w-5 h-5 mt-0.5 rounded border-slate-600 text-indigo-600 focus:ring-indigo-500"
              />
              <span className="text-xs sm:text-sm text-slate-200 font-medium select-none">
                Ich habe die offenen Vormerkungen zur Kenntnis genommen und
                möchte die Veranstaltung trotz {openQueueSummary.count} offener
                Vormerkung{openQueueSummary.count === 1 ? "" : "en"}{" "}
                abschließen.
              </span>
            </label>
          </div>
        ) : (
          <div className="bg-slate-950/80 border border-slate-800 p-4 rounded-2xl text-xs sm:text-sm text-slate-300 space-y-2 leading-relaxed">
            <p>
              Möchtest du die Veranstaltung „{event.name}“ wirklich abschließen?
            </p>
            <p className="text-slate-400 text-xs">
              Nach dem Abschluss können für diese Veranstaltung keine neuen
              Bestellungen mehr aufgenommen werden.
            </p>
            <p className="text-emerald-400/90 text-xs font-medium pt-1">
              ✓ Auf diesem Gerät liegen keine offenen Vormerkungen vor.
            </p>
          </div>
        )}

        <div className="flex gap-3 justify-end pt-2">
          <button
            type="button"
            autoFocus={hasOpenOrders}
            onClick={onClose}
            disabled={isSubmitting}
            className="px-5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-sm transition"
          >
            Abbrechen
          </button>
          <button
            type="button"
            disabled={(hasOpenOrders && !acknowledged) || isSubmitting}
            onClick={() => onConfirm(hasOpenOrders)}
            className={`px-5 py-2.5 rounded-xl font-bold text-sm shadow-lg transition flex items-center gap-2 ${
              hasOpenOrders
                ? "bg-amber-600 hover:bg-amber-500 disabled:opacity-40 disabled:cursor-not-allowed text-white shadow-amber-600/30"
                : "bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white shadow-indigo-600/30"
            }`}
          >
            {isSubmitting
              ? "Wird abgeschlossen..."
              : "Veranstaltung abschließen"}
          </button>
        </div>
      </div>
    </div>
  );
};
