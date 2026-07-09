#!/usr/bin/env bash
# Usage: bash scripts/smoke-test.sh http://192.168.1.192:8080
set -uo pipefail

BASE="${1:-http://localhost:8080}"
PASS=0
FAIL=0

ok()   { echo "  ✓ $1"; PASS=$((PASS+1)); }
fail() { echo "  ✗ $1"; FAIL=$((FAIL+1)); }

http_status() { curl -s -o /dev/null -w "%{http_code}" --max-time 8 "$1"; }
http_body()   { curl -s --max-time 8 "$1"; }

echo ""
echo "Smoke tests → $BASE"
echo "────────────────────────────────────────"

# 1. Portfolio site loads
s=$(http_status "$BASE/")
[ "$s" = "200" ] && ok "GET / → 200" || fail "GET / → 200 (got $s)"

# 2. Nginx health endpoint
s=$(http_status "$BASE/health")
[ "$s" = "200" ] && ok "GET /health → 200" || fail "GET /health → 200 (got $s)"

# 3. API health
b=$(http_body "$BASE/api/health")
[[ "$b" == *'"ok":true'* ]] && ok "GET /api/health → {ok:true}" || fail "GET /api/health → {ok:true} (got: $b)"

# 4. Config file served
s=$(http_status "$BASE/config/site.json")
[ "$s" = "200" ] && ok "GET /config/site.json → 200" || fail "GET /config/site.json → 200 (got $s)"

# 5. Booking POST creates record
b=$(curl -s --max-time 8 -X POST "$BASE/api/bookings" \
  -H "Content-Type: application/json" \
  -d '{"client_name":"Smoke Test","client_email":"smoke@test.lisilou","session_date":"2099-12-31","session_type":"individual","session_length":"mini","location":"studio"}')
[[ "$b" == *'"id"'* ]] && ok "POST /api/bookings → returns id" || fail "POST /api/bookings → returns id (got: $b)"

# 6. Signed contract 404s gracefully (no file for nonexistent booking)
s=$(http_status "$BASE/api/bookings/99999/contract")
[ "$s" = "404" ] && ok "GET /api/bookings/99999/contract → 404" || fail "GET /api/bookings/99999/contract → 404 (got $s)"

# 7. Nginx does not 500 on unknown /api/ path
s=$(http_status "$BASE/api/nonexistent-route")
[ "$s" != "500" ] && ok "GET /api/unknown → not 500 (got $s)" || fail "GET /api/unknown → 500 (nginx misconfigured)"

echo "────────────────────────────────────────"
if [ $FAIL -eq 0 ]; then
  echo "  All $PASS tests passed ✓"
else
  echo "  Passed: $PASS  Failed: $FAIL"
fi
echo ""

[ $FAIL -eq 0 ]
