#!/usr/bin/env node
import { authorizationUrl, TOKEN_PATH } from "./auth.js";
import { ShopeeApiError, ShopeeClient } from "./client.js";
import { loadConfig } from "./config.js";

/**
 * Checks that the configured partner id and key are accepted by the API, without
 * needing a shop: it sends a token exchange for a deliberately invalid code.
 *
 * - `error_sign` means the signature was rejected: wrong key, wrong partner id,
 *   wrong environment, or a clock more than five minutes off.
 * - any other error means the signature was accepted and the request failed for
 *   the reason the body says (an expired or invalid code), which is the expected
 *   answer for a probe.
 */
const PROBE_CODE = "signature-probe-not-a-real-code";

async function main(): Promise<void> {
  const config = loadConfig();
  const client = new ShopeeClient({
    partnerId: config.partnerId,
    partnerKey: config.partnerKey,
    baseUrl: config.baseUrl,
  });

  console.log(`environment : ${config.env} (${config.baseUrl})`);
  console.log(`partner id  : ${config.partnerId}`);

  if (config.redirectUrl) {
    console.log(`auth url    : ${authorizationUrl({
      partnerId: config.partnerId,
      partnerKey: config.partnerKey,
      redirectUrl: config.redirectUrl,
      baseUrl: config.baseUrl,
    })}`);
  }

  try {
    await client.publicPost(TOKEN_PATH, {
      code: PROBE_CODE,
      shop_id: 0,
      partner_id: config.partnerId,
    });
    console.log("result      : the probe was accepted, which is unexpected for an invalid code");
    process.exit(1);
  } catch (error) {
    if (error instanceof ShopeeApiError) {
      const code = String(error.code);
      console.log(`result      : ${code} (${error.message})`);
      // The server looks the partner up before it verifies the signature, so a
      // bad partner id answers invalid_partner_id and never reaches the HMAC.
      // Treat both as a credential failure, and only other errors as proof that
      // the signature itself was accepted.
      if (code === "error_sign") {
        console.error("signature   : REJECTED. Check the key, the partner id, the environment, and the clock.");
        process.exit(1);
      }
      if (code.includes("partner_id") || /partner_id/i.test(error.message)) {
        console.error("partner id  : REJECTED by the server. This id does not exist in this environment.");
        process.exit(1);
      }
      console.log("signature   : accepted. The key and partner id belong to this environment.");
      return;
    }
    throw error;
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
