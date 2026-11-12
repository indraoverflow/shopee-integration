import { describe, expect, it } from "vitest";
import type { ShopeeSDK } from "@congminh1254/shopee-sdk";
import { getShopInfo, listOrdersByUpdateTime } from "../src/shop.js";

describe("getShopInfo", () => {
  it("returns the payload when the endpoint wraps it", async () => {
    const sdk = {
      shop: { getShopInfo: async () => ({ response: { shop_id: 11, shop_name: "Wrapped Shop", region: "ID" }, error: "" }) },
    } as unknown as ShopeeSDK;

    const info = await getShopInfo(sdk);
    expect(info.shop_name).toBe("Wrapped Shop");
  });

  it("returns the payload when the endpoint answers flat, as the sandbox does", async () => {
    const sdk = {
      shop: { getShopInfo: async () => ({ shop_id: 11, shop_name: "Flat Shop", region: "ID", error: "", message: "" }) },
    } as unknown as ShopeeSDK;

    const info = await getShopInfo(sdk);
    expect(info.shop_name).toBe("Flat Shop");
  });
});

describe("listOrdersByUpdateTime", () => {
  it("pages with the cursor until the response says there is no more", async () => {
    const queries: Array<Record<string, unknown>> = [];
    const pages = [
      { order_list: [{ order_sn: "A" }, { order_sn: "B" }], more: true, next_cursor: "c1" },
      { order_list: [{ order_sn: "C" }], more: false },
    ];
    const sdk = {
      order: {
        getOrderList: async (query: Record<string, unknown>) => {
          queries.push(query);
          return pages[queries.length - 1];
        },
      },
    } as unknown as ShopeeSDK;

    const result = await listOrdersByUpdateTime(sdk, { from: 100, to: 200 });

    expect(result.orders.map((o) => o.order_sn)).toEqual(["A", "B", "C"]);
    expect(result.pages).toBe(2);
    expect(result.truncated).toBe(false);
    expect(queries[0]).toMatchObject({ time_range_field: "update_time", time_from: 100, time_to: 200, page_size: 50 });
    expect(queries[0]!.cursor).toBeUndefined();
    expect(queries[1]!.cursor).toBe("c1");
  });

  it("unwraps a wrapped order list", async () => {
    const sdk = {
      order: { getOrderList: async () => ({ response: { order_list: [{ order_sn: "W" }], more: false }, error: "" }) },
    } as unknown as ShopeeSDK;

    const result = await listOrdersByUpdateTime(sdk, { from: 1, to: 2 });
    expect(result.orders.map((o) => o.order_sn)).toEqual(["W"]);
  });

  it("stops at maxPages and says the result is truncated", async () => {
    const sdk = {
      order: { getOrderList: async () => ({ order_list: [{ order_sn: "A" }], more: true, next_cursor: "again" }) },
    } as unknown as ShopeeSDK;

    const result = await listOrdersByUpdateTime(sdk, { from: 1, to: 2, pageSize: 1, maxPages: 3 });
    expect(result.pages).toBe(3);
    expect(result.truncated).toBe(true);
    expect(result.orders).toHaveLength(3);
  });

  it("stops when more is true but no cursor came back, instead of looping", async () => {
    const sdk = {
      order: { getOrderList: async () => ({ order_list: [{ order_sn: "A" }], more: true }) },
    } as unknown as ShopeeSDK;

    const result = await listOrdersByUpdateTime(sdk, { from: 1, to: 2 });
    expect(result.pages).toBe(1);
    expect(result.truncated).toBe(false);
  });
});
