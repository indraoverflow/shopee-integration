import { describe, expect, it } from "vitest";
import type { ShopeeClient } from "../src/client.js";
import { ORDER_LIST_PATH, SHOP_INFO_PATH, getShopInfo, listOrdersByUpdateTime } from "../src/shop.js";

const auth = { accessToken: "tok", shopId: 11 };

describe("getShopInfo", () => {
  it("calls the shop endpoint with the shop credentials", async () => {
    const calls: unknown[] = [];
    const fake = {
      shopGet: async (path: string, shop: unknown, query: unknown) => {
        calls.push({ path, shop, query });
        return { shop_id: 11, shop_name: "Test Shop", region: "ID" };
      },
    } as unknown as ShopeeClient;

    const info = await getShopInfo(fake, auth);
    expect(info.shop_name).toBe("Test Shop");
    expect(calls[0]).toEqual({ path: SHOP_INFO_PATH, shop: auth, query: undefined });
  });
});

describe("listOrdersByUpdateTime", () => {
  it("pages with the cursor until the response says there is no more", async () => {
    const queries: Array<Record<string, unknown>> = [];
    const pages = [
      { order_list: [{ order_sn: "A" }, { order_sn: "B" }], more: true, next_cursor: "c1" },
      { order_list: [{ order_sn: "C" }], more: false },
    ];
    const fake = {
      shopGet: async (_path: string, _shop: unknown, query: Record<string, unknown>) => {
        queries.push(query);
        return pages[queries.length - 1];
      },
    } as unknown as ShopeeClient;

    const result = await listOrdersByUpdateTime(fake, { ...auth, from: 100, to: 200 });

    expect(result.orders.map((o) => o.order_sn)).toEqual(["A", "B", "C"]);
    expect(result.pages).toBe(2);
    expect(result.truncated).toBe(false);
    expect(queries[0]).toMatchObject({ time_range_field: "update_time", time_from: 100, time_to: 200, page_size: 50 });
    expect(queries[0]!.cursor).toBeUndefined();
    expect(queries[1]!.cursor).toBe("c1");
  });

  it("stops at maxPages and says the result is truncated", async () => {
    const fake = {
      shopGet: async () => ({ order_list: [{ order_sn: "A" }], more: true, next_cursor: "again" }),
    } as unknown as ShopeeClient;

    const result = await listOrdersByUpdateTime(fake, { ...auth, from: 1, to: 2, pageSize: 1, maxPages: 3 });
    expect(result.pages).toBe(3);
    expect(result.truncated).toBe(true);
    expect(result.orders).toHaveLength(3);
  });

  it("stops when more is true but no cursor came back, instead of looping", async () => {
    const fake = {
      shopGet: async () => ({ order_list: [{ order_sn: "A" }], more: true }),
    } as unknown as ShopeeClient;

    const result = await listOrdersByUpdateTime(fake, { ...auth, from: 1, to: 2 });
    expect(result.pages).toBe(1);
    expect(result.truncated).toBe(false);
  });

  it("asks for the order list path", async () => {
    const paths: string[] = [];
    const fake = {
      shopGet: async (path: string) => {
        paths.push(path);
        return { order_list: [], more: false };
      },
    } as unknown as ShopeeClient;

    await listOrdersByUpdateTime(fake, { ...auth, from: 1, to: 2 });
    expect(paths).toEqual([ORDER_LIST_PATH]);
  });
});
