import type { OrderRejectionCode } from "@vereinorder/shared";

export interface OrderRejectionResponse {
  code: OrderRejectionCode;
  message: string;
}

export function orderRejection(
  code: OrderRejectionCode,
  message: string,
): OrderRejectionResponse {
  return { code, message };
}
