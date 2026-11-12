import { describe, expect, it } from "vitest";
import type { ShopeeClient } from "../src/client.js";
import { DEFAULT_ORDER_FIELDS, ORDER_DETAIL_PATH, getOrderDetails } from "../src/orders.js";

const auth = { accessToken: "tok", shopId: 42 };

describe("getOrderDetails", () => {
  it("asks for the detail fields and returns the order list", async () => {
    const calls: Array<{ path: string; query: Record<string, unknown> }> = [];
    const fake = {
      shopGet: async (path: string, _shop: unknown, query: Record<string, unknown>) => {
        calls.push({ path, query });
        return {
          order_list: [
            {
              order_sn: "250101ABC",
              order_status: "READY_TO_SHIP",
              buyer_username: "pembeli1",
              item_list: [{ item_id: 9, model_id: 3, model_quantity_purchased: 2 }],
            },
          ],
        };
      },
    } as unknown as ShopeeClient;

    const orders = await getOrderDetails(fake, auth, ["250101ABC"]);

    expect(orders).toHaveLength(1);
    expect(orders[0]!.buyer_username).toBe("pembeli1");
    expect(calls[0]!.path).toBe(ORDER_DETAIL_PATH);
    expect(calls[0]!.query.order_sn_list).toBe("250101ABC");
    expect(String(calls[0]!.query.response_optional_fields)).toContain("buyer_username");
    expect(String(calls[0]!.query.response_optional_fields)).toBe(DEFAULT_ORDER_FIELDS.join(","));
  });

  it("batches more than fifty order numbers instead of sending one giant query", async () => {
    const batches: string[][] = [];
    const fake = {
      shopGet: async (_path: string, _shop: unknown, query: Record<string, unknown>) => {
        const sns = String(query.order_sn_list).split(",");
        batches.push(sns);
        return { order_list: sns.map((order_sn) => ({ order_sn })) };
      },
    } as unknown as ShopeeClient;

    const sns = Array.from({ length: 120 }, (_, index) => `SN${index}`);
    const orders = await getOrderDetails(fake, auth, sns);

    expect(batches.map((batch) => batch.length)).toEqual([50, 50, 20]);
    expect(orders).toHaveLength(120);
  });

  it("drops duplicates and empty values before calling upstream", async () => {
    const sent: string[] = [];
    const fake = {
      shopGet: async (_path: string, _shop: unknown, query: Record<string, unknown>) => {
        sent.push(String(query.order_sn_list));
        return { order_list: [] };
      },
    } as unknown as ShopeeClient;

    await getOrderDetails(fake, auth, ["A", "A", "", "B"]);
    expect(sent).toEqual(["A,B"]);
  });

  it("makes no call when there is nothing to fetch", async () => {
    const fake = {
      shopGet: async () => {
        throw new Error("should not be called");
      },
    } as unknown as ShopeeClient;

    await expect(getOrderDetails(fake, auth, [])).resolves.toEqual([]);
  });
});
