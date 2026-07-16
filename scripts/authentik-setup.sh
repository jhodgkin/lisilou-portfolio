#!/usr/bin/env bash
# One-shot Authentik setup for LisiLou (issues #10 + #12).
#
# Creates (idempotently — safe to re-run):
#   1. OAuth2/OpenID provider "lisilou-portfolio" (confidential, PKCE-friendly)
#      with redirect URIs for dev + prod
#   2. Application "LisiLou Portfolio" bound to the provider
#   3. Group "lisilou-admin" (dashboard access) and optionally adds a user
#   4. Enrollment flow "lisilou-enrollment" so clients can self-register (#12),
#      and sets it as the brand's enrollment flow (adds a "Sign up" link)
#
# Usage:
#   AUTHENTIK_URL=https://auth.jerodrigged.com AUTHENTIK_TOKEN=<api-token> \
#     bash scripts/authentik-setup.sh [admin-username-to-add]
#
# The API token comes from: Admin interface → Directory → Tokens → Create
# (intent: API). Prints ready-to-paste api/.env lines at the end.

set -euo pipefail

: "${AUTHENTIK_URL:?set AUTHENTIK_URL, e.g. https://auth.jerodrigged.com}"
: "${AUTHENTIK_TOKEN:?set AUTHENTIK_TOKEN (Directory → Tokens, intent API)}"
ADMIN_USER="${1:-}"

BASE="${AUTHENTIK_URL%/}/api/v3"
DEV_REDIRECT="https://dev-lisilou.jerodrigged.com/api/auth/callback"
PROD_REDIRECT="https://lisilou.jerodrigged.com/api/auth/callback"
CLIENT_ID="lisilou-portfolio"

api() { # method path [json-body]
  local method="$1" path="$2" body="${3:-}"
  if [ -n "$body" ]; then
    curl -sS --fail-with-body -X "$method" "$BASE$path" \
      -H "Authorization: Bearer $AUTHENTIK_TOKEN" \
      -H "Content-Type: application/json" -d "$body"
  else
    curl -sS --fail-with-body -X "$method" "$BASE$path" \
      -H "Authorization: Bearer $AUTHENTIK_TOKEN"
  fi
}

jget() { python -c "import sys,json;d=json.load(sys.stdin);print(eval(sys.argv[1]))" "$2" <<<"$1"; }

echo "── Checking API access…"
VERSION=$(api GET /admin/version/ | jget - "d['version_current']" 2>/dev/null || true)
[ -n "$VERSION" ] || { echo "Cannot reach Authentik API — is CT121 running and the token valid?"; exit 1; }
echo "   Authentik $VERSION"

# ── 1. Flows and scope mappings we need to reference ─────────────────────────
AUTHZ_FLOW=$(api GET "/flows/instances/?slug=default-provider-authorization-implicit-consent" | jget - "d['results'][0]['pk']")
INVALIDATION_FLOW=$(api GET "/flows/instances/?slug=default-provider-invalidation-flow" | jget - "d['results'][0]['pk']" 2>/dev/null || echo "")

SCOPES=$(api GET "/propertymappings/provider/scope/?managed__iexact=goauthentik.io/providers/oauth2/scope-openid" | jget - "d['results'][0]['pk']")
for s in profile email; do
  SCOPES="$SCOPES,$(api GET "/propertymappings/provider/scope/?managed__iexact=goauthentik.io/providers/oauth2/scope-$s" | jget - "d['results'][0]['pk']")"
done
SCOPES_JSON=$(python -c "import sys;print(__import__('json').dumps(sys.argv[1].split(',')))" "$SCOPES")

# ── 2. OAuth2 provider ────────────────────────────────────────────────────────
echo "── Provider…"
EXISTING=$(api GET "/providers/oauth2/?name=$CLIENT_ID" | jget - "len(d['results'])")
if [ "$EXISTING" -gt 0 ]; then
  PROVIDER_PK=$(api GET "/providers/oauth2/?name=$CLIENT_ID" | jget - "d['results'][0]['pk']")
  echo "   exists (pk=$PROVIDER_PK)"
else
  BODY=$(python - "$AUTHZ_FLOW" "$INVALIDATION_FLOW" "$SCOPES_JSON" <<'PY'
import json, sys
authz, inval, scopes = sys.argv[1], sys.argv[2], json.loads(sys.argv[3])
p = {
  "name": "lisilou-portfolio",
  "authorization_flow": authz,
  "client_type": "confidential",
  "client_id": "lisilou-portfolio",
  "property_mappings": scopes,
  "redirect_uris": [
    {"matching_mode": "strict", "url": "https://dev-lisilou.jerodrigged.com/api/auth/callback"},
    {"matching_mode": "strict", "url": "https://lisilou.jerodrigged.com/api/auth/callback"},
  ],
  "sub_mode": "hashed_user_id",
  "include_claims_in_id_token": True,
}
if inval: p["invalidation_flow"] = inval
print(json.dumps(p))
PY
)
  RESP=$(api POST /providers/oauth2/ "$BODY" 2>&1) || {
    # Older Authentik (<2024.2) wants redirect_uris as a newline-joined string
    BODY=$(python -c "
import json,sys
p=json.loads(sys.argv[1]); p['redirect_uris']='\n'.join(u['url'] for u in p['redirect_uris']); print(json.dumps(p))" "$BODY")
    RESP=$(api POST /providers/oauth2/ "$BODY")
  }
  PROVIDER_PK=$(jget "$RESP" "d['pk']")
  echo "   created (pk=$PROVIDER_PK)"
fi
CLIENT_SECRET=$(api GET "/providers/oauth2/$PROVIDER_PK/" | jget - "d['client_secret']")

# ── 3. Application ────────────────────────────────────────────────────────────
echo "── Application…"
if [ "$(api GET "/core/applications/?slug=lisilou" | jget - "len(d['results'])")" -gt 0 ]; then
  echo "   exists"
  api PATCH "/core/applications/lisilou/" "{\"provider\": $PROVIDER_PK}" >/dev/null
else
  api POST /core/applications/ "{\"name\": \"LisiLou Portfolio\", \"slug\": \"lisilou\", \"provider\": $PROVIDER_PK, \"meta_launch_url\": \"https://lisilou.jerodrigged.com/my-bookings\"}" >/dev/null
  echo "   created"
fi

# ── 4. Admin group (+ optional member) ───────────────────────────────────────
echo "── Group lisilou-admin…"
if [ "$(api GET "/core/groups/?name=lisilou-admin" | jget - "len(d['results'])")" -gt 0 ]; then
  GROUP_UUID=$(api GET "/core/groups/?name=lisilou-admin" | jget - "d['results'][0]['pk']")
  echo "   exists"
else
  GROUP_UUID=$(api POST /core/groups/ '{"name": "lisilou-admin"}' | jget - "d['pk']")
  echo "   created"
fi
if [ -n "$ADMIN_USER" ]; then
  USER_PK=$(api GET "/core/users/?username=$ADMIN_USER" | jget - "d['results'][0]['pk']" 2>/dev/null || echo "")
  if [ -n "$USER_PK" ]; then
    api POST "/core/groups/$GROUP_UUID/add_user/" "{\"pk\": $USER_PK}" >/dev/null && echo "   added $ADMIN_USER"
  else
    echo "   WARNING: user '$ADMIN_USER' not found — add to lisilou-admin manually"
  fi
fi

# ── 5. Enrollment flow (issue #12) ────────────────────────────────────────────
echo "── Enrollment flow…"
if [ "$(api GET "/flows/instances/?slug=lisilou-enrollment" | jget - "len(d['results'])")" -gt 0 ]; then
  FLOW_PK=$(api GET "/flows/instances/?slug=lisilou-enrollment" | jget - "d['results'][0]['pk']")
  echo "   exists"
else
  FLOW_PK=$(api POST /flows/instances/ '{
    "name": "LisiLou client sign-up",
    "slug": "lisilou-enrollment",
    "title": "Create your LisiLou Photography account",
    "designation": "enrollment",
    "authentication": "require_unauthenticated",
    "compatibility_mode": true
  }' | jget - "d['pk']")

  # Prompt fields (created only if a same-key field doesn't already exist)
  declare -A FIELD_PKS
  make_field() { # key label type order placeholder
    local existing
    existing=$(api GET "/stages/prompt/prompts/?field_key=$1&name=lisilou-$1" | jget - "d['results'][0]['pk']" 2>/dev/null || echo "")
    if [ -n "$existing" ]; then FIELD_PKS[$1]=$existing; return; fi
    FIELD_PKS[$1]=$(api POST /stages/prompt/prompts/ "{
      \"name\": \"lisilou-$1\", \"field_key\": \"$1\", \"label\": \"$2\",
      \"type\": \"$3\", \"required\": true, \"order\": $4, \"placeholder\": \"$5\"
    }" | jget - "d['pk']")
  }
  make_field username "Username" username 0 ""
  make_field name "Full name" text 1 "Jane Smith"
  make_field email "Email" email 2 "you@example.com"
  make_field password "Password" password 3 ""
  make_field password_repeat "Confirm password" password 4 ""

  PROMPT_STAGE=$(api POST /stages/prompt/ "{
    \"name\": \"lisilou-enrollment-prompt\",
    \"fields\": [\"${FIELD_PKS[username]}\",\"${FIELD_PKS[name]}\",\"${FIELD_PKS[email]}\",\"${FIELD_PKS[password]}\",\"${FIELD_PKS[password_repeat]}\"]
  }" | jget - "d['pk']")
  WRITE_STAGE=$(api POST /stages/user_write/ '{"name": "lisilou-enrollment-write", "user_creation_mode": "always_create", "create_users_as_inactive": false}' \
    | jget - "d['pk']" 2>/dev/null || \
    api POST /stages/user_write/ '{"name": "lisilou-enrollment-write", "can_create_users": true}' | jget - "d['pk']")
  LOGIN_STAGE=$(api POST /stages/user_login/ '{"name": "lisilou-enrollment-login"}' | jget - "d['pk']")

  for binding in "$PROMPT_STAGE 10" "$WRITE_STAGE 20" "$LOGIN_STAGE 30"; do
    set -- $binding
    api POST /flows/bindings/ "{\"target\": \"$FLOW_PK\", \"stage\": \"$1\", \"order\": $2}" >/dev/null
  done
  echo "   created (prompt → user_write → login)"
fi

# Point the active brand's enrollment flow at it (adds "Sign up" on the login page)
BRAND=$(api GET "/core/brands/?default=true" | jget - "d['results'][0]['brand_uuid']" 2>/dev/null || echo "")
if [ -n "$BRAND" ]; then
  api PATCH "/core/brands/$BRAND/" "{\"flow_enrollment\": \"$FLOW_PK\"}" >/dev/null
  echo "   set as brand enrollment flow"
else
  echo "   NOTE: could not find default brand — set Flows→enrollment manually in Brands"
fi

# ── Done ──────────────────────────────────────────────────────────────────────
cat <<EOF

✅ Authentik setup complete. Paste into api/.env on each instance
   (SITE-specific OIDC_REDIRECT_URI shown for prod; use the dev URL on CT114):

OIDC_ISSUER=${AUTHENTIK_URL%/}/application/o/lisilou/
OIDC_CLIENT_ID=$CLIENT_ID
OIDC_CLIENT_SECRET=$CLIENT_SECRET
OIDC_REDIRECT_URI=$PROD_REDIRECT
OIDC_ADMIN_GROUP=lisilou-admin
SESSION_SECRET=$(openssl rand -hex 32 2>/dev/null || python -c "import secrets;print(secrets.token_hex(32))")

Then: docker compose restart api
EOF
