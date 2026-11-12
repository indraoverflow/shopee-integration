import type { ShopeeClient } from "./client.js";

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

export const SHOP_INFO_PATH = "/api/v2/shop/get_shop_info";
export const ORDER_LIST_PATH = "/api/v2/order/get_order_list";

export interface ShopAuth {
  accessToken: string;
  shopId: number;
}

export async function getShopInfo(client: ShopeeClient, auth: ShopAuth): Promise<ShopInfo> {
  return client.shopGet<ShopInfo>(SHOP_INFO_PATH, auth);
}

export interface OrderWindow extends ShopAuth {
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
export async function listOrdersByUpdateTime(client: ShopeeClient, window: OrderWindow): Promise<OrderPage> {
  const pageSize = window.pageSize ?? 50;
  const maxPages = window.maxPages ?? 20;
  const orders: OrderSummary[] = [];
  let cursor = "";
  let pages = 0;

  for (;;) {
    const response = await client.shopGet<{
      order_list?: OrderSummary[];
      more?: boolean;
      next_cursor?: string;
    }>(
      ORDER_LIST_PATH,
      { accessToken: window.accessToken, shopId: window.shopId },
      {
        time_range_field: "update_time",
        time_from: window.from,
        time_to: window.to,
        page_size: pageSize,
        ...(cursor ? { cursor } : {}),
      },
    );

    pages += 1;
    orders.push(...(response.order_list ?? []));

    if (!response.more) {
      return { orders, pages, truncated: false };
    }
    if (!response.next_cursor) {
      return { orders, pages, truncated: false };
    }
    cursor = response.next_cursor;
    if (pages >= maxPages) {
      return { orders, pages, truncated: true };
    }
  }
}
