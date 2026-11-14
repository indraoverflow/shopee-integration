import { createHash, timingSafeEqual } from "node:crypto";
import rateLimit from "@fastify/rate-limit";
import Fastify, { type FastifyInstance } from "fastify";
import { authorizationUrl, exchangeCode, refreshAccessToken } from "./auth.js";
import { ShopeeApiError, ShopeeClient } from "./client.js";
import { loadConfig, type Config } from "./config.js";
import { getShopInfo, type ShopInfo } from "./shop.js";
import {
  FileTokenStore,
  MemoryTokenStore,
  isExpired,
  toStoredToken,
  type TokenStore,
} from "./tokens.js";
import { parsePushEvent, verifyPushSignature } from "./webhook.js";

export interface ServerOptions {
  config?: Config;
  client?: ShopeeClient;
  tokens?: TokenStore;
  /** Requests per minute per IP. Tests raise it; production keeps the default. */
  rateLimitMax?: number;
}

/**
 * Compares two secrets by digest, so the comparison neither leaks the length
 * nor short-circuits on the first differing byte.
 */
function secretMatches(
  expected: string,
  received: string | string[] | undefined,
): boolean {
  const value = Array.isArray(received) ? received[0] : received;
  if (!value) return false;
  const a = createHash("sha256").update(expected).digest();
  const b = createHash("sha256").update(value).digest();
  return timingSafeEqual(a, b);
}

export interface BuiltServer {
  app: FastifyInstance;
  tokens: TokenStore;
}

/**
 * A reference service: enough to finish authorization, keep the token across
 * restarts, call one shop endpoint, and receive pushes with a verified
 * signature. Business handling belongs behind a queue, not inside the request
 * Shopee is waiting on.
 */
export async function buildServer(
  options: ServerOptions = {},
): Promise<BuiltServer> {
  const config = options.config ?? loadConfig();
  const tokens: TokenStore =
    options.tokens ??
    (config.tokenStorePath
      ? new FileTokenStore(config.tokenStorePath)
      : new MemoryTokenStore());
  const client =
    options.client ??
    new ShopeeClient({
      partnerId: config.partnerId,
      partnerKey: config.partnerKey,
      baseUrl: config.baseUrl,
    });

  const app = Fastify({ logger: false, bodyLimit: 1_048_576 });

  // Every route here either verifies a signature, exchanges a code for a token or asks Shopee
  // something with the shop's token, so an unauthenticated caller must not be able to hammer
  // them. The default is generous because Shopee's push retries arrive in bursts; the routes
  // that touch OAuth get a tighter limit of their own.
  await app.register(rateLimit, {
    max: options.rateLimitMax ?? 120,
    timeWindow: "1 minute",
  });

  // The push signature is computed over the raw bytes, so the JSON parser must
  // not reserialise the body before verification.
  app.addContentTypeParser(
    "application/json",
    { parseAs: "string" },
    (_request, body, done) => {
      done(null, body);
    },
  );

  app.get("/health", async () => ({ ok: true, environment: config.env }));

  /** Prints the authorization URL instead of requiring the CLI. */
  app.get(
    "/auth/url",
    { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
    async (_request, reply) => {
      if (!config.redirectUrl) {
        return reply
          .code(500)
          .send({ error: "REDIRECT_URL is not configured" });
      }
      return {
        url: authorizationUrl({
          partnerId: config.partnerId,
          partnerKey: config.partnerKey,
          redirectUrl: config.redirectUrl,
          baseUrl: config.baseUrl,
        }),
      };
    },
  );

  app.get<{ Querystring: { code?: string; shop_id?: string } }>(
    "/auth/callback",
    // Tighter than the default: this one exchanges a code for the shop's tokens.
    { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const code = request.query.code;
      const shopId = Number(request.query.shop_id);
      if (!code || !Number.isInteger(shopId) || shopId <= 0) {
        return reply.code(400).send({ error: "code and shop_id are required" });
      }
      try {
        const token = await exchangeCode(client, config.partnerId, {
          code,
          shopId,
        });
        await tokens.set(toStoredToken(shopId, token));
        // Never echo the tokens: report what the caller needs to know instead.
        return { shop_id: shopId, expires_in: token.expire_in };
      } catch (error) {
        // An expired, reused or mismatched code is the caller's problem, so it
        // is a 400. A 5xx here would also be replaced by Cloudflare's own error
        // page when the service sits behind a tunnel, hiding the real message.
        const status = error instanceof ShopeeApiError ? 400 : 500;
        return reply
          .code(status)
          .send({ error: error instanceof Error ? error.message : "unknown" });
      }
    },
  );

  /**
   * Calls one shop endpoint, the smallest proof that a stored token works. An
   * expired token is refreshed once and the new pair persisted, because refresh
   * tokens are single use and losing one means asking the seller to authorize
   * again.
   */
  app.get<{ Querystring: { shop_id?: string } }>(
    "/shop/info",
    async (request, reply) => {
      const shopId = Number(request.query.shop_id);
      if (!Number.isInteger(shopId) || shopId <= 0) {
        return reply.code(400).send({ error: "shop_id is required" });
      }

      // The tunnel makes this endpoint public, so a shared secret keeps shop data
      // from being readable by anyone who guesses a shop id.
      if (
        config.shopInfoToken &&
        !secretMatches(
          config.shopInfoToken,
          request.headers["x-shop-info-token"],
        )
      ) {
        return reply
          .code(401)
          .send({ error: "missing or wrong x-shop-info-token" });
      }

      let stored = await tokens.get(shopId);
      if (!stored) {
        return reply.code(404).send({
          error: `no token for shop ${shopId}; authorize the app first`,
        });
      }

      try {
        if (isExpired(stored)) {
          const refreshed = await refreshAccessToken(client, config.partnerId, {
            refreshToken: stored.refreshToken,
            shopId,
          });
          stored = toStoredToken(shopId, refreshed);
          await tokens.set(stored);
        }

        const info: ShopInfo = await getShopInfo(client, {
          accessToken: stored.accessToken,
          shopId,
        });
        return {
          shop_id: info.shop_id ?? shopId,
          shop_name: info.shop_name,
          region: info.region,
          status: info.status,
          expires_at: new Date(stored.expiresAt).toISOString(),
        };
      } catch (error) {
        // Same reasoning as the callback: keep upstream rejections in the 4xx
        // range so a proxy does not swap the body for its own error page.
        const status = error instanceof ShopeeApiError ? 400 : 500;
        return reply
          .code(status)
          .send({ error: error instanceof Error ? error.message : "unknown" });
      }
    },
  );

  app.post<{ Body: string }>("/webhook/shopee", async (request, reply) => {
    const rawBody =
      typeof request.body === "string"
        ? request.body
        : JSON.stringify(request.body);

    if (config.publicUrl) {
      const signature = request.headers.authorization ?? "";
      const valid = verifyPushSignature({
        partnerKey: config.partnerKey,
        url: config.publicUrl,
        rawBody,
        signature,
        alternateKeys: config.pushTestPartnerKey
          ? [config.pushTestPartnerKey]
          : [],
      });
      if (!valid) {
        return reply.code(401).send({ error: "invalid push signature" });
      }
    }

    let event;
    try {
      event = parsePushEvent(rawBody);
    } catch (error) {
      return reply.code(400).send({
        error: error instanceof Error ? error.message : "invalid payload",
      });
    }

    // Acknowledge immediately. Shopee retries when the ack is slow or missing,
    // and the retry is harmless only if the handler behind this is idempotent.
    return { ok: true, code: event.code };
  });

  return { app, tokens };
}

export async function start(): Promise<void> {
  const config = loadConfig();
  const { app } = await buildServer({ config });
  await app.listen({ port: config.port, host: "0.0.0.0" });
  console.log(`listening on ${config.port}, environment ${config.env}`);
}

const entry = process.argv[1] ?? "";
if (entry.endsWith("server.js") || entry.endsWith("server.ts")) {
  start().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
