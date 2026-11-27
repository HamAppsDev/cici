#!/usr/bin/env bash
# Deploys Cici to AWS (us-east-2). Reads the Cloudflare values SST needs for DNS straight from
# Parameter Store, so no secret is ever written to a file on this laptop.
# First: aws login --profile hamapps
set -euo pipefail
cd "$(dirname "$0")"
eval "$(aws configure export-credentials --profile hamapps --format env)"
get() { aws ssm get-parameter --region us-east-2 --name "$1" --with-decryption --query Parameter.Value --output text; }
export CLOUDFLARE_API_TOKEN="$(get /homepage/CLOUDFLARE_API_TOKEN)"
export CLOUDFLARE_DEFAULT_ACCOUNT_ID="$(get /homepage/CLOUDFLARE_DEFAULT_ACCOUNT_ID)"
npx sst deploy --stage production
