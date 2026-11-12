import { z } from "zod";

/**
 * The sandbox host is not the one most guides print. Read "Request URL" in the
 * console's API Test Tool for the app you are working on and override with
 * SHOPEE_BASE_URL if your region differs.
 */
export const HOSTS = {
  sandbox: "https://openplatform.sandbox.test-stable.shopee.sg",
  production: "https://partner.shopeemobile.com",
} as const;

export type ShopeeEnv = keyof typeof HOSTS;

const envSchema = z.object({
  PARTNER_ID: z.coerce.number().int().positive(),
  PARTNER_KEY: z.string().min(1, "PARTNER_KEY is required"),
  SHOPEE_ENV: z.enum(["sandbox", "production"]).default("sandbox"),
  REDIRECT_URL: z.string().url().optional(),
  PUBLIC_URL: z.string().url().optional(),
  PORT: z.coerce.number().int().positive().max(65535).default(3000),
  /** Where access tokens are persisted. Unset keeps them in memory only. */
  TOKEN_STORE_PATH: z.string().min(1).optional(),
  /** Full override for the API host, for regions whose host differs. */
  SHOPEE_BASE_URL: z.string().url().optional(),
  /** Key the console uses to sign test pushes from the Push Mechanism page. */
  PUSH_TEST_PARTNER_KEY: z.string().min(1).optional(),
});

export interface Config {
  partnerId: number;
  partnerKey: string;
  env: ShopeeEnv;
  baseUrl: string;
  redirectUrl?: string;
  publicUrl?: string;
  port: number;
  tokenStorePath?: string;
  pushTestPartnerKey?: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.parse(env);
  const config: Config = {
    partnerId: parsed.PARTNER_ID,
    partnerKey: parsed.PARTNER_KEY,
    env: parsed.SHOPEE_ENV,
    baseUrl: parsed.SHOPEE_BASE_URL ?? HOSTS[parsed.SHOPEE_ENV],
    port: parsed.PORT,
  };
  if (parsed.REDIRECT_URL) config.redirectUrl = parsed.REDIRECT_URL;
  if (parsed.PUBLIC_URL) config.publicUrl = parsed.PUBLIC_URL;
  if (parsed.TOKEN_STORE_PATH) config.tokenStorePath = parsed.TOKEN_STORE_PATH;
  if (parsed.PUSH_TEST_PARTNER_KEY) config.pushTestPartnerKey = parsed.PUSH_TEST_PARTNER_KEY;
  return config;
}
