#!/usr/bin/env node
import { authorizationUrl } from "./auth.js";
import { loadConfig } from "./config.js";

/**
 * Prints the authorization URL for the configured environment. Open it as the
 * seller, approve the app, and Shopee redirects to REDIRECT_URL with a code.
 */
function main(): void {
  const config = loadConfig();
  if (!config.redirectUrl) {
    console.error("REDIRECT_URL is not set; it must match the app's configured redirect");
    process.exit(2);
  }
  const url = authorizationUrl({
    partnerId: config.partnerId,
    partnerKey: config.partnerKey,
    redirectUrl: config.redirectUrl,
    baseUrl: config.baseUrl,
  });
  console.log(`environment: ${config.env}`);
  console.log(`partner id : ${config.partnerId}`);
  console.log(url);
}

main();
