import { create } from 'zustand';

export interface CartItem {
  product: any;
  quantity: number;
}

interface CartState {
  items: CartItem[];
  addItem: (product: any) => void;
  removeItem: (productId: string) => void;
  clearCart: () => void;
  total: number;
}

export const useCartStore = create<CartState>((set) => ({
  items: [],
  total: 0,
  addItem: (product) => set((state) => {
    const existing = state.items.find(i => i.product.id === product.id);
    let newItems;
    if (existing) {
      newItems = state.items.map(i => 
        i.product.id === product.id ? { ...i, quantity: i.quantity + 1 } : i
      );
    } else {
      newItems = [...state.items, { product, quantity: 1 }];
    }
    const newTotal = newItems.reduce((acc, item) => acc + (item.product.price * item.quantity), 0);
    return { items: newItems, total: newTotal };
  }),
  removeItem: (productId) => set((state) => {
    const existing = state.items.find(i => i.product.id === productId);
    let newItems;
    if (existing && existing.quantity > 1) {
      newItems = state.items.map(i => 
        i.product.id === productId ? { ...i, quantity: i.quantity - 1 } : i
      );
    } else {
      newItems = state.items.filter(i => i.product.id !== productId);
    }
    const newTotal = newItems.reduce((acc, item) => acc + (item.product.price * item.quantity), 0);
    return { items: newItems, total: newTotal };
  }),
  clearCart: () => set({ items: [], total: 0 }),
}));
