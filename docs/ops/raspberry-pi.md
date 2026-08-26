# Raspberry Pi Handbuch & Festbetrieb

Der Betrieb auf einem **Raspberry Pi 4 oder 5 (ARM64)** ist der Standard-Einsatzfall für VereinOrder auf Vereinsfesten, Zeltfesten und Feuerwehrfesten.

---

## 1. Empfohlene Hardware

- **Modell:** Raspberry Pi 4 Model B (4 GB / 8 GB) oder Raspberry Pi 5 (4 GB / 8 GB).
- **Speichermedium:** Schnelle microSD-Karte (A2 / V30, min. 32 GB) oder besser eine **externe USB-3.0-SSD** für maximale Lese-/Schreibperformance und Zuverlässigkeit.
- **Stromversorgung:** Originales Raspberry Pi Netzteil (5.1V / 3A bzw. 5.1V / 5A bei Pi 5). USV-Pufferung (z. B. Powerbank mit Pass-Through) wird für Festbetrieb dringend empfohlen!
- **Netzwerk:** Ethernet-Verbindung zu einem leistungsstarken WLAN-Access-Point (z. B. Ubiquiti UniFi, MikroTik oder AVM FRITZ!Box).

---

## 2. Betriebssystem & Docker vorbereiten

1. **Raspberry Pi OS 64-Bit (Lite)** mittels _Raspberry Pi Imager_ installieren.
2. SSH aktivieren, festen Hostnamen vergeben (z. B. `vereinorder-pi`) und System aktualisieren:

```bash
sudo apt update && sudo apt full-upgrade -y
```

3. **Docker Engine & Compose installieren:**

```bash
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh
sudo usermod -aG docker $USER
```

---

## 3. Statische IP-Adresse & mDNS einrichten

Um sicherzustellen, dass alle Kellner-Smartphones den Server immer zuverlässig unter derselben IP oder `http://vereinorder.local:5173` erreichen:

### A. mDNS (Avahi) aktivieren

```bash
sudo apt install -y avahi-daemon
sudo systemctl enable --now avahi-daemon
```

Damit ist VereinOrder im lokalen Netzwerk sofort erreichbar unter:  
👉 `http://vereinorder-pi.local:5173`

### B. Statische IP via NetworkManager zuweisen

```bash
sudo nmcli connection modify "Wired connection 1" \
  ipv4.method manual \
  ipv4.addresses 192.168.1.100/24 \
  ipv4.gateway 192.168.1.1 \
  ipv4.dns "1.1.1.1 8.8.8.8"
```

---

## 4. USB-Drucker über CUPS einbinden

Für USB-Bondrucker (z. B. Epson TM-T20, Bixolon, Xprinter) auf dem Raspberry Pi:

```bash
# CUPS installieren
sudo apt install -y cups cups-client

# pi-Benutzer zur Druckgruppe hinzufügen
sudo usermod -aG lpadmin $USER

# CUPS für lokales Netzwerk freischalten
sudo cupsctl --remote-admin --remote-any
sudo systemctl restart cups
```

Die CUPS-Weboberfläche steht auf Port 631 zur Verfügung:  
👉 `http://192.168.1.100:631`

---

## 5. Kaltstart & Stromausfall-Verhalten

VereinOrder ist so konfiguriert, dass nach einem unvorhergesehenen Stromausfall:

- Alle Docker-Container dank `restart: always` automatisch starten.
- PostgreSQL automatisch ein Crash-Recovery durchführt.
- Die Druckwarteschlange offene Aufträge nicht verliert, sondern nach Reboot wieder anstößt.
