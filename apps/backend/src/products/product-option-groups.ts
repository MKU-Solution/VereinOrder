import { BadRequestException } from "@nestjs/common";
import {
  Prisma,
  ProductOptionPriceMode,
  ProductOptionSelectionType,
} from "@vereinorder/database";

// Eingabetypen fuer die verschachtelte Pflege der Auswahlgruppen aus dem
// Schnittstellenvertrag (docs/development/produktoptionen-schnittstelle.md,
// Abschnitt "Nutzlast der Pflege").
export interface OptionInput {
  id?: string;
  name: string;
  priceEffect: number;
  isActive?: boolean;
  sortOrder: number;
}

export interface GroupInput {
  id?: string;
  name: string;
  selectionType: ProductOptionSelectionType;
  isRequired: boolean;
  minSelect: number;
  maxSelect: number | null;
  priceMode: ProductOptionPriceMode;
  quickSaleTiles: boolean;
  sortOrder: number;
  options: OptionInput[];
}

const MAX_GROUPS_PER_PRODUCT = 10;
const MAX_OPTIONS_PER_GROUP = 20;
const MIN_PRICE_EFFECT = -1_000_000;
const MAX_PRICE_EFFECT = 1_000_000;

function isBlank(value: unknown): boolean {
  return typeof value !== "string" || value.trim().length === 0;
}

function isActiveOption(option: OptionInput): boolean {
  return option.isActive !== false;
}

/**
 * Prueft die Nutzlast gegen die Regeln aus
 * docs/development/produktoptionen-schnittstelle.md ("Pruefungen im
 * Backend") und docs/development/produktoptionen-datenmodell.md ("Regeln,
 * die die Anwendung erzwingen muss"), unabhaengig von der Datenbank. Wirft
 * BadRequestException mit den dort vorgegebenen deutschen Meldungstexten.
 * Zusaetzliche, im Vertrag nicht woertlich vorgegebene Meldungen decken die
 * datenbankseitigen CHECK-Bedingungen ab, damit kein roher Datenbankfehler
 * die Bedienenden erreicht.
 */
export function validateOptionGroupsPayload(groups: GroupInput[]): void {
  if (!Array.isArray(groups)) {
    throw new BadRequestException("optionGroups muss eine Liste sein.");
  }
  if (groups.length > MAX_GROUPS_PER_PRODUCT) {
    throw new BadRequestException("Höchstens 10 Auswahlgruppen je Produkt.");
  }

  const groupNames = new Set<string>();
  let absoluteGroupCount = 0;
  let hasAbsoluteGroup = false;
  let quickSaleGroupCount = 0;
  let quickSaleGroupIsAbsolute = false;

  for (const group of groups) {
    if (isBlank(group.name)) {
      throw new BadRequestException(
        "Der Name einer Auswahlgruppe darf nicht leer sein.",
      );
    }
    const normalizedGroupName = group.name.trim();
    if (groupNames.has(normalizedGroupName)) {
      throw new BadRequestException(
        `Der Name „${normalizedGroupName}" kommt zweimal vor.`,
      );
    }
    groupNames.add(normalizedGroupName);

    if (!Array.isArray(group.options)) {
      throw new BadRequestException("options muss eine Liste sein.");
    }
    if (group.options.length > MAX_OPTIONS_PER_GROUP) {
      throw new BadRequestException("Höchstens 20 Antworten je Auswahlgruppe.");
    }
    if (
      group.selectionType !== "SINGLE" &&
      group.selectionType !== "MULTIPLE"
    ) {
      throw new BadRequestException(
        "selectionType muss SINGLE oder MULTIPLE sein.",
      );
    }
    if (group.priceMode !== "ABSOLUTE" && group.priceMode !== "SURCHARGE") {
      throw new BadRequestException(
        "priceMode muss ABSOLUTE oder SURCHARGE sein.",
      );
    }
    if (!Number.isInteger(group.sortOrder) || group.sortOrder < 0) {
      throw new BadRequestException(
        "Die Sortierposition einer Auswahlgruppe darf nicht negativ sein.",
      );
    }
    if (!Number.isInteger(group.minSelect) || group.minSelect < 0) {
      throw new BadRequestException(
        "Die Mindestanzahl einer Auswahlgruppe ist ungültig.",
      );
    }
    if (
      group.maxSelect !== null &&
      (!Number.isInteger(group.maxSelect) || group.maxSelect < 1)
    ) {
      throw new BadRequestException(
        "Die Höchstanzahl einer Auswahlgruppe ist ungültig.",
      );
    }
    if (group.maxSelect !== null && group.maxSelect < group.minSelect) {
      throw new BadRequestException(
        "Die Höchstanzahl einer Auswahlgruppe darf die Mindestanzahl nicht unterschreiten.",
      );
    }
    const derivedIsRequired = group.minSelect >= 1;
    if (
      group.selectionType === "SINGLE" &&
      (group.maxSelect !== 1 || group.minSelect > 1)
    ) {
      throw new BadRequestException(
        "Eine Gruppe mit Einfachauswahl erlaubt höchstens eine Antwort.",
      );
    }

    const optionNames = new Set<string>();
    let activeOptionCount = 0;
    for (const option of group.options) {
      if (isBlank(option.name)) {
        throw new BadRequestException(
          "Der Name einer Antwort darf nicht leer sein.",
        );
      }
      const normalizedOptionName = option.name.trim();
      if (optionNames.has(normalizedOptionName)) {
        throw new BadRequestException(
          `Der Name „${normalizedOptionName}" kommt zweimal vor.`,
        );
      }
      optionNames.add(normalizedOptionName);

      if (!Number.isInteger(option.sortOrder) || option.sortOrder < 0) {
        throw new BadRequestException(
          "Die Sortierposition einer Antwort darf nicht negativ sein.",
        );
      }
      if (
        !Number.isInteger(option.priceEffect) ||
        option.priceEffect < MIN_PRICE_EFFECT ||
        option.priceEffect > MAX_PRICE_EFFECT
      ) {
        throw new BadRequestException(
          "Der Preis einer Antwort liegt außerhalb des zulässigen Bereichs.",
        );
      }
      if (isActiveOption(option)) activeOptionCount += 1;
    }

    if (activeOptionCount === 0) {
      throw new BadRequestException(
        `Die Auswahlgruppe „${normalizedGroupName}" braucht mindestens eine Antwort.`,
      );
    }
    if (group.maxSelect !== null && group.maxSelect > activeOptionCount) {
      throw new BadRequestException(
        `„${normalizedGroupName}" erlaubt mehr Antworten, als die Gruppe hat.`,
      );
    }

    if (group.priceMode === "ABSOLUTE") {
      if (group.selectionType !== "SINGLE" || !derivedIsRequired) {
        throw new BadRequestException(
          "Eine Gruppe, die den Endpreis festlegt, muss eine Pflichtgruppe mit Einfachauswahl sein.",
        );
      }
      absoluteGroupCount += 1;
      hasAbsoluteGroup = true;
      for (const option of group.options) {
        if (option.priceEffect < 0) {
          throw new BadRequestException(
            "Ein Endpreis darf nicht negativ sein.",
          );
        }
      }
    }

    if (group.quickSaleTiles) {
      if (group.selectionType !== "SINGLE" || !derivedIsRequired) {
        throw new BadRequestException(
          "Eine Auswahlgruppe mit Schnellverkaufskacheln muss eine Pflichtgruppe mit Einfachauswahl sein.",
        );
      }
      quickSaleGroupCount += 1;
      quickSaleGroupIsAbsolute = group.priceMode === "ABSOLUTE";
    }
  }

  if (absoluteGroupCount > 1) {
    throw new BadRequestException(
      "Nur eine Auswahlgruppe je Produkt darf den Endpreis festlegen.",
    );
  }
  if (quickSaleGroupCount > 1) {
    throw new BadRequestException(
      "Nur eine Auswahlgruppe je Produkt darf im Schnellverkauf eigene Kacheln bekommen.",
    );
  }
  if (
    hasAbsoluteGroup &&
    quickSaleGroupCount === 1 &&
    !quickSaleGroupIsAbsolute
  ) {
    throw new BadRequestException(
      "Die Kacheln im Schnellverkauf gehören an die Gruppe, die den Endpreis festlegt.",
    );
  }
}

/**
 * Gleicht die Auswahlgruppen eines Produkts mit der Nutzlast ab: Eintraege
 * mit `id` werden geaendert, Eintraege ohne `id` neu angelegt, nicht mehr
 * enthaltene Eintraege geloescht. Eine `id`, die nicht zu diesem Produkt
 * (bzw. dieser Gruppe) gehoert, ergibt 400 statt einer stillen Neuanlage.
 * Muss innerhalb derselben Transaktion wie die Aenderung der Produktfelder
 * aufgerufen werden.
 */
export async function saveOptionGroups(
  tx: Prisma.TransactionClient,
  productId: string,
  groups: GroupInput[],
): Promise<void> {
  validateOptionGroupsPayload(groups);

  const existingGroups = await tx.productOptionGroup.findMany({
    where: { productId },
    include: { options: true },
  });
  const existingGroupsById = new Map(existingGroups.map((g) => [g.id, g]));

  for (const group of groups) {
    if (group.id && !existingGroupsById.has(group.id)) {
      throw new BadRequestException(
        "Eine Auswahlgruppe mit dieser Kennung gehört nicht zu diesem Produkt.",
      );
    }
  }

  const keepGroupIds = new Set(
    groups
      .filter((g): g is GroupInput & { id: string } => Boolean(g.id))
      .map((g) => g.id),
  );
  const groupIdsToDelete = existingGroups
    .filter((g) => !keepGroupIds.has(g.id))
    .map((g) => g.id);
  if (groupIdsToDelete.length > 0) {
    await tx.productOptionGroup.deleteMany({
      where: { id: { in: groupIdsToDelete } },
    });
  }

  // Zwischenschritt gegen einen rohen Datenbankfehler beim Vertauschen der
  // Endpreis-Gruppe oder der Kachelmarke: die Migration legt fuer beide
  // Merkmale einen partiellen eindeutigen Index je Produkt an, und Postgres
  // prueft ihn je Anweisung, nicht erst am Ende der Transaktion. Kommt in
  // der Nutzlast die Gruppe, die die Marke abgibt, nach der Gruppe, die sie
  // uebernimmt (das ist die vom Bedienenden gepflegte Sortierung, keine
  // Ausnahme), wuerde das UPDATE der uebernehmenden Gruppe kurzzeitig zwei
  // Zeilen mit derselben Marke erzeugen, obwohl der Endzustand gueltig
  // waere. Deshalb werden zuerst alle bestehenden, weiterhin vorhandenen
  // Gruppen neutral gesetzt (SURCHARGE, quickSaleTiles=false) -- beides
  // verletzt fuer sich genommen nie eine CHECK-Bedingung --, bevor die
  // eigentlichen Zielwerte je Gruppe greifen.
  const keptExistingGroupIds = groups
    .filter((g): g is GroupInput & { id: string } => Boolean(g.id))
    .map((g) => g.id);
  if (keptExistingGroupIds.length > 0) {
    await tx.productOptionGroup.updateMany({
      where: { id: { in: keptExistingGroupIds } },
      data: { priceMode: "SURCHARGE", quickSaleTiles: false },
    });
  }

  for (const group of groups) {
    const isRequired = group.minSelect >= 1;

    if (group.id) {
      const existingGroup = existingGroupsById.get(group.id)!;
      const existingOptionsById = new Map(
        existingGroup.options.map((o) => [o.id, o]),
      );
      for (const option of group.options) {
        if (option.id && !existingOptionsById.has(option.id)) {
          throw new BadRequestException(
            "Eine Antwort mit dieser Kennung gehört nicht zu dieser Auswahlgruppe.",
          );
        }
      }

      await tx.productOptionGroup.update({
        where: { id: group.id },
        data: {
          name: group.name.trim(),
          selectionType: group.selectionType,
          isRequired,
          minSelect: group.minSelect,
          maxSelect: group.maxSelect,
          priceMode: group.priceMode,
          quickSaleTiles: group.quickSaleTiles,
          sortOrder: group.sortOrder,
        },
      });

      const keepOptionIds = new Set(
        group.options
          .filter((o): o is OptionInput & { id: string } => Boolean(o.id))
          .map((o) => o.id),
      );
      const optionIdsToDelete = existingGroup.options
        .filter((o) => !keepOptionIds.has(o.id))
        .map((o) => o.id);
      if (optionIdsToDelete.length > 0) {
        await tx.productOption.deleteMany({
          where: { id: { in: optionIdsToDelete } },
        });
      }

      for (const option of group.options) {
        if (option.id) {
          await tx.productOption.update({
            where: { id: option.id },
            data: {
              name: option.name.trim(),
              priceEffect: option.priceEffect,
              isActive: option.isActive ?? true,
              sortOrder: option.sortOrder,
            },
          });
        } else {
          await tx.productOption.create({
            data: {
              groupId: group.id,
              name: option.name.trim(),
              priceEffect: option.priceEffect,
              isActive: option.isActive ?? true,
              sortOrder: option.sortOrder,
            },
          });
        }
      }
    } else {
      for (const option of group.options) {
        if (option.id) {
          throw new BadRequestException(
            "Eine Antwort mit dieser Kennung gehört nicht zu dieser Auswahlgruppe.",
          );
        }
      }
      await tx.productOptionGroup.create({
        data: {
          productId,
          name: group.name.trim(),
          selectionType: group.selectionType,
          isRequired,
          minSelect: group.minSelect,
          maxSelect: group.maxSelect,
          priceMode: group.priceMode,
          quickSaleTiles: group.quickSaleTiles,
          sortOrder: group.sortOrder,
          options: {
            create: group.options.map((option) => ({
              name: option.name.trim(),
              priceEffect: option.priceEffect,
              isActive: option.isActive ?? true,
              sortOrder: option.sortOrder,
            })),
          },
        },
      });
    }
  }
}
