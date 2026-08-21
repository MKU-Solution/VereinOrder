import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

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
