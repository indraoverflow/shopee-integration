import type { ShopeeSDK } from "@congminh1254/shopee-sdk";
import { listOrdersByUpdateTime, type OrderPage, type OrderSummary, type OrderWindow } from "./shop.js";
import type { PushEvent } from "./webhook.js";

/** Push code 3 is an order status update. */
export const PUSH_CODE_ORDER_STATUS = 3;

/** The order number a push refers to, when the push carries one. */
export function orderSnFromPush(event: PushEvent): string | undefined {
  const data = event.data as { ordersn?: string; order_sn?: string } | undefined;
  const sn = data?.ordersn ?? data?.order_sn;
  return typeof sn === "string" && sn !== "" ? sn : undefined;
}

export interface ReconcileResult {
  scanned: number;
  handled: number;
  skipped: number;
  pages: number;
  truncated: boolean;
}

/**
 * Push plus reconciliation. Pushes arrive late, twice, or not at all, so this
 * queries the window and hands each unseen order to the handler. `seen` is the
 * caller's idempotency set: passing the same set between runs makes a repeated
 * order harmless.
 */
export async function reconcileOrders(
  sdk: ShopeeSDK,
  window: OrderWindow,
  handle: (order: OrderSummary) => Promise<void> | void,
  seen: Set<string> = new Set(),
): Promise<ReconcileResult> {
  const page: OrderPage = await listOrdersByUpdateTime(sdk, window);
  let handled = 0;
  let skipped = 0;

  for (const order of page.orders) {
    if (typeof order.order_sn !== "string" || order.order_sn === "") {
      skipped += 1;
      continue;
    }
    if (seen.has(order.order_sn)) {
      skipped += 1;
      continue;
    }
    await handle(order);
    seen.add(order.order_sn);
    handled += 1;
  }

  return { scanned: page.orders.length, handled, skipped, pages: page.pages, truncated: page.truncated };
}
