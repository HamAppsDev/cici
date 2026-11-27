# Cici: the HamApps Discord bot

Cici, the club's box-cat mascot, guards the HamApps Discord. New members join with the permanent invite (https://discord.gg/DgsvrQeJjr) and can only see #welcome until they verify:

1. They click **Verify** in #welcome. Discord sends the click to `https://verify.hamapps.dev/interactions` (`src/verify.ts`), and Cici privately replies with a personal 15-minute link.
2. The link signs them in with Google. Only Hamilton accounts (`hd` = `hamilton.edu`) pass.
3. They get the **Member** role, their server nickname becomes their real name, and Cici welcomes them in #general. Nothing about them is stored.
4. In #roles, Cici's menu gives interest roles (💻 Development, 🎨 Design, 📋 Product, 📣 Marketing).

Every hour `src/cleanup.ts` kicks people who joined **after go-live** and still have no Member role 48 hours later (Cici DMs them the invite first). Anyone who joined before go-live is never kicked. Go-live is the date in Parameter Store `/cici/DISCORD_VERIFY_GO_LIVE`; delete it to stop all kicks.

## Secrets

All secrets are in AWS Parameter Store (us-east-2) as encrypted SecureStrings. Never commit them.

| Parameter | What |
| --- | --- |
| `/cici/DISCORD_MASCOT_BOT_TOKEN` | Cici's bot token (Developer Portal → Cici → Bot → Reset Token) |
| `/cici/GOOGLE_OAUTH_CLIENT_SECRET_VERIFY` | Google OAuth client "HamApps Discord verify" |
| `/cici/VERIFY_LINK_SECRET` | Random string that signs the verify links |
| `/cici/DISCORD_VERIFY_GO_LIVE` | Go-live date (not secret) |

Server, role and channel IDs, Cici's public key and the Google client ID are public and live in `sst.config.ts`.

## Deploy

```bash
aws login --profile hamapps
npm install
./deploy.sh
```

`deploy.sh` reads the Cloudflare values from Parameter Store, so nothing secret is saved on disk.

## Settings outside this repo

- Discord Developer Portal → Cici → General Information → **Interactions Endpoint URL** = `https://verify.hamapps.dev/interactions`. Bot → **Server Members Intent** on.
- Google Cloud → OAuth client "HamApps Discord verify" → redirect URI `https://verify.hamapps.dev/callback`.
- Discord Server Settings → Roles: Cici must stay above Officer, Member and the interest roles.
