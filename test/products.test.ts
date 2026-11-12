import { describe, expect, it } from "vitest";
import type { ShopeeClient } from "../src/client.js";
import {
  ITEM_BASE_INFO_PATH,
  ITEM_LIST_PATH,
  MODEL_LIST_PATH,
  getItemDetails,
  getItemModels,
  listAllItems,
  listItems,
} from "../src/products.js";

const auth = { accessToken: "tok", shopId: 42 };

describe("listItems", () => {
  it("pages the catalog and passes the requested status", async () => {
    const queries: Array<Record<string, unknown>> = [];
    const fake = {
      shopGet: async (path: string, _shop: unknown, query: Record<string, unknown>) => {
        expect(path).toBe(ITEM_LIST_PATH);
        queries.push(query);
        return { item: [{ item_id: 1 }, { item_id: 2 }], has_next_page: true, next_offset: 2, total_count: 4 };
      },
    } as unknown as ShopeeClient;

    const page = await listItems(fake, auth, { offset: 0, pageSize: 2, itemStatus: "NORMAL" });

    expect(page.items).toHaveLength(2);
    expect(page.hasNextPage).toBe(true);
    expect(page.nextOffset).toBe(2);
    expect(page.totalCount).toBe(4);
    expect(queries[0]).toMatchObject({ offset: 0, page_size: 2, item_status: "NORMAL" });
  });

  it("caps page size at the documented maximum", async () => {
    let sent = 0;
    const fake = {
      shopGet: async (_path: string, _shop: unknown, query: Record<string, unknown>) => {
        sent = Number(query.page_size);
        return { item: [] };
      },
    } as unknown as ShopeeClient;

    await listItems(fake, auth, { pageSize: 500 });
    expect(sent).toBe(100);
  });
});

describe("listAllItems", () => {
  it("walks every page until has_next_page is false", async () => {
    let call = 0;
    const fake = {
      shopGet: async (_path: string, _shop: unknown, query: Record<string, unknown>) => {
        call += 1;
        expect(query.offset).toBe((call - 1) * 2);
        return call < 3
          ? { item: [{ item_id: call * 10 }, { item_id: call * 10 + 1 }], has_next_page: true, next_offset: call * 2 }
          : { item: [{ item_id: 99 }], has_next_page: false };
      },
    } as unknown as ShopeeClient;

    const result = await listAllItems(fake, auth, { pageSize: 2 });
    expect(result.items.map((item) => item.item_id)).toEqual([10, 11, 20, 21, 99]);
    expect(result.pages).toBe(3);
    expect(result.truncated).toBe(false);
  });

  it("stops at maxPages and reports truncation", async () => {
    const fake = {
      shopGet: async () => ({ item: [{ item_id: 1 }], has_next_page: true, next_offset: 1 }),
    } as unknown as ShopeeClient;

    const result = await listAllItems(fake, auth, { maxPages: 4 });
    expect(result.pages).toBe(4);
    expect(result.truncated).toBe(true);
  });
});

describe("getItemDetails", () => {
  it("batches item ids at fifty per call", async () => {
    const batches: number[] = [];
    const fake = {
      shopGet: async (path: string, _shop: unknown, query: Record<string, unknown>) => {
        expect(path).toBe(ITEM_BASE_INFO_PATH);
        batches.push(String(query.item_id_list).split(",").length);
        return { item_list: [] };
      },
    } as unknown as ShopeeClient;

    await getItemDetails(fake, auth, Array.from({ length: 105 }, (_, index) => index + 1));
    expect(batches).toEqual([50, 50, 5]);
  });
});

describe("getItemModels", () => {
  it("collects models and variation names across pages", async () => {
    let call = 0;
    const fake = {
      shopGet: async (path: string, _shop: unknown, query: Record<string, unknown>) => {
        expect(path).toBe(MODEL_LIST_PATH);
        expect(query.item_id).toBe(7);
        call += 1;
        if (call === 1) {
          return {
            model: [{ model_id: 100, model_name: "1 E-Meterai" }],
            has_next_page: true,
            next_offset: 1,
            tier_variation: [{ name: "Paket", option_list: [{ option: "1" }] }],
          };
        }
        return {
          model: [{ model_id: 101, model_name: "5 E-Meterai" }],
          has_next_page: false,
          tier_variation: [{ name: "Paket", option_list: [{ option: "5" }] }],
        };
      },
    } as unknown as ShopeeClient;

    const result = await getItemModels(fake, auth, 7);
    expect(result.models.map((model) => model.model_id)).toEqual([100, 101]);
    expect(result.tierNames).toEqual(["Paket"]);
    expect(result.pages).toBe(2);
  });

  it("returns no models for a listing without variations", async () => {
    const fake = {
      shopGet: async () => ({ model: [], has_next_page: false }),
    } as unknown as ShopeeClient;

    const result = await getItemModels(fake, auth, 7);
    expect(result.models).toEqual([]);
    expect(result.pages).toBe(1);
  });
});
