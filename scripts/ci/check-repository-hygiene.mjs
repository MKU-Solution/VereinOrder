import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const git = spawnSync("git", ["ls-files", "-z"], { encoding: "utf8" });
if (git.status !== 0) {
  console.error(git.stderr || "Git-Dateiliste konnte nicht gelesen werden.");
  process.exit(git.status || 1);
}

const forbidden = [
  {
    pattern:
      /(^|\/)(node_modules|\.pnpm-store|dist|build|coverage|playwright-report|test-results)(\/|$)/,
    reason: "generiertes Build-/Testartefakt",
  },
  {
    pattern: /(^|\/)backups?\/.*\.(json|sql|dump|backup)$/i,
    reason: "Laufzeit- oder Datenbankbackup",
  },
  { pattern: /\.tsbuildinfo$/i, reason: "TypeScript-Inkrementaldatei" },
  {
    pattern: /^apps\/frontend\/vite\.config\.(js|d\.ts)$/i,
    reason: "aus TypeScript generierte Vite-Konfiguration",
  },
  {
    pattern: /(^|\/)\.env($|\.)/,
    allow: /(^|\/)\.env\.example$/,
    reason: "Umgebungsdatei mit möglichen Geheimnissen",
  },
];

const violations = [];
for (const file of git.stdout.split("\0").filter(Boolean)) {
  if (!existsSync(file)) continue;
  for (const rule of forbidden) {
    if (rule.pattern.test(file) && !rule.allow?.test(file)) {
      violations.push(`${file} (${rule.reason})`);
      break;
    }
  }
}

if (violations.length > 0) {
  console.error("Verbotene Laufzeitdateien sind in Git eingecheckt:");
  for (const violation of violations) console.error(`- ${violation}`);
  process.exit(1);
}

console.log(
  "Repository-Hygiene geprüft: keine verbotenen Laufzeitdateien verfolgt.",
);

// --- .dockerignore deckt Umgebungsdateien ab (#182) -------------------------
//
// Warum diese Pruefung ueberhaupt noetig ist: .gitignore und .dockerignore
// sehen gleich aus und bedeuten Verschiedenes. git wendet ein Muster ohne
// Schraegstrich auf jeder Ebene an, Docker vergleicht es mit dem
// vollstaendigen relativen Pfad. Die woertlich gleiche Zeile ".env" schloss in
// git jede solche Datei aus, in Docker nur die im Wurzelverzeichnis - und weil
// git sie ignorierte, fiel in "git status" nichts auf, waehrend
// apps/backend/.env ueber "COPY apps/backend ./apps/backend" in die
// Builder-Schicht wanderte.
//
// Ein Kommentar in .dockerignore allein haelt das nicht: Die naechste Zeile
// wird wieder aus .gitignore abgeschrieben. Deshalb wird hier die WIRKUNG der
// Muster geprueft, nicht ihr Wortlaut.

// Uebersetzt ein .dockerignore-Muster in einen regulaeren Ausdruck.
//
// Nachgebildet ist der Teil der Docker-Syntax, den diese Datei verwendet:
// "**" ueber Verzeichnisgrenzen hinweg, "*" und "?" innerhalb eines
// Pfadabschnitts. Entscheidend ist "(?:[^/]+/)*" fuer "**/": Es passt auch auf
// NULL Abschnitte, "**/.env" erfasst deshalb sowohl ".env" als auch
// "apps/backend/.env" - genau das Verhalten, das ein Testbau bestaetigt.
function dockerPatternToRegExp(pattern) {
  const characters = [...pattern];
  let source = "^";
  for (let index = 0; index < characters.length; index += 1) {
    const character = characters[index];
    if (character === "*") {
      if (characters[index + 1] === "*") {
        index += 1;
        if (characters[index + 1] === "/") {
          index += 1;
          source += "(?:[^/]+/)*";
        } else {
          source += ".*";
        }
      } else {
        source += "[^/]*";
      }
    } else if (character === "?") {
      source += "[^/]";
    } else {
      source += character.replace(/[.+^${}()|[\]\\]/, "\\$&");
    }
  }
  return new RegExp(`${source}$`);
}

function readDockerIgnoreRules() {
  const raw = readFileSync(".dockerignore", "utf8");
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"))
    .map((line) => {
      const negated = line.startsWith("!");
      const body = (negated ? line.slice(1) : line).replace(/\/+$/, "");
      return { negated, regex: dockerPatternToRegExp(body) };
    });
}

// Ein Pfad ist ausgeschlossen, wenn ein Muster ihn selbst ODER eines seiner
// Elternverzeichnisse trifft - "**/node_modules" schliesst auch alles darin
// aus. Bei mehreren Treffern gewinnt der letzte, damit "!"-Ausnahmen wirken.
function isExcludedFromBuildContext(path, rules) {
  const segments = path.split("/");
  let excluded = false;
  for (let depth = 1; depth <= segments.length; depth += 1) {
    const prefix = segments.slice(0, depth).join("/");
    for (const rule of rules) {
      if (rule.regex.test(prefix)) excluded = !rule.negated;
    }
  }
  return excluded;
}

const dockerIgnoreRules = readDockerIgnoreRules();
const dockerIgnoreProblems = [];

// Teil 1: die Zusage selbst, an festen Pfaden festgenagelt. Diese Liste ist
// die eigentliche Aussage von #182 - sie faellt um, sobald jemand "**/.env"
// wieder zu ".env" verkuerzt, und zwar ohne dass ein Abbild gebaut werden muss.
const mustBeExcluded = [
  ".env",
  ".env.local",
  ".env.production.local",
  "apps/backend/.env",
  "apps/frontend/.env",
  "apps/print-worker/.env",
  "packages/database/.env",
  "apps/frontend/.env.local",
  "apps/frontend/.env.staging.local",
];
// Die Gegenprobe: Ein pauschales "**/.env.*" waere die naheliegende, falsche
// Abkuerzung - es verschluckt .env.example, und die wird im Baukontext
// gebraucht.
const mustNotBeExcluded = [".env.example", "apps/backend/.env.example"];

for (const path of mustBeExcluded) {
  if (!isExcludedFromBuildContext(path, dockerIgnoreRules)) {
    dockerIgnoreProblems.push(
      `${path} gelangt in den Docker-Baukontext, obwohl .dockerignore das verhindern soll (#182).`,
    );
  }
}
for (const path of mustNotBeExcluded) {
  if (isExcludedFromBuildContext(path, dockerIgnoreRules)) {
    dockerIgnoreProblems.push(
      `${path} wird von .dockerignore ausgeschlossen, gehoert aber in den Baukontext.`,
    );
  }
}

// Teil 2: der Blick auf die Platte. Teil 1 deckt die Schreibweisen ab, an die
// beim Formulieren der Muster gedacht wurde; hier faellt auf, was jemand
// tatsaechlich angelegt hat - eine ".env.production" etwa passt auf keines der
// drei Muster und wuerde mitgebaut. In der CI ist dieser Teil leer, auf einem
// Entwicklungsrechner ist er der eigentliche Fang.
function collectEnvironmentFiles(directory, relative = "") {
  const found = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = relative === "" ? entry.name : `${relative}/${entry.name}`;
    if (entry.isDirectory()) {
      if (isExcludedFromBuildContext(path, dockerIgnoreRules)) continue;
      found.push(...collectEnvironmentFiles(join(directory, entry.name), path));
    } else if (
      entry.name.startsWith(".env") &&
      entry.name !== ".env.example" &&
      !isExcludedFromBuildContext(path, dockerIgnoreRules)
    ) {
      found.push(path);
    }
  }
  return found;
}

for (const path of collectEnvironmentFiles(".")) {
  dockerIgnoreProblems.push(
    `${path} liegt im Arbeitsverzeichnis und wuerde in den Docker-Baukontext gelangen. ` +
      `Entweder die Datei entfernen oder .dockerignore um ihre Schreibweise erweitern ` +
      `(kein pauschales "**/.env.*", das erfasst auch .env.example).`,
  );
}

if (dockerIgnoreProblems.length > 0) {
  console.error(
    "Umgebungsdateien sind gegen den Docker-Baukontext ungeschützt:",
  );
  for (const problem of dockerIgnoreProblems) console.error(`- ${problem}`);
  process.exit(1);
}

console.log(
  ".dockerignore geprüft: Umgebungsdateien bleiben auf jeder Ebene außerhalb des Baukontexts, .env.example bleibt darin.",
);
