#!/usr/bin/env bash
#
# Push the deploy credentials from .env into GitHub Actions.
#
# Run this YOURSELF — it reads private keys out of .env and sends them to
# GitHub, which is exactly the kind of thing that should not happen inside an
# agent's sandbox without you watching it.
#
#   bash tools/deploy/gh-secrets.sh
#
# Idempotent: re-running overwrites with whatever .env currently says.
# Values are never echoed; only the name and character count are printed, so
# you can spot a truncated paste without the secret reaching your scrollback.

set -euo pipefail
cd "$(dirname "$0")/../.."

REPO="${REPO:-TechnicallyKiller/ethonline-1}"
[ -f .env ] || { echo "no .env here" >&2; exit 1; }

# Strip inline comments and surrounding quotes — .env has both
# (e.g. `WINDOW_SECONDS=300           # 3600 in normal operation`).
get() {
  grep -m1 "^$1=" .env | cut -d= -f2- \
    | sed 's/[[:space:]]*#.*$//; s/^"//; s/"$//' | tr -d '\r' | xargs || true
}

echo "-> $REPO"
echo
echo "secrets"
for k in HEDERA_OPERATOR_ID HEDERA_OPERATOR_KEY \
         USDC_TOKEN_ID TAB_ACCOUNT_ID \
         TOPIC_RECEIPTS TOPIC_CEILINGS TOPIC_SETTLEMENTS \
         FAUCET_ACCOUNT_ID FAUCET_ACCOUNT_KEY \
         DEMO_PAYER_ACCOUNT_ID DEMO_PAYER_ACCOUNT_KEY \
         DEMO_PAYER2_ACCOUNT_ID DEMO_PAYER2_ACCOUNT_KEY \
         DEMO_PAYER3_ACCOUNT_ID DEMO_PAYER3_ACCOUNT_KEY; do
  v="$(get "$k")"
  if [ -z "$v" ]; then printf '  SKIP  %-22s (empty in .env)\n' "$k"; continue; fi
  printf '%s' "$v" | gh secret set "$k" --repo "$REPO" >/dev/null
  printf '  set   %-22s (%d chars)\n' "$k" "${#v}"
done

# Variables are NOT secret — they are printed in full, because a wrong
# WINDOW_SECONDS is a silent correctness bug and you want to see the value.
#
# WINDOW_SECONDS and DEMO_MODE must match render.yaml. The gateway files
# receipts into windows and the engine computes ceilings over them; they agree
# only if both use the same number.
echo
echo "variables"
# TRAILING_WINDOWS is deliberately NOT taken from .env.
#
# .env carries 1, which is right for a laptop: one 300s window of history, so a
# change shows up immediately. The deployment wants 6, so revenue is averaged
# over half an hour and the tier does not flicker to Unrated in every window the
# traffic generator happens not to run in.
#
# This script previously copied .env's 1 over the 6 set in the dashboard, twice,
# silently reverting a deliberate choice. Pass TRAILING_WINDOWS=n to set it.
for pair in "DEMO_MODE=$(get DEMO_MODE)" \
            "WINDOW_SECONDS=$(get WINDOW_SECONDS)" \
            "TRAILING_WINDOWS=${TRAILING_WINDOWS:-}"; do
  k="${pair%%=*}"; v="${pair#*=}"
  if [ -z "$v" ]; then printf '  SKIP  %-22s (empty in .env)\n' "$k"; continue; fi
  gh variable set "$k" --repo "$REPO" --body "$v" >/dev/null
  printf '  set   %-22s = %s\n' "$k" "$v"
done

# The traffic workflow needs to know where the deployed services are. These are
# public URLs, not secrets, so they are variables — visible in the Actions log,
# which is where you want them when a run fails.
echo
echo "service urls"
for pair in "TAB_GATEWAY_URL=${TAB_GATEWAY_URL:-}" "SELLER_URL=${SELLER_URL:-}"; do
  k="${pair%%=*}"; v="${pair#*=}"
  if [ -z "$v" ]; then
    printf '  SKIP  %-22s (already set, or pass it: %s=https://... bash %s)\n' "$k" "$k" "$0"
    continue
  fi
  gh variable set "$k" --repo "$REPO" --body "$v" >/dev/null
  printf '  set   %-22s = %s\n' "$k" "$v"
done

# TREASURY_ACCOUNT_ID is still the `0.0.xxxxx` placeholder and FLOAT_TOTAL_USDC
# is absent, so both are left unset on purpose: verify-tab detects each and
# SKIPS the float-conservation check rather than failing. Setting a wrong value
# would be worse than setting none.
echo
echo "left unset (verify-tab skips the float check): TREASURY_ACCOUNT_ID, FLOAT_TOTAL_USDC"
echo
echo "done. confirm with:  gh secret list --repo $REPO"
