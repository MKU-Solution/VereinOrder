import { useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Database,
  Download,
  HardDrive,
  RotateCcw,
  ShieldCheck,
} from "lucide-react";

import type { BackupItem } from "./adminDomainTypes";
import { AdminEmptyState } from "./AdminEmptyState";
import { formatStorageBytes } from "./adminFormatters";
import { AdminToolbar } from "./AdminToolbar";

export interface AdminBackupsViewProps {
  backups: BackupItem[];
  restoreOperation: any;
  restoreOperationConfirmation: string;
  isBackingUp?: boolean;
  isRestoring?: boolean;
  isRollingBack?: boolean;
  isAccepting?: boolean;
  isRefreshing?: boolean;
  onRefresh: () => void;
  onCreateBackup: () => void;
  onVerifyBackup: (backup: BackupItem) => void;
  onPrepareRestore: (backup: BackupItem) => void;
  onDownloadBackup: (backup: BackupItem, file?: string) => void;
  onRollbackRestore: () => void;
  onAcceptRestore: () => void;
  onSetRestoreOperationConfirmation: (val: string) => void;
  onOpenDirectRestore?: (filename: string) => void;
}

export const AdminBackupsView = ({
  backups,
  restoreOperation,
  restoreOperationConfirmation,
  isBackingUp = false,
  isRestoring = false,
  isRollingBack = false,
  isAccepting = false,
  isRefreshing = false,
  onRefresh,
  onCreateBackup,
  onVerifyBackup,
  onPrepareRestore,
  onDownloadBackup,
  onRollbackRestore,
  onAcceptRestore,
  onSetRestoreOperationConfirmation,
  onOpenDirectRestore,
}: AdminBackupsViewProps) => {
  const [searchQuery, setSearchQuery] = useState("");
  const [formatFilter, setFormatFilter] = useState("ALL");

  const filteredBackups = useMemo(() => {
    return backups.filter((b) => {
      const q = searchQuery.trim().toLowerCase();
      const matchesSearch =
        !q ||
        (b.filename || "").toLowerCase().includes(q) ||
        (b.version || "").toLowerCase().includes(q);

      const matchesFormat =
        formatFilter === "ALL" ||
        (formatFilter === "POSTGRES_CUSTOM" &&
          b.format === "POSTGRES_CUSTOM") ||
        (formatFilter === "LEGACY_JSON" && b.format === "LEGACY_JSON") ||
        (formatFilter === "SQL" && (b.format as string) === "SQL_TEXT");

      return matchesSearch && matchesFormat;
    });
  }, [backups, searchQuery, formatFilter]);

  const isFiltered = searchQuery.trim().length > 0 || formatFilter !== "ALL";

  const handleResetFilters = () => {
    setSearchQuery("");
    setFormatFilter("ALL");
  };

  const formatFilterSelect = (
    <div className="flex items-center gap-2">
      <label htmlFor="admin-backups-format-filter" className="sr-only">
        Sicherungsformat filtern
      </label>
      <select
        id="admin-backups-format-filter"
        value={formatFilter}
        onChange={(e) => setFormatFilter(e.target.value)}
        className="min-h-11 rounded-xl border border-slate-700 bg-slate-800 px-3.5 py-2 text-xs font-bold text-slate-200 transition-colors hover:border-slate-600 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-400/30"
      >
        <option value="ALL">Alle Sicherungsformate</option>
        <option value="POSTGRES_CUSTOM">Custom-Dump (.dump)</option>
        <option value="LEGACY_JSON">JSON-Legacy (.json)</option>
        <option value="SQL">SQL-Text (.sql)</option>
      </select>
    </div>
  );

  return (
    <div className="space-y-6">
      {/* Status-Kopfkarte: Automatische & Manuelle Datensicherung */}
      <section
        aria-label="Sicherungsstatus"
        className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 rounded-2xl border border-slate-700/80 bg-slate-900/80 p-5 shadow-lg"
      >
        <div className="flex items-center gap-3.5">
          <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/20 p-3 text-emerald-400">
            <ShieldCheck aria-hidden="true" className="h-6 w-6" />
          </div>
          <div>
            <h2 className="text-base font-bold text-slate-100">
              Automatische & Manuelle Datensicherung
            </h2>
            <p className="mt-0.5 text-xs text-slate-300">
              Stündliche PostgreSQL-Sicherung unabhängig vom
              Veranstaltungsstatus. Custom-Dump und Manifest werden mit SHA-256
              und pg_restore geprüft.
            </p>
          </div>
        </div>

        <button
          type="button"
          disabled={isBackingUp}
          onClick={onCreateBackup}
          className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-xl bg-emerald-600 px-5 py-2.5 text-xs font-bold text-white shadow-lg shadow-emerald-950/40 transition-colors hover:bg-emerald-500 focus-visible:outline focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-amber-200 disabled:opacity-50"
        >
          <HardDrive aria-hidden="true" className="h-4 w-4" />
          {isBackingUp
            ? "Sicherung läuft..."
            : "Jetzt sichern (Manuelles Backup)"}
        </button>
      </section>

      {/* Restore-Operation Wartungs- und Abnahmehinweis */}
      {restoreOperation && (
        <section
          aria-label="Wiederherstellungsprüfung"
          className="space-y-4 rounded-2xl border border-amber-500/40 bg-amber-500/10 p-5 shadow-md"
        >
          <div className="flex items-start gap-3">
            <AlertTriangle
              aria-hidden="true"
              className="mt-0.5 h-6 w-6 shrink-0 text-amber-400"
            />
            <div className="min-w-0 flex-1 space-y-1">
              <h3 className="font-bold text-amber-100 text-base">
                Wiederherstellung wartet auf Abnahme
              </h3>
              <p className="break-all font-mono text-xs text-amber-200">
                {restoreOperation.backupFilename} · Phase{" "}
                {restoreOperation.phase}
              </p>
              <p className="text-xs text-slate-300">
                {restoreOperation.activeCashierSessions} offene
                Kassensitzung(en) wurden protokolliert. Die Rückfalldatenbank
                bleibt bis zu deiner Entscheidung aktiv.
              </p>
            </div>
          </div>

          <div className="space-y-2">
            <label
              htmlFor="restore-operation-confirmation-input"
              className="block text-xs font-bold text-slate-200"
            >
              Sicherungszeitpunkt für die Entscheidung exakt eingeben
            </label>
            <code className="block break-all text-xs text-amber-200 font-mono">
              {restoreOperation.backupCreatedAt}
            </code>
            <input
              id="restore-operation-confirmation-input"
              value={restoreOperationConfirmation}
              onChange={(e) =>
                onSetRestoreOperationConfirmation(e.target.value)
              }
              placeholder={restoreOperation.backupCreatedAt}
              className="min-h-11 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 font-mono text-xs text-white placeholder:text-slate-600 focus:border-amber-400 focus:outline-none"
            />
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center gap-3 border-t border-amber-500/30 pt-3">
            <button
              type="button"
              disabled={
                isRollingBack ||
                restoreOperationConfirmation !==
                  restoreOperation.backupCreatedAt
              }
              onClick={onRollbackRestore}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-700 bg-slate-800 px-4 py-2 text-xs font-bold text-slate-200 hover:bg-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-200 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <RotateCcw
                aria-hidden="true"
                className="h-4 w-4 text-amber-400"
              />
              {isRollingBack
                ? "Rückfall läuft …"
                : "Wiederherstellung rückgängig machen"}
            </button>

            <button
              type="button"
              disabled={
                isAccepting ||
                restoreOperationConfirmation !==
                  restoreOperation.backupCreatedAt
              }
              onClick={onAcceptRestore}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-200 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <CheckCircle2 aria-hidden="true" className="h-4 w-4" />
              {isAccepting
                ? "Übernahme läuft …"
                : "Wiederherstellung abnehmen und Wartung beenden"}
            </button>
          </div>
        </section>
      )}

      <AdminToolbar
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        searchPlaceholder="Sicherungsdatei suchen …"
        searchLabel="Sicherungen durchsuchen"
        totalCount={backups.length}
        filteredCount={filteredBackups.length}
        isRefreshing={isRefreshing}
        onRefresh={onRefresh}
        filters={formatFilterSelect}
      />

      {filteredBackups.length === 0 ? (
        <AdminEmptyState
          icon={Database}
          title="Noch keine Datensicherungen vorhanden"
          description="Erstelle deine erste manuelle Datensicherung oder warte auf die automatische stündliche Sicherung."
          actionLabel="Datensicherung erstellen"
          onAction={onCreateBackup}
          isFiltered={isFiltered && backups.length > 0}
          onResetFilters={handleResetFilters}
        />
      ) : (
        <div className="space-y-3">
          <div className="hidden overflow-hidden rounded-2xl border border-slate-700/80 bg-slate-900/60 shadow-lg md:block">
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-slate-700/80 bg-slate-800/60 text-xs font-bold uppercase tracking-wider text-slate-400">
                    <th className="px-5 py-3.5">Sicherung</th>
                    <th className="px-4 py-3.5">Format & Typ</th>
                    <th className="px-4 py-3.5">Status & Version</th>
                    <th className="px-4 py-3.5">Größe & Datum</th>
                    <th className="px-5 py-3.5 text-right">Aktionen</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/80 text-sm">
                  {filteredBackups.map((backup) => (
                    <tr
                      key={backup.filename}
                      className="transition-colors hover:bg-slate-800/40"
                    >
                      <td className="px-5 py-4 font-mono font-semibold text-slate-100 max-w-xs break-all">
                        <div className="flex items-center gap-2">
                          <Database
                            aria-hidden="true"
                            className="h-4 w-4 shrink-0 text-indigo-400"
                          />
                          <span>{backup.filename}</span>
                        </div>
                      </td>
                      <td className="px-4 py-4 text-xs">
                        <div className="space-y-1">
                          <span
                            className={`inline-flex items-center rounded-md border px-2 py-0.5 font-bold ${
                              backup.format === "POSTGRES_CUSTOM"
                                ? "border-emerald-500/30 bg-emerald-500/15 text-emerald-300"
                                : "border-slate-700 bg-slate-800 text-slate-300"
                            }`}
                          >
                            {backup.format === "POSTGRES_CUSTOM"
                              ? "PostgreSQL Custom-Dump"
                              : backup.format === "LEGACY_JSON"
                                ? "Altbestand (JSON)"
                                : "SQL-Text"}
                          </span>
                          <div className="text-slate-400 font-medium">
                            {backup.trigger === "MANUAL"
                              ? "Manuell"
                              : backup.trigger === "PRE_MIGRATION"
                                ? "Vor Migration"
                                : "Stündlich"}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-4 text-xs">
                        <div className="space-y-1">
                          <span
                            className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 font-semibold ${
                              backup.verification === "STRUCTURE_VERIFIED"
                                ? "border-emerald-500/30 bg-emerald-500/15 text-emerald-300"
                                : "border-amber-500/30 bg-amber-500/15 text-amber-300"
                            }`}
                          >
                            {backup.verification === "STRUCTURE_VERIFIED" ? (
                              <CheckCircle2
                                aria-hidden="true"
                                className="h-3 w-3"
                              />
                            ) : (
                              <AlertTriangle
                                aria-hidden="true"
                                className="h-3 w-3"
                              />
                            )}
                            {(backup.verification as string) ===
                            "STRUCTURE_VERIFIED"
                              ? "Strukturgeprüft"
                              : (backup.verification as string) ===
                                    "CHECKSUM_ONLY" ||
                                  backup.verification === "LEGACY"
                                ? "Legacy-Prüfsumme"
                                : backup.verification}
                          </span>
                          <div className="font-mono text-slate-400">
                            Version {backup.version}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-4 text-xs text-slate-300 font-mono">
                        <div>{formatStorageBytes(backup.sizeBytes)}</div>
                        <div className="text-slate-400">
                          {new Date(backup.createdAt).toLocaleString("de-AT")}
                        </div>
                      </td>
                      <td className="px-5 py-4 text-right">
                        <div className="flex flex-wrap items-center justify-end gap-1.5">
                          {backup.restoreVerificationAvailable && (
                            <button
                              type="button"
                              onClick={() => onVerifyBackup(backup)}
                              className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-bold text-slate-200 hover:bg-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-200"
                            >
                              Wiederherstellung prüfen
                            </button>
                          )}

                          {backup.restorePreparationAvailable && (
                            <button
                              type="button"
                              disabled={isRestoring}
                              onClick={() => onPrepareRestore(backup)}
                              className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-amber-500/30 bg-amber-500/20 px-3 py-1.5 text-xs font-bold text-amber-300 hover:bg-amber-500/30 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-200 disabled:opacity-50"
                            >
                              Sicher wiederherstellen
                            </button>
                          )}

                          {backup.format === "LEGACY_JSON" &&
                            onOpenDirectRestore && (
                              <button
                                type="button"
                                onClick={() =>
                                  onOpenDirectRestore(backup.filename)
                                }
                                title="Nur im gesperrten Wartungsmodus wiederherstellen"
                                className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-amber-500/30 bg-amber-500/20 px-3 py-1.5 text-xs font-bold text-amber-300 hover:bg-amber-500/30 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-200"
                              >
                                Legacy wiederherstellen
                              </button>
                            )}

                          {(backup as any).downloadFiles &&
                          (backup as any).downloadFiles.length > 0 ? (
                            (backup as any).downloadFiles.map(
                              (file: string) => {
                                const isDump =
                                  file.endsWith(".dump") ||
                                  file.endsWith(".sql");
                                const label = isDump ? "Dump" : "Manifest";
                                return (
                                  <button
                                    key={file}
                                    type="button"
                                    onClick={() =>
                                      onDownloadBackup(backup, file)
                                    }
                                    className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-xs font-bold text-slate-200 hover:bg-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-200"
                                  >
                                    <Download
                                      aria-hidden="true"
                                      className="h-3.5 w-3.5"
                                    />
                                    <span>{label}</span>
                                  </button>
                                );
                              },
                            )
                          ) : (
                            <button
                              type="button"
                              onClick={() => onDownloadBackup(backup)}
                              className="inline-flex min-h-9 min-w-9 items-center justify-center rounded-lg border border-slate-700 bg-slate-800 p-2 text-slate-300 hover:bg-slate-700 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-200"
                              title="Herunterladen"
                              aria-label={`Sicherung ${backup.filename} herunterladen`}
                            >
                              <Download
                                aria-hidden="true"
                                className="h-4 w-4"
                              />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="space-y-3 md:hidden">
            {filteredBackups.map((backup) => (
              <article
                key={backup.filename}
                className="space-y-3 rounded-2xl border border-slate-700/80 bg-slate-900/80 p-4 shadow-md text-xs"
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <Database
                      aria-hidden="true"
                      className="h-4 w-4 shrink-0 text-indigo-400"
                    />
                    <h3 className="break-all font-mono font-bold text-slate-100 text-sm">
                      Sicherungsdatei: {backup.filename}
                    </h3>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <span
                      className={`rounded-md border px-2 py-0.5 font-bold ${
                        backup.format === "POSTGRES_CUSTOM"
                          ? "border-emerald-500/30 bg-emerald-500/15 text-emerald-300"
                          : "border-slate-700 bg-slate-800 text-slate-300"
                      }`}
                    >
                      {backup.format === "POSTGRES_CUSTOM"
                        ? "PostgreSQL Custom-Dump"
                        : backup.format === "LEGACY_JSON"
                          ? "Altbestand (JSON)"
                          : "SQL-Text"}
                    </span>
                    <span className="text-slate-400">
                      {backup.trigger === "MANUAL"
                        ? "Manuell"
                        : backup.trigger === "PRE_MIGRATION"
                          ? "Vor Migration"
                          : "Stündlich"}
                    </span>
                  </div>
                </div>

                <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-2.5 font-mono text-slate-300">
                  <div className="grid grid-cols-2 gap-1">
                    <span>Größe: {formatStorageBytes(backup.sizeBytes)}</span>
                    <span>Version: {backup.version}</span>
                    <span className="col-span-2 text-slate-400">
                      📅 {new Date(backup.createdAt).toLocaleString("de-AT")}
                    </span>
                  </div>
                </div>

                <div className="flex flex-col gap-2 border-t border-slate-800 pt-3">
                  <div className="flex flex-wrap gap-2">
                    {backup.restoreVerificationAvailable && (
                      <button
                        type="button"
                        onClick={() => onVerifyBackup(backup)}
                        className="inline-flex min-h-11 flex-1 items-center justify-center gap-1 rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 font-bold text-slate-200 hover:bg-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-200"
                      >
                        Wiederherstellung prüfen
                      </button>
                    )}

                    {backup.restorePreparationAvailable && (
                      <button
                        type="button"
                        disabled={isRestoring}
                        onClick={() => onPrepareRestore(backup)}
                        className="inline-flex min-h-11 flex-1 items-center justify-center gap-1 rounded-xl border border-amber-500/30 bg-amber-500/20 px-3 py-2 font-bold text-amber-300 hover:bg-amber-500/30 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-200 disabled:opacity-50"
                      >
                        Sicher wiederherstellen
                      </button>
                    )}

                    {backup.format === "LEGACY_JSON" && onOpenDirectRestore && (
                      <button
                        type="button"
                        onClick={() => onOpenDirectRestore(backup.filename)}
                        title="Nur im gesperrten Wartungsmodus wiederherstellen"
                        className="inline-flex min-h-11 flex-1 items-center justify-center gap-1 rounded-xl border border-amber-500/30 bg-amber-500/20 px-3 py-2 font-bold text-amber-300 hover:bg-amber-500/30 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-200"
                      >
                        Legacy wiederherstellen
                      </button>
                    )}
                  </div>

                  {(backup as any).downloadFiles &&
                  (backup as any).downloadFiles.length > 0 ? (
                    <div className="flex gap-2">
                      {(backup as any).downloadFiles.map((file: string) => {
                        const isDump =
                          file.endsWith(".dump") || file.endsWith(".sql");
                        const label = isDump ? "Dump" : "Manifest";
                        return (
                          <button
                            key={file}
                            type="button"
                            onClick={() => onDownloadBackup(backup, file)}
                            className="inline-flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 font-bold text-slate-200 hover:bg-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-200"
                          >
                            <Download aria-hidden="true" className="h-4 w-4" />
                            <span>{label}</span>
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => onDownloadBackup(backup)}
                      className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 font-bold text-slate-200 hover:bg-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-200"
                    >
                      <Download aria-hidden="true" className="h-4 w-4" />
                      <span>Herunterladen</span>
                    </button>
                  )}
                </div>
              </article>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
