import { useEffect, useRef, useState } from "react";
import { api } from "../../lib/api";

type EventItem = {
  id: string;
  name: string;
  status: string;
  testMode: boolean;
  rksvConfirmedAt?: string;
};
type Station = { id: string; name: string };
type CleanupSummary = {
  orders: number;
  payments: number;
  sessions: number;
  vouchers: number;
};
type Action = "duplicate" | "copy" | "cleanup" | null;

const key = () => crypto.randomUUID();

export function EventConfigurationActions({
  event,
  events,
  onDone,
}: {
  event: EventItem;
  events: EventItem[];
  onDone: () => void;
}) {
  const [action, setAction] = useState<Action>(null);
  const [name, setName] = useState("");
  const [targetEventId, setTargetEventId] = useState("");
  const [mappings, setMappings] = useState<Record<string, string | null>>({});
  const [sourceStations, setSourceStations] = useState<Station[]>([]);
  const [targetStations, setTargetStations] = useState<Station[]>([]);
  const [summary, setSummary] = useState<CleanupSummary | null>(null);
  const [loadingContext, setLoadingContext] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [idempotencyKey, setIdempotencyKey] = useState("");
  const trigger = useRef<HTMLElement | null>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const first = useRef<HTMLInputElement | HTMLSelectElement>(null);
  const importKey = useRef("");
  const busyRef = useRef(false);

  useEffect(() => {
    busyRef.current = busy;
  }, [busy]);

  useEffect(() => {
    if (!action) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusTimer = window.setTimeout(
      () => (first.current || dialog.current)?.focus(),
      0,
    );
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busyRef.current) setAction(null);
      if (e.key === "Tab") {
        const focusable = dialog.current
          ? Array.from(
              dialog.current.querySelectorAll<HTMLElement>(
                "button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])",
              ),
            )
          : [];
        if (!focusable.length) return;
        const current = document.activeElement;
        if (e.shiftKey && current === focusable[0]) {
          e.preventDefault();
          focusable[focusable.length - 1].focus();
        }
        if (!e.shiftKey && current === focusable[focusable.length - 1]) {
          e.preventDefault();
          focusable[0].focus();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.clearTimeout(focusTimer);
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKey);
      trigger.current?.focus();
    };
  }, [action]);

  const download = async () => {
    const response = await api.get(`/events/${event.id}/config-export`);
    const blob = new Blob([JSON.stringify(response.data, null, 2)], {
      type: "application/json",
    });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `${event.name}-konfiguration.json`;
    link.click();
    URL.revokeObjectURL(link.href);
  };
  const importFile = async (file?: File) => {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".json") || file.size > 1_000_000) {
      setError("Bitte wähle eine JSON-Konfiguration mit höchstens 1 MB.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      if (!importKey.current) importKey.current = key();
      await api.post("/events/config-import", JSON.parse(await file.text()), {
        headers: { "Idempotency-Key": importKey.current },
      });
      importKey.current = "";
      onDone();
    } catch (e: any) {
      setError(
        e.response?.data?.message || "Import konnte nicht verarbeitet werden.",
      );
    } finally {
      setBusy(false);
    }
  };
  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      if (action === "duplicate")
        await api.post(
          `/events/${event.id}/duplicate`,
          { name: name || undefined },
          { headers: { "Idempotency-Key": idempotencyKey } },
        );
      if (action === "copy")
        await api.post(
          `/events/${event.id}/assortment-copy`,
          { targetEventId, stationMappings: mappings },
          { headers: { "Idempotency-Key": idempotencyKey } },
        );
      if (action === "cleanup")
        await api.post(
          `/events/${event.id}/clean-test-data`,
          { confirmationName: name },
          { headers: { "Idempotency-Key": idempotencyKey } },
        );
      setAction(null);
      onDone();
    } catch (e: any) {
      setError(
        e.response?.data?.message || "Aktion konnte nicht ausgeführt werden.",
      );
    } finally {
      setBusy(false);
    }
  };
  const open = async (next: Action, source: HTMLElement) => {
    trigger.current = source;
    setError("");
    setName(next === "duplicate" ? `${event.name} (Kopie)` : "");
    setTargetEventId("");
    setMappings({});
    setSourceStations([]);
    setTargetStations([]);
    setSummary(null);
    setIdempotencyKey(key());
    setAction(next);
    if (next === "copy") {
      setLoadingContext(true);
      try {
        const response = await api.get(
          `/stations/admin/all?eventId=${event.id}`,
        );
        setSourceStations(response.data);
        setMappings(
          Object.fromEntries(
            response.data.map((station: Station) => [station.id, null]),
          ),
        );
      } catch (requestError: any) {
        setError(
          requestError.response?.data?.message ||
            "Quellstationen konnten nicht geladen werden.",
        );
      } finally {
        setLoadingContext(false);
      }
    }
    if (next === "cleanup") {
      setLoadingContext(true);
      try {
        const response = await api.get(`/events/${event.id}/test-data-summary`);
        setSummary(response.data);
      } catch (requestError: any) {
        setError(
          requestError.response?.data?.message ||
            "Testdaten konnten nicht gezählt werden.",
        );
      } finally {
        setLoadingContext(false);
      }
    }
  };

  const loadTargetStations = async (targetId: string) => {
    setTargetEventId(targetId);
    setTargetStations([]);
    if (!targetId) return;
    setLoadingContext(true);
    try {
      const response = await api.get(`/stations/admin/all?eventId=${targetId}`);
      setTargetStations(response.data);
    } catch (requestError: any) {
      setError(
        requestError.response?.data?.message ||
          "Zielstationen konnten nicht geladen werden.",
      );
    } finally {
      setLoadingContext(false);
    }
  };
  return (
    <>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={(clickEvent) => open("duplicate", clickEvent.currentTarget)}
          className="min-h-11 px-3 rounded-xl bg-slate-800 text-slate-200 text-xs font-bold"
        >
          Als Vorlage verwenden
        </button>
        <button
          type="button"
          onClick={(clickEvent) => open("copy", clickEvent.currentTarget)}
          className="min-h-11 px-3 rounded-xl bg-slate-800 text-slate-200 text-xs font-bold"
        >
          Sortiment kopieren
        </button>
        <button
          type="button"
          onClick={download}
          className="min-h-11 px-3 rounded-xl bg-slate-800 text-slate-200 text-xs font-bold"
        >
          JSON exportieren
        </button>
        <label className="min-h-11 px-3 rounded-xl bg-slate-800 text-slate-200 text-xs font-bold inline-flex items-center cursor-pointer">
          JSON importieren
          <input
            className="sr-only"
            type="file"
            accept="application/json,.json"
            onChange={(e) => importFile(e.target.files?.[0])}
          />
        </label>
        {event.status === "TEST_MODE" && event.testMode && (
          <button
            type="button"
            onClick={(clickEvent) => open("cleanup", clickEvent.currentTarget)}
            className="min-h-11 px-3 rounded-xl bg-rose-500/20 text-rose-200 text-xs font-bold"
          >
            Testdaten bereinigen
          </button>
        )}
      </div>
      {action && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4"
          role="presentation"
        >
          <div
            ref={dialog}
            role="dialog"
            aria-modal="true"
            aria-labelledby="config-action-title"
            tabIndex={-1}
            className="max-h-[calc(100vh-2rem)] w-full max-w-lg overflow-y-auto rounded-2xl border border-slate-700 bg-slate-900 p-6 shadow-2xl"
          >
            <h2
              id="config-action-title"
              className="text-lg font-bold text-white"
            >
              {action === "duplicate"
                ? "Veranstaltung duplizieren"
                : action === "copy"
                  ? "Sortiment kopieren"
                  : "Testdaten bereinigen"}
            </h2>
            {action === "duplicate" && (
              <label className="mt-4 block text-sm text-slate-200">
                Name der Kopie
                <input
                  ref={first as any}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="mt-1 min-h-11 w-full rounded-lg bg-slate-800 px-3 text-white"
                />
              </label>
            )}
            {action === "copy" && (
              <>
                <label className="mt-4 block text-sm text-slate-200">
                  Zielveranstaltung
                  <select
                    ref={first as any}
                    value={targetEventId}
                    onChange={(e) => loadTargetStations(e.target.value)}
                    className="mt-1 min-h-11 w-full rounded-lg bg-slate-800 px-3 text-white"
                  >
                    <option value="">Auswählen</option>
                    {events
                      .filter(
                        (x) =>
                          x.id !== event.id &&
                          ["DRAFT", "PREPARED", "TEST_MODE"].includes(
                            x.status,
                          ) &&
                          !x.rksvConfirmedAt,
                      )
                      .map((x) => (
                        <option key={x.id} value={x.id}>
                          {x.name} ({x.status})
                        </option>
                      ))}
                  </select>
                </label>
                {sourceStations.length > 0 && (
                  <fieldset className="mt-4 space-y-3 rounded-xl border border-slate-700 p-3">
                    <legend className="px-2 text-sm font-bold text-slate-200">
                      Stationszuordnungen
                    </legend>
                    {sourceStations.map((sourceStation) => (
                      <label
                        key={sourceStation.id}
                        className="grid gap-2 text-sm text-slate-300 sm:grid-cols-2 sm:items-center"
                      >
                        <span>{sourceStation.name}</span>
                        <select
                          value={mappings[sourceStation.id] || ""}
                          disabled={!targetEventId}
                          onChange={(e) =>
                            setMappings((current) => ({
                              ...current,
                              [sourceStation.id]: e.target.value || null,
                            }))
                          }
                          className="min-h-11 rounded-lg bg-slate-800 px-3 text-white"
                        >
                          <option value="">Keine Zielstation</option>
                          {targetStations.map((targetStation) => (
                            <option
                              key={targetStation.id}
                              value={targetStation.id}
                            >
                              {targetStation.name}
                            </option>
                          ))}
                        </select>
                      </label>
                    ))}
                  </fieldset>
                )}
              </>
            )}
            {action === "cleanup" && (
              <>
                {loadingContext ? (
                  <p className="mt-4 text-sm text-slate-300">
                    Testdaten werden gezählt …
                  </p>
                ) : (
                  summary && (
                    <dl className="mt-4 grid grid-cols-2 gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-slate-200">
                      <div>
                        <dt>Bestellungen</dt>
                        <dd className="font-black">{summary.orders}</dd>
                      </div>
                      <div>
                        <dt>Zahlungen</dt>
                        <dd className="font-black">{summary.payments}</dd>
                      </div>
                      <div>
                        <dt>Sitzungen</dt>
                        <dd className="font-black">{summary.sessions}</dd>
                      </div>
                      <div>
                        <dt>Gutscheine</dt>
                        <dd className="font-black">{summary.vouchers}</dd>
                      </div>
                    </dl>
                  )
                )}
                <label className="mt-4 block text-sm text-slate-200">
                  Zum Bestätigen vollständigen Namen eingeben:{" "}
                  <strong>{event.name}</strong>
                  <input
                    ref={first as any}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="mt-1 min-h-11 w-full rounded-lg bg-slate-800 px-3 text-white"
                  />
                </label>
              </>
            )}
            {error && (
              <p role="alert" className="mt-3 text-sm text-rose-300">
                {error}
              </p>
            )}
            <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <button
                disabled={busy}
                onClick={() => setAction(null)}
                className="min-h-11 px-4 text-slate-200"
              >
                Abbrechen
              </button>
              <button
                disabled={
                  busy ||
                  loadingContext ||
                  (action === "duplicate" && !name.trim()) ||
                  (action === "copy" && !targetEventId) ||
                  (action === "cleanup" && (name !== event.name || !summary))
                }
                onClick={submit}
                className="min-h-11 rounded-xl bg-emerald-600 px-4 font-bold text-white disabled:opacity-50"
              >
                {busy
                  ? "Wird ausgeführt …"
                  : action === "cleanup"
                    ? "Testdaten endgültig bereinigen"
                    : "Ausführen"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
