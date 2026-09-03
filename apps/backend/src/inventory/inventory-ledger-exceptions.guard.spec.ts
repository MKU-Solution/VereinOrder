import * as fs from "fs";
import * as path from "path";
import * as ts from "typescript";

/**
 * Waechtertest fuer die Ausnahmen vom Append-only-Trigger des Bestandsledgers
 * (Issue #154).
 *
 * WAS HIER GESCHUETZT WIRD
 * ------------------------
 * "InventoryMovement" ist per Datenbanktrigger unveraenderlich
 * (guard_inventory_movement_append_only, Migrationen 20260829100000 und
 * 20260829130000). Der Trigger kennt genau zwei transaktionslokale
 * Ausnahmen, aktiviert per "SET LOCAL":
 *   - "vereinorder.inventory_restore"    - UPDATE und DELETE, jede
 *     Betriebsart. Gesetzt vom Sicherungsdienst beim Einspielen einer alten
 *     JSON-Sicherung (apps/backend/src/backup/backup.service.ts).
 *   - "vereinorder.inventory_test_reset" - ausschliesslich DELETE,
 *     ausschliesslich Zeilen der Betriebsart TEST. Gesetzt und sofort danach
 *     wieder abgeschaltet von der Testdatenbereinigung
 *     (apps/backend/src/events/events.service.ts).
 * Die Unveraenderlichkeit des Ledgers haengt also nicht nur am Trigger,
 * sondern auch daran, dass es im Anwendungscode nur diese beiden, bewusst
 * engen Aufrufstellen gibt.
 *
 * WARUM EIN TEST UND KEINE EIGENE DATENBANKROLLE
 * -----------------------------------------------
 * Eine eigene Datenbankrolle wurde bewusst NICHT gewaehlt (Entscheidung des
 * Projektinhabers zu Issue #154). PostgreSQL laesst sich fuer eine
 * selbstdefinierte Einstellung ("custom GUC") nicht auf bestimmte Rollen
 * einschraenken - jede Verbindung darf "SET LOCAL" fuer einen beliebigen
 * Namen im Namensraum "vereinorder.*" ausfuehren. Eine echte Absicherung
 * muesste stattdessen im Trigger selbst die Rolle der Verbindung pruefen und
 * braeuchte dafuer eine zweite Zugangskennung - zusaetzliche Konfiguration in
 * docker-compose, in .env und bei der Installation auf dem Raspberry Pi. Die
 * Anwendung verbindet sich ohnehin als Superuser; gegen jemanden mit genau
 * diesen Zugangsdaten wuerde eine Rollentrennung nichts schuetzen, die sie
 * nicht ohnehin schon hat. Die tatsaechliche Gefahr ist eine andere: dass
 * irgendwann eine dritte Stelle im eigenen Code die Ausnahme setzt, ohne dass
 * es jemandem auffaellt. Genau das faengt dieser Test ab - zum
 * Entwicklungszeitpunkt, in jedem "jest"-Lauf, ohne Datenbank.
 *
 * GRENZE DIESES TESTS
 * --------------------
 * Dieser Test schuetzt gegen unbemerkte NEUE Aufrufstellen im eigenen
 * Quelltext. Er schuetzt NICHT gegen jemanden, der ueber die Zugangsdaten der
 * Datenbank verfuegt und "SET LOCAL" von ausserhalb der Anwendung setzt -
 * dagegen hilft nur eine Rollentrennung, die hier bewusst nicht gewaehlt
 * wurde (siehe oben). Wird dieser Test durch etwas "Besseres" ersetzt, muss
 * dieses Bessere dieselbe Abwaegung explizit treffen, nicht implizit
 * unterlaufen.
 *
 * ECHTE VERWENDUNG VS. BLOSSE ERWAEHNUNG
 * ----------------------------------------
 * Kommentare, die "vereinorder.inventory_restore" oder
 * "vereinorder.inventory_test_reset" nur zur Erklaerung nennen (z. B. der
 * Kommentar in events.service.ts direkt ueber der eigentlichen Aufrufstelle),
 * sind harmlos und duerfen den Test nicht ausloesen - sonst waere er staendig
 * eine Last bei jeder erklaerenden Anmerkung. Eine tatsaechliche SQL-Anweisung
 * (das Innere eines Template-Literals wie "Prisma.sql`SET LOCAL ...`") ist
 * hingegen scharf: sie hebt bei Ausfuehrung die Unveraenderlichkeit auf und
 * MUSS erfasst werden. Die Trennung geschieht nicht per Text-Heuristik
 * (z. B. "Zeile beginnt mit //"), sondern ueber den TypeScript-Scanner
 * ("ts.createScanner" mit "skipTrivia = false"): er zerlegt jede Datei in
 * Token und markiert Kommentare eindeutig als "SingleLineCommentTrivia" bzw.
 * "MultiLineCommentTrivia". Nur Fundstellen ausserhalb dieser Kommentar-Token
 * zaehlen als Verwendung. Das ist robust gegenueber Formatierung (Kommentar
 * ueber, neben oder unter dem Code) und gegenueber String-Inhalten, die
 * zufaellig wie ein Kommentaranfang aussehen - eine reine Regex-Loesung
 * waere hier fehleranfaelliger.
 *
 * WARUM AUCH DIE MIGRATIONEN GEPRUEFT WERDEN
 * ---------------------------------------------
 * Der zweite Testfall unten durchsucht zusaetzlich die SQL-Migrationen nach
 * Einstellungsnamen im Namensraum "vereinorder.*". Das ist bewusst mehr als
 * die Aufgabenstellung im engeren Sinn verlangt (die von Aufrufstellen im
 * Anwendungscode spricht), aber sinnvoll: eine dritte Ausnahme koennte auch
 * direkt im Trigger selbst entstehen - durch eine neue Migration, die eine
 * weitere "current_setting('vereinorder.xyz', true)"-Abfrage ergaenzt -, noch
 * bevor oder ohne dass Anwendungscode sie ueberhaupt aufruft. Der erste
 * Testfall allein wuerde das nicht bemerken, weil er nur Anwendungscode
 * durchsucht. Beide Testfaelle zusammen decken damit beide Enden der
 * Ausnahme ab: wo sie im Trigger definiert ist und wo sie im Anwendungscode
 * gezogen wird.
 *
 * WAS BEI EINEM FEHLSCHLAG ZU TUN IST
 * --------------------------------------
 * Der Zweck ist nicht, eine dritte Stelle zu verbieten, sondern zu
 * verhindern, dass sie unbemerkt entsteht. Ist die neue Stelle berechtigt:
 * die Liste unten ("ALLOWED_EXCEPTION_SITES" bzw. "KNOWN_TRIGGER_SETTINGS")
 * erweitern UND die Erweiterung im "reason"-Feld begruenden. Ist sie es
 * nicht: den "SET LOCAL"-Aufruf bzw. die neue Trigger-Abfrage wieder
 * entfernen.
 */

const SRC_ROOT = path.resolve(__dirname, "..");
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");
const MIGRATIONS_ROOT = path.join(
  REPO_ROOT,
  "packages",
  "database",
  "prisma",
  "migrations",
);
const SELF_FILE = path.resolve(__filename);

/** Erkennt jede Einstellung im Namensraum der Anwendung, nicht nur die zwei
 * heute bekannten - eine voellig neu erfundene Ausnahme faellt damit
 * ebenfalls auf, nicht nur eine zusaetzliche Verwendung der bestehenden. */
const NAMESPACE_PATTERN = /vereinorder\.[A-Za-z_][A-Za-z0-9_]*/g;

const KNOWN_TRIGGER_SETTINGS = new Set<string>([
  "vereinorder.inventory_restore",
  "vereinorder.inventory_test_reset",
]);

interface ExceptionSite {
  setting: string;
  /** Pfad relativ zu apps/backend/src, mit "/" als Trenner. */
  file: string;
  /** Anzahl echter (nicht-kommentierter) Fundstellen in dieser Datei. */
  occurrences: number;
  reason: string;
}

/**
 * Die vollstaendige, geprueft-abschliessende Liste der Stellen im
 * Anwendungscode, die eine der beiden Ledger-Ausnahmen tatsaechlich setzen.
 * Jede neue oder veraenderte Fundstelle im Quelltext muss hier auftauchen -
 * sonst schlaegt der Test unten fehl.
 */
const ALLOWED_EXCEPTION_SITES: ExceptionSite[] = [
  {
    setting: "vereinorder.inventory_restore",
    file: "backup/backup.service.ts",
    occurrences: 1,
    reason:
      "Sicherungsdienst ersetzt beim Einspielen einer alten JSON-Sicherung " +
      "den gesamten operativen Datenbestand einschliesslich Ledger und muss " +
      "dafuer bestehende Bewegungen loeschen und neu schreiben duerfen " +
      "(Issue #103).",
  },
  {
    setting: "vereinorder.inventory_test_reset",
    file: "events/events.service.ts",
    occurrences: 2,
    reason:
      "Testdatenbereinigung einer Veranstaltung schaltet die enge " +
      "Loesch-Ausnahme fuer TEST-Ledgerzeilen unmittelbar vor den " +
      "betroffenen deleteMany-Aufrufen ein ('on') und direkt danach wieder " +
      "aus ('off'), damit sie ausserhalb dieser zwei Anweisungen nie gilt " +
      "(Issue #141).",
  },
];

function isRelevantSourceFile(fileName: string): boolean {
  if (!fileName.endsWith(".ts")) return false;
  if (fileName.endsWith(".d.ts")) return false;
  // Tests laufen gegen Mocks, nie gegen eine echte Transaktion. Eine
  // tatsaechliche Aufrufstelle, die den Trigger beeinflusst, muss in
  // Produktionscode stehen, der wirklich eine Datenbankverbindung nutzt.
  if (fileName.endsWith(".spec.ts")) return false;
  return true;
}

function listFilesRecursively(
  dir: string,
  predicate: (fileName: string) => boolean,
): string[] {
  const result: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      result.push(...listFilesRecursively(fullPath, predicate));
    } else if (entry.isFile() && predicate(entry.name)) {
      result.push(fullPath);
    }
  }
  return result;
}

/**
 * Liefert alle Fundstellen von "vereinorder.<name>" in "text", die NICHT in
 * einem Kommentar stehen. Reine Kernlogik ohne Dateizugriff, damit sie
 * unabhaengig von echten Quelltextdateien getestet werden kann (siehe
 * "Nachweis" weiter unten).
 */
export function extractNonCommentNamespaceUsages(text: string): string[] {
  const scanner = ts.createScanner(
    ts.ScriptTarget.Latest,
    /* skipTrivia */ false,
    ts.LanguageVariant.Standard,
    text,
  );
  const matches: string[] = [];
  let kind = scanner.scan();
  while (kind !== ts.SyntaxKind.EndOfFileToken) {
    const isComment =
      kind === ts.SyntaxKind.SingleLineCommentTrivia ||
      kind === ts.SyntaxKind.MultiLineCommentTrivia;
    if (!isComment) {
      const tokenText = text.slice(scanner.getTokenPos(), scanner.getTextPos());
      const found = tokenText.match(NAMESPACE_PATTERN);
      if (found) matches.push(...found);
    }
    kind = scanner.scan();
  }
  return matches;
}

function stripSqlLineComments(sql: string): string {
  return sql
    .split("\n")
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n")
    .replace(/\/\*[\s\S]*?\*\//g, "");
}

interface FoundSite {
  setting: string;
  file: string;
  occurrences: number;
}

function collectSitesInSource(): FoundSite[] {
  const files = listFilesRecursively(SRC_ROOT, isRelevantSourceFile);
  const counts = new Map<string, number>();

  for (const file of files) {
    if (path.resolve(file) === SELF_FILE) continue; // eigene Allowlist-Strings sind kein Fund
    const text = fs.readFileSync(file, "utf8");
    const usages = extractNonCommentNamespaceUsages(text);
    if (usages.length === 0) continue;

    const relFile = path.relative(SRC_ROOT, file).split(path.sep).join("/");
    for (const setting of usages) {
      const key = `${setting}::${relFile}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }

  return [...counts.entries()].map(([key, occurrences]) => {
    const [setting, file] = key.split("::");
    return { setting, file, occurrences };
  });
}

function siteKey(s: { setting: string; file: string; occurrences: number }) {
  return `${s.setting}::${s.file}::${s.occurrences}`;
}

describe("Waechtertest: Aufrufstellen der Ledger-Ausnahmen (Issue #154)", () => {
  it("findet im Anwendungscode ausschliesslich die dokumentierten Aufrufstellen", () => {
    const actual = collectSitesInSource();
    const expected: FoundSite[] = ALLOWED_EXCEPTION_SITES.map((s) => ({
      setting: s.setting,
      file: s.file,
      occurrences: s.occurrences,
    }));

    const expectedKeys = new Set(expected.map(siteKey));
    const actualKeys = new Set(actual.map(siteKey));

    const unexpected = actual.filter((s) => !expectedKeys.has(siteKey(s)));
    const missing = expected.filter((s) => !actualKeys.has(siteKey(s)));

    if (unexpected.length === 0 && missing.length === 0) return;

    const lines: string[] = [
      "Die tatsaechlichen Aufrufstellen der Ledger-Ausnahmen " +
        "(vereinorder.inventory_restore / vereinorder.inventory_test_reset) " +
        "weichen von der dokumentierten Liste ALLOWED_EXCEPTION_SITES in " +
        "apps/backend/src/inventory/inventory-ledger-exceptions.guard.spec.ts ab.",
      "",
    ];

    if (unexpected.length > 0) {
      lines.push("Neu bzw. veraendert gefunden (nicht in der Liste):");
      for (const s of unexpected) {
        lines.push(`  - ${s.setting} in ${s.file} (${s.occurrences}x)`);
      }
      lines.push("");
    }
    if (missing.length > 0) {
      lines.push(
        "In der Liste dokumentiert, aber im Quelltext nicht (mehr) so gefunden:",
      );
      for (const s of missing) {
        lines.push(
          `  - ${s.setting} in ${s.file} (erwartet ${s.occurrences}x)`,
        );
      }
      lines.push("");
    }

    lines.push(
      "Ist die neue oder veraenderte Stelle berechtigt: ALLOWED_EXCEPTION_SITES " +
        "in dieser Datei entsprechend erweitern/anpassen UND die Aenderung im " +
        "'reason'-Feld begruenden - genau das ist der Zweck dieses Tests: " +
        "keine dritte Stelle verbieten, sondern verhindern, dass sie unbemerkt " +
        "entsteht.",
    );
    lines.push(
      "Ist sie NICHT berechtigt: den SET-LOCAL-Aufruf wieder entfernen - er " +
        "hebt sonst die Unveraenderlichkeit des Bestandsledgers ohne " +
        "Widerstand aus (Issue #154).",
    );

    throw new Error(lines.join("\n"));
  });

  it("loest bei einer blossen Kommentar-Erwaehnung NICHT aus (Nachweis der Trennung)", () => {
    const nurKommentar = `
      // Diese Zeile erklaert nur, dass es "vereinorder.inventory_restore" gibt.
      /* Auch ein Blockkommentar ueber vereinorder.inventory_test_reset zaehlt nicht. */
      const harmless = "kein SET LOCAL hier";
    `;
    expect(extractNonCommentNamespaceUsages(nurKommentar)).toEqual([]);

    const echterAufruf = `
      await tx.$executeRaw(
        Prisma.sql\`SET LOCAL "vereinorder.inventory_restore" = 'on'\`,
      );
    `;
    expect(extractNonCommentNamespaceUsages(echterAufruf)).toEqual([
      "vereinorder.inventory_restore",
    ]);
  });

  it("kennt in den Migrationen (dem Trigger selbst) ausschliesslich die beiden dokumentierten Einstellungsnamen", () => {
    const migrationFiles = listFilesRecursively(
      MIGRATIONS_ROOT,
      (name) => name === "migration.sql",
    );
    // Sanity-Check: Wenn dieser Pfad ins Leere liefe, waere der Testfall
    // unten wertlos, ohne dass ein Fehlschlag das anzeigen wuerde.
    expect(migrationFiles.length).toBeGreaterThan(0);

    const found = new Set<string>();
    for (const file of migrationFiles) {
      const withoutComments = stripSqlLineComments(
        fs.readFileSync(file, "utf8"),
      );
      const names = withoutComments.match(NAMESPACE_PATTERN) ?? [];
      names.forEach((n) => found.add(n));
    }

    const unknown = [...found].filter((n) => !KNOWN_TRIGGER_SETTINGS.has(n));
    if (unknown.length === 0) return;

    throw new Error(
      [
        `Unbekannte Einstellungsname(n) im Bestandsledger-Trigger entdeckt: ${unknown.join(", ")}.`,
        "guard_inventory_movement_append_only kannte bislang ausschliesslich: " +
          [...KNOWN_TRIGGER_SETTINGS].join(", ") +
          ".",
        "Ist die neue Ausnahme beabsichtigt: KNOWN_TRIGGER_SETTINGS in dieser " +
          "Datei ergaenzen, die zugehoerige Aufrufstelle in " +
          "ALLOWED_EXCEPTION_SITES eintragen und beides begruenden.",
        "Ist sie NICHT beabsichtigt: die neue Abfrage wieder aus der Migration " +
          "entfernen (Issue #154).",
      ].join("\n"),
    );
  });
});
