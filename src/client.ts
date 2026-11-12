import { sign, unixSeconds, type ApiKind } from "./signature.js";

export class ShopeeApiError extends Error {
  constructor(
    readonly code: string | number,
    message: string,
    readonly requestId?: string,
  ) {
    super(`${code}: ${message}`);
    this.name = "ShopeeApiError";
  }
}

export interface ShopeeEnvelope<T> {
  error?: string;
  message?: string;
  request_id?: string;
  response?: T;
}

export interface ClientOptions {
  partnerId: number;
  partnerKey: string;
  /** Override for the sandbox, a proxy, or a test double. */
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  /** Injectable clock so tests can pin the timestamp. */
  now?: () => Date;
}

type Query = Record<string, string | number | boolean | undefined>;

function toQuery(entries: Query): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(entries)) {
    if (value === undefined) continue;
    params.set(key, String(value));
  }
  return params;
}

/**
 * Minimal signed client. Every call computes its own signature: the timestamp
 * is only valid for five minutes, so a signature can never be cached or reused.
 */
export class ShopeeClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => Date;

  constructor(private readonly options: ClientOptions) {
    this.baseUrl = (options.baseUrl ?? "https://partner.shopeemobile.com").replace(/\/$/, "");
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? (() => new Date());
  }

  /** Public API: signature covers partner_id, path and timestamp only. */
  async publicGet<T>(path: string, query: Query = {}): Promise<T> {
    return this.call<T>({ kind: "public", method: "GET", path, query });
  }

  async publicPost<T>(path: string, body: Record<string, unknown>): Promise<T> {
    return this.call<T>({ kind: "public", method: "POST", path, body });
  }

  /**
   * The token endpoints answer flat: access_token, refresh_token and expire_in
   * sit at the top level with an empty error, not inside `response`. Everything
   * else is wrapped. This returns the body as-is so the caller can accept both.
   */
  async publicPostFlat<T>(path: string, body: Record<string, unknown>): Promise<T> {
    return this.call<T>({ kind: "public", method: "POST", path, body, unwrap: false });
  }

  /** Shop API: signature also covers the access token and the shop id. */
  async shopGet<T>(path: string, shop: { accessToken: string; shopId: number }, query: Query = {}): Promise<T> {
    return this.call<T>({ kind: "shop", method: "GET", path, query, ...shop });
  }

  async shopPost<T>(
    path: string,
    shop: { accessToken: string; shopId: number },
    body: Record<string, unknown>,
  ): Promise<T> {
    return this.call<T>({ kind: "shop", method: "POST", path, body, ...shop });
  }

  private async call<T>(input: {
    kind: ApiKind;
    method: "GET" | "POST";
    path: string;
    query?: Query;
    body?: Record<string, unknown>;
    accessToken?: string;
    shopId?: number;
    /** false returns the whole envelope, for endpoints that answer flat. */
    unwrap?: boolean;
  }): Promise<T> {
    const timestamp = unixSeconds(this.now());
    const { partnerId, partnerKey } = this.options;

    const signInput = {
      partnerId,
      partnerKey,
      path: input.path,
      timestamp,
      kind: input.kind,
      ...(input.accessToken ? { accessToken: input.accessToken } : {}),
      ...(input.shopId !== undefined ? { shopId: input.shopId } : {}),
    };

    const params = toQuery({
      partner_id: partnerId,
      timestamp,
      ...(input.accessToken ? { access_token: input.accessToken } : {}),
      ...(input.shopId !== undefined ? { shop_id: input.shopId } : {}),
      sign: sign(signInput),
      ...input.query,
    });

    const url = `${this.baseUrl}${input.path}?${params.toString()}`;
    const init: RequestInit = { method: input.method };
    if (input.body) {
      init.headers = { "content-type": "application/json" };
      init.body = JSON.stringify(input.body);
    }
    const response = await this.fetchImpl(url, init);

    const text = await response.text();
    let envelope: ShopeeEnvelope<T>;
    try {
      envelope = JSON.parse(text) as ShopeeEnvelope<T>;
    } catch {
      throw new ShopeeApiError("invalid_response", `HTTP ${response.status}: ${text.slice(0, 200)}`);
    }

    const hasError = envelope.error !== undefined && envelope.error !== "";
    if (hasError) {
      throw new ShopeeApiError(
        envelope.error ?? "unknown_error",
        envelope.message ?? "no message",
        envelope.request_id,
      );
    }
    if (!response.ok) {
      throw new ShopeeApiError("http_error", `HTTP ${response.status}: ${text.slice(0, 200)}`);
    }
    if (input.unwrap === false) {
      return envelope as unknown as T;
    }
    if (envelope.response === undefined) {
      throw new ShopeeApiError("invalid_response", "response field is missing");
    }
    return envelope.response;
  }
}
