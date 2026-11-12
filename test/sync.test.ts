import { describe, expect, it } from "vitest";
import type { ShopeeSDK } from "@congminh1254/shopee-sdk";
import { orderSnFromPush, reconcileOrders } from "../src/sync.js";

const window = { from: 1, to: 2 };

function sdkReturning(orders: Array<Record<string, unknown>>) {
  return {
    order: { getOrderList: async () => ({ order_list: orders, more: false }) },
  } as unknown as ShopeeSDK;
}

describe("reconcileOrders", () => {
  it("hands each order to the handler once", async () => {
    const handled: string[] = [];
    const result = await reconcileOrders(sdkReturning([{ order_sn: "A" }, { order_sn: "B" }]), window, (order) => {
      handled.push(order.order_sn);
    });

    expect(handled).toEqual(["A", "B"]);
    expect(result).toMatchObject({ scanned: 2, handled: 2, skipped: 0, pages: 1, truncated: false });
  });

  it("skips orders the caller has already seen, so a repeated push is harmless", async () => {
    const seen = new Set(["A"]);
    const handled: string[] = [];
    const result = await reconcileOrders(
      sdkReturning([{ order_sn: "A" }, { order_sn: "B" }]),
      window,
      (order) => {
        handled.push(order.order_sn);
      },
      seen,
    );

    expect(handled).toEqual(["B"]);
    expect(result).toMatchObject({ scanned: 2, handled: 1, skipped: 1 });
    expect(seen.has("B")).toBe(true);
  });

  it("counts an order with no order_sn as skipped instead of calling the handler", async () => {
    const handled: string[] = [];
    const result = await reconcileOrders(sdkReturning([{ order_sn: "" }, {}]), window, (order) => {
      handled.push(order.order_sn);
    });
    expect(handled).toEqual([]);
    expect(result.skipped).toBe(2);
  });

  it("propagates a handler failure instead of swallowing it", async () => {
    await expect(
      reconcileOrders(sdkReturning([{ order_sn: "A" }]), window, () => {
        throw new Error("downstream failed");
      }),
    ).rejects.toThrow(/downstream failed/);
  });
});

describe("orderSnFromPush", () => {
  it("reads the order number from a status push", () => {
    expect(orderSnFromPush({ code: 3, data: { ordersn: "241112ABC" } })).toBe("241112ABC");
    expect(orderSnFromPush({ code: 3, data: { order_sn: "241112ABC" } })).toBe("241112ABC");
  });

  it("returns undefined when the push carries no order number", () => {
    expect(orderSnFromPush({ code: 3, data: {} })).toBeUndefined();
    expect(orderSnFromPush({ code: 3 })).toBeUndefined();
  });
});
