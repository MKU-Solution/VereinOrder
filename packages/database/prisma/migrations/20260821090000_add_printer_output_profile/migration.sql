-- Ausgabeprofil je Drucker: Papierbreite, Zeichensatz, Schnitt, Kopien
-- und Netzwerk-Zeitlimit fuer den ESC/POS-Transport des Print-Workers.
ALTER TABLE "Printer" ADD COLUMN "paperWidth" INTEGER NOT NULL DEFAULT 80;
ALTER TABLE "Printer" ADD COLUMN "codepage" TEXT NOT NULL DEFAULT 'CP858';
ALTER TABLE "Printer" ADD COLUMN "cutMode" TEXT NOT NULL DEFAULT 'PARTIAL';
ALTER TABLE "Printer" ADD COLUMN "copies" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "Printer" ADD COLUMN "timeoutMs" INTEGER NOT NULL DEFAULT 5000;
