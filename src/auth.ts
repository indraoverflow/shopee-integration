import { sign, unixSeconds } from "./signature.js";
import type { ShopeeClient } from "./client.js";

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

export interface AccessToken {
  access_token: string;
  refresh_token: string;
  expire_in: number;
  request_id?: string;
  /** Present on merchant level authorization. */
  merchant_id?: number;
  shop_id?: number;
}

/** Exchanges the authorization code for the first access token. */
type TokenBody = AccessToken & { response?: AccessToken };

/** The token endpoints answer flat, but accept the wrapped shape as well. */
function readToken(body: TokenBody): AccessToken {
  const token = body.response ?? body;
  if (!token.access_token) {
    throw new Error("token response has no access_token");
  }
  return token;
}

export async function exchangeCode(
  client: ShopeeClient,
  partnerId: number,
  input: { code: string; shopId: number; mainAccountId?: number },
): Promise<AccessToken> {
  const body: Record<string, unknown> = {
    code: input.code,
    shop_id: input.shopId,
    partner_id: partnerId,
  };
  if (input.mainAccountId !== undefined) body.main_account_id = input.mainAccountId;
  return readToken(await client.publicPostFlat<TokenBody>(TOKEN_PATH, body));
}

/** Rotates the access token. Refresh tokens are single use, so store the new one. */
export async function refreshAccessToken(
  client: ShopeeClient,
  partnerId: number,
  input: { refreshToken: string; shopId: number },
): Promise<AccessToken> {
  return readToken(
    await client.publicPostFlat<TokenBody>(REFRESH_PATH, {
      refresh_token: input.refreshToken,
      shop_id: input.shopId,
      partner_id: partnerId,
    }),
  );
}
