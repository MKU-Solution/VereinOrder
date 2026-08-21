import * as net from "node:net";

import { PreparedDocument } from "../printing/prepare";
import { PrintTarget } from "../target";
import {
  DeliveryResult,
  PrintErrorCode,
  PrinterAdapter,
  PrintTransportError,
} from "./types";

export interface TcpAdapterOptions {
  /** Nur für Tests: eigene Verbindungsfunktion. */
  connect?: (options: net.NetConnectOpts) => net.Socket;
  /**
   * Wartezeit auf das Schließen der Verbindung durch den Drucker, nachdem
   * alle Bytes gesendet wurden. Viele Bondrucker schließen selbst; die
   * übrigen werden nach dieser Frist als erfolgreich gewertet.
   */
  lingerMs?: number;
}

const DEFAULT_LINGER_MS = 1500;

const ERROR_CODES: Record<string, PrintErrorCode> = {
  ENOTFOUND: "DNS_ERROR",
  EAI_AGAIN: "DNS_ERROR",
  ECONNREFUSED: "CONNECTION_REFUSED",
  EHOSTUNREACH: "UNREACHABLE",
  ENETUNREACH: "UNREACHABLE",
  EHOSTDOWN: "UNREACHABLE",
  ENETDOWN: "UNREACHABLE",
  EACCES: "UNREACHABLE",
  ETIMEDOUT: "TIMEOUT",
  ECONNRESET: "CONNECTION_LOST",
  EPIPE: "CONNECTION_LOST",
};

function endpoint(target: PrintTarget): string {
  return `${target.host}:${target.port}`;
}

function describe(
  code: PrintErrorCode,
  target: PrintTarget,
  raw?: string,
): string {
  switch (code) {
    case "DNS_ERROR":
      return `Adresse "${target.host}" konnte nicht aufgelöst werden.`;
    case "CONNECTION_REFUSED":
      return `Verbindung zu ${endpoint(target)} wurde abgelehnt. Drucker eingeschaltet und Port korrekt?`;
    case "UNREACHABLE":
      return `Drucker ${endpoint(target)} ist im Netzwerk nicht erreichbar.`;
    case "TIMEOUT":
      return `Zeitüberschreitung nach ${target.timeoutMs} ms bei ${endpoint(target)}.`;
    case "WRITE_FAILED":
      return `Druckdaten konnten nicht an ${endpoint(target)} gesendet werden.`;
    default:
      return `Verbindung zu ${endpoint(target)} abgebrochen${raw ? ` (${raw})` : ""}.`;
  }
}

function classify(error: NodeJS.ErrnoException): PrintErrorCode {
  return ERROR_CODES[String(error.code)] ?? "CONNECTION_LOST";
}

/**
 * Raw-TCP-Transport für ESC/POS-Netzwerkdrucker (LAN und WLAN, Port 9100).
 *
 * Erfolgreich ist ein Auftrag erst, wenn alle Bytes gesendet und die
 * Verbindung sauber beendet wurde. Jeder andere Ausgang meldet einen Fehler
 * mit stabiler Kennung, damit der Auftrag als `FAILED` endet.
 */
export function createTcpAdapter(
  options: TcpAdapterOptions = {},
): PrinterAdapter {
  const connect = options.connect ?? net.connect;
  const lingerMs = options.lingerMs ?? DEFAULT_LINGER_MS;

  return {
    kind: "escpos-network",
    deliver(
      prepared: PreparedDocument,
      target: PrintTarget,
    ): Promise<DeliveryResult> {
      return new Promise<DeliveryResult>((resolve, reject) => {
        const socket = connect({ host: target.host, port: target.port });

        let settled = false;
        let written = false;
        let deadline: NodeJS.Timeout | undefined;
        let linger: NodeJS.Timeout | undefined;

        const clearTimers = () => {
          if (deadline) clearTimeout(deadline);
          if (linger) clearTimeout(linger);
          deadline = undefined;
          linger = undefined;
        };

        const succeed = () => {
          if (settled) return;
          settled = true;
          clearTimers();
          socket.destroy();
          resolve({
            transport: "escpos-network",
            bytes: prepared.bytes.length,
          });
        };

        const fail = (code: PrintErrorCode, raw?: string) => {
          if (settled) return;
          settled = true;
          clearTimers();
          socket.destroy();
          reject(new PrintTransportError(code, describe(code, target, raw)));
        };

        deadline = setTimeout(() => fail("TIMEOUT"), target.timeoutMs);

        socket.setNoDelay(true);
        socket.setTimeout(target.timeoutMs, () => fail("TIMEOUT"));

        socket.on("error", (error: NodeJS.ErrnoException) =>
          fail(classify(error), error.code),
        );

        socket.on("connect", () => {
          socket.write(prepared.bytes, (error) => {
            if (error) {
              fail("WRITE_FAILED");
              return;
            }
            written = true;
            socket.end();
          });
        });

        socket.on("finish", () => {
          // Alle Bytes sind übergeben und das Verbindungsende ist gesendet.
          // Ab hier zählt nur noch die Nachlauffrist.
          if (deadline) clearTimeout(deadline);
          deadline = undefined;
          linger = setTimeout(succeed, lingerMs);
        });

        socket.on("close", (hadError: boolean) => {
          // Schließt der Drucker, bevor die Daten übergeben wurden, ist der
          // Bon nicht gedruckt – auch ohne Fehlerkennzeichen des Sockets.
          if (hadError || !written) {
            fail("CONNECTION_LOST");
            return;
          }
          succeed();
        });
      });
    },
  };
}
