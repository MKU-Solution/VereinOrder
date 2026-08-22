import { create } from "zustand";

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
  removeItem: (cartItemId: string) => void;
  deleteItem: (cartItemId: string) => void;
  clearCart: () => void;
  total: number;
}

export const useCartStore = create<CartState>((set) => ({
  items: [],
  total: 0,
  addItem: (product, selectedOptions) =>
    set((state) => {
      const options = selectedOptions || [];

      // Grundpreis: die Antwort der ABSOLUTE-Gruppe, sonst der Produktpreis.
      const absoluteOption = options.find((o) => o.priceMode === "ABSOLUTE");
      let finalPrice = absoluteOption
        ? absoluteOption.priceEffect
        : product.price;

      // Aufpreise: Summe der priceEffect aller übrigen gewählten Antworten.
      const surcharge = options
        .filter((o) => o.priceMode !== "ABSOLUTE")
        .reduce((sum, o) => sum + o.priceEffect, 0);
      finalPrice += surcharge;

      // cartItemId enthält alle gewählten Antwortkennungen, aufsteigend sortiert,
      // damit zwei verschiedene Zusammenstellungen desselben Produkts nicht zu
      // einer Warenkorbzeile verschmelzen.
      const optionIds = options.map((o) => o.id).sort();
      const cartItemId = [product.id, ...optionIds].join("|");

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

      const newTotal = newItems.reduce(
        (acc, item) => acc + item.finalPrice * item.quantity,
        0,
      );
      return { items: newItems, total: newTotal };
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
      const newTotal = newItems.reduce(
        (acc, item) => acc + item.finalPrice * item.quantity,
        0,
      );
      return { items: newItems, total: newTotal };
    }),

  deleteItem: (cartItemId) =>
    set((state) => {
      const newItems = state.items.filter((i) => i.id !== cartItemId);
      const newTotal = newItems.reduce(
        (acc, item) => acc + item.finalPrice * item.quantity,
        0,
      );
      return { items: newItems, total: newTotal };
    }),

  clearCart: () => set({ items: [], total: 0 }),
}));
