import { sign, unixSeconds } from "./signature.js";

/** Shopee hosts the authorization screen; every partner points at the same path. */
export const AUTH_PATH = "/api/v2/shop/auth_partner";
export const TOKEN_PATH = "/api/v2/auth/token/get";
export const REFRESH_PATH = "/api/v2/auth/access_token/get";

export interface AuthorizationUrlInput {
  partnerId: number;
  partnerKey: string;
  /** Passed through to Shopee and must match the app's configured redirect. */
  redirectUrl: string;
  baseUrl: string;
  now?: Date;
}

/**
 * The URL the seller opens to authorize the app. Authorizing calls Shopee with
 * a redirect back to redirectUrl carrying code and shop_id.
 *
 * Kept out of the SDK on purpose: the console registers this exact path for the
 * app, and `verify` and `diagnose` sign it themselves so the signature can be
 * checked independently of the library.
 */
export function authorizationUrl(input: AuthorizationUrlInput): string {
  const timestamp = unixSeconds(input.now ?? new Date());
  const signature = sign({
    partnerId: input.partnerId,
    partnerKey: input.partnerKey,
    path: AUTH_PATH,
    timestamp,
    kind: "public",
  });
  const params = new URLSearchParams({
    partner_id: String(input.partnerId),
    timestamp: String(timestamp),
    sign: signature,
    redirect: input.redirectUrl,
  });
  return `${input.baseUrl}${AUTH_PATH}?${params.toString()}`;
}
