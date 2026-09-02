-- Gruppenschalter fuer Warengruppen statt Loeschen (Issue #170), analog zur
-- Migration 20260818124602_add_user_isactive fuer "User". Der Default true
-- haelt jede bestehende Warengruppe unveraendert sichtbar und verkaeuflich;
-- kein Altbestand kann diese Spalte verletzen.
ALTER TABLE "ProductCategory" ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true;
