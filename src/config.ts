import { z } from "zod";

export const HOSTS = {
  sandbox: "https://partner.test-stable.shopeemobile.com",
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
});

export interface Config {
  partnerId: number;
  partnerKey: string;
  env: ShopeeEnv;
  baseUrl: string;
  redirectUrl?: string;
  publicUrl?: string;
  port: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.parse(env);
  const config: Config = {
    partnerId: parsed.PARTNER_ID,
    partnerKey: parsed.PARTNER_KEY,
    env: parsed.SHOPEE_ENV,
    baseUrl: HOSTS[parsed.SHOPEE_ENV],
    port: parsed.PORT,
  };
  if (parsed.REDIRECT_URL) config.redirectUrl = parsed.REDIRECT_URL;
  if (parsed.PUBLIC_URL) config.publicUrl = parsed.PUBLIC_URL;
  return config;
}
