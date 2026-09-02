# Agents

Dieses Projekt wird maßgeblich von Antigravity-Agenten unter der Projektleitung eines "Hauptagenten" entwickelt.
Alle Subagenten arbeiten auf Basis strikter Rollen, nutzen Branches und Pull Requests und folgen einem verbindlichen Test-Workflow, wie im `docs/product/master-prompt.md` definiert.

Subagenten dürfen nicht direkt auf `main` pushen.

Vor jedem `git push` muss das Projekt zwingend auf Funktion geprüft werden (z. B. durch erfolgreichen Build `pnpm -r run build` und Tests).

## Unverhandelbare Regeln

- Kommunikation und Benutzerdokumentation sind auf Deutsch; Codebezeichner dürfen Englisch sein.
- VereinOrder ist keine RKSV-Registrierkasse.
- Test- und Echtbetrieb dürfen nicht vermischt werden.
- Berechtigungen werden immer im Backend geprüft.
- Zahlungen, Stornos, Preisänderungen und sicherheitsrelevante Aktionen werden auditierbar erfasst.
- Der Festbetrieb darf keine öffentliche Internetverbindung benötigen.

## Entwicklung

- Nach dem Bootstrap niemals direkt auf `main` arbeiten.
- Änderungen benötigen ein Issue, einen passenden Branch und einen Pull Request.
- Fremde oder nicht zugewiesene Dateien nicht verändern.
- Datenbankänderungen benötigen nachvollziehbare, eingecheckte SQL-Migrationen.
- Destruktive Datenbanktests dürfen ausschließlich eine eindeutig geprüfte Testdatenbank verwenden.
- Neue Abhängigkeiten müssen begründet und auf AMD64/ARM64-Kompatibilität geprüft werden.
- `[skip ci]` ist in Commit-Nachrichten und PR-Titeln verboten, ausnahmslos, auch bei reinen
  Textänderungen unter `docs/`. Gleiches gilt für die von GitHub Actions ebenso ausgewerteten Marken
  `[ci skip]`, `[no ci]`, `[skip actions]`, `[actions skip]` und den Nachsatz `skip-checks:true`.
  Hintergrund: Als die CI vom 24.08. bis 31.08.2026 wegen eines Abrechnungsproblems ausfiel,
  gelangten 58 Commits ungeprüft auf `main`, 21 davon zusätzlich mit `[skip ci]`. Der erste echte
  Lauf danach fand sechs rote Prüfungen mit vier Ursachen; zwei davon gingen unmittelbar auf
  `[skip ci]`-Commits zurück und wären im eigenen Pull Request sofort aufgefallen. Der für `main`
  eingerichtete Zweigschutz macht dieses Verbot selbsttragend: Ohne Prüfung kein grüner
  Pflichtstatus, ohne grünen Status kein Merge.
- **Zweigschutz für `main`:** Zwölf Pflichtprüfungen müssen grün sein, bevor gemergt werden kann –
  alle Aufträge der CI, nicht nur die schnellen:

  - Format, Lint, Typen, Unit-Tests und Build
  - PostgreSQL-Integration und Migrationen
  - Browser-Smoke admin und kellner1
  - Geheimnisprüfung
  - Docker backend linux/amd64
  - Docker backend linux/arm64
  - Docker frontend linux/amd64
  - Docker frontend linux/arm64
  - Docker print-worker linux/amd64
  - Docker print-worker linux/arm64
  - Docker-Bündel Migrationsstart
  - Docker-Bündel Aktualisierung (upgrade.sh, PRE_MIGRATION vor Migration)

  Warum alle zwölf und nicht nur Lint und Typen: VereinOrder läuft im Festbetrieb auf einem
  Raspberry Pi, ohne Netz. Die CI ist die einzige Instanz, die das Docker-Bündel vor dem Ernstfall
  vollständig hochfährt – deshalb sind gerade die Docker- und Bündel-Aufträge Pflicht, nicht nur
  Lint und Typen. Der Zweig muss vor dem Merge auf dem aktuellen Stand von `main` sein, ein Pull
  Request ist verpflichtend (ohne Pflicht zu einer Freigabe durch Dritte – das kann ein
  Einzelentwickler nicht leisten), erzwungene Pushes und das Löschen von `main` sind gesperrt. Der
  Schutz gilt auch für Administratoren.

  Notfallweg: Nur der Repository-Inhaber kann den Schutz aufheben, weil er der einzige
  Administrator ist. Der Weg lautet: Schutz vorübergehend abschalten, mergen, sofort wieder
  einschalten, und den Vorgang im betroffenen Pull Request vermerken. Der Vermerk ist der Punkt –
  eine Ausnahme, die niemand nachlesen kann, ist keine Ausnahme, sondern eine Lücke.

  Betriebsfalle: Pflichtprüfungen werden über den **Namen** des Auftrags zugeordnet. Wird ein
  Auftrag in `.github/workflows/ci.yml` umbenannt oder entfernt, wartet der Zweigschutz dauerhaft
  auf eine Meldung, die nie kommt – der Merge bleibt blockiert, ohne dass etwas rot ist. Wer einen
  Auftragsnamen ändert, muss die Liste der Pflichtprüfungen oben mitziehen. Das ist der
  wahrscheinlichste Weg, sich hier selbst auszusperren.

## Delegierte Aufgaben und Modellwahl

- Vor jeder Delegation werden Mitarbeiter beziehungsweise Teilaufgabe, Modell und Denkstufe
  sichtbar genannt.
- Modell und Denkstufe werden für jede Delegation ausdrücklich gesetzt und nicht unbeabsichtigt
  vom Hauptagenten geerbt.
- Für klar begrenzte Analysen und Dokumentationsarbeiten gilt `gpt-5.6-terra` mit `low` als
  Standard; normale Implementierungs- und Prüfaufgaben verwenden `gpt-5.6-terra` mit `medium`.
- `gpt-5.6-sol` sowie die Denkstufen `high`, `xhigh` oder `max` sind schwierigen Sicherheits-,
  Architektur-, Zahlungs- oder Nebenläufigkeitsfragen vorbehalten. Ihre Verwendung wird vor der
  Delegation kurz begründet.
- Ist die vorgesehene kosteneffiziente Konfiguration technisch nicht verfügbar, wird dies
  transparent gemeldet. Eine teurere Konfiguration wird nicht stillschweigend eingesetzt.

Für die wiederkehrenden Mitarbeiterrollen gilt folgende verbindliche Startkonfiguration:

| Mitarbeiterrolle             | Modell          | Claude   | Gemini     | Denkstufe | Begründung                                      |
| ---------------------------- | --------------- | -------- | ---------- | --------- | ----------------------------------------------- |
| Architektur nächster Schnitt | `gpt-5.6-sol`   | `opus`   | `pro`      | `high`    | Sicherheitsinvarianten und Nebenläufigkeit      |
| Umsetzungsreife              | `gpt-5.6-terra` | `sonnet` | `flash`    | `medium`  | Normale Implementierung und Integrationsprüfung |
| UI/UX-Konzept                | `gpt-5.6-terra` | `sonnet` | `pro`      | `high`    | Gestaltungsentscheidung vor der Umsetzung       |
| Issue-Priorisierung          | `gpt-5.6-terra` | `haiku`  | `flash-8b` | `low`     | Klar begrenzte Scope- und Abhängigkeitsanalyse  |
| Teststrategie                | `gpt-5.6-terra` | `sonnet` | `flash`    | `medium`  | Risikoabdeckung und prüfbare Abnahmeszenarien   |
| Wächtertests                 | `gpt-5.6-terra` | `sonnet` | `flash`    | `medium`  | Testaussagen samt Rot-Beweis                    |
| Datenmodell                  | `gpt-5.6-sol`   | `opus`   | `pro`      | `high`    | Transaktionen, Geld- und Audit-Invarianten      |
| Produktanforderungen         | `gpt-5.6-terra` | `haiku`  | `flash-8b` | `low`     | Fachliche Strukturierung ohne Codeänderung      |
| Betriebskonzept              | `gpt-5.6-terra` | `sonnet` | `flash`    | `medium`  | Lokaler Betrieb, Wiederherstellung und Übergabe |

Beide Modellspalten stehen gleichwertig nebeneinander; maßgeblich ist die Spalte der tatsächlich
ausführenden Umgebung. Für Claude und Gemini gilt zusätzlich:

- `haiku` bzw. `flash-8b` ist der Kostenanker für eng abgegrenzte, mechanische Arbeit ohne Codeänderung. Sein
  Kontextfenster ist deutlich kleiner als das der übrigen Klassen; repoweite Analysen erhalten
  daher mindestens `sonnet` bzw. `flash`.
- `sonnet` bzw. `flash` ist die Standardklasse für Implementierung, Integrationsprüfung und Teststrategie.
- `opus` bzw. `pro` bleibt Sicherheits-, Architektur-, Zahlungs- und Nebenläufigkeitsfragen vorbehalten.
- Die darüberliegende Klasse `fable` ist Reserve und wird ausschließlich nach ausdrücklicher
  Freigabe der Projektleitung eingesetzt.

Abweichungen von dieser Zuordnung werden vor der Delegation begründet. Abgeschlossene
Mitarbeiterinstanzen werden nicht nur zum Ändern ihrer Konfiguration neu gestartet; bei einem neuen
Arbeitsauftrag wird eine neue, passend konfigurierte Instanz verwendet.

### Hinterlegte Mitarbeiterdefinitionen

Zwei wiederkehrende Rollen sind unter `.claude/agents/` als Dauerauftrag hinterlegt, damit Modell,
Denkstufe und Pflichten nicht bei jeder Delegation neu entschieden werden müssen:

| Datei                             | Rolle         | Modell   | Denkstufe |
| --------------------------------- | ------------- | -------- | --------- |
| `.claude/agents/ui-ux-konzept.md` | UI/UX-Konzept | `sonnet` | `high`    |
| `.claude/agents/waechtertests.md` | Wächtertests  | `sonnet` | `medium`  |

**Warum das UI/UX-Konzept `sonnet` mit `high` bekommt und nicht `opus`.** Die Denkstufe trägt hier
mehr als die Modellklasse: Die Fehler, die in Issue #86 auftraten, waren Rechen- und
Sorgfaltsfehler — ein neuer Farbton, der die Schwelle verfehlte, für die er erfunden wurde, und
ein Fokusrahmen, dessen Unsichtbarkeit über vier Schnitte unbemerkt blieb. Beides entstand unter
`opus` mit `high` und wurde nicht vom Modell gefunden, sondern vom Nachrechnen. Die Definition
verlangt deshalb ausgerechnete Kontrastwerte statt Behauptungen; die teurere Klasse hätte daran
nichts geändert.

**Warum die Projektleitung diese Arbeit nicht selbst macht.** Sie prüft die Ergebnisse. Wer sein
eigenes Konzept umsetzt und seine eigenen Tests schreibt, prüft nichts, sondern wiederholt seine
Annahmen. Die Trennung ist der Zweck der Rollen, nicht ihre Verwaltung.

**Grenze der Zuständigkeit.** Das UI/UX-Konzept schreibt keinen Produktionscode, die
Wächtertest-Rolle keine Produktionslogik. Findet die Testrolle einen echten Fehler, schreibt sie
den Test, der ihn fängt, meldet ihn und lässt ihn rot stehen; behoben wird er von der
Umsetzungsrolle.

**Auftragsrahmen.** Delegationen benennen die zu lesenden Abschnitte. Ein Mitarbeiter, dem eine
1800-Zeilen-Datei zum Selbststudium überlassen wird, liest zu viel und liefert zu spät: In
Issue #86 sind zwei Delegationen am Ausgabelimit gestorben, eine nach 215 000 Token ohne
verwertbares Ergebnis.

## Pflichtprüfungen

Vor Commit mindestens Formatierung, Linting, Typprüfung und relevante Tests ausführen.
Frontendänderungen zusätzlich zwingend durch den Agenten über den `browser_subagent` auf ihre Funktionalität (Interaktion, Modals, Formulare) in einem echten Browser bei ungefähr 390×844, 768×1024 und 1440×900 Pixel prüfen. Dabei muss zwingend sowohl mit einem **Administrator-Benutzer** (`admin`) als auch mit einem **Kellner-Benutzer** (`kellner1` / `WAITER`) getestet werden. Die UI darf nicht ungetestet gepusht werden. Datenbank-, Docker- und Raspberry-Pi-Änderungen benötigen die jeweils relevanten Integrationsprüfungen.

## Abschlussbericht

Jeder Arbeitsauftrag berichtet geänderte Dateien, ausgeführte Befehle, Testergebnisse,
Annahmen, Risiken, nicht ausführbare Prüfungen und mögliche Konflikte.
