-- Ausfallsicherer Druckweg (Issue #64): Reservierung mit Fencing-Token,
-- Versuchsphase, genau ein Wechsel auf den Ersatzdrucker und der ausdrueckliche
-- Zustand "Ergebnis unklar" statt eines automatischen Zweitdrucks.
--
-- Alle Aenderungen sind additiv. Bestehende Zeilen bleiben gueltig: die beiden
-- neuen Zaehler erhalten den Vorgabewert 0, alle uebrigen Spalten sind nullbar.
-- Der Ersatzdrucker ist global konfiguriert; es gibt bewusst keine eventId.
--
-- Die Pruefbedingungen am Ende bilden Abschnitt 5.4 des Architekturentwurfs ab.
-- Prisma kennt keine CHECK-Constraints und stellt sie im Schema nicht dar; sie
-- duerfen von einer spaeteren Migration nicht stillschweigend entfernt werden.

-- CreateEnum
CREATE TYPE "PrintAttemptPhase" AS ENUM ('CLAIMED', 'DELIVERING', 'SPOOLED');

-- CreateEnum
CREATE TYPE "PrintOutcomeClass" AS ENUM ('NOT_PRINTED', 'PRINTED', 'UNCLEAR');

-- AlterEnum
-- PostgreSQL 12 und neuer erlaubt ADD VALUE innerhalb einer Transaktion,
-- solange der neue Wert in derselben Transaktion nicht verwendet wird. Diese
-- Migration verwendet 'UNRESOLVED' und 'CANCELLED' nirgends.
ALTER TYPE "PrintJobStatus" ADD VALUE 'UNRESOLVED';
ALTER TYPE "PrintJobStatus" ADD VALUE 'CANCELLED';

-- AlterTable: Ersatzdrucker, CUPS-Warteschlange und Betriebssicht am Drucker
ALTER TABLE "Printer" ADD COLUMN "queueName" TEXT;
ALTER TABLE "Printer" ADD COLUMN "fallbackPrinterId" TEXT;
ALTER TABLE "Printer" ADD COLUMN "lastErrorCode" TEXT;
ALTER TABLE "Printer" ADD COLUMN "lastErrorAt" TIMESTAMP(3);
ALTER TABLE "Printer" ADD COLUMN "lastOkAt" TIMESTAMP(3);

-- AlterTable: Reservierung und Fencing
ALTER TABLE "PrintJob" ADD COLUMN "attemptPhase" "PrintAttemptPhase";
ALTER TABLE "PrintJob" ADD COLUMN "leaseId" TEXT;
ALTER TABLE "PrintJob" ADD COLUMN "leaseExpiresAt" TIMESTAMP(3);
ALTER TABLE "PrintJob" ADD COLUMN "lastHeartbeatAt" TIMESTAMP(3);
ALTER TABLE "PrintJob" ADD COLUMN "attemptCount" INTEGER NOT NULL DEFAULT 0;

-- AlterTable: Ersatzdruckerwechsel
ALTER TABLE "PrintJob" ADD COLUMN "activePrinterId" TEXT;
ALTER TABLE "PrintJob" ADD COLUMN "failoverCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "PrintJob" ADD COLUMN "failoverAt" TIMESTAMP(3);
ALTER TABLE "PrintJob" ADD COLUMN "failoverReason" TEXT;
ALTER TABLE "PrintJob" ADD COLUMN "failoverFromPrinterId" TEXT;

-- AlterTable: Ergebnis des letzten Versuchs
ALTER TABLE "PrintJob" ADD COLUMN "outcomeClass" "PrintOutcomeClass";
ALTER TABLE "PrintJob" ADD COLUMN "errorCode" TEXT;
ALTER TABLE "PrintJob" ADD COLUMN "deliveredAt" TIMESTAMP(3);

-- AlterTable: unklarer Ausgang und Admin-Entscheidung
ALTER TABLE "PrintJob" ADD COLUMN "unresolvedAt" TIMESTAMP(3);
ALTER TABLE "PrintJob" ADD COLUMN "unresolvedReason" TEXT;
ALTER TABLE "PrintJob" ADD COLUMN "resolvedAt" TIMESTAMP(3);
ALTER TABLE "PrintJob" ADD COLUMN "resolvedByUserId" TEXT;
ALTER TABLE "PrintJob" ADD COLUMN "resolution" TEXT;

-- AlterTable: Nachweistraeger der Transporte
ALTER TABLE "PrintJob" ADD COLUMN "cupsJobId" INTEGER;
ALTER TABLE "PrintJob" ADD COLUMN "cupsJobState" TEXT;
ALTER TABLE "PrintJob" ADD COLUMN "bytesWritten" INTEGER;

-- AddForeignKey
-- Alle vier Fremdschluessel sind nullbar und loeschen beim Entfernen des Ziels
-- nur die Referenz. Ein geloeschter Drucker darf keinen Druckauftrag und keine
-- Ersatzdruckerzeile mitnehmen.
ALTER TABLE "Printer" ADD CONSTRAINT "Printer_fallbackPrinterId_fkey" FOREIGN KEY ("fallbackPrinterId") REFERENCES "Printer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PrintJob" ADD CONSTRAINT "PrintJob_activePrinterId_fkey" FOREIGN KEY ("activePrinterId") REFERENCES "Printer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PrintJob" ADD CONSTRAINT "PrintJob_failoverFromPrinterId_fkey" FOREIGN KEY ("failoverFromPrinterId") REFERENCES "Printer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PrintJob" ADD CONSTRAINT "PrintJob_resolvedByUserId_fkey" FOREIGN KEY ("resolvedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex
-- Auswahl im Claim: WHERE status = 'PENDING' ORDER BY createdAt ASC
CREATE INDEX "PrintJob_status_createdAt_idx" ON "PrintJob"("status", "createdAt");
-- Reaper: WHERE status = 'PROCESSING' AND leaseExpiresAt < NOW()
CREATE INDEX "PrintJob_status_leaseExpiresAt_idx" ON "PrintJob"("status", "leaseExpiresAt");
-- Betriebsblick auf den Drucker des aktuellen Versuchs
CREATE INDEX "PrintJob_activePrinterId_idx" ON "PrintJob"("activePrinterId");
-- Admin-Liste: WHERE status = 'UNRESOLVED' ORDER BY unresolvedAt
CREATE INDEX "PrintJob_status_unresolvedAt_idx" ON "PrintJob"("status", "unresolvedAt");

-- AddCheckConstraint (von Prisma nicht abgebildet, siehe Kopfkommentar)
-- Invariante des einmaligen Wechsels: es gibt keinen zweiten Ersatzdrucker und
-- kein Ping-Pong zwischen zwei Geraeten.
ALTER TABLE "PrintJob" ADD CONSTRAINT "PrintJob_failoverCount_range_check"
  CHECK ("failoverCount" BETWEEN 0 AND 1);

-- Die Versuchsphase existiert nur innerhalb einer laufenden Reservierung. Ein
-- terminaler Auftrag mit gesetzter Phase waere fuer den Reaper nicht
-- unterscheidbar von einem laufenden.
ALTER TABLE "PrintJob" ADD CONSTRAINT "PrintJob_attemptPhase_status_check"
  CHECK ("attemptPhase" IS NULL OR "status" = 'PROCESSING');

-- Selbstreferenzfreiheit des Ersatzdruckers. Mehr kann die Datenbank nicht
-- zusichern: Kettenfreiheit (A -> B -> C -> A) und die Bedingung, dass der
-- Zieldrucker aktiv ist, bleiben Aufgabe der Anwendungsschicht.
ALTER TABLE "Printer" ADD CONSTRAINT "Printer_fallback_not_self_check"
  CHECK ("fallbackPrinterId" IS NULL OR "fallbackPrinterId" <> "id");
