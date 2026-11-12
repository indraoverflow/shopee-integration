import type { ShopeeSDK } from "@congminh1254/shopee-sdk";

/**
 * The sandbox answers flat for some endpoints, with the payload at the top
 * level, while the upstream types declare `response` as always present. Accept
 * both so a flat body is not read as an empty result.
 */
export function unwrap<T>(body: unknown): T {
  const envelope = body as { response?: T } & T;
  return (envelope.response ?? envelope) as T;
}

export interface ShopInfo {
  shop_id?: number;
  shop_name?: string;
  region?: string;
  status?: string;
  [key: string]: unknown;
}

export interface OrderSummary {
  order_sn: string;
  order_status?: string;
  update_time?: number;
  create_time?: number;
  [key: string]: unknown;
}

export async function getShopInfo(sdk: ShopeeSDK): Promise<ShopInfo> {
  return unwrap<ShopInfo>(await sdk.shop.getShopInfo());
}

export interface OrderWindow {
  /** Unix seconds. */
  from: number;
  /** Unix seconds. */
  to: number;
  pageSize?: number;
  /** Safety stop for a runaway loop; the caller decides what is too many. */
  maxPages?: number;
}

export interface OrderPage {
  orders: OrderSummary[];
  pages: number;
  /** True when the loop stopped at maxPages instead of exhausting the cursor. */
  truncated: boolean;
}

/**
 * Lists orders whose update time falls inside the window. Reconciliation uses
 * update time, not create time: a push that never arrived is invisible in a
 * create-time query.
 */
export async function listOrdersByUpdateTime(sdk: ShopeeSDK, window: OrderWindow): Promise<OrderPage> {
  const pageSize = window.pageSize ?? 50;
  const maxPages = window.maxPages ?? 20;
  const orders: OrderSummary[] = [];
  let cursor = "";
  let pages = 0;

  for (;;) {
    const page = unwrap<{ order_list?: OrderSummary[]; more?: boolean; next_cursor?: string }>(
      await sdk.order.getOrderList({
        time_range_field: "update_time",
        time_from: window.from,
        time_to: window.to,
        page_size: pageSize,
        ...(cursor ? { cursor } : {}),
      } as never),
    );

    pages += 1;
    orders.push(...(page.order_list ?? []));

    if (!page.more || !page.next_cursor) {
      return { orders, pages, truncated: false };
    }
    cursor = page.next_cursor;
    if (pages >= maxPages) {
      return { orders, pages, truncated: true };
    }
  }
}
