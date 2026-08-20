import { OrderFulfillmentStatus } from "@vereinorder/database";

type FulfillmentItem = { status: string };

export const deriveFulfillmentStatus = (
  items: FulfillmentItem[],
): OrderFulfillmentStatus => {
  const activeItems = items.filter((item) => item.status !== "CANCELLED");
  if (activeItems.length === 0) return "PENDING";

  if (activeItems.every((item) => item.status === "DELIVERED"))
    return "DELIVERED";
  if (
    activeItems.some(
      (item) => item.status === "IN_DELIVERY" || item.status === "DELIVERED",
    )
  ) {
    return "PARTIALLY_DELIVERED";
  }
  if (activeItems.every((item) => item.status === "READY")) return "READY";
  if (activeItems.some((item) => item.status === "READY"))
    return "PARTIALLY_READY";
  if (activeItems.some((item) => item.status === "PREPARING"))
    return "PREPARING";
  return "PENDING";
};
