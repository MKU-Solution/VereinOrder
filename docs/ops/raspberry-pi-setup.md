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

Nach dem Flashen der SD-Karte mit dem *Raspberry Pi Imager*:

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
2. In der Administration (`/admin` -> Tab *Drucker & Bon-Routing*) den Druckertyp `ESC_POS_USB` auswählen.

---

## 6. Offline-Betrieb & WLAN-Access-Point

Im Festbetrieb ist keine Verbindung zum öffentlichen Internet erforderlich. Die Kellner-Handys verbinden sich direkt mit dem lokalen WLAN des Festzelts und rufen im Browser `http://vereinorder.local` oder die IP-Adresse des Raspberry Pi auf.
