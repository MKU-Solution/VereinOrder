# Testen mit Admin- und Kellner-Rolle

Bei allen Frontend- und Berechtigungsprüfungen via `browser_subagent` muss zwingend mit folgenden zwei Benutzerrollen getestet werden:

1. **Administrator (`admin`)**:
   - Prüfung von Verwaltungsfunktionen, Stammdaten, Status, Backups, Diagnosen und Freigaben.
2. **Kellner (`kellner1` / `WAITER`)**:
   - Prüfung der Tischaufnahme, Bestellabläufe, Schnellverkäufe, Artikelverfügbarkeits-Sperren und Kassiervorgänge im Kellner-Dashboard.
