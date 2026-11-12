import { ShopeeRegion, ShopeeSDK } from "@congminh1254/shopee-sdk";
import type { Config } from "./config.js";
import { StoreTokenStorage } from "./storage.js";
import type { TokenStore } from "./tokens.js";

/**
 * One SDK instance per shop. The upstream package owns signing, retries and
 * token refresh; this service owns storage, the callback and the Push endpoint.
 */
export function createSdk(config: Config, tokens: TokenStore, shopId: number): ShopeeSDK {
  const storage = new StoreTokenStorage(tokens, shopId);
  return new ShopeeSDK(
    {
      partner_id: config.partnerId,
      partner_key: config.partnerKey,
      base_url: `${config.baseUrl}/api/v2`,
      shop_id: shopId,
      region: config.env === "sandbox" ? ShopeeRegion.TEST_GLOBAL : ShopeeRegion.GLOBAL,
    },
    storage,
  );
}
