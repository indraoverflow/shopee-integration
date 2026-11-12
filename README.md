# shopee-integration

A typed Node.js client, OAuth flow and Push receiver for the **Shopee Open Platform API v2**:
correct signing for the three API kinds, an authorization helper, token exchange and refresh,
and a webhook endpoint that verifies the Push signature before it parses anything.

The signing code is pinned by Shopee's own worked example from their documentation, so a change
that breaks the base string fails the test suite instead of failing silently in production.

## Scope, and what this does not replace

This repository is a deployable service, not an SDK. It exists for four things an SDK does not do:
verify a Push callback against the raw body, keep tokens across restarts, reconcile orders by
`update_time`, and prove those credentials work from the command line (`npm run verify`,
`npm run diagnose`).

For endpoint breadth, `@congminh1254/shopee-sdk` (MIT, 464 generated endpoint schemas, live sandbox
suites, `TEST_GLOBAL` pointed at the right host) is the better tool, and you should reach for it
before hand-writing another endpoint here. Two findings from evaluating it against this codebase:

- Its response types declare `response: T` as always present. This sandbox answers flat for
  `auth/token/get` and `shop/get_shop_info`, with the payload at the top level, so any consumer
  needs a `body.response ?? body` normaliser. This repository's transport takes that shape as
  normal, which is why it stays.
- It ships no webhook receiver, no reconciliation, and no token file store, which is the part worth
  keeping here.

The transport in `src/signature.ts` and `src/client.ts` is also what `verify` and `diagnose` use to
recompute a signature independently of Shopee, which is how a wrong sandbox host was caught. A
dependency that hides signing would remove that check.

## Why TypeScript

Shopee responses are loosely typed JSON that changes between regions and app versions. This
package validates its own inputs, exposes narrow types at the edges, and keeps the HMAC work in
`node:crypto`, so there is nothing to compile outside npm and no runtime to install on the host.
A single `Dockerfile`-less `node dist/server.js` runs the receiver.

## Install

```bash
npm install
cp .env.example .env      # repository root, next to package.json
npm run build
npm test
```

`.env` lives at the repository root and is gitignored. The npm scripts load it with Node's
`--env-file-if-exists=.env`, so there is no dotenv dependency and no code path that reads the file
itself. In a container or CI, skip the file and pass the same names as environment variables.

| Path | Tracked | Purpose |
|---|---|---|
| `.env.example` | yes | Every variable with a safe placeholder |
| `.env` | no | Your real partner id and key |
| `data/tokens.json` | no | Access and refresh tokens, mode 0600, when `TOKEN_STORE_PATH` is set |

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
| Sandbox | `https://openplatform.sandbox.test-stable.shopee.sg` |
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

## Check the credentials

```bash
npm run verify
```

It prints the environment, the partner id and the signed authorization URL, then sends a token
exchange for a deliberately invalid code. That is enough to learn whether the credentials are
accepted, without a shop and without a real code:

| Answer | Meaning |
|---|---|
| `error_sign` | The signature was rejected: wrong key, wrong partner id, wrong environment, or a clock more than five minutes off. |
| `invalid_partner_id` | The server looked the partner up and did not find it. The id does not exist in this environment, so the signature was never checked. |
| anything else, for example an invalid or expired code | The signature was accepted. The credentials belong to this environment. |

### When the answer is `error_sign`

Four things can produce it, and guessing is slow. `npm run diagnose` narrows it down:

```bash
npm run diagnose
```

It compares the host clock with the server's `Date` header (a skew over five minutes invalidates
every signature), then signs two different endpoints: the token exchange and the authorization
page. Both failing means the key does not belong to that partner id, because the partner lookup
succeeded and only the signature was refused.

To test several keys at once, list them in a file and pass it in. Only the index, the first three
characters and the length are printed, never the value:

```bash
cat > candidate-keys.txt <<'EOF'
first-candidate-key
second-candidate-key
EOF
CANDIDATE_KEYS_FILE=./candidate-keys.txt npm run diagnose
rm candidate-keys.txt
```

`candidate-keys.txt` is covered by `.gitignore` together with `.env` and `data/`.

### Finishing the authorization when the redirect cannot be reached

Shopee only calls back to the domain registered as `Test Redirect URL Domain` in the app page. If
that domain is not served yet, the browser still lands on the redirect URL, and the code is visible
in the address bar:

```
https://your-domain/auth/callback?code=5a5477794a55537954697169514f4653&shop_id=227889163
```

Hand that code to the CLI, which exchanges it and writes the token store:

```bash
CODE=5a5477794a55537954697169514f4653 SHOP_ID=227889163 npm run exchange
```

It prints the shop id and the token lifetime only, never the token. A code is single use and short
lived, so run it immediately. Then `curl "http://localhost:3111/shop/info?shop_id=227889163"`
proves the token works.

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

## Token storage

Set `TOKEN_STORE_PATH` to persist tokens; leave it unset and they live in memory, which loses
every authorization on restart.

```bash
TOKEN_STORE_PATH=./data/tokens.json
```

`FileTokenStore` keeps one JSON object, writes through a temporary file and renames it, and
creates the file with mode `0600`. The file holds access and refresh tokens for every shop, so
treat it like the partner key. The interface is three methods (`get`, `set`, `delete`), which is
small enough to swap for your database in an afternoon.

Refresh tokens are single use. `GET /shop/info` refreshes an expired token once and persists the
new pair before calling the API, so a restart does not cost the seller another authorization.

## Calling a shop endpoint

```bash
curl "http://localhost:3000/shop/info?shop_id=14701711"
```

Behind a public tunnel, set `SHOP_INFO_TOKEN` and send it as a header, otherwise the shop name is
readable by anyone who guesses a shop id:

```bash
curl -H "x-shop-info-token: $SHOP_INFO_TOKEN" "https://your-domain/shop/info?shop_id=14701711"
```

`/auth/callback` and `/webhook/shopee` stay public on purpose: Shopee calls them, and one is
protected by a single-use code while the other is protected by the Push signature.

That returns `shop_id`, `shop_name`, `region`, `status` and the token expiry, and it never echoes
the tokens themselves. `getShopInfo()` is the library call behind it, and it is the smallest proof
that an authorization works before you build anything on top.

## Push plus reconciliation

A webhook alone is not a feed. Pushes arrive late, twice, or not at all, so the package ships the
other half:

```ts
import { reconcileOrders } from "shopee-integration";

const seen = new Set<string>();
const result = await reconcileOrders(client, { ...auth, from, to: Math.floor(Date.now() / 1000) }, async (order) => {
  await upsertOrder(order);           // idempotent on order_sn
}, seen);
```

`reconcileOrders` queries orders by **update_time**, pages with the cursor until `more` is false,
and skips anything already in `seen`, so a repeated push and a reconciliation pass cannot
double-handle one order. `orderSnFromPush(event)` reads the order number out of a status push when
you want the push path to share the same handler.

## What this is not

- No database of its own. `FileTokenStore` is a single-process store; point `TokenStore` at your
  database before running more than one instance.
- No retry or rate limiting. Add it at the call site, per endpoint, because Shopee limits differ
  by API.
- No product or order domain code beyond reading a shop and listing order summaries. This is the
  transport, the signing, the authentication and the reconciliation primitive.

## Layout

```
src/signature.ts  base string and HMAC for the three API kinds
src/client.ts     signed fetch, envelope and error handling
src/auth.ts       authorization URL, code exchange, refresh
src/shop.ts       get_shop_info and order list by update time
src/sync.ts       push plus reconciliation, idempotent on order_sn
src/tokens.ts     TokenStore interface, memory and file implementations
src/webhook.ts    push signature and payload parsing
src/server.ts     Fastify app: /health, /auth/url, /auth/callback, /shop/info, /webhook/shopee
src/verify.ts     credential probe that needs no shop
test/             fixture-driven tests, no credentials required
```

## License

MIT
