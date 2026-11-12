import type { ShopeeClient } from "./client.js";
import type { ShopAuth } from "./shop.js";

export const ORDER_DETAIL_PATH = "/api/v2/order/get_order_detail";

/**
 * Fields the order list endpoint does not carry. The detail endpoint only
 * returns what you ask for, so the defaults here are the set a fulfilment
 * pipeline needs: who bought it, what they bought, and what the seller has to
 * ship against.
 */
export const DEFAULT_ORDER_FIELDS = [
  "buyer_username",
  "recipient_address",
  "item_list",
  "total_amount",
  "payment_method",
  "message_to_seller",
  "order_status",
  "create_time",
  "update_time",
  "currency",
  "cod",
] as const;

export interface OrderItem {
  item_id: number;
  /** Absent when the listing has no variations. */
  model_id?: number;
  item_name?: string;
  item_sku?: string;
  model_name?: string;
  model_sku?: string;
  /** Shopee's field name. Always at least 1 on a paid order. */
  model_quantity_purchased?: number;
  model_discounted_price?: number;
  model_original_price?: number;
  image_info?: { image_url?: string };
  [key: string]: unknown;
}

export interface RecipientAddress {
  name?: string;
  /** Shopee masks this on most order states, e.g. "********1234". */
  phone?: string;
  /** Present on newer responses instead of `phone`. */
  masked_phone?: string;
  full_address?: string;
  city?: string;
  state?: string;
  zipcode?: string;
  [key: string]: unknown;
}

export interface OrderDetail {
  order_sn: string;
  order_status?: string;
  buyer_username?: string;
  create_time?: number;
  update_time?: number;
  total_amount?: number;
  currency?: string;
  payment_method?: string;
  message_to_seller?: string;
  recipient_address?: RecipientAddress;
  item_list?: OrderItem[];
  [key: string]: unknown;
}

interface OrderDetailResponse {
  order_list?: OrderDetail[];
}

/** Shopee caps order_sn_list at 50 per call. */
export const ORDER_DETAIL_BATCH = 50;

/**
 * Fetches full order details for the given order numbers. The caller describes
 * the window; this only fetches, so a 50-order page never turns into 50 calls
 * by mistake.
 */
export async function getOrderDetails(
  client: ShopeeClient,
  auth: ShopAuth,
  orderSns: string[],
  optionalFields: readonly string[] = DEFAULT_ORDER_FIELDS,
): Promise<OrderDetail[]> {
  const unique = [...new Set(orderSns.filter((sn) => typeof sn === "string" && sn !== ""))];
  const orders: OrderDetail[] = [];

  for (let index = 0; index < unique.length; index += ORDER_DETAIL_BATCH) {
    const batch = unique.slice(index, index + ORDER_DETAIL_BATCH);
    const response = await client.shopGet<OrderDetailResponse>(ORDER_DETAIL_PATH, auth, {
      order_sn_list: batch.join(","),
      response_optional_fields: optionalFields.join(","),
    });
    orders.push(...(response.order_list ?? []));
  }

  return orders;
}
