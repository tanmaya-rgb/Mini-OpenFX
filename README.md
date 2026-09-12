# MiniOpenFX

An API-only FX/crypto-FX quoting and trading service. A client fetches an indicative price, requests a firm time-bound quote, executes a trade against that quote, and can read back their balances and trade history — all through a small, versioned REST API backed by Postgres and Redis.

This is a take-home assignment focused on API design, data modelling, and engineering fundamentals (idempotency, transactional correctness, concurrency safety) rather than UI polish. There is no UI.

## Contents

- [Product shape](#product-shape)
- [Quick start](#quick-start)
- [API reference + curl examples](#api-reference--curl-examples)
- [Error format](#error-format)
- [Data model](#data-model)
- [Money and amount semantics — worked example](#money-and-amount-semantics--worked-example)
- [Concurrency and idempotency](#concurrency-and-idempotency)
- [Architecture](#architecture)
- [Assumptions and tradeoffs](#assumptions-and-tradeoffs)
- [Testing](#testing)
- [CI](#ci)

## Product shape

1. **Indicative price** — `GET /v1/prices` — informational only, not tradable, no DB write.
2. **Firm quote** — `POST /v1/quotes` — locks a price for a short TTL, backed by a DB row.
3. **Trade execution** — `POST /v1/trades` — executes against a quote, transactionally, idempotently.
4. **Balances** — `GET /v1/balances` — current holdings per currency.
5. **Trade history** — `GET /v1/trades` — cursor-paginated.

Pricing and trading are deliberately isolated: trading never calls the external pricing provider. A quote is the only bridge between them — the price is fetched once, at quote-creation time, and locked in.

## Quick start

Prerequisites: Node.js 20+, and either Docker (recommended) or a local Postgres 16 + Redis 7.

```bash
git clone <this-repo>
cd miniopenfx
npm install

cp .env.example .env
# Edit .env if you want a different SEED_CLIENT_API_KEY — otherwise the
# default is fine for local development.

# Start Postgres + Redis
docker compose up -d

# Create the schema and seed one demo client with starting balances
npm run db:migrate
npm run db:seed
# ^ prints the client's Authorization: Bearer <key> — this is the key
#   used in every curl example below.

npm run start:dev
# API is now listening on http://localhost:3000, all routes under /v1
```

Run `npm run db:studio` at any point to browse the database in Drizzle Studio.

## API reference + curl examples

All routes are prefixed `/v1`. Every route except `/v1/health` and `/v1/prices` requires:

```
Authorization: Bearer <api-key>
```

(the key printed by `npm run db:seed`).

### Health

```bash
curl http://localhost:3000/v1/health
```

### Get an indicative price

Not tradable, no DB write. Supported symbols: `BTCUSDT`, `ETHUSDT`, `ETHBTC`.

```bash
curl "http://localhost:3000/v1/prices?symbol=BTCUSDT"
```

```json
{
  "symbol": "BTCUSDT",
  "bid": "64999.50000000",
  "ask": "65000.50000000",
  "mid": "65000",
  "timestamp": "2026-09-12T13:00:00.000Z",
  "source": "binance",
  "stale": false
}
```

`stale: true` means the live provider call failed and this is the last known good price from cache — still returned rather than a hard error, because a slightly-stale display price is more useful than none. (See [Assumptions and tradeoffs](#assumptions-and-tradeoffs) — quote creation refuses a stale price outright.)

### Create a firm quote

```bash
curl -X POST http://localhost:3000/v1/quotes \
  -H "Authorization: Bearer <api-key>" \
  -H "Content-Type: application/json" \
  -d '{"symbol":"BTCUSDT","side":"BUY","base_amount":"0.01","ttl_seconds":15}'
```

`base_amount` is always in the **base currency** (BTC, for `BTCUSDT`), as a human-readable decimal string — you don't need to know a currency's minor-unit decimals to request a quote. `ttl_seconds` is optional (defaults to `DEFAULT_QUOTE_TTL_SECONDS`, currently 15s; max 300s).

```json
{
  "id": "06637d34-5365-46b9-9179-6689ee32650a",
  "symbol": "BTCUSDT",
  "side": "BUY",
  "base_currency": "BTC",
  "quote_currency": "USDT",
  "base_amount": "0.01",
  "base_amount_minor": "1000000",
  "price": "65065.000000000000000000",
  "quote_amount": "650.65",
  "quote_amount_minor": "65065",
  "status": "ACTIVE",
  "expires_at": "2026-09-12T13:39:55.325Z",
  "created_at": "2026-09-12T13:38:55.328Z"
}
```

### Get a quote

```bash
curl http://localhost:3000/v1/quotes/06637d34-5365-46b9-9179-6689ee32650a \
  -H "Authorization: Bearer <api-key>"
```

If the quote's `expires_at` has passed, this lazily flips its stored `status` to `EXPIRED` before returning it — there's no background job; expiry is checked deterministically wherever a quote is read or used.

### Execute a trade

```bash
curl -X POST http://localhost:3000/v1/trades \
  -H "Authorization: Bearer <api-key>" \
  -H "Idempotency-Key: unique-client-generated-key-001" \
  -H "Content-Type: application/json" \
  -d '{"quote_id":"06637d34-5365-46b9-9179-6689ee32650a"}'
```

`Idempotency-Key` is required. Retrying the exact same request (same client, same key) — for example after a network timeout — returns the original trade rather than executing a second time; see [Concurrency and idempotency](#concurrency-and-idempotency).

```json
{
  "id": "e46ff458-4189-40e2-bda5-cf4eef29be12",
  "quote_id": "06637d34-5365-46b9-9179-6689ee32650a",
  "symbol": "BTCUSDT",
  "side": "BUY",
  "base_currency": "BTC",
  "quote_currency": "USDT",
  "base_amount": "0.01",
  "base_amount_minor": "1000000",
  "price": "65065.000000000000000000",
  "quote_amount": "650.65",
  "quote_amount_minor": "65065",
  "status": "FILLED",
  "idempotency_key": "unique-client-generated-key-001",
  "created_at": "2026-09-12T13:38:55.471Z"
}
```

### Get a single trade

```bash
curl http://localhost:3000/v1/trades/e46ff458-4189-40e2-bda5-cf4eef29be12 \
  -H "Authorization: Bearer <api-key>"
```

### Trade history (cursor-paginated)

```bash
curl "http://localhost:3000/v1/trades?limit=20" \
  -H "Authorization: Bearer <api-key>"

# Next page:
curl "http://localhost:3000/v1/trades?limit=20&cursor=<next_cursor from previous response>" \
  -H "Authorization: Bearer <api-key>"
```

```json
{
  "data": [ /* trades, newest first */ ],
  "next_cursor": "eyJjcmVhdGVkQXQiOi..." // or null if this was the last page
}
```

The cursor is opaque keyset pagination on `(created_at, id)`, not `OFFSET` — see [Assumptions and tradeoffs](#assumptions-and-tradeoffs) for why that matters.

### Balances

```bash
curl http://localhost:3000/v1/balances -H "Authorization: Bearer <api-key>"
```

```json
{
  "data": [
    { "currency": "BTC", "available": "5.01", "available_minor": "501000000", "updated_at": "..." },
    { "currency": "USDT", "available": "9349.35", "available_minor": "934935", "updated_at": "..." }
  ]
}
```

### Fund a balance (dev/demo only)

Disabled by default. Requires `ENABLE_DEV_DEPOSITS=true` in `.env` — with it unset/false, this route 404s as if it doesn't exist, rather than 403ing (see [Assumptions and tradeoffs](#assumptions-and-tradeoffs)). The seed script (`npm run db:seed`) is the preferred way to get starting balances; this endpoint exists for topping up mid-demo without reseeding.

```bash
curl -X POST http://localhost:3000/v1/deposits \
  -H "Authorization: Bearer <api-key>" \
  -H "Content-Type: application/json" \
  -d '{"currency":"USD","amount":"500"}'
```

## Error format

Every error response, from every endpoint, has the same shape:

```json
{ "error": { "code": "INSUFFICIENT_FUNDS", "message": "Insufficient BTC balance to execute this trade" } }
```

| Code | HTTP status | When |
|---|---|---|
| `VALIDATION_ERROR` | 400 | Malformed request body/query, unsupported symbol/currency |
| `UNAUTHORIZED` | 401 | Missing or invalid `Authorization` header |
| `NOT_FOUND` | 404 | Quote/trade doesn't exist (or belongs to another client) |
| `QUOTE_ALREADY_EXECUTED` | 409 | The quote has already produced a trade |
| `IDEMPOTENCY_CONFLICT` | 409 | Same `Idempotency-Key` reused with a different `quote_id` |
| `QUOTE_EXPIRED` | 410 | `now >= quote.expires_at` |
| `INSUFFICIENT_FUNDS` | 422 | Not enough balance in the currency being paid |
| `PRICING_PROVIDER_ERROR` | 502/503 | Binance unreachable/erroring, no cached fallback available |
| `INTERNAL_SERVER_ERROR` | 500 | Anything unexpected |

## Data model

Five tables, all in `src/db/schema/`:

- **`clients`** — API consumers. `api_key_hash` (bcrypt) maps to `Authorization: Bearer <key>`. Everything below is scoped to `client_id`.
- **`balances`** — one row per `(client_id, currency)`, `UNIQUE(client_id, currency)`. A fast-read cache, not the source of truth — every write happens inside the same transaction as the ledger entry that justifies it.
- **`ledger_entries`** — the source of truth for money movement. Signed `delta_minor` per currency, `reason` (`DEPOSIT` | `TRADE`), `ref_type`/`ref_id` pointing back at what caused it.
- **`quotes`** — a firm, time-bound price: `base_amount_minor`, `price` (string, `numeric(38,18)`), `quote_amount_minor`, `status` (`ACTIVE`|`EXPIRED`|`EXECUTED`), `expires_at`.
- **`trades`** — an immutable execution record. `UNIQUE(quote_id)` (one trade per quote, ever) and `UNIQUE(client_id, idempotency_key)` (idempotent retries) are what make concurrent execution safe — see below.

All amounts are stored as `bigint` **minor units** (never floats). Each currency's decimal count is a fixed table in `src/domain/currencies.ts`:

| Currency | Minor-unit decimals |
|---|---|
| USD | 2 |
| EUR | 2 |
| USDT | 2 *(see note below)* |
| BTC | 8 |
| ETH | 8 *(truncated from ETH's native 18 — see below)* |

Two deliberate simplifications, stated explicitly rather than left implicit: USDT is treated as a 2-decimal stablecoin here (real USDT is 6 decimals on-chain) to keep the demo numbers readable; ETH is capped at 8 decimals rather than its native 18, since 18-decimal minor units would exceed what's useful to display and isn't needed for the trade sizes this assignment demos. Both are one-line changes in `currencies.ts` if higher precision is ever needed — nothing else in the codebase assumes a specific decimal count, everything reads it from that table.

Price math uses `decimal.js` (`src/domain/money.ts`); conversion to/from minor units only happens at the boundary (request in, DB write, response out).

## Money and amount semantics — worked example

**BUY** means: client pays in the **quote currency**, receives the **base currency**.
**SELL** means: client pays in the **base currency**, receives the **quote currency**.

Worked example, verified live against a running instance of this service — a client BUYs 0.01 BTC via `BTCUSDT` at an indicative mid price of 65000, with the default 10bps spread applied in the house-favoring direction:

```
firm price = 65000 × (1 + 0.0010) = 65065  (BUY marks the price up)
base_amount = 0.01 BTC  → base_amount_minor = 1,000,000   (8 decimals)
quote_amount = 0.01 × 65065 = 650.65 USDT → quote_amount_minor = 65,065  (2 decimals)
```

On execution, two ledger entries are written in the same transaction as the trade and balance update:

| currency | delta_minor | meaning |
|---|---|---|
| USDT | −65065 | client pays 650.65 USDT |
| BTC | +1,000,000 | client receives 0.01 BTC |

A SELL of the same size at the same mid price instead marks the price **down** (65000 × 0.9990 = 64935) and reverses the pay/receive direction: BTC debited, USDT credited.

## Concurrency and idempotency

Trade execution (`TradesService.executeTrade`) is the only code path that moves money, and it runs entirely inside one Postgres transaction:

1. `SELECT ... FOR UPDATE` the quote row (serializes concurrent requests for the same quote).
2. Reject if already `EXECUTED`, or if expired (lazily marking it `EXPIRED` on the way out).
3. `SELECT ... FOR UPDATE` the paying balance row; reject with `INSUFFICIENT_FUNDS` if too low — **nothing is written** in this case, so the idempotency key stays free to retry once funded.
4. Insert the trade, insert both ledger entries, apply both balance deltas, mark the quote `EXECUTED`.

Idempotency is checked twice, deliberately redundantly:

- **Application-level**, before opening a transaction: a `(client_id, idempotency_key)` lookup — the fast path for a normal client retry.
- **Database-level**: the `UNIQUE(client_id, idempotency_key)` and `UNIQUE(quote_id)` constraints are the actual guarantee. The application-level check has a TOCTOU race window; if two requests for the same key (or the same quote) land inside that window, one succeeds and the other's `INSERT` hits the constraint — caught and turned into "return the winner's trade" rather than a 500.

This was verified, not just reasoned about: firing 5 truly concurrent `POST /v1/trades` requests at the same fresh quote with the same `Idempotency-Key` produced exactly one trade row, one pair of ledger entries, and one balance movement — all 5 HTTP responses returned the identical trade `id`.

## Architecture

```
src/
  main.ts                 — bootstrap, /v1 global prefix, global exception filter
  app.module.ts
  config/                 — Zod-validated env (fails fast at boot on bad config)
  db/                      — Drizzle schema, migrations, seed script
  domain/                  — currencies.ts, money.ts (decimal.js), errors.ts (typed, HTTP-status-carrying)
  redis/                   — Redis connection provider
  common/
    filters/               — global exception filter → consistent error envelope
    pipes/                 — ZodValidationPipe (request validation, not class-validator)
  modules/
    health/
    clients/               — API-key auth guard + @CurrentClient() decorator
    pricing/                — Binance adapter + Redis cache + resilience (timeout/retry/stale-fallback)
    quotes/                 — firm quote creation, lazy expiry
    balances/               — repository (shared with trades) + read endpoint
    ledger/                 — ledger writes (shared by trades + deposits)
    trades/                 — execution (the core), history, idempotency
    deposits/               — dev-only funding endpoint
```

Each `modules/*` follows the same shape: a `*.repository.ts` (all Drizzle access, nothing else), a `*.service.ts` (business logic, orchestrates repositories, throws typed `domain/errors.ts` errors), a `*.controller.ts` (thin — validates via a Zod schema in `dto/`, calls the service, presents the response), and a `*.module.ts` wiring it together. Services never touch HTTP; controllers never touch the DB.

**Stack**: TypeScript, NestJS on the Express adapter, PostgreSQL via Drizzle ORM, Redis (via ioredis) as a short-TTL cache in front of pricing, Zod for request validation, `decimal.js` for money math, Vitest for tests, `oxlint` + Prettier for lint/format.

## Assumptions and tradeoffs

- **NestJS + Express**, as named in the brief, rather than a lighter framework — chosen deliberately over a mid-build swap, even though a minimal framework like Hono would have meant less boilerplate for a service this size.
- **Zod over `class-validator`/DTO classes** for request validation, via a small `ZodValidationPipe` bridge — schemas live next to their module in `dto/`, and the same schemas could later drive generated OpenAPI docs without decorator duplication.
- **Insufficient funds leaves no trace.** A failed-for-insufficient-funds attempt writes nothing — no trade row, quote stays `ACTIVE`. The alternative (recording a `REJECTED` trade) is defensible too; this project picked "no side effects on a client-correctable error" so the same idempotency key can be retried after funding.
- **Quote creation refuses a stale price** (`PricingProviderError`, not a 200 with a warning) — a firm, executable quote must not be built on a price the system already knows might be wrong. `GET /v1/prices`, being informational only, is fine serving a stale price with `stale: true` rather than failing outright.
- **Redis is a cache, never a source of truth.** It holds only the last-known indicative price (fresh + a longer-lived fallback tier), never anything transactional. If Redis is down, pricing degrades to "always call the provider" rather than the app breaking.
- **Keyset (seek) pagination, not `OFFSET`**, for trade history — `OFFSET` re-numbers rows on every request, so a trade inserted while a client is paging silently duplicates or skips a row for them.
- **Currency and symbol universe is a fixed, small allowlist** (`src/domain/currencies.ts`) rather than accepting anything Binance happens to list — deliberate, since minor-unit decimals and base/quote splitting both need to be known in advance for the money math to be safe.
- **Single seeded client, Bearer-token auth.** `ClientAuthService` bcrypt-compares the incoming key against every client — a full table scan, fine at this scale; a real multi-tenant version would add a fast, non-secret lookup prefix instead.
- **A real bug this caught**: `z.coerce.boolean()` on an env var is a trap — `Boolean("false")` is `true` in JavaScript, since any non-empty string is truthy. `ENABLE_DEV_DEPOSITS=false` was silently turning the dev-deposits endpoint *on* until this was caught by testing the disabled state explicitly, not just the happy path. Fixed with an explicit string comparison; pinned with a regression test (`src/config/env.schema.spec.ts`).

## Testing

```bash
npm test          # unit tests (Vitest) — pure logic, mocked repositories/providers, no network/DB required
npm run test:e2e  # e2e + integration tests against a real Nest application, real Postgres, real Redis
npm run typecheck # tsc --noEmit — NOT run by `npm test`; always run both before trusting a change
npm run lint       # oxlint
```

59 unit tests across 11 files. Coverage includes: money math (minor-unit conversion, rounding, spread application — `domain/money.spec.ts`), the Binance adapter's retry/timeout/error-mapping behavior with `fetch` mocked (`binance-pricing.provider.spec.ts`), pricing resilience end to end (cache hit/miss/stale-fallback/hard-failure), quote spread math and lazy expiry, the full trade-execution branch set (not found / already executed / expired / insufficient funds / both success directions / both unique-violation race paths), client authentication, the deposits credit logic, the global exception filter's error-envelope mapping, cursor pagination encode/decode, and the `ENABLE_DEV_DEPOSITS` boolean-parsing regression described above.

`test/trading-flow.e2e-spec.ts` is a genuine integration test, not a mocked one: a real NestJS application instance, a real Postgres connection, a real Redis connection — only the Binance provider is faked (via `overrideProvider`, DI-level, not a network mock), since it's the one truly external third party. It creates its own disposable client + balances, runs the full quote → trade → balance → history flow over real HTTP (`supertest`) against the real transaction logic, and asserts on exact minor-unit balance numbers after a real Postgres commit. Building this test caught two real bugs worth calling out: the test app initially didn't register the global exception filter the way `main.ts` does, so domain errors like `InsufficientFundsError` fell through to Nest's default handler and returned a raw 500 instead of the real 422 — fixed with a shared `test/test-app.factory.ts` that mirrors `main.ts`'s bootstrap exactly, so this can't silently regress in a future test file. The cleanup logic also initially tried to delete the test client before its child rows, hit the same foreign-key constraints that protect production data, and was fixed to delete in dependency order.

Every functional path in this README was also exercised live against a real running instance during development (Postgres + Redis, not just test-mocked) — including the 5-concurrent-request idempotency race described above.

**A note on the pricing provider in restricted network environments**: this project was developed inside a sandboxed environment whose network egress is allowlisted, and `api.binance.com` was not reachable from it. The pricing code itself makes no assumption about that — it will reach Binance normally with standard internet access (the endpoint used, `/api/v3/ticker/bookTicker`, is public and needs no API key). Where live Binance access wasn't available, the cache and resilience logic were verified by seeding Redis directly with what a successful provider response looks like, and by observing the real 403 the provider call failed with.

## CI

GitHub Actions (`.github/workflows/ci.yml`) runs lint, typecheck, and both test suites against a real Postgres + Redis service container on every push and pull request.
