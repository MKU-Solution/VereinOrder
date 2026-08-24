import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const compose = readFileSync(resolve(root, "docker-compose.yml"), "utf8");
const dockerfile = readFileSync(
  resolve(root, "apps/backend/Dockerfile"),
  "utf8",
);

const server = compose.match(/image:\s*postgres:(\d+)-alpine/);
const client = dockerfile.match(/postgresql(\d+)-client/);
if (!server || !client) {
  throw new Error(
    "PostgreSQL-Server- oder Client-Hauptversion konnte nicht eindeutig gelesen werden.",
  );
}
if (server[1] !== client[1]) {
  throw new Error(
    `PostgreSQL-Hauptversionen weichen ab: Server ${server[1]}, Client ${client[1]}.`,
  );
}
if (!dockerfile.includes("FROM node:20-alpine AS runner")) {
  throw new Error("Das ARM64-/AMD64-fähige Alpine-Laufzeitabbild fehlt.");
}

console.log(
  `PostgreSQL-Werkzeugbindung geprüft: Server und Client verwenden Hauptversion ${server[1]}; das Laufzeitabbild ist plattformneutral.`,
);
