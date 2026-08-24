# VereinOrder - Raspberry Pi Setup & Offline-Festbetrieb

Dieses Dokument beschreibt die Inbetriebnahme von **VereinOrder** auf einem **Raspberry Pi 4 oder 5** mit **Raspberry Pi OS 64-Bit** für den 100% offlinefähigen Festbetrieb ohne Internetverbindung.

---

## 1. Voraussetzungen

- **Hardware**: Raspberry Pi 4 (ab 4 GB RAM) oder Raspberry Pi 5.
- **Speichermedium**: Schnelle microSD-Karte (mind. 32 GB, A2-Klasse) oder externe USB-3.0-SSD.
- **Betriebssystem**: Raspberry Pi OS Lite (64-bit).
- **Netzwerk**: Eigenes Festzelt-WLAN (z. B. über Access Point oder Raspberry Pi internen Hotspot).

---

## 2. Betriebssystem vorbereiten & Docker installieren

Nach dem Flashen der SD-Karte mit dem _Raspberry Pi Imager_:

```bash
# System aktualisieren
sudo apt update && sudo apt upgrade -y

# Docker installieren
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh

# Benutzer 'pi' zur Docker-Gruppe hinzufügen
sudo usermod -aG docker $USER
newgrp docker
```

---

## 3. VereinOrder bereitstellen

```bash
# Projektverzeichnis anlegen
mkdir -p ~/vereinorder && cd ~/vereinorder

# Repository klonen
git clone https://github.com/seipekm/VereinOrder.git .

# Umgebungsvariablen anlegen
cp .env.example .env

# Stack im Hintergrund starten
docker compose up -d
```

Vor dem ersten Start und bei jedem Update werden Migrationen ausschließlich über den
abgesicherten Betriebsweg ausgeführt:

```bash
export ADMIN_TOKEN='<aktuelles Administrator-JWT>'
./scripts/ops/upgrade.sh
```

Der Ablauf setzt den Wartungsmodus, erzeugt eine geprüfte `PRE_MIGRATION`-Sicherung,
führt `prisma migrate deploy` sowie `prisma migrate status` aus und öffnet das System
erst nach Erfolg wieder. Details und der Notfall-Restore stehen in
[`docs/ops/backup-recovery.md`](./backup-recovery.md).

---

## 4. Ausfallsicherheit bei Stromausfall

Alle Container sind mit `restart: always` konfiguriert.

- Nach einem plötzlichen Stromausfall (z. B. Notstromaggregat-Umschaltung) startet der Raspberry Pi automatisch neu.
- Docker initialisiert PostgreSQL, Backend, Frontend und Print-Worker.
- Nach ca. 20–30 Sekunden ist das Kassensystem wieder unter `http://<IP-des-Raspberry-Pi>` erreichbar.
- Alle bis zum Ausfall getätigten Buchungen bleiben dank persistenter PostgreSQL-Volumes und atomarer Transaktionen vollständig erhalten.

---

## 5. USB-Bondrucker am Raspberry Pi

USB-Bondrucker (z.B. Epson TM-T20, Bixolon, Munbyn) werden automatisch als `/dev/usb/lp0` erkannt.

1. Drucker per USB verbinden:
   ```bash
   ls -la /dev/usb/lp*
   ```
2. In der Administration (`/admin` -> Tab _Drucker & Bon-Routing_) den Druckertyp `ESC_POS_USB` auswählen.

**Ausführliche Anleitung:** Der USB-Bondrucker wird auf dem Pi über CUPS als Raw-Queue
betrieben und in der Verwaltung als Druckertyp `CUPS_IPP` angelegt (nicht direkt über
`/dev/usb/lp*`). Installation, Härtung von CUPS, Einrichtung der Raw-Queue, stabile
Geräteidentität beim Wiedereinstecken, Ersatzdrucker-Zuordnung, Austausch im laufenden
Betrieb und Fehlersuche stehen vollständig in
[`docs/ops/druckerbetrieb.md`](./druckerbetrieb.md).

---

## 6. Offline-Betrieb & WLAN-Access-Point

Im Festbetrieb ist keine Verbindung zum öffentlichen Internet erforderlich. Die Kellner-Handys verbinden sich direkt mit dem lokalen WLAN des Festzelts und rufen im Browser `http://vereinorder.local` oder die IP-Adresse des Raspberry Pi auf.

## 7. Datensicherung vor dem Fest

Auf dem ARM64-Gerät mindestens eine native Sicherung erstellen, die vollständige
Wiederherstellungsprüfung ausführen und einen kontrollierten Backend-Neustart im
Wartungsmodus testen. Dump und Manifest gemeinsam auf einen geschützten zweiten
Datenträger kopieren. Der vollständige Ablauf einschließlich Rücknahme steht im
Backup-Handbuch.
