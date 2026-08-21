/**
 * Zeichensatzabbildung für ESC/POS-Bondrucker.
 *
 * Bondrucker kennen kein UTF-8, sondern Ein-Byte-Codepages. Umlaute und
 * Akzente werden deshalb vor dem Senden auf die jeweilige Codepage
 * abgebildet; nicht darstellbare Zeichen werden nachvollziehbar ersetzt.
 */
export type Codepage = "CP437" | "CP850" | "CP858";

export const SUPPORTED_CODEPAGES: Codepage[] = ["CP437", "CP850", "CP858"];

export const DEFAULT_CODEPAGE: Codepage = "CP858";

/** Parameter des ESC/POS-Befehls "ESC t n" zur Codepage-Auswahl. */
export const CODEPAGE_COMMAND: Record<Codepage, number> = {
  CP437: 0,
  CP850: 2,
  CP858: 19,
};

/** In CP437, CP850 und CP858 identisch belegte Zeichen. */
const SHARED: Record<string, number> = {
  Ç: 0x80,
  ü: 0x81,
  é: 0x82,
  â: 0x83,
  ä: 0x84,
  à: 0x85,
  å: 0x86,
  ç: 0x87,
  ê: 0x88,
  ë: 0x89,
  è: 0x8a,
  ï: 0x8b,
  î: 0x8c,
  ì: 0x8d,
  Ä: 0x8e,
  Å: 0x8f,
  É: 0x90,
  æ: 0x91,
  Æ: 0x92,
  ô: 0x93,
  ö: 0x94,
  ò: 0x95,
  û: 0x96,
  ù: 0x97,
  ÿ: 0x98,
  Ö: 0x99,
  Ü: 0x9a,
  "£": 0x9c,
  ƒ: 0x9f,
  á: 0xa0,
  í: 0xa1,
  ó: 0xa2,
  ú: 0xa3,
  ñ: 0xa4,
  Ñ: 0xa5,
  ª: 0xa6,
  º: 0xa7,
  "¿": 0xa8,
  "¬": 0xaa,
  "½": 0xab,
  "¼": 0xac,
  "¡": 0xad,
  "«": 0xae,
  "»": 0xaf,
  ß: 0xe1,
  µ: 0xe6,
  "±": 0xf1,
  "÷": 0xf6,
  "°": 0xf8,
  "·": 0xfa,
  "²": 0xfd,
};

/** Nur in CP850 und CP858 vorhandene Zeichen. */
const LATIN1_EXTRA: Record<string, number> = {
  ø: 0x9b,
  Ø: 0x9d,
  "×": 0x9e,
  "®": 0xa9,
  Á: 0xb5,
  Â: 0xb6,
  À: 0xb7,
  "©": 0xb8,
  ã: 0xc6,
  Ã: 0xc7,
  ð: 0xd0,
  Ð: 0xd1,
  Ê: 0xd2,
  Ë: 0xd3,
  È: 0xd4,
  Í: 0xd6,
  Î: 0xd7,
  Ï: 0xd8,
  Ì: 0xde,
  Ó: 0xe0,
  Ô: 0xe2,
  Ò: 0xe3,
  õ: 0xe4,
  Õ: 0xe5,
  þ: 0xe7,
  Þ: 0xe8,
  Ú: 0xe9,
  Û: 0xea,
  Ù: 0xeb,
  ý: 0xec,
  Ý: 0xed,
  "¯": 0xee,
  "´": 0xef,
  "¾": 0xf3,
  "¶": 0xf4,
  "§": 0xf5,
  "¸": 0xf7,
  "¨": 0xf9,
  "¹": 0xfb,
  "³": 0xfc,
};

const CODEPAGE_TABLES: Record<Codepage, Record<string, number>> = {
  CP437: { ...SHARED, "¢": 0x9b, "¥": 0x9d },
  CP850: { ...SHARED, ...LATIN1_EXTRA, ı: 0xd5 },
  // CP858 entspricht CP850, ersetzt aber das kaum benutzte "ı" durch das
  // Eurozeichen. Deshalb ist CP858 der Standard für Belege in Euro.
  CP858: { ...SHARED, ...LATIN1_EXTRA, "€": 0xd5 },
};

/**
 * Ersatzdarstellungen für Zeichen, die keine der Codepages kennt. Typografie
 * aus Web-Eingaben (Gedankenstriche, typografische Anführungszeichen) wird so
 * lesbar statt als Fragezeichen gedruckt.
 */
const TRANSLITERATIONS: Record<string, string> = {
  "€": "EUR",
  "–": "-",
  "—": "-",
  "‐": "-",
  "„": '"',
  "“": '"',
  "”": '"',
  "‚": "'",
  "‘": "'",
  "’": "'",
  "…": "...",
  "→": "->",
  "•": "*",
  "\u00a0": " ",
  "\t": "  ",
};

const REPLACEMENT = 0x3f; // "?"

export function isCodepage(value: unknown): value is Codepage {
  return SUPPORTED_CODEPAGES.includes(value as Codepage);
}

export function resolveCodepage(value: unknown): Codepage {
  return isCodepage(value) ? value : DEFAULT_CODEPAGE;
}

function encodeChar(char: string, table: Record<string, number>): number[] {
  const code = char.codePointAt(0) ?? REPLACEMENT;
  if (code >= 0x20 && code <= 0x7e) return [code];

  const mapped = table[char];
  if (mapped !== undefined) return [mapped];

  const transliteration = TRANSLITERATIONS[char];
  if (transliteration !== undefined) {
    return encodeText(transliteration, table);
  }

  // Letzter Versuch: Akzent entfernen und Grundbuchstaben drucken.
  const stripped = char.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (stripped !== char && stripped.length > 0) {
    return encodeText(stripped, table);
  }

  return [REPLACEMENT];
}

function encodeText(text: string, table: Record<string, number>): number[] {
  const bytes: number[] = [];
  for (const char of text) {
    bytes.push(...encodeChar(char, table));
  }
  return bytes;
}

/** Wandelt Text in die Bytes der gewählten Codepage um. */
export function encodeForCodepage(text: string, codepage: Codepage): Buffer {
  const table = CODEPAGE_TABLES[codepage] ?? CODEPAGE_TABLES[DEFAULT_CODEPAGE];
  return Buffer.from(encodeText(String(text ?? ""), table));
}

/** Gegenrichtung, ausschließlich für Tests und Diagnose. */
export function decodeFromCodepage(bytes: Buffer, codepage: Codepage): string {
  const table = CODEPAGE_TABLES[codepage] ?? CODEPAGE_TABLES[DEFAULT_CODEPAGE];
  const reverse = new Map<number, string>();
  for (const [char, byte] of Object.entries(table)) reverse.set(byte, char);

  let text = "";
  for (const byte of bytes) {
    if (byte >= 0x20 && byte <= 0x7e) {
      text += String.fromCharCode(byte);
      continue;
    }
    text += reverse.get(byte) ?? "\uFFFD";
  }
  return text;
}
