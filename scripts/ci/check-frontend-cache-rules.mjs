import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

// #179: apps/frontend/nginx.conf traegt seitdem feste Cache-Regeln fuer jede
// ungestempelte Bauausgabe des Frontends (index.html, das Service-Worker-
// Registrierungsskript, die Webmanifest-Datei, der Service Worker selbst).
// Diese Liste wurde von Hand an einem echten Bauergebnis abgelesen - und
// genau das ist die Schwachstelle: Legt ein kuenftiger Bau eine weitere
// ungestempelte Datei ab, an die beim Schreiben der Regeln niemand gedacht
// hat, faellt sie unbemerkt unter die allgemeine Auslieferung und wird
// unbegrenzt zwischengespeichert - das urspruengliche Problem von #179 kehrt
// zurueck, ohne dass irgendwo ein Fehler erscheint.
//
// Diese Pruefung fuehrt deshalb KEINE zweite, separat gepflegte Dateiliste
// (die bei jeder Aenderung hier von Hand nachgezogen werden muesste und
// damit dasselbe Vergessens-Risiko nur verdoppelt) und parst auch nicht die
// nginx-Syntax im Detail (das braeche bei jeder Umformulierung, ohne dass
// sich am Verhalten etwas aendert). Sie liest stattdessen das tatsaechliche
// Bauergebnis unter apps/frontend/dist und verlangt fuer jede darin
// gefundene ungestempelte Datei lediglich, dass irgendeine 'location'-Zeile
// in nginx.conf ihren Pfad woertlich nennt.

const DIST_DIR = "apps/frontend/dist";
const NGINX_CONF = "apps/frontend/nginx.conf";

if (!existsSync(DIST_DIR)) {
  console.error(
    `${DIST_DIR} fehlt. Diese Pruefung liest die Cache-Regeln gegen ein ` +
      "echtes Bauergebnis, nicht gegen eine vermutete oder gepflegte " +
      "Dateiliste, und kann ohne ein solches Ergebnis nichts pruefen - sie " +
      "bricht deshalb ab, statt sich als bestanden zu melden. Vorher " +
      "'pnpm --filter @vereinorder/frontend run build' ausfuehren (in der " +
      "CI laeuft dieser Schritt erst NACH 'pnpm build', siehe ci.yml).",
  );
  process.exit(1);
}

// Bekannte Namensschemata gestempelter Dateien, am Bauergebnis von #179
// abgelesen: alles unter assets/ traegt Vite's Inhaltsstempel im Namen,
// workbox-<Hash>.js traegt den Stempel von vite-plugin-pwa, liegt aber
// ausserhalb von assets/. Alles andere gilt als ungestempelt - auch wenn ein
// kuenftiger Bau ein drittes Namensschema mit eigenem Stempel einfuehrt. Das
// ist die sichere Richtung fuer einen Fehlschlag: Eine faelschlich als
// "ungestempelt" behandelte, tatsaechlich gestempelte Datei verlangt
// hoechstens eine ueberfluessige Regel; das Umgekehrte waere wieder genau
// das Problem, das #179 beheben sollte.
function isStamped(relativePath) {
  return (
    relativePath.startsWith("assets/") ||
    /^workbox-[^/]+\.js$/.test(relativePath)
  );
}

function collectFiles(directory, relative = "") {
  const found = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = relative === "" ? entry.name : `${relative}/${entry.name}`;
    if (entry.isDirectory()) {
      found.push(...collectFiles(join(directory, entry.name), path));
    } else {
      found.push(path);
    }
  }
  return found;
}

// Verlangt keine bestimmte Cache-Control-Auspraegung und kein bestimmtes
// location-Praefix (=, ^~, ~*) - nur, dass irgendeine 'location'-Zeile den
// Dateipfad woertlich als eigenen Pfadabschnitt enthaelt. Das reicht, um das
// Vergessen einer Regel zu erkennen, ohne die nginx-Syntax selbst verstehen
// zu muessen.
function hasNamingRule(nginxConf, relativePath) {
  const escaped = relativePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(
    `^\\s*location\\b[^\\n{]*/${escaped}(?=[\\s"'{]|$)`,
    "m",
  );
  return pattern.test(nginxConf);
}

const nginxConf = readFileSync(NGINX_CONF, "utf8");
const unstamped = collectFiles(DIST_DIR).filter((path) => !isStamped(path));
const missing = unstamped.filter((path) => !hasNamingRule(nginxConf, path));

if (missing.length > 0) {
  console.error(
    `${NGINX_CONF} nennt nicht jede ungestempelte Bauausgabe aus ${DIST_DIR} ` +
      "beim Namen:",
  );
  for (const path of missing) {
    console.error(
      `- ${path}: keine 'location'-Regel gefunden, die "/${path}" enthaelt. ` +
        `Eine eigene Regel ergaenzen, z. B. 'location = /${path} { ` +
        'add_header Cache-Control "no-cache, must-revalidate" always; }\' - ' +
        "ohne Stempel im Namen faellt diese Datei sonst unter die " +
        "allgemeine Auslieferung in location / und wird unbegrenzt " +
        "zwischengespeichert (#179).",
    );
  }
  process.exit(1);
}

console.log(
  `Frontend-Cache-Regeln geprueft: alle ${unstamped.length} ungestempelten ` +
    `Dateien aus ${DIST_DIR} sind in ${NGINX_CONF} namentlich erfasst.`,
);
