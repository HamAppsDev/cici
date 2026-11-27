#!/usr/bin/env bash
# Deploys all of Cici to AWS (us-east-2):
#   1. packs bot/ (the always-on part) into .build/bot.tgz
#   2. sst deploy: Lambdas, verify.hamapps.dev, the EC2 instance, and uploads bot.tgz
#   3. registers the /commands with Discord (src/commands.json)
#   4. tells the EC2 instance to install the new bot.tgz and restart (through Session Manager)
# Reads the Cloudflare values and Cici's token from Parameter Store, so no secret is written to disk.
# First: aws login --profile hamapps
set -euo pipefail
cd "$(dirname "$0")"
eval "$(aws configure export-credentials --profile hamapps --format env)"
export AWS_REGION=us-east-2
get() { aws ssm get-parameter --region us-east-2 --name "$1" --with-decryption --query Parameter.Value --output text; }

mkdir -p .build
COPYFILE_DISABLE=1 tar -czf .build/bot.tgz -C bot package.json package-lock.json index.mjs

export CLOUDFLARE_API_TOKEN="$(get /homepage/CLOUDFLARE_API_TOKEN)"
export CLOUDFLARE_DEFAULT_ACCOUNT_ID="$(get /homepage/CLOUDFLARE_DEFAULT_ACCOUNT_ID)"
npx sst deploy --stage production
unset CLOUDFLARE_API_TOKEN CLOUDFLARE_DEFAULT_ACCOUNT_ID

DISCORD_TOKEN="$(get /cici/DISCORD_MASCOT_BOT_TOKEN)" node scripts/register-commands.mjs

INSTANCE=$(aws ec2 describe-instances --filters Name=tag:Name,Values=cici-live Name=instance-state-name,Values=running \
  --query 'Reservations[].Instances[].InstanceId' --output text)
if [ -n "$INSTANCE" ] && [ "$(aws ssm describe-instance-information --filters Key=InstanceIds,Values=$INSTANCE --query 'length(InstanceInformationList)' --output text)" = "1" ]; then
  CMD=$(aws ssm send-command --instance-ids "$INSTANCE" --document-name AWS-RunShellScript \
    --parameters commands=/usr/local/bin/cici-update --comment "Cici update" --query Command.CommandId --output text)
  aws ssm wait command-executed --command-id "$CMD" --instance-id "$INSTANCE" || true
  echo "Cici live update: $(aws ssm get-command-invocation --command-id "$CMD" --instance-id "$INSTANCE" --query Status --output text)"
else
  echo "Cici live: instance is still starting; it installs the bot on first boot."
fi
