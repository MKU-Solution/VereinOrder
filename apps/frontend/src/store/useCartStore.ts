import { create } from "zustand";
import { resolveProductDeposit } from "../lib/productDeposit";

export interface SelectedCartOption {
  id: string;
  name: string;
  priceEffect: number;
  groupId: string;
  groupName: string;
  priceMode: "ABSOLUTE" | "SURCHARGE";
}

export interface CartItem {
  id: string;
  product: any;
  selectedOptions?: SelectedCartOption[];
  quantity: number;
  finalPrice: number;
}

interface CartState {
  items: CartItem[];
  addItem: (product: any, selectedOptions?: SelectedCartOption[]) => void;
  // Ersetzt die Auswahl einer bestehenden Zeile (Issue #82), z. B. wenn der
  // Gast statt Reis doch Pommes möchte. Bildet Schlüssel und Preis nach
  // denselben Regeln wie addItem (siehe buildCartLine) und verschmilzt mit
  // einer bereits vorhandenen gleichen Zusammenstellung, statt zwei gleiche
  // Zeilen entstehen zu lassen.
  updateItemOptions: (
    cartItemId: string,
    selectedOptions: SelectedCartOption[],
  ) => void;
  removeItem: (cartItemId: string) => void;
  deleteItem: (cartItemId: string) => void;
  clearCart: () => void;
  depositRefundCount: number;
  depositRefundUnitPrice: number;
  setDepositRefundCount: (count: number) => void;
  setDepositRefundUnitPrice: (unitPrice: number) => void;
  total: number;
}

// Gemeinsame Bildung von Zeilenschlüssel und Endpreis aus Produkt und
// gewählten Antworten. Von addItem und updateItemOptions genutzt, damit
// beide garantiert denselben Schlüssel für dieselbe Zusammenstellung bilden
// (Voraussetzung für das Verschmelzen gleicher Zeilen).
const buildCartLine = (
  product: any,
  selectedOptions: SelectedCartOption[] | undefined,
) => {
  const options = selectedOptions || [];

  // Grundpreis: die Antwort der ABSOLUTE-Gruppe, sonst der Produktpreis.
  const absoluteOption = options.find((o) => o.priceMode === "ABSOLUTE");
  let finalPrice = absoluteOption ? absoluteOption.priceEffect : product.price;

  // Aufpreise: Summe der priceEffect aller übrigen gewählten Antworten.
  const surcharge = options
    .filter((o) => o.priceMode !== "ABSOLUTE")
    .reduce((sum, o) => sum + o.priceEffect, 0);
  finalPrice += surcharge;

  // Pfandaufschlag je Stück (Issue #137)
  const deposit = resolveProductDeposit(product || {});
  finalPrice += deposit;

  // cartItemId enthält alle gewählten Antwortkennungen, aufsteigend sortiert,
  // damit zwei verschiedene Zusammenstellungen desselben Produkts nicht zu
  // einer Warenkorbzeile verschmelzen (und gleiche Zusammenstellungen sicher
  // denselben Schlüssel erhalten).
  const optionIds = options.map((o) => o.id).sort();
  const cartItemId = [product.id, ...optionIds].join("|");

  return { cartItemId, finalPrice, options };
};

const recalcTotal = (
  items: CartItem[],
  depositRefundCount = 0,
  depositRefundUnitPrice = 100,
) => {
  const itemsTotal = items.reduce(
    (acc, item) => acc + item.finalPrice * item.quantity,
    0,
  );
  const refundTotal = Math.max(0, depositRefundCount * depositRefundUnitPrice);
  return Math.max(0, itemsTotal - refundTotal);
};

const sanitizeNonNegativeInt32 = (value: number) => {
  if (!Number.isFinite(value)) return 0;
  return Math.min(2_147_483_647, Math.max(0, Math.floor(value)));
};

export const useCartStore = create<CartState>((set) => ({
  items: [],
  total: 0,
  depositRefundCount: 0,
  depositRefundUnitPrice: 100, // standardmäßig 1,00 € (100 Cent) je Pfandglas
  setDepositRefundCount: (count) =>
    set((state) => {
      const sanitized = sanitizeNonNegativeInt32(count);
      return {
        depositRefundCount: sanitized,
        total: recalcTotal(
          state.items,
          sanitized,
          state.depositRefundUnitPrice,
        ),
      };
    }),
  setDepositRefundUnitPrice: (unitPrice) =>
    set((state) => {
      const sanitized = sanitizeNonNegativeInt32(unitPrice);
      return {
        depositRefundUnitPrice: sanitized,
        total: recalcTotal(state.items, state.depositRefundCount, sanitized),
      };
    }),
  addItem: (product, selectedOptions) =>
    set((state) => {
      const { cartItemId, finalPrice, options } = buildCartLine(
        product,
        selectedOptions,
      );

      const existing = state.items.find((i) => i.id === cartItemId);
      let newItems;

      if (existing) {
        newItems = state.items.map((i) =>
          i.id === cartItemId ? { ...i, quantity: i.quantity + 1 } : i,
        );
      } else {
        newItems = [
          ...state.items,
          {
            id: cartItemId,
            product,
            selectedOptions: options,
            quantity: 1,
            finalPrice,
          },
        ];
      }

      return {
        items: newItems,
        total: recalcTotal(
          newItems,
          state.depositRefundCount,
          state.depositRefundUnitPrice,
        ),
      };
    }),

  updateItemOptions: (cartItemId, selectedOptions) =>
    set((state) => {
      const current = state.items.find((i) => i.id === cartItemId);
      if (!current) return state;

      const {
        cartItemId: newCartItemId,
        finalPrice,
        options,
      } = buildCartLine(current.product, selectedOptions);

      if (newCartItemId === cartItemId) {
        // Zusammenstellung unverändert (z. B. dieselbe Auswahl erneut
        // übernommen): Zeile bleibt an ihrem Platz, nur Auswahl/Preis werden
        // aufgefrischt.
        const newItems = state.items.map((i) =>
          i.id === cartItemId
            ? { ...i, selectedOptions: options, finalPrice }
            : i,
        );
        return {
          items: newItems,
          total: recalcTotal(
            newItems,
            state.depositRefundCount,
            state.depositRefundUnitPrice,
          ),
        };
      }

      const mergeTarget = state.items.find((i) => i.id === newCartItemId);

      let newItems: CartItem[];
      if (mergeTarget) {
        // Die neue Zusammenstellung entspricht einer bereits vorhandenen
        // anderen Zeile: beide verschmelzen, Mengen addieren sich, statt
        // zwei gleiche Zeilen entstehen zu lassen.
        newItems = state.items
          .filter((i) => i.id !== cartItemId)
          .map((i) =>
            i.id === newCartItemId
              ? { ...i, quantity: i.quantity + current.quantity }
              : i,
          );
      } else {
        // Keine passende Zeile vorhanden: die bestehende Zeile erhält die
        // neue Auswahl, neuen Schlüssel und neuen Preis, behält aber ihre
        // Menge.
        newItems = state.items.map((i) =>
          i.id === cartItemId
            ? {
                ...i,
                id: newCartItemId,
                selectedOptions: options,
                finalPrice,
              }
            : i,
        );
      }

      return {
        items: newItems,
        total: recalcTotal(
          newItems,
          state.depositRefundCount,
          state.depositRefundUnitPrice,
        ),
      };
    }),

  removeItem: (cartItemId) =>
    set((state) => {
      const existing = state.items.find((i) => i.id === cartItemId);
      let newItems;
      if (existing && existing.quantity > 1) {
        newItems = state.items.map((i) =>
          i.id === cartItemId ? { ...i, quantity: i.quantity - 1 } : i,
        );
      } else {
        newItems = state.items.filter((i) => i.id !== cartItemId);
      }
      return {
        items: newItems,
        total: recalcTotal(
          newItems,
          state.depositRefundCount,
          state.depositRefundUnitPrice,
        ),
      };
    }),

  deleteItem: (cartItemId) =>
    set((state) => {
      const newItems = state.items.filter((i) => i.id !== cartItemId);
      return {
        items: newItems,
        total: recalcTotal(
          newItems,
          state.depositRefundCount,
          state.depositRefundUnitPrice,
        ),
      };
    }),

  clearCart: () => set({ items: [], total: 0, depositRefundCount: 0 }),
}));
