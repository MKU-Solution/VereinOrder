import {
  buildCancelJobRequest,
  buildGetJobAttributesRequest,
  buildPrintJobRequest,
  decodeIppMessage,
  encodeIppRequest,
  IPP_GROUP,
  IPP_JOB_STATE,
  IPP_OPERATION,
  IPP_STATUS,
  IPP_VALUE,
  isSuccessfulStatus,
  parseCancelJobResponse,
  parseGetJobAttributesResponse,
  parsePrintJobResponse,
} from "./protocol";

/**
 * Byte-Fixtures für den IPP-Kodierer.
 *
 * WICHTIG (siehe Abschlussbericht): Es stand kein echter CUPS-Server zur
 * Verfügung. Die Hex-Werte unten sind deshalb keine mit einem Netzwerk-
 * Mitschnitt aufgezeichneten Bytes eines echten `cupsd`, sondern einmalig
 * mit genau diesem Kodierer erzeugt und danach hier als Regressionsanker
 * eingefroren ("gepinnt"). Jede Feldreihenfolge und jede Länge ist von Hand
 * gegen RFC 8010 §3.5 nachgerechnet (Tag, 2-Byte-Namenslänge, Name,
 * 2-Byte-Wertlänge, Wert). Ändert sich einer dieser Werte unbeabsichtigt,
 * schlägt der Test an; eine absichtliche Änderung muss die Fixtures hier
 * bewusst mitziehen.
 */
const CANCEL_JOB_FIXTURE_HEX =
  "010100080000000101470012617474726962757465732d6368617273657400057574662d3848001b617474726962757465732d6e61747572616c2d6c616e67756167650002656e4500076a6f622d757269001b6970703a2f2f6c6f63616c686f73743a3633312f6a6f62732f343242001472657175657374696e672d757365722d6e616d650006776f726b657203";

const GET_JOB_ATTRIBUTES_FIXTURE_HEX =
  "010100090000000201470012617474726962757465732d6368617273657400057574662d3848001b617474726962757465732d6e61747572616c2d6c616e67756167650002656e4500076a6f622d757269001b6970703a2f2f6c6f63616c686f73743a3633312f6a6f62732f343242001472657175657374696e672d757365722d6e616d650006776f726b65724400147265717565737465642d6174747269627574657300096a6f622d737461746544000000116a6f622d73746174652d726561736f6e7344000000157072696e7465722d73746174652d726561736f6e7303";

const PRINT_JOB_FIXTURE_HEX =
  "010100020000000301470012617474726962757465732d6368617273657400057574662d3848001b617474726962757465732d6e61747572616c2d6c616e67756167650002656e45000b7072696e7465722d75726900236970703a2f2f6c6f63616c686f73743a3633312f7072696e746572732f6b756563686542001472657175657374696e672d757365722d6e616d650006776f726b657249000f646f63756d656e742d666f726d617400186170706c69636174696f6e2f6f637465742d73747265616d031b404869";

describe("IPP-Kodierer: Byte-Fixtures (RFC 8010)", () => {
  it("kodiert Cancel-Job byteidentisch zur Fixture", () => {
    const buffer = buildCancelJobRequest({
      requestId: 1,
      jobUri: "ipp://localhost:631/jobs/42",
      requestingUserName: "worker",
    });
    expect(buffer.toString("hex")).toBe(CANCEL_JOB_FIXTURE_HEX);
  });

  it("kodiert Get-Job-Attributes byteidentisch zur Fixture", () => {
    const buffer = buildGetJobAttributesRequest({
      requestId: 2,
      jobUri: "ipp://localhost:631/jobs/42",
      requestingUserName: "worker",
    });
    expect(buffer.toString("hex")).toBe(GET_JOB_ATTRIBUTES_FIXTURE_HEX);
  });

  it("kodiert Print-Job (inklusive Dokumentbytes) byteidentisch zur Fixture", () => {
    const buffer = buildPrintJobRequest({
      requestId: 3,
      printerUri: "ipp://localhost:631/printers/kueche",
      requestingUserName: "worker",
      documentFormat: "application/octet-stream",
      data: Buffer.from([0x1b, 0x40, 0x48, 0x69]),
    });
    expect(buffer.toString("hex")).toBe(PRINT_JOB_FIXTURE_HEX);
  });

  it("hängt die Dokumentbytes unverändert und ohne Längenpräfix an", () => {
    const buffer = Buffer.from(PRINT_JOB_FIXTURE_HEX, "hex");
    // end-of-attributes-tag (0x03) gefolgt von genau den vier ESC/POS-Bytes.
    expect(buffer.subarray(buffer.length - 5).toString("hex")).toBe(
      "031b404869",
    );
  });
});

describe("IPP-Kodierer: Dekodieren von Anfragen (Rundlauf)", () => {
  it("dekodiert eine kodierte Cancel-Job-Anfrage wieder in ihre Attribute", () => {
    const buffer = Buffer.from(CANCEL_JOB_FIXTURE_HEX, "hex");
    const message = decodeIppMessage(buffer);

    expect(message.versionMajor).toBe(1);
    expect(message.versionMinor).toBe(1);
    expect(message.code).toBe(IPP_OPERATION.CANCEL_JOB);
    expect(message.requestId).toBe(1);
    expect(message.groups).toHaveLength(1);
    expect(message.groups[0].tag).toBe(IPP_GROUP.OPERATION_ATTRIBUTES);

    const names = message.groups[0].attributes.map((a) => a.name);
    expect(names).toEqual([
      "attributes-charset",
      "attributes-natural-language",
      "job-uri",
      "requesting-user-name",
    ]);
    expect(
      message.groups[0].attributes.find((a) => a.name === "job-uri")?.values,
    ).toEqual(["ipp://localhost:631/jobs/42"]);
    expect(message.data.length).toBe(0);
  });

  it("dekodiert das mehrwertige requested-attributes-Attribut vollständig", () => {
    const buffer = Buffer.from(GET_JOB_ATTRIBUTES_FIXTURE_HEX, "hex");
    const message = decodeIppMessage(buffer);
    const requested = message.groups[0].attributes.find(
      (a) => a.name === "requested-attributes",
    );
    expect(requested?.values).toEqual([
      "job-state",
      "job-state-reasons",
      "printer-state-reasons",
    ]);
  });

  it("trennt Attributgruppen und Dokumentbytes bei Print-Job korrekt", () => {
    const buffer = Buffer.from(PRINT_JOB_FIXTURE_HEX, "hex");
    const message = decodeIppMessage(buffer);

    expect(message.groups.map((g) => g.tag)).toEqual([
      IPP_GROUP.OPERATION_ATTRIBUTES,
    ]);
    expect(
      message.groups[0].attributes.find((a) => a.name === "document-format")
        ?.values,
    ).toEqual(["application/octet-stream"]);
    expect(message.data).toEqual(Buffer.from([0x1b, 0x40, 0x48, 0x69]));
  });
});

/**
 * Baut eine synthetische IPP-Antwort mit derselben Rahmung wie eine Anfrage
 * (RFC 8010 §3.1.1 und §3.1.2 unterscheiden sich nur in der Bedeutung der
 * 2-Byte-Kennung nach der Version: Operation-id bei Anfragen, Status-Code
 * bei Antworten – das Byteformat ist identisch). Ohne echten CUPS-Server ist
 * das der einzige Weg, das Dekodieren von Antworten mit einer belastbaren
 * Fixture zu prüfen.
 */
function buildResponseFixture(options: {
  statusCode: number;
  requestId: number;
  jobAttributes?: Parameters<typeof encodeIppRequest>[0]["jobAttributes"];
}): Buffer {
  return encodeIppRequest({
    operationId: options.statusCode,
    requestId: options.requestId,
    operationAttributes: [
      { tag: IPP_VALUE.CHARSET, name: "attributes-charset", values: ["utf-8"] },
      {
        tag: IPP_VALUE.NATURAL_LANGUAGE,
        name: "attributes-natural-language",
        values: ["en"],
      },
    ],
    jobAttributes: options.jobAttributes,
  });
}

describe("IPP-Kodierer: Dekodieren von Antworten", () => {
  it("liest job-id und job-uri aus einer erfolgreichen Print-Job-Antwort", () => {
    const buffer = buildResponseFixture({
      statusCode: IPP_STATUS.SUCCESSFUL_OK,
      requestId: 3,
      jobAttributes: [
        { tag: IPP_VALUE.INTEGER, name: "job-id", values: [42] },
        {
          tag: IPP_VALUE.URI,
          name: "job-uri",
          values: ["ipp://localhost:631/jobs/42"],
        },
        { tag: 0x23, name: "job-state", values: [IPP_JOB_STATE.PENDING] },
      ],
    });

    const parsed = parsePrintJobResponse(buffer);
    expect(parsed.statusCode).toBe(IPP_STATUS.SUCCESSFUL_OK);
    expect(parsed.jobId).toBe(42);
    expect(parsed.jobUri).toBe("ipp://localhost:631/jobs/42");
    expect(parsed.jobState).toBe(IPP_JOB_STATE.PENDING);
    expect(isSuccessfulStatus(parsed.statusCode)).toBe(true);
  });

  it("liest job-state und die mehrwertigen reasons aus Get-Job-Attributes", () => {
    const buffer = buildResponseFixture({
      statusCode: IPP_STATUS.SUCCESSFUL_OK,
      requestId: 4,
      jobAttributes: [
        {
          tag: 0x23,
          name: "job-state",
          values: [IPP_JOB_STATE.PROCESSING_STOPPED],
        },
        {
          tag: IPP_VALUE.KEYWORD,
          name: "job-state-reasons",
          values: ["job-stopped"],
        },
        {
          tag: IPP_VALUE.KEYWORD,
          name: "printer-state-reasons",
          values: ["media-empty", "media-needed"],
        },
      ],
    });

    const parsed = parseGetJobAttributesResponse(buffer);
    expect(parsed.jobState).toBe(IPP_JOB_STATE.PROCESSING_STOPPED);
    expect(parsed.jobStateReasons).toEqual(["job-stopped"]);
    expect(parsed.printerStateReasons).toEqual(["media-empty", "media-needed"]);
  });

  it("liest den Status einer Cancel-Job-Antwort", () => {
    const buffer = buildResponseFixture({
      statusCode: IPP_STATUS.SUCCESSFUL_OK,
      requestId: 5,
    });
    expect(parseCancelJobResponse(buffer).statusCode).toBe(
      IPP_STATUS.SUCCESSFUL_OK,
    );
  });

  it("erkennt client-error-not-found (fehlende Warteschlange) als Fehlschlag", () => {
    const buffer = buildResponseFixture({
      statusCode: IPP_STATUS.CLIENT_ERROR_NOT_FOUND,
      requestId: 6,
    });
    const parsed = parsePrintJobResponse(buffer);
    expect(isSuccessfulStatus(parsed.statusCode)).toBe(false);
    expect(parsed.statusCode).toBe(0x0406);
  });

  it("zieht die Grenze erfolgreich/fehlgeschlagen exakt bei 0x0400", () => {
    expect(isSuccessfulStatus(0x0000)).toBe(true);
    expect(isSuccessfulStatus(0x00ff)).toBe(true);
    expect(isSuccessfulStatus(0x0400)).toBe(false);
    expect(isSuccessfulStatus(IPP_STATUS.SERVER_ERROR_NOT_ACCEPTING_JOBS)).toBe(
      false,
    );
  });
});
