import * as net from "node:net";

import { decodeFromCodepage } from "../printing/charset";
import { prepareDocument } from "../printing/prepare";
import { PrintTarget, resolveTarget } from "../target";
import { createTcpAdapter } from "./tcp";
import { PrintTransportError } from "./types";

const job = {
  id: "job-1",
  jobType: "STATION_TICKET",
  createdAt: new Date(2026, 7, 21, 18, 5, 9).toISOString(),
  content: {
    stationName: "Küche",
    orderNumber: 7,
    items: [{ productName: "Käsekrainer", quantity: 2 }],
  },
};

interface TestServer {
  port: number;
  received: () => Buffer;
  close: () => Promise<void>;
}

/** Lokaler Ersatzdrucker: nimmt Bytes entgegen und schließt wie ein Bondrucker. */
async function startServer(
  options: { closeOnEnd?: boolean; resetImmediately?: boolean } = {},
): Promise<TestServer> {
  const chunks: Buffer[] = [];
  const sockets = new Set<net.Socket>();

  const server = net.createServer((socket) => {
    sockets.add(socket);
    if (options.resetImmediately) {
      // Verbindungsabbruch mit RST, damit der Abbruch auf allen Plattformen
      // gleich aussieht. Ein blosses destroy() sendet je nach System nur FIN.
      socket.resetAndDestroy();
      return;
    }
    socket.on("data", (chunk) => chunks.push(chunk));
    socket.on("end", () => {
      if (options.closeOnEnd !== false) socket.end();
    });
    socket.on("error", () => undefined);
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

  return {
    port: (server.address() as net.AddressInfo).port,
    received: () => Buffer.concat(chunks),
    close: () =>
      new Promise<void>((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.close(() => resolve());
      }),
  };
}

function targetFor(port: number, timeoutMs = 2000): PrintTarget {
  return resolveTarget({
    id: "p1",
    name: "Küchendrucker",
    type: "ESC_POS_NETWORK",
    ipAddress: "127.0.0.1",
    port,
    paperWidth: 80,
    timeoutMs,
  });
}

describe("TCP-Transport gegen einen lokalen Testdrucker", () => {
  jest.setTimeout(15000);

  it("überträgt die ESC/POS-Bytes vollständig", async () => {
    const server = await startServer();
    try {
      const target = targetFor(server.port);
      const prepared = prepareDocument(job, target);
      const result = await createTcpAdapter().deliver(prepared, target);

      expect(result).toEqual({
        transport: "escpos-network",
        bytes: prepared.bytes.length,
      });

      const received = server.received();
      expect(received.equals(prepared.bytes)).toBe(true);
      expect(decodeFromCodepage(received, target.codepage)).toContain(
        "Käsekrainer",
      );
    } finally {
      await server.close();
    }
  });

  it("wertet den Auftrag auch dann als gedruckt, wenn der Drucker offen bleibt", async () => {
    const server = await startServer({ closeOnEnd: false });
    try {
      const target = targetFor(server.port);
      const prepared = prepareDocument(job, target);
      const adapter = createTcpAdapter({ lingerMs: 50 });

      await expect(adapter.deliver(prepared, target)).resolves.toMatchObject({
        transport: "escpos-network",
      });
      expect(server.received().equals(prepared.bytes)).toBe(true);
    } finally {
      await server.close();
    }
  });

  it("meldet eine abgelehnte Verbindung", async () => {
    const server = await startServer();
    const port = server.port;
    await server.close();

    const target = targetFor(port);
    const error = await createTcpAdapter()
      .deliver(prepareDocument(job, target), target)
      .catch((caught) => caught);

    expect(error).toBeInstanceOf(PrintTransportError);
    expect(error.code).toBe("CONNECTION_REFUSED");
    expect(error.message).toContain(`127.0.0.1:${port}`);
  });

  it("meldet einen Abbruch, wenn der Drucker die Verbindung zurücksetzt", async () => {
    const server = await startServer({ resetImmediately: true });
    try {
      const target = targetFor(server.port);
      const error = await createTcpAdapter()
        .deliver(prepareDocument(job, target), target)
        .catch((caught) => caught);

      expect(error).toBeInstanceOf(PrintTransportError);
      expect(["CONNECTION_LOST", "WRITE_FAILED"]).toContain(error.code);
    } finally {
      await server.close();
    }
  });

  it("bricht nach dem Zeitlimit ab, wenn keine Verbindung zustande kommt", async () => {
    const target = targetFor(9100, 250);
    // Ein Socket, der niemals verbindet, entspricht einem Drucker, der auf
    // das SYN nicht antwortet – etwa weil er ausgeschaltet ist.
    const adapter = createTcpAdapter({ connect: () => new net.Socket() });

    const started = Date.now();
    const error = await adapter
      .deliver(prepareDocument(job, target), target)
      .catch((caught) => caught);

    expect(error).toBeInstanceOf(PrintTransportError);
    expect(error.code).toBe("TIMEOUT");
    expect(error.message).toContain("250 ms");
    expect(Date.now() - started).toBeGreaterThanOrEqual(200);
  });

  it("meldet einen nicht auflösbaren Druckernamen", async () => {
    const target = resolveTarget({
      id: "p2",
      name: "Küchendrucker",
      type: "ESC_POS_NETWORK",
      ipAddress: "drucker.invalid",
      timeoutMs: 4000,
    });

    const error = await createTcpAdapter()
      .deliver(prepareDocument(job, target), target)
      .catch((caught) => caught);

    expect(error).toBeInstanceOf(PrintTransportError);
    expect(error.code).toBe("DNS_ERROR");
    expect(error.message).toContain("drucker.invalid");
  });
});
