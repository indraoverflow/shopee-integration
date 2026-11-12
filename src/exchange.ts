#!/usr/bin/env node
import { exchangeCode } from "./auth.js";
import { ShopeeClient, ShopeeApiError } from "./client.js";
import { loadConfig } from "./config.js";
import { FileTokenStore, MemoryTokenStore, toStoredToken } from "./tokens.js";

/**
 * Exchanges an authorization code for a token and stores it.
 *
 *   CODE=... SHOP_ID=227889163 npm run exchange
 *
 * The code is single use and expires in minutes, so this is meant to be run
 * right after the seller lands on the redirect URL. Nothing secret is printed:
 * only the shop id and the token lifetime.
 */
async function main(): Promise<void> {
  const config = loadConfig();
  const code = process.env.CODE ?? process.argv[2];
  const shopId = Number(process.env.SHOP_ID ?? process.argv[3]);

  if (!code) {
    console.error("CODE is required: CODE=<authorization code> SHOP_ID=<shop id> npm run exchange");
    process.exit(2);
  }
  if (!Number.isInteger(shopId) || shopId <= 0) {
    console.error("SHOP_ID is required and must be a positive integer");
    process.exit(2);
  }

  const client = new ShopeeClient({
    partnerId: config.partnerId,
    partnerKey: config.partnerKey,
    baseUrl: config.baseUrl,
  });
  const store = config.tokenStorePath ? new FileTokenStore(config.tokenStorePath) : new MemoryTokenStore();

  try {
    const token = await exchangeCode(client, config.partnerId, { code, shopId });
    await store.set(toStoredToken(shopId, token));
    console.log(`shop ${shopId}: token stored, expires in ${token.expire_in}s`);
    if (!config.tokenStorePath) {
      console.log("TOKEN_STORE_PATH is unset, so the token lived only in this process. Set it in .env.");
    }
  } catch (error) {
    if (error instanceof ShopeeApiError) {
      console.error(`shop ${shopId}: ${error.code ?? "error"} ${error.message ?? ""}`.trim());
      process.exit(1);
    }
    throw error;
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
