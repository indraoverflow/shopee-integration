import type { AccessToken, TokenStorage } from "@congminh1254/shopee-sdk";
import { toStoredToken, type TokenStore } from "./tokens.js";

/**
 * Bridges this service's token store to the upstream SDK, which keeps exactly
 * one token per instance. The shop id is bound at construction, so one SDK
 * instance talks to one shop.
 */
export class StoreTokenStorage implements TokenStorage {
  constructor(
    private readonly tokens: TokenStore,
    private readonly shopId: number,
  ) {}

  async store(token: AccessToken): Promise<void> {
    await this.tokens.set(toStoredToken(this.shopId, token));
  }

  async get(): Promise<AccessToken | null> {
    const stored = await this.tokens.get(this.shopId);
    if (!stored) return null;
    return {
      access_token: stored.accessToken,
      refresh_token: stored.refreshToken,
      expire_in: Math.max(0, Math.round((stored.expiresAt - Date.now()) / 1000)),
      request_id: "",
      error: "",
      message: "",
      shop_id: this.shopId,
      // The SDK refreshes by itself when this timestamp has passed.
      expired_at: stored.expiresAt,
    };
  }

  async clear(): Promise<void> {
    await this.tokens.delete(this.shopId);
  }
}
