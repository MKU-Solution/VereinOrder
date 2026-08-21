import * as http from "node:http";
import { AddressInfo } from "node:net";

import {
  IPP_JOB_STATE,
  IPP_OPERATION,
  IPP_STATUS,
  IPP_VALUE,
  IppAttribute,
  IppMessage,
  decodeIppMessage,
  encodeIppRequest,
} from "../ipp/protocol";
import { prepareDocument } from "../printing/prepare";
import { resolveTarget } from "../target";
import { createCupsAdapter } from "./cups";
import { classifyOutcome, DeliveryContext, PrintTransportError } from "./types";

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

interface FakeServer {
  port: number;
  close: () => Promise<void>;
  requests: { operationId: number; message: IppMessage }[];
}

/** Baut eine IPP-Antwort mit derselben Rahmung wie eine Anfrage (siehe protocol.spec.ts). */
function ippResponse(
  statusCode: number,
  requestId: number,
  jobAttributes: IppAttribute[] = [],
): Buffer {
  return encodeIppRequest({
    operationId: statusCode,
    requestId,
    operationAttributes: [
      { tag: IPP_VALUE.CHARSET, name: "attributes-charset", values: ["utf-8"] },
      {
        tag: IPP_VALUE.NATURAL_LANGUAGE,
        name: "attributes-natural-language",
        values: ["en"],
      },
    ],
    jobAttributes,
  });
}

function printJobSuccessResponse(requestId: number, jobId: number): Buffer {
  return ippResponse(IPP_STATUS.SUCCESSFUL_OK, requestId, [
    { tag: IPP_VALUE.INTEGER, name: "job-id", values: [jobId] },
    {
      tag: IPP_VALUE.URI,
      name: "job-uri",
      values: [`ipp://127.0.0.1/jobs/${jobId}`],
    },
  ]);
}

function jobStateResponse(
  requestId: number,
  state: number,
  reasons: string[] = [],
  printerReasons: string[] = [],
): Buffer {
  return ippResponse(IPP_STATUS.SUCCESSFUL_OK, requestId, [
    { tag: 0x23, name: "job-state", values: [state] },
    { tag: IPP_VALUE.KEYWORD, name: "job-state-reasons", values: reasons },
    {
      tag: IPP_VALUE.KEYWORD,
      name: "printer-state-reasons",
      values: printerReasons,
    },
  ]);
}

/** Lokaler HTTP-Testserver, der IPP-Anfragen entgegennimmt und dekodiert. */
async function startCupsServer(
  handler: (operationId: number, message: IppMessage) => Buffer,
): Promise<FakeServer> {
  const requests: FakeServer["requests"] = [];
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const body = Buffer.concat(chunks);
      const message = decodeIppMessage(body);
      requests.push({ operationId: message.code, message });
      const response = handler(message.code, message);
      res.writeHead(200, { "Content-Type": "application/ipp" });
      res.end(response);
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;

  return {
    port,
    requests,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

function targetFor(port: number, queueName = "kueche") {
  return resolveTarget({
    id: "printer-1",
    name: "Küchendrucker",
    type: "CUPS_IPP",
    ipAddress: "127.0.0.1",
    port,
    queueName,
    paperWidth: 80,
    timeoutMs: 2000,
  });
}

describe("CUPS-Adapter gegen einen lokalen IPP-Testserver", () => {
  jest.setTimeout(20000);

  it("druckt erfolgreich: Print-Job -> processing -> completed", async () => {
    let getAttrCalls = 0;
    const server = await startCupsServer((operationId, message) => {
      if (operationId === IPP_OPERATION.PRINT_JOB) {
        return printJobSuccessResponse(message.requestId, 7);
      }
      if (operationId === IPP_OPERATION.GET_JOB_ATTRIBUTES) {
        getAttrCalls += 1;
        return getAttrCalls === 1
          ? jobStateResponse(message.requestId, IPP_JOB_STATE.PROCESSING)
          : jobStateResponse(message.requestId, IPP_JOB_STATE.COMPLETED);
      }
      throw new Error(`Unerwartete Operation ${operationId}`);
    });

    try {
      const target = targetFor(server.port);
      const prepared = prepareDocument(job, target);
      const adapter = createCupsAdapter({ pollMs: 15, waitMs: 500 });

      const spooled: number[] = [];
      const events: string[] = [];
      const context: DeliveryContext = {
        onSpooled: async (cupsJobId) => {
          spooled.push(cupsJobId);
        },
        onEvent: (event) => events.push(event),
      };

      const result = await adapter.deliver(prepared, target, context);

      expect(result).toMatchObject({
        transport: "cups-ipp",
        cupsJobId: 7,
        cupsJobState: "completed",
      });
      expect(spooled).toEqual([7]);
      expect(events).toContain("cups.state");

      const printJobRequest = server.requests.find(
        (r) => r.operationId === IPP_OPERATION.PRINT_JOB,
      );
      expect(printJobRequest?.message.data.equals(prepared.bytes)).toBe(true);
    } finally {
      await server.close();
    }
  });

  it("löst bei Papiermangel KEIN Failover aus und druckt nach dem Nachlegen weiter", async () => {
    let getAttrCalls = 0;
    const server = await startCupsServer((operationId, message) => {
      if (operationId === IPP_OPERATION.PRINT_JOB) {
        return printJobSuccessResponse(message.requestId, 11);
      }
      if (operationId === IPP_OPERATION.GET_JOB_ATTRIBUTES) {
        getAttrCalls += 1;
        // Zwei Abfragen lang "Papier aus", danach läuft der Auftrag weiter.
        if (getAttrCalls <= 2) {
          return jobStateResponse(
            message.requestId,
            IPP_JOB_STATE.PROCESSING_STOPPED,
            ["media-empty"],
            ["media-empty"],
          );
        }
        if (getAttrCalls === 3) {
          return jobStateResponse(message.requestId, IPP_JOB_STATE.PROCESSING);
        }
        return jobStateResponse(message.requestId, IPP_JOB_STATE.COMPLETED);
      }
      throw new Error(
        `Unerwartete Operation ${operationId} (Cancel-Job darf hier nicht aufgerufen werden)`,
      );
    });

    try {
      const target = targetFor(server.port);
      const prepared = prepareDocument(job, target);
      const adapter = createCupsAdapter({ pollMs: 15, waitMs: 2000 });

      const result = await adapter.deliver(prepared, target, {});

      expect(result).toMatchObject({ cupsJobState: "completed" });
      const cancelCalls = server.requests.filter(
        (r) => r.operationId === IPP_OPERATION.CANCEL_JOB,
      );
      expect(cancelCalls).toHaveLength(0);
    } finally {
      await server.close();
    }
  });

  it("stuft einen Abbruch aus dem Zustand pending als sicher nicht gedruckt ein", async () => {
    const server = await startCupsServer((operationId, message) => {
      if (operationId === IPP_OPERATION.PRINT_JOB) {
        return printJobSuccessResponse(message.requestId, 21);
      }
      if (operationId === IPP_OPERATION.GET_JOB_ATTRIBUTES) {
        return jobStateResponse(message.requestId, IPP_JOB_STATE.PENDING);
      }
      if (operationId === IPP_OPERATION.CANCEL_JOB) {
        return ippResponse(IPP_STATUS.SUCCESSFUL_OK, message.requestId);
      }
      throw new Error(`Unerwartete Operation ${operationId}`);
    });

    try {
      const target = targetFor(server.port);
      const prepared = prepareDocument(job, target);
      const adapter = createCupsAdapter({ pollMs: 15, waitMs: 60 });

      const error = await adapter
        .deliver(prepared, target, {})
        .catch((caught) => caught);

      expect(error).toBeInstanceOf(PrintTransportError);
      expect(error.code).toBe("CUPS_JOB_CANCELED_PENDING");
      expect(classifyOutcome(error)).toBe("NOT_PRINTED");

      const cancelCalls = server.requests.filter(
        (r) => r.operationId === IPP_OPERATION.CANCEL_JOB,
      );
      expect(cancelCalls).toHaveLength(1);
    } finally {
      await server.close();
    }
  });

  it("stuft einen Abbruch aus dem Zustand processing als unklar ein", async () => {
    const server = await startCupsServer((operationId, message) => {
      if (operationId === IPP_OPERATION.PRINT_JOB) {
        return printJobSuccessResponse(message.requestId, 22);
      }
      if (operationId === IPP_OPERATION.GET_JOB_ATTRIBUTES) {
        return jobStateResponse(message.requestId, IPP_JOB_STATE.PROCESSING);
      }
      if (operationId === IPP_OPERATION.CANCEL_JOB) {
        return ippResponse(IPP_STATUS.SUCCESSFUL_OK, message.requestId);
      }
      throw new Error(`Unerwartete Operation ${operationId}`);
    });

    try {
      const target = targetFor(server.port);
      const prepared = prepareDocument(job, target);
      const adapter = createCupsAdapter({ pollMs: 15, waitMs: 60 });

      const error = await adapter
        .deliver(prepared, target, {})
        .catch((caught) => caught);

      expect(error).toBeInstanceOf(PrintTransportError);
      expect(error.code).toBe("CUPS_JOB_CANCELED_PROCESSING");
      expect(classifyOutcome(error)).toBe("UNCLEAR");
    } finally {
      await server.close();
    }
  });

  it("meldet CUPS als nicht erreichbar, wenn keine Verbindung zustande kommt", async () => {
    const server = await startCupsServer(() => {
      throw new Error("wird nicht aufgerufen");
    });
    const port = server.port;
    await server.close(); // Server sofort wieder schließen -> ECONNREFUSED

    const target = targetFor(port);
    const prepared = prepareDocument(job, target);
    const adapter = createCupsAdapter({ pollMs: 15, waitMs: 60 });

    const error = await adapter
      .deliver(prepared, target, {})
      .catch((caught) => caught);

    expect(error).toBeInstanceOf(PrintTransportError);
    expect(error.code).toBe("CUPS_UNREACHABLE");
    expect(classifyOutcome(error)).toBe("NOT_PRINTED");
  });

  it("meldet einen abgelehnten Auftrag (fehlende Warteschlange) sofort", async () => {
    const server = await startCupsServer((operationId, message) => {
      if (operationId === IPP_OPERATION.PRINT_JOB) {
        return ippResponse(
          IPP_STATUS.CLIENT_ERROR_NOT_FOUND,
          message.requestId,
        );
      }
      throw new Error(`Unerwartete Operation ${operationId}`);
    });

    try {
      const target = targetFor(server.port, "unbekannte-queue");
      const prepared = prepareDocument(job, target);
      const adapter = createCupsAdapter({ pollMs: 15, waitMs: 60 });

      const error = await adapter
        .deliver(prepared, target, {})
        .catch((caught) => caught);

      expect(error).toBeInstanceOf(PrintTransportError);
      expect(error.code).toBe("CUPS_QUEUE_NOT_FOUND");
      expect(classifyOutcome(error)).toBe("NOT_PRINTED");
    } finally {
      await server.close();
    }
  });

  it("bricht ab, wenn die Phasenbestätigung (onSpooled) die Lease verloren meldet", async () => {
    const server = await startCupsServer((operationId, message) => {
      if (operationId === IPP_OPERATION.PRINT_JOB) {
        return printJobSuccessResponse(message.requestId, 33);
      }
      throw new Error(
        `Unerwartete Operation ${operationId} (Polling darf hier nicht starten)`,
      );
    });

    try {
      const target = targetFor(server.port);
      const prepared = prepareDocument(job, target);
      const adapter = createCupsAdapter({ pollMs: 15, waitMs: 500 });

      const boom = new Error("Lease verloren");
      const error = await adapter
        .deliver(prepared, target, {
          onSpooled: async () => {
            throw boom;
          },
        })
        .catch((caught) => caught);

      expect(error).toBe(boom);
      const pollCalls = server.requests.filter(
        (r) => r.operationId === IPP_OPERATION.GET_JOB_ATTRIBUTES,
      );
      expect(pollCalls).toHaveLength(0);
    } finally {
      await server.close();
    }
  });
});
