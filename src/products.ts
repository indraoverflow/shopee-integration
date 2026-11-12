import type { ShopeeClient } from "./client.js";
import type { ShopAuth } from "./shop.js";

export const ITEM_LIST_PATH = "/api/v2/product/get_item_list";
export const ITEM_BASE_INFO_PATH = "/api/v2/product/get_item_base_info";
export const MODEL_LIST_PATH = "/api/v2/product/get_model_list";

export type ShopeeItemStatus = "NORMAL" | "BANNED" | "DELETED" | "UNLIST" | "REVIEWING";

export interface ItemListEntry {
  item_id: number;
  item_status?: ShopeeItemStatus | string;
  update_time?: number;
  [key: string]: unknown;
}

export interface ModelSummary {
  model_id: number;
  model_name?: string;
  model_sku?: string;
  /** Absent for some listings; treat as unknown rather than zero. */
  stock_info_v2?: { seller_stock?: Array<{ stock: number }>; summary_info?: { total_available_stock?: number } };
  price_info?: Array<{ original_price?: number; current_price?: number }>;
  [key: string]: unknown;
}

export interface ItemDetail {
  item_id: number;
  item_name?: string;
  item_status?: string;
  description?: string;
  item_sku?: string;
  image?: { image_url_list?: string[] };
  price_info?: Array<{ original_price?: number; current_price?: number; currency?: string }>;
  stock_info_v2?: { summary_info?: { total_available_stock?: number } };
  has_model?: boolean;
  update_time?: number;
  [key: string]: unknown;
}

interface ItemListResponse {
  item?: ItemListEntry[];
  has_next_page?: boolean;
  next_offset?: number;
  total_count?: number;
}

export interface ItemListPage {
  items: ItemListEntry[];
  hasNextPage: boolean;
  nextOffset: number;
  totalCount?: number;
}

/**
 * One page of the item catalog. `item_status` is required by Shopee on newer
 * versions of the endpoint; NORMAL is the default because deleted and banned
 * listings cannot be sold and are useless for fulfilment mappings.
 */
export async function listItems(
  client: ShopeeClient,
  auth: ShopAuth,
  options: { offset?: number; pageSize?: number; itemStatus?: ShopeeItemStatus; updateTimeFrom?: number; updateTimeTo?: number } = {},
): Promise<ItemListPage> {
  const response = await client.shopGet<ItemListResponse>(ITEM_LIST_PATH, auth, {
    offset: options.offset ?? 0,
    page_size: Math.min(options.pageSize ?? 50, 100),
    item_status: options.itemStatus ?? "NORMAL",
    ...(options.updateTimeFrom !== undefined ? { update_time_from: options.updateTimeFrom } : {}),
    ...(options.updateTimeTo !== undefined ? { update_time_to: options.updateTimeTo } : {}),
  });

  return {
    items: response.item ?? [],
    hasNextPage: response.has_next_page ?? false,
    nextOffset: response.next_offset ?? 0,
    ...(response.total_count !== undefined ? { totalCount: response.total_count } : {}),
  };
}

/** Walks the whole catalog, with a page cap so a bad `has_next_page` cannot spin forever. */
export async function listAllItems(
  client: ShopeeClient,
  auth: ShopAuth,
  options: { pageSize?: number; itemStatus?: ShopeeItemStatus; maxPages?: number } = {},
): Promise<{ items: ItemListEntry[]; pages: number; truncated: boolean }> {
  const maxPages = options.maxPages ?? 200;
  const items: ItemListEntry[] = [];
  let offset = 0;
  let pages = 0;

  for (;;) {
    const page = await listItems(client, auth, {
      offset,
      ...(options.pageSize !== undefined ? { pageSize: options.pageSize } : {}),
      ...(options.itemStatus !== undefined ? { itemStatus: options.itemStatus } : {}),
    });
    pages += 1;
    items.push(...page.items);
    if (!page.hasNextPage || page.items.length === 0) return { items, pages, truncated: false };
    if (pages >= maxPages) return { items, pages, truncated: true };
    offset = page.nextOffset;
  }
}

interface ItemBaseInfoResponse {
  item_list?: ItemDetail[];
}

/** get_item_base_info accepts up to 50 item ids per call. */
export async function getItemDetails(
  client: ShopeeClient,
  auth: ShopAuth,
  itemIds: number[],
  options: { needTaxInfo?: boolean; needComplaintPolicy?: boolean } = {},
): Promise<ItemDetail[]> {
  const unique = [...new Set(itemIds.filter((id) => Number.isInteger(id) && id > 0))];
  const details: ItemDetail[] = [];

  for (let index = 0; index < unique.length; index += 50) {
    const batch = unique.slice(index, index + 50);
    const response = await client.shopGet<ItemBaseInfoResponse>(ITEM_BASE_INFO_PATH, auth, {
      item_id_list: batch.join(","),
      ...(options.needTaxInfo !== undefined ? { need_tax_info: options.needTaxInfo } : {}),
      ...(options.needComplaintPolicy !== undefined ? { need_complaint_policy: options.needComplaintPolicy } : {}),
    });
    details.push(...(response.item_list ?? []));
  }

  return details;
}

interface ModelListResponse {
  model?: ModelSummary[];
  has_next_page?: boolean;
  next_offset?: number;
  tier_variation?: Array<{ name?: string; option_list?: Array<{ option?: string }> }>;
}

export interface ModelList {
  models: ModelSummary[];
  /** The variation names Shopee shows to buyers, in order, e.g. ["Paket"]. */
  tierNames: string[];
  pages: number;
}

/** Reads every model (variation) of one item. */
export async function getItemModels(
  client: ShopeeClient,
  auth: ShopAuth,
  itemId: number,
  options: { pageSize?: number; maxPages?: number } = {},
): Promise<ModelList> {
  const pageSize = Math.min(options.pageSize ?? 100, 100);
  const maxPages = options.maxPages ?? 50;
  const models: ModelSummary[] = [];
  const tierNames: string[] = [];
  let offset = 0;
  let pages = 0;

  for (;;) {
    const response = await client.shopGet<ModelListResponse>(MODEL_LIST_PATH, auth, {
      item_id: itemId,
      offset,
      page_size: pageSize,
    });
    pages += 1;
    models.push(...(response.model ?? []));
    for (const tier of response.tier_variation ?? []) {
      if (tier.name && !tierNames.includes(tier.name)) tierNames.push(tier.name);
    }
    if (!response.has_next_page || (response.model ?? []).length === 0) break;
    if (pages >= maxPages) break;
    offset = response.next_offset ?? offset + pageSize;
  }

  return { models, tierNames, pages };
}
