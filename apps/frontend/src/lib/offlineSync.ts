import { openDB } from "idb";

const DB_NAME = "vereinorder-db";
const STORE_NAME = "offline-orders";
const DB_VERSION = 1;

interface OfflineOrder {
  idempotencyKey: string;
  eventId: string;
  items: { productId: string; quantity: number }[];
  payments: { amount: number; method: "CASH" | "CARD" | "VOUCHER" }[];
  tableName?: string;
  areaId?: string;
  createdAt: number;
}

const getDB = async () => {
  return openDB(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "idempotencyKey" });
      }
    },
  });
};

export const saveOrderOffline = async (order: OfflineOrder) => {
  const db = await getDB();
  await db.put(STORE_NAME, order);
};

export const getOfflineOrders = async (): Promise<OfflineOrder[]> => {
  const db = await getDB();
  return db.getAll(STORE_NAME);
};

export const removeOfflineOrder = async (idempotencyKey: string) => {
  const db = await getDB();
  await db.delete(STORE_NAME, idempotencyKey);
};
