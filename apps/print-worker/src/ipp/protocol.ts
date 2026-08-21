/**
 * Minimaler IPP-Kodierer für genau die drei Operationen, die der
 * CUPS-Adapter braucht: `Print-Job`, `Get-Job-Attributes`, `Cancel-Job`.
 *
 * Kodierung nach RFC 8010 ("Internet Printing Protocol/1.1: Encoding and
 * Transport"), Operationen und Attribute nach RFC 8011
 * ("Internet Printing Protocol/1.1: Model and Semantics"). Bewusst kein
 * generischer IPP-Client: nur die Teilmenge, die für Raw-Queue-Druck über
 * eine lokale `cupsd` gebraucht wird (keine Authentifizierung, keine
 * Sammelanfragen, keine Sprachvarianten).
 */

/** Anfang-einer-Attributgruppe-Kennungen ("delimiter tags", RFC 8010 §3.5.1). */
export const IPP_GROUP = {
  OPERATION_ATTRIBUTES: 0x01,
  JOB_ATTRIBUTES: 0x02,
  END_OF_ATTRIBUTES: 0x03,
  PRINTER_ATTRIBUTES: 0x04,
  UNSUPPORTED_ATTRIBUTES: 0x05,
} as const;

/** Werttyp-Kennungen ("value tags", RFC 8010 §3.5.2), nur die benötigten. */
export const IPP_VALUE = {
  INTEGER: 0x21,
  BOOLEAN: 0x22,
  ENUM: 0x23,
  TEXT_WITHOUT_LANGUAGE: 0x41,
  NAME_WITHOUT_LANGUAGE: 0x42,
  KEYWORD: 0x44,
  URI: 0x45,
  CHARSET: 0x47,
  NATURAL_LANGUAGE: 0x48,
  MIME_MEDIA_TYPE: 0x49,
} as const;

/** Operation-ids (RFC 8011 §5.4.15). */
export const IPP_OPERATION = {
  PRINT_JOB: 0x0002,
  CANCEL_JOB: 0x0008,
  GET_JOB_ATTRIBUTES: 0x0009,
} as const;

/** Status-Codes, die für die Klassifikation in Abschnitt 2.2 benötigt werden. */
export const IPP_STATUS = {
  SUCCESSFUL_OK: 0x0000,
  CLIENT_ERROR_NOT_FOUND: 0x0406,
  SERVER_ERROR_NOT_ACCEPTING_JOBS: 0x0506,
} as const;

/** Ein Status-Code < 0x0400 ist laut RFC 8011 §13.1.4 immer erfolgreich. */
export function isSuccessfulStatus(statusCode: number): boolean {
  return statusCode < 0x0400;
}

/** job-state-Werte (RFC 8011 §5.3.7). */
export const IPP_JOB_STATE = {
  PENDING: 3,
  PENDING_HELD: 4,
  PROCESSING: 5,
  PROCESSING_STOPPED: 6,
  CANCELED: 7,
  ABORTED: 8,
  COMPLETED: 9,
} as const;

export type IppAttributeValue = string | number | boolean;

export interface IppAttribute {
  tag: number;
  name: string;
  values: IppAttributeValue[];
}

export interface IppGroup {
  tag: number;
  attributes: IppAttribute[];
}

export interface IppMessage {
  versionMajor: number;
  versionMinor: number;
  /** Bei Anfragen die Operation-id, bei Antworten der Status-Code – beides
   *  liegt an derselben Stelle im Kopf (RFC 8010 §3.1.1/§3.1.2). */
  code: number;
  requestId: number;
  groups: IppGroup[];
  /** Rohdaten nach `end-of-attributes-tag`, z. B. der Bon bei `Print-Job`. */
  data: Buffer;
}

function encodeValue(tag: number, value: IppAttributeValue): Buffer {
  switch (tag) {
    case IPP_VALUE.INTEGER:
    case IPP_VALUE.ENUM: {
      const buf = Buffer.alloc(4);
      buf.writeInt32BE(Number(value), 0);
      return buf;
    }
    case IPP_VALUE.BOOLEAN:
      return Buffer.from([value ? 1 : 0]);
    default:
      return Buffer.from(String(value), "utf8");
  }
}

function decodeValue(tag: number, buf: Buffer): IppAttributeValue {
  switch (tag) {
    case IPP_VALUE.INTEGER:
    case IPP_VALUE.ENUM:
      return buf.readInt32BE(0);
    case IPP_VALUE.BOOLEAN:
      return buf.readUInt8(0) === 1;
    default:
      return buf.toString("utf8");
  }
}

/**
 * Ein Attribut mit einem oder mehreren Werten. Bei mehreren Werten
 * (`1setOf`) trägt nur der erste Wert den Namen; jeder weitere Wert wird mit
 * `name-length = 0` codiert (RFC 8010 §3.5.2).
 */
function encodeAttribute(attribute: IppAttribute): Buffer {
  const parts: Buffer[] = [];
  attribute.values.forEach((value, index) => {
    const nameBuf =
      index === 0 ? Buffer.from(attribute.name, "ascii") : Buffer.alloc(0);
    const valueBuf = encodeValue(attribute.tag, value);
    const head = Buffer.alloc(1 + 2 + nameBuf.length + 2);
    let offset = 0;
    head.writeUInt8(attribute.tag, offset);
    offset += 1;
    head.writeUInt16BE(nameBuf.length, offset);
    offset += 2;
    nameBuf.copy(head, offset);
    offset += nameBuf.length;
    head.writeUInt16BE(valueBuf.length, offset);
    parts.push(head, valueBuf);
  });
  return Buffer.concat(parts);
}

export interface EncodeRequestOptions {
  operationId: number;
  requestId: number;
  operationAttributes: IppAttribute[];
  jobAttributes?: IppAttribute[];
  /** Wird unverändert nach `end-of-attributes-tag` angehängt (die Bon-Bytes). */
  data?: Buffer;
}

/** Kodiert eine IPP-Anfrage nach RFC 8010 §3.1.1. */
export function encodeIppRequest(options: EncodeRequestOptions): Buffer {
  const header = Buffer.alloc(8);
  header.writeUInt8(1, 0); // Version 1.1, wie von CUPS erwartet
  header.writeUInt8(1, 1);
  header.writeUInt16BE(options.operationId, 2);
  header.writeUInt32BE(options.requestId >>> 0, 4);

  const parts: Buffer[] = [header];

  parts.push(Buffer.from([IPP_GROUP.OPERATION_ATTRIBUTES]));
  for (const attribute of options.operationAttributes) {
    parts.push(encodeAttribute(attribute));
  }

  if (options.jobAttributes && options.jobAttributes.length > 0) {
    parts.push(Buffer.from([IPP_GROUP.JOB_ATTRIBUTES]));
    for (const attribute of options.jobAttributes) {
      parts.push(encodeAttribute(attribute));
    }
  }

  parts.push(Buffer.from([IPP_GROUP.END_OF_ATTRIBUTES]));
  if (options.data && options.data.length > 0) {
    parts.push(options.data);
  }

  return Buffer.concat(parts);
}

/**
 * Dekodiert eine IPP-Nachricht (Anfrage oder Antwort) nach RFC 8010 §3.1.
 * Gruppentrenner (< 0x10) eröffnen eine neue Attributgruppe; jede weitere
 * Kennung ist ein Werttyp. `end-of-attributes-tag` beendet die
 * Attribute, alles danach sind Rohdaten (Dokumentbytes).
 */
export function decodeIppMessage(buffer: Buffer): IppMessage {
  let offset = 0;
  const versionMajor = buffer.readUInt8(offset);
  offset += 1;
  const versionMinor = buffer.readUInt8(offset);
  offset += 1;
  const code = buffer.readUInt16BE(offset);
  offset += 2;
  const requestId = buffer.readUInt32BE(offset);
  offset += 4;

  const groups: IppGroup[] = [];
  let currentGroup: IppGroup | undefined;
  let currentAttribute: IppAttribute | undefined;

  while (offset < buffer.length) {
    const tag = buffer.readUInt8(offset);
    offset += 1;

    if (tag === IPP_GROUP.END_OF_ATTRIBUTES) {
      break;
    }

    if (tag <= 0x0f) {
      currentGroup = { tag, attributes: [] };
      groups.push(currentGroup);
      currentAttribute = undefined;
      continue;
    }

    const nameLength = buffer.readUInt16BE(offset);
    offset += 2;
    const name = buffer.toString("utf8", offset, offset + nameLength);
    offset += nameLength;
    const valueLength = buffer.readUInt16BE(offset);
    offset += 2;
    const valueBuf = buffer.subarray(offset, offset + valueLength);
    offset += valueLength;
    const value = decodeValue(tag, valueBuf);

    if (nameLength === 0 && currentAttribute) {
      // Zusätzlicher Wert eines 1setOf-Attributs.
      currentAttribute.values.push(value);
    } else {
      currentAttribute = { tag, name, values: [value] };
      if (!currentGroup) {
        // Sollte bei gültigen IPP-Nachrichten nicht vorkommen; schützt nur
        // gegen fehlerhafte Fremdantworten.
        currentGroup = { tag: 0, attributes: [] };
        groups.push(currentGroup);
      }
      currentGroup.attributes.push(currentAttribute);
    }
  }

  const data =
    offset < buffer.length ? buffer.subarray(offset) : Buffer.alloc(0);
  return { versionMajor, versionMinor, code, requestId, groups, data };
}

function findAttribute(
  message: IppMessage,
  name: string,
  groupTag?: number,
): IppAttribute | undefined {
  for (const group of message.groups) {
    if (groupTag !== undefined && group.tag !== groupTag) continue;
    const attribute = group.attributes.find((a) => a.name === name);
    if (attribute) return attribute;
  }
  return undefined;
}

function firstValue(
  message: IppMessage,
  name: string,
  groupTag?: number,
): IppAttributeValue | undefined {
  return findAttribute(message, name, groupTag)?.values[0];
}

function allValues(
  message: IppMessage,
  name: string,
  groupTag?: number,
): IppAttributeValue[] {
  return findAttribute(message, name, groupTag)?.values ?? [];
}

const REQUESTING_USER_NAME = "vereinorder-print-worker";

function baseOperationAttributes(): IppAttribute[] {
  return [
    { tag: IPP_VALUE.CHARSET, name: "attributes-charset", values: ["utf-8"] },
    {
      tag: IPP_VALUE.NATURAL_LANGUAGE,
      name: "attributes-natural-language",
      values: ["en"],
    },
  ];
}

export interface BuildPrintJobOptions {
  requestId: number;
  printerUri: string;
  documentFormat?: string;
  jobName?: string;
  requestingUserName?: string;
  data: Buffer;
}

/** `Print-Job` (RFC 8011 §5.2.1): spoolt den Bon in einem Schritt. */
export function buildPrintJobRequest(options: BuildPrintJobOptions): Buffer {
  const operationAttributes: IppAttribute[] = [
    ...baseOperationAttributes(),
    { tag: IPP_VALUE.URI, name: "printer-uri", values: [options.printerUri] },
    {
      tag: IPP_VALUE.NAME_WITHOUT_LANGUAGE,
      name: "requesting-user-name",
      values: [options.requestingUserName ?? REQUESTING_USER_NAME],
    },
    {
      tag: IPP_VALUE.MIME_MEDIA_TYPE,
      name: "document-format",
      values: [options.documentFormat ?? "application/octet-stream"],
    },
  ];
  const jobAttributes: IppAttribute[] = options.jobName
    ? [
        {
          tag: IPP_VALUE.NAME_WITHOUT_LANGUAGE,
          name: "job-name",
          values: [options.jobName],
        },
      ]
    : [];

  return encodeIppRequest({
    operationId: IPP_OPERATION.PRINT_JOB,
    requestId: options.requestId,
    operationAttributes,
    jobAttributes,
    data: options.data,
  });
}

export interface PrintJobResponse {
  statusCode: number;
  jobId?: number;
  jobUri?: string;
  jobState?: number;
}

export function parsePrintJobResponse(buffer: Buffer): PrintJobResponse {
  const message = decodeIppMessage(buffer);
  const jobId = firstValue(message, "job-id", IPP_GROUP.JOB_ATTRIBUTES);
  const jobUri = firstValue(message, "job-uri", IPP_GROUP.JOB_ATTRIBUTES);
  const jobState = firstValue(message, "job-state", IPP_GROUP.JOB_ATTRIBUTES);
  return {
    statusCode: message.code,
    jobId: typeof jobId === "number" ? jobId : undefined,
    jobUri: typeof jobUri === "string" ? jobUri : undefined,
    jobState: typeof jobState === "number" ? jobState : undefined,
  };
}

export interface BuildGetJobAttributesOptions {
  requestId: number;
  jobUri: string;
  requestingUserName?: string;
}

/** `Get-Job-Attributes` (RFC 8011 §5.3.2): fragt genau die Attribute ab,
 * die die Klassifikation aus Abschnitt 2.2 braucht. */
export function buildGetJobAttributesRequest(
  options: BuildGetJobAttributesOptions,
): Buffer {
  const operationAttributes: IppAttribute[] = [
    ...baseOperationAttributes(),
    { tag: IPP_VALUE.URI, name: "job-uri", values: [options.jobUri] },
    {
      tag: IPP_VALUE.NAME_WITHOUT_LANGUAGE,
      name: "requesting-user-name",
      values: [options.requestingUserName ?? REQUESTING_USER_NAME],
    },
    {
      tag: IPP_VALUE.KEYWORD,
      name: "requested-attributes",
      values: ["job-state", "job-state-reasons", "printer-state-reasons"],
    },
  ];

  return encodeIppRequest({
    operationId: IPP_OPERATION.GET_JOB_ATTRIBUTES,
    requestId: options.requestId,
    operationAttributes,
  });
}

export interface GetJobAttributesResponse {
  statusCode: number;
  jobState?: number;
  jobStateReasons: string[];
  printerStateReasons: string[];
}

export function parseGetJobAttributesResponse(
  buffer: Buffer,
): GetJobAttributesResponse {
  const message = decodeIppMessage(buffer);
  const jobState = firstValue(message, "job-state");
  return {
    statusCode: message.code,
    jobState: typeof jobState === "number" ? jobState : undefined,
    jobStateReasons: allValues(message, "job-state-reasons").map(String),
    printerStateReasons: allValues(message, "printer-state-reasons").map(
      String,
    ),
  };
}

export interface BuildCancelJobOptions {
  requestId: number;
  jobUri: string;
  requestingUserName?: string;
}

/** `Cancel-Job` (RFC 8011 §5.3.3): der einzige Weg zum Abbruchbeweis. */
export function buildCancelJobRequest(options: BuildCancelJobOptions): Buffer {
  const operationAttributes: IppAttribute[] = [
    ...baseOperationAttributes(),
    { tag: IPP_VALUE.URI, name: "job-uri", values: [options.jobUri] },
    {
      tag: IPP_VALUE.NAME_WITHOUT_LANGUAGE,
      name: "requesting-user-name",
      values: [options.requestingUserName ?? REQUESTING_USER_NAME],
    },
  ];

  return encodeIppRequest({
    operationId: IPP_OPERATION.CANCEL_JOB,
    requestId: options.requestId,
    operationAttributes,
  });
}

export interface CancelJobResponse {
  statusCode: number;
}

export function parseCancelJobResponse(buffer: Buffer): CancelJobResponse {
  const message = decodeIppMessage(buffer);
  return { statusCode: message.code };
}
