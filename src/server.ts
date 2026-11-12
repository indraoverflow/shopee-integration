import Fastify, { type FastifyInstance } from "fastify";
import { authorizationUrl, exchangeCode, type AccessToken } from "./auth.js";
import { ShopeeApiError, ShopeeClient } from "./client.js";
import { loadConfig, type Config } from "./config.js";
import { parsePushEvent, verifyPushSignature } from "./webhook.js";

export interface ServerOptions {
  config?: Config;
  client?: ShopeeClient;
  /** Access tokens keyed by shop id. A real deployment stores these durably. */
  tokens?: Map<number, AccessToken>;
}

export interface BuiltServer {
  app: FastifyInstance;
  tokens: Map<number, AccessToken>;
}

/**
 * The service is deliberately small: enough to complete authorization and to
 * receive pushes with a verified signature. Business handling belongs behind a
 * queue, not in the request that Shopee is waiting on.
 */
export function buildServer(options: ServerOptions = {}): BuiltServer {
  const config = options.config ?? loadConfig();
  const tokens = options.tokens ?? new Map<number, AccessToken>();
  const client = options.client ?? new ShopeeClient({
    partnerId: config.partnerId,
    partnerKey: config.partnerKey,
    baseUrl: config.baseUrl,
  });

  const app = Fastify({ logger: false, bodyLimit: 1_048_576 });

  // The push signature is computed over the raw bytes, so the JSON parser must
  // not reserialise the body before verification.
  app.addContentTypeParser("application/json", { parseAs: "string" }, (_request, body, done) => {
    done(null, body);
  });

  app.get("/health", async () => ({ ok: true, environment: config.env }));

  /** Prints the authorization URL instead of requiring the CLI. */
  app.get("/auth/url", async (_request, reply) => {
    if (!config.redirectUrl) {
      return reply.code(500).send({ error: "REDIRECT_URL is not configured" });
    }
    return {
      url: authorizationUrl({
        partnerId: config.partnerId,
        partnerKey: config.partnerKey,
        redirectUrl: config.redirectUrl,
        baseUrl: config.baseUrl,
      }),
    };
  });

  app.get<{ Querystring: { code?: string; shop_id?: string } }>(
    "/auth/callback",
    async (request, reply) => {
      const code = request.query.code;
      const shopId = Number(request.query.shop_id);
      if (!code || !Number.isInteger(shopId) || shopId <= 0) {
        return reply.code(400).send({ error: "code and shop_id are required" });
      }
      try {
        const token = await exchangeCode(client, config.partnerId, { code, shopId });
        tokens.set(shopId, token);
        // Never echo the tokens: report what the caller needs to know instead.
        return { shop_id: shopId, expires_in: token.expire_in };
      } catch (error) {
        const status = error instanceof ShopeeApiError ? 502 : 500;
        return reply.code(status).send({ error: error instanceof Error ? error.message : "unknown" });
      }
    },
  );

  app.post<{ Body: string }>("/webhook/shopee", async (request, reply) => {
    const rawBody = typeof request.body === "string" ? request.body : JSON.stringify(request.body);

    if (config.publicUrl) {
      const signature = request.headers.authorization ?? "";
      const valid = verifyPushSignature({
        partnerKey: config.partnerKey,
        url: config.publicUrl,
        rawBody,
        signature,
      });
      if (!valid) {
        return reply.code(401).send({ error: "invalid push signature" });
      }
    }

    let event;
    try {
      event = parsePushEvent(rawBody);
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : "invalid payload" });
    }

    // Acknowledge immediately. Shopee retries when the ack is slow or missing,
    // and the retry is harmless only if the handler behind this is idempotent.
    return { ok: true, code: event.code };
  });

  return { app, tokens };
}

export async function start(): Promise<void> {
  const config = loadConfig();
  const { app } = buildServer({ config });
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
