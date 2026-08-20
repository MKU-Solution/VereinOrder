import { create } from "zustand";

export interface CartItem {
  id: string;
  product: any;
  variant?: any;
  extras?: any[];
  quantity: number;
  finalPrice: number;
}

interface CartState {
  items: CartItem[];
  addItem: (product: any, variant?: any, extras?: any[]) => void;
  removeItem: (cartItemId: string) => void;
  deleteItem: (cartItemId: string) => void;
  clearCart: () => void;
  total: number;
}

export const useCartStore = create<CartState>((set) => ({
  items: [],
  total: 0,
  addItem: (product, variant, extras) =>
    set((state) => {
      let finalPrice = product.price;
      const idParts = [product.id];

      if (variant) {
        finalPrice = variant.price;
        idParts.push(variant.id);
      }

      if (extras && extras.length > 0) {
        const extraCost = extras.reduce((sum, e) => sum + e.price, 0);
        finalPrice += extraCost;
        const extraIds = extras
          .map((e) => e.id)
          .sort()
          .join("_");
        idParts.push(extraIds);
      }

      const cartItemId = idParts.join("|");
      const existing = state.items.find((i) => i.id === cartItemId);
      let newItems;

      if (existing) {
        newItems = state.items.map((i) =>
          i.id === cartItemId ? { ...i, quantity: i.quantity + 1 } : i,
        );
      } else {
        newItems = [
          ...state.items,
          { id: cartItemId, product, variant, extras, quantity: 1, finalPrice },
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
