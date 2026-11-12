# shopee-open-platform

A typed Node.js client, OAuth flow and Push receiver for the **Shopee Open Platform API v2**:
correct signing for the three API kinds, an authorization helper, token exchange and refresh,
and a webhook endpoint that verifies the Push signature before it parses anything.

The signing code is pinned by Shopee's own worked example from their documentation, so a change
that breaks the base string fails the test suite instead of failing silently in production.

## Why TypeScript

Shopee responses are loosely typed JSON that changes between regions and app versions. This
package validates its own inputs, exposes narrow types at the edges, and keeps the HMAC work in
`node:crypto`, so there is nothing to compile outside npm and no runtime to install on the host.
A single `Dockerfile`-less `node dist/server.js` runs the receiver.

## Install

```bash
npm install
cp .env.example .env      # fill in the sandbox partner id and key
npm run build
npm test
```

The test suite needs no credentials: it runs against the documented fixture and an injected
`fetch`, so it can run in CI on a fork without secrets.

## Environment

| Variable | Required | Meaning |
|---|---|---|
| `PARTNER_ID` | yes | Partner id from the Open Platform console. Test values only work against the sandbox host. |
| `PARTNER_KEY` | yes | Partner key. Never commit it; `.env` is gitignored. |
| `SHOPEE_ENV` | no | `sandbox` (default) or `production`. Chooses the host, nothing else. |
| `REDIRECT_URL` | for auth | Where Shopee returns the seller. Must match the redirect configured for the app. |
| `PUBLIC_URL` | for push | The exact public webhook URL. The Push signature covers this string. |
| `PORT` | no | HTTP port, default `3000`. |

## Hosts

| Environment | Host |
|---|---|
| Sandbox | `https://partner.test-stable.shopeemobile.com` |
| Production | `https://partner.shopeemobile.com` |

The partner id, the key and the host belong to the same environment. A production key against
the sandbox host fails every call with a signature error, which looks like a signing bug and is
not one.

## Authorization

```bash
npm run auth-url            # prints the signed authorization URL
# the seller approves; Shopee redirects to REDIRECT_URL with ?code=...&shop_id=...
curl "http://localhost:3000/auth/callback?code=...&shop_id=..."
```

| Step | Endpoint | Signature covers |
|---|---|---|
| Authorization screen | `GET /api/v2/shop/auth_partner` | `partner_id + path + timestamp` |
| Code exchange | `POST /api/v2/auth/token/get` | `partner_id + path + timestamp` |
| Token refresh | `POST /api/v2/auth/access_token/get` | `partner_id + path + timestamp` |
| Shop call | any `/api/v2/...` shop endpoint | `partner_id + path + timestamp + access_token + shop_id` |
| Merchant call | any `/api/v2/...` merchant endpoint | `partner_id + path + timestamp + access_token + merchant_id` |

`sign` is lowercase hex HMAC-SHA256 over that concatenation, keyed by the partner key. The path
is the API path only: no host, no query string. Paging and filter parameters never enter the base
string. A signature is valid for five minutes, so it is computed per request and never cached.

Refresh tokens are single use. Persist the new pair every time you refresh, or the next refresh
fails with an authentication error.

## Push (webhook)

Shopee sends the signature in the `Authorization` header: HMAC-SHA256 of
`url + raw_body`, keyed by the partner key, hex encoded. Two consequences shape this package:

- The JSON parser must not reserialise the body. `server.ts` registers a raw content type parser
  for `application/json` so the bytes that were signed are the bytes that are verified.
- The URL in the signature is the URL Shopee posts to, so `PUBLIC_URL` has to match it exactly,
  including the scheme and path.

The endpoint answers `200` with the push code as soon as the signature and the payload shape
check out. Work belongs behind a queue: pushes can arrive late, twice, or not at all, so every
handler should be idempotent on the order or item id and a reconciliation job should query by
update time.

## What this is not

- Token storage is an in-memory `Map` keyed by shop id. Replace it with your database before
  running more than one process.
- No retry or rate limiting. Add it at the call site, per endpoint, because Shopee limits differ
  by API.
- No product or order domain code. This is the transport, the signing and the authentication.

## Layout

```
src/signature.ts  base string and HMAC for the three API kinds
src/client.ts     signed fetch, envelope and error handling
src/auth.ts       authorization URL, code exchange, refresh
src/webhook.ts    push signature and payload parsing
src/server.ts     Fastify app: /health, /auth/url, /auth/callback, /webhook/shopee
test/             fixture-driven tests, no credentials required
```

## License

MIT
