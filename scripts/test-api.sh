#!/usr/bin/env bash
#
# End-to-end manual/smoke test script for MiniOpenFX.
#
# Exercises every endpoint and the important edge cases: validation
# errors, auth, quote expiry, trade idempotency (including a real
# concurrent race), insufficient funds, pagination, and the dev deposits
# flag. Safe to run repeatedly — it creates its own quotes/trades each
# run and only ever adds to balances (via a small BUY + a deposit), never
# assumes a specific starting balance.
#
# Usage:
#   ./scripts/test-api.sh
#   BASE_URL=http://localhost:3000 API_KEY=your-key ./scripts/test-api.sh
#
# Requires: the API running (npm run start:dev), curl, python3.
# Needs real internet access to Binance for the pricing calls to succeed
# (this script does not mock pricing) — that's expected to work fine on
# your machine even though it didn't inside the sandbox this was built in.

set -uo pipefail

BASE_URL="${BASE_URL:-http://localhost:3000}"
API_KEY="${API_KEY:-dev-local-api-key-change-me}"
AUTH_HEADER="Authorization: Bearer ${API_KEY}"

PASS=0
FAIL=0

# ---------- helpers ----------

section() {
  echo
  echo "==================================================================="
  echo "  $1"
  echo "==================================================================="
}

# check <label> <expected_status> <curl args...>
# Runs curl, prints the response body, and pass/fails on HTTP status.
check() {
  local label="$1" expected="$2"
  shift 2
  local out status
  out=$(curl -s -w '\n%{http_code}' "$@")
  status=$(echo "$out" | tail -n1)
  body=$(echo "$out" | sed '$d')
  if [ "$status" = "$expected" ]; then
    echo "PASS  [$status] $label"
    PASS=$((PASS + 1))
  else
    echo "FAIL  [$status, expected $expected] $label"
    echo "      body: $body"
    FAIL=$((FAIL + 1))
  fi
  # Make the last response body available to the caller for chaining
  # (e.g. pulling an id out of a just-created quote).
  LAST_BODY="$body"
}

json_get() {
  # json_get <key> <<< "$json"
  python3 -c "import json,sys;d=json.load(sys.stdin);print(d.get('$1',''))"
}

echo "Testing MiniOpenFX at $BASE_URL"
echo "Using API key: ${API_KEY:0:8}..."

# ---------- 1. Health ----------

section "Health"
check "GET /v1/health" 200 "$BASE_URL/v1/health"

# ---------- 2. Pricing ----------

section "Pricing"
check "GET /v1/prices?symbol=BTCUSDT (valid)" 200 "$BASE_URL/v1/prices?symbol=BTCUSDT"
check "GET /v1/prices?symbol=DOGEUSDT (unsupported symbol)" 400 "$BASE_URL/v1/prices?symbol=DOGEUSDT"
check "GET /v1/prices (missing symbol)" 400 "$BASE_URL/v1/prices"

# ---------- 3. Auth ----------

section "Auth"
check "GET /v1/balances, no Authorization header" 401 "$BASE_URL/v1/balances"
check "GET /v1/balances, wrong key" 401 "$BASE_URL/v1/balances" -H "Authorization: Bearer totally-wrong-key"
check "GET /v1/balances, correct key" 200 "$BASE_URL/v1/balances" -H "$AUTH_HEADER"

# ---------- 4. Quote validation ----------

section "Quote validation"
check "POST /v1/quotes, unsupported symbol" 400 -X POST "$BASE_URL/v1/quotes" \
  -H "$AUTH_HEADER" -H "Content-Type: application/json" \
  -d '{"symbol":"DOGEUSDT","side":"BUY","base_amount":"1"}'

check "POST /v1/quotes, negative amount" 400 -X POST "$BASE_URL/v1/quotes" \
  -H "$AUTH_HEADER" -H "Content-Type: application/json" \
  -d '{"symbol":"BTCUSDT","side":"BUY","base_amount":"-1"}'

check "POST /v1/quotes, missing fields" 400 -X POST "$BASE_URL/v1/quotes" \
  -H "$AUTH_HEADER" -H "Content-Type: application/json" \
  -d '{"symbol":"BTCUSDT"}'

check "GET /v1/quotes/<random-uuid> (not found)" 404 "$BASE_URL/v1/quotes/00000000-0000-0000-0000-000000000000" \
  -H "$AUTH_HEADER"

# ---------- 5. Quote creation + lazy expiry ----------

section "Quote creation"
check "POST /v1/quotes BUY 0.001 BTC" 201 -X POST "$BASE_URL/v1/quotes" \
  -H "$AUTH_HEADER" -H "Content-Type: application/json" \
  -d '{"symbol":"BTCUSDT","side":"BUY","base_amount":"0.001","ttl_seconds":30}'
QUOTE_ID=$(echo "$LAST_BODY" | json_get id)
QUOTE_AMOUNT_MINOR=$(echo "$LAST_BODY" | json_get quote_amount_minor)
echo "      quote id: $QUOTE_ID, cost: $QUOTE_AMOUNT_MINOR USDT minor units"

section "Quote lazy expiry"
check "POST /v1/quotes with ttl_seconds=1 (for expiry test)" 201 -X POST "$BASE_URL/v1/quotes" \
  -H "$AUTH_HEADER" -H "Content-Type: application/json" \
  -d '{"symbol":"BTCUSDT","side":"BUY","base_amount":"0.001","ttl_seconds":1}'
EXPIRY_QUOTE_ID=$(echo "$LAST_BODY" | json_get id)
echo "      waiting 2s for it to expire..."
sleep 2
check "GET that quote after expiry -> status flips to EXPIRED" 200 "$BASE_URL/v1/quotes/$EXPIRY_QUOTE_ID" -H "$AUTH_HEADER"
STATUS_AFTER_EXPIRY=$(echo "$LAST_BODY" | json_get status)
if [ "$STATUS_AFTER_EXPIRY" = "EXPIRED" ]; then
  echo "PASS  quote lazily flipped to EXPIRED"
  PASS=$((PASS + 1))
else
  echo "FAIL  expected status EXPIRED, got $STATUS_AFTER_EXPIRY"
  FAIL=$((FAIL + 1))
fi

check "POST /v1/trades against the now-expired quote -> 410" 410 -X POST "$BASE_URL/v1/trades" \
  -H "$AUTH_HEADER" -H "Idempotency-Key: expiry-test-$(date +%s)" -H "Content-Type: application/json" \
  -d "{\"quote_id\":\"$EXPIRY_QUOTE_ID\"}"

# ---------- 6. Trade execution ----------

section "Trade execution"

BALANCE_BEFORE=$(curl -s "$BASE_URL/v1/balances" -H "$AUTH_HEADER")
BTC_BEFORE=$(echo "$BALANCE_BEFORE" | python3 -c "import json,sys;d=json.load(sys.stdin);print(next((b['available_minor'] for b in d['data'] if b['currency']=='BTC'),'0'))")
USDT_BEFORE=$(echo "$BALANCE_BEFORE" | python3 -c "import json,sys;d=json.load(sys.stdin);print(next((b['available_minor'] for b in d['data'] if b['currency']=='USDT'),'0'))")
echo "      before: BTC=$BTC_BEFORE, USDT=$USDT_BEFORE (minor units)"

IDEMPOTENCY_KEY="smoke-test-$(date +%s)-$RANDOM"
check "POST /v1/trades, missing Idempotency-Key header" 400 -X POST "$BASE_URL/v1/trades" \
  -H "$AUTH_HEADER" -H "Content-Type: application/json" \
  -d "{\"quote_id\":\"$QUOTE_ID\"}"

check "POST /v1/trades, execute the BUY quote" 201 -X POST "$BASE_URL/v1/trades" \
  -H "$AUTH_HEADER" -H "Idempotency-Key: $IDEMPOTENCY_KEY" -H "Content-Type: application/json" \
  -d "{\"quote_id\":\"$QUOTE_ID\"}"
TRADE_ID=$(echo "$LAST_BODY" | json_get id)
echo "      trade id: $TRADE_ID"

BALANCE_AFTER=$(curl -s "$BASE_URL/v1/balances" -H "$AUTH_HEADER")
BTC_AFTER=$(echo "$BALANCE_AFTER" | python3 -c "import json,sys;d=json.load(sys.stdin);print(next((b['available_minor'] for b in d['data'] if b['currency']=='BTC'),'0'))")
USDT_AFTER=$(echo "$BALANCE_AFTER" | python3 -c "import json,sys;d=json.load(sys.stdin);print(next((b['available_minor'] for b in d['data'] if b['currency']=='USDT'),'0'))")
echo "      after:  BTC=$BTC_AFTER, USDT=$USDT_AFTER (minor units)"

BTC_DELTA=$((BTC_AFTER - BTC_BEFORE))
USDT_DELTA=$((USDT_AFTER - USDT_BEFORE))
if [ "$BTC_DELTA" = "100000" ] && [ "$USDT_DELTA" = "-$QUOTE_AMOUNT_MINOR" ]; then
  echo "PASS  balances moved by exactly the trade amount (BTC +100000, USDT -$QUOTE_AMOUNT_MINOR)"
  PASS=$((PASS + 1))
else
  echo "FAIL  unexpected balance deltas: BTC $BTC_DELTA, USDT $USDT_DELTA (expected BTC +100000, USDT -$QUOTE_AMOUNT_MINOR)"
  FAIL=$((FAIL + 1))
fi

section "Idempotency"

check "Retry same Idempotency-Key + same quote -> same trade, 201" 201 -X POST "$BASE_URL/v1/trades" \
  -H "$AUTH_HEADER" -H "Idempotency-Key: $IDEMPOTENCY_KEY" -H "Content-Type: application/json" \
  -d "{\"quote_id\":\"$QUOTE_ID\"}"
RETRY_TRADE_ID=$(echo "$LAST_BODY" | json_get id)
if [ "$RETRY_TRADE_ID" = "$TRADE_ID" ]; then
  echo "PASS  retry returned the identical trade id (no double-execution)"
  PASS=$((PASS + 1))
else
  echo "FAIL  retry returned a different trade id: $RETRY_TRADE_ID vs $TRADE_ID"
  FAIL=$((FAIL + 1))
fi

check "Same quote, different Idempotency-Key -> 409 QUOTE_ALREADY_EXECUTED" 409 -X POST "$BASE_URL/v1/trades" \
  -H "$AUTH_HEADER" -H "Idempotency-Key: a-different-key-$RANDOM" -H "Content-Type: application/json" \
  -d "{\"quote_id\":\"$QUOTE_ID\"}"

check "Same Idempotency-Key, different (fake) quote_id -> 409 IDEMPOTENCY_CONFLICT" 409 -X POST "$BASE_URL/v1/trades" \
  -H "$AUTH_HEADER" -H "Idempotency-Key: $IDEMPOTENCY_KEY" -H "Content-Type: application/json" \
  -d '{"quote_id":"00000000-0000-0000-0000-000000000000"}'

section "Concurrency race (5 parallel requests, same key + quote)"
check "POST /v1/quotes BUY 0.001 BTC (fresh quote for the race)" 201 -X POST "$BASE_URL/v1/quotes" \
  -H "$AUTH_HEADER" -H "Content-Type: application/json" \
  -d '{"symbol":"BTCUSDT","side":"BUY","base_amount":"0.001","ttl_seconds":30}'
RACE_QUOTE_ID=$(echo "$LAST_BODY" | json_get id)
RACE_KEY="race-$(date +%s)-$RANDOM"

RACE_DIR=$(mktemp -d)
for i in 1 2 3 4 5; do
  curl -s -o "$RACE_DIR/r$i.json" -X POST "$BASE_URL/v1/trades" \
    -H "$AUTH_HEADER" -H "Idempotency-Key: $RACE_KEY" -H "Content-Type: application/json" \
    -d "{\"quote_id\":\"$RACE_QUOTE_ID\"}" &
done
wait

UNIQUE_IDS=$(for i in 1 2 3 4 5; do python3 -c "import json;print(json.load(open('$RACE_DIR/r$i.json')).get('id',''))"; done | sort -u | wc -l)
rm -rf "$RACE_DIR"
if [ "$UNIQUE_IDS" = "1" ]; then
  echo "PASS  5 concurrent requests for the same quote/key produced exactly 1 distinct trade id"
  PASS=$((PASS + 1))
else
  echo "FAIL  5 concurrent requests produced $UNIQUE_IDS distinct trade ids (expected 1)"
  FAIL=$((FAIL + 1))
fi

# ---------- 7. Insufficient funds ----------

section "Insufficient funds"
check "POST /v1/quotes SELL 999 BTC (far more than any seeded balance)" 201 -X POST "$BASE_URL/v1/quotes" \
  -H "$AUTH_HEADER" -H "Content-Type: application/json" \
  -d '{"symbol":"BTCUSDT","side":"SELL","base_amount":"999","ttl_seconds":30}'
BIG_QUOTE_ID=$(echo "$LAST_BODY" | json_get id)

check "POST /v1/trades against it -> 422 INSUFFICIENT_FUNDS" 422 -X POST "$BASE_URL/v1/trades" \
  -H "$AUTH_HEADER" -H "Idempotency-Key: insufficient-$(date +%s)" -H "Content-Type: application/json" \
  -d "{\"quote_id\":\"$BIG_QUOTE_ID\"}"

check "GET that quote afterwards -> still ACTIVE (no side effect from the failed attempt)" 200 "$BASE_URL/v1/quotes/$BIG_QUOTE_ID" -H "$AUTH_HEADER"
BIG_QUOTE_STATUS=$(echo "$LAST_BODY" | json_get status)
if [ "$BIG_QUOTE_STATUS" = "ACTIVE" ]; then
  echo "PASS  quote untouched by the failed insufficient-funds attempt"
  PASS=$((PASS + 1))
else
  echo "FAIL  expected quote status ACTIVE after failed trade, got $BIG_QUOTE_STATUS"
  FAIL=$((FAIL + 1))
fi

# ---------- 8. Trade history / pagination ----------

section "Trade history"
check "GET /v1/trades?limit=2" 200 "$BASE_URL/v1/trades?limit=2" -H "$AUTH_HEADER"
NEXT_CURSOR=$(echo "$LAST_BODY" | python3 -c "import json,sys;d=json.load(sys.stdin);print(d.get('next_cursor') or '')")
if [ -n "$NEXT_CURSOR" ]; then
  check "GET /v1/trades?limit=2&cursor=<next_cursor> (page 2)" 200 "$BASE_URL/v1/trades?limit=2&cursor=$NEXT_CURSOR" -H "$AUTH_HEADER"
else
  echo "      (skipped page 2 — fewer than 3 trades exist for this client yet)"
fi
check "GET /v1/trades?cursor=not-a-real-cursor -> 400" 400 "$BASE_URL/v1/trades?cursor=not-a-real-cursor" -H "$AUTH_HEADER"
check "GET /v1/trades?limit=99999 -> 400 (over the 200 cap)" 400 "$BASE_URL/v1/trades?limit=99999" -H "$AUTH_HEADER"
check "GET /v1/trades/$TRADE_ID (single trade)" 200 "$BASE_URL/v1/trades/$TRADE_ID" -H "$AUTH_HEADER"
check "GET /v1/trades/00000000-0000-0000-0000-000000000000 -> 404" 404 "$BASE_URL/v1/trades/00000000-0000-0000-0000-000000000000" -H "$AUTH_HEADER"

# ---------- 9. Deposits (dev-only) ----------

section "Deposits (only if ENABLE_DEV_DEPOSITS=true in your .env)"
DEPOSIT_STATUS=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE_URL/v1/deposits" \
  -H "$AUTH_HEADER" -H "Content-Type: application/json" -d '{"currency":"USD","amount":"100"}')
if [ "$DEPOSIT_STATUS" = "201" ]; then
  echo "PASS  [201] POST /v1/deposits (enabled)"
  PASS=$((PASS + 1))
  check "POST /v1/deposits, unsupported currency -> 400" 400 -X POST "$BASE_URL/v1/deposits" \
    -H "$AUTH_HEADER" -H "Content-Type: application/json" -d '{"currency":"DOGE","amount":"10"}'
elif [ "$DEPOSIT_STATUS" = "404" ]; then
  echo "SKIP  deposits endpoint is disabled (ENABLE_DEV_DEPOSITS is not true) — this is expected unless you turned it on"
else
  echo "FAIL  [$DEPOSIT_STATUS] POST /v1/deposits — unexpected status"
  FAIL=$((FAIL + 1))
fi

# ---------- summary ----------

section "Summary"
echo "PASS: $PASS   FAIL: $FAIL"
if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
