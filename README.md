# Cici: the HamApps Discord bot

Cici, the club's box-cat mascot, runs the HamApps Discord: she verifies new members, answers commands and questions, keeps a mod log and plays music. **The full list of commands and features is in [COMMANDS.md](COMMANDS.md).**

## How it's built

Cici has two halves on AWS (us-east-2). If the always-on half goes down, verification and commands keep working.

| Part | Where | What it does |
| --- | --- | --- |
| `src/verify.ts` | Lambda at https://verify.hamapps.dev | The **Verify** button, Hamilton Google sign-in, the interest menu, and all `/commands` (Discord sends every click and command here) |
| `src/commands.ts`, `src/commands.json` | same Lambda | The `/commands`. Slow ones reply "thinking…" and are finished by the **Followup** Lambda (`src/followup.ts`) |
| `src/cleanup.ts` | Lambda, every hour | Kicks people who joined after go-live and haven't verified in 48 hours |
| `bot/index.mjs` | EC2 instance `cici-live` (t4g.nano, always on) | Online status, live stat channels, greetings, 24-hour reminder, tour DM, mod log, raid alert, @Cici AI replies (Claude), event reminders, Lofi Lounge |

### Verification

New members join with the permanent invite (https://discord.gg/7edtbs8pua) and can only see ✅・verify (formerly #welcome), 📖・rules and the stat channels until they verify:

1. They click **Verify** in ✅・verify. Cici privately replies with a personal 15-minute link.
2. The link signs them in with Google. Only Hamilton accounts (`hd` = `hamilton.edu`) pass.
3. They get the **Member** role, their server nickname becomes their real name, and Cici welcomes them in #general. Nothing about them is stored.
4. In 🎭・roles, Cici's menu gives interest roles (💻 Development, 🎨 Design, 📋 Product, 📣 Marketing).

### Joining the GitHub org

Members with **💻 Development** see 🐙・join-github (in ➤ Start Here). Code: `src/github.ts`.

1. They click **Join GitHub**. Cici checks they have Member and Development, then privately replies with a personal 15-minute link.
2. The link signs them in with GitHub, so Cici learns their GitHub username without anyone typing it.
3. Cici checks their Discord roles again, invites them to **HamAppsDev** as a plain member, and tries to accept the invite for them. If GitHub doesn't allow that, they get a button to https://github.com/orgs/HamAppsDev/invitation.
4. The invite is logged in #mod-log, and their GitHub sign-in is thrown away. Nothing about them is stored.

People already in the org (including owners) are never touched: GitHub's invite call would change their role, so Cici checks first. GitHub allows about 50 invites a day; after that Cici asks people to try tomorrow. Removing someone's Development role does **not** remove them from the org; do that on GitHub.

The new-member base permission in the org is **Read**, so members can't push to any repo until they're given more.

People who joined **before** go-live (`/cici/DISCORD_VERIFY_GO_LIVE`) are never kicked. Delete that parameter to stop all kicks.

### The EC2 instance

- No open ports and no SSH. For a shell: AWS Console → Systems Manager → **Session Manager** → `cici-live`.
- Logs: `journalctl -u cici -n 100` in that shell. Restart: `sudo systemctl restart cici`.
- Security updates install automatically every day. Node.js 24 is in `/usr/local`; the bot is in `/opt/cici/app`.
- Bot updates (`/usr/local/bin/cici-update`, run by `./deploy.sh`) download and build in `/opt/cici/build` and delete it afterwards. Not in `/tmp`: there it's a 208 MB slice of memory, and the old script filled it up (fixed 2026-11-27; the live instance has the same script, old one saved as `cici-update.bak-2026-11-27`).
- Cost: about $7 a month (server, disk and public IP address).

## Secrets

All secrets are in AWS Parameter Store (us-east-2) as encrypted SecureStrings. Never commit them.

| Parameter | What |
| --- | --- |
| `/cici/DISCORD_MASCOT_BOT_TOKEN` | Cici's bot token (Developer Portal → Cici → Bot → Reset Token) |
| `/cici/GOOGLE_OAUTH_CLIENT_SECRET_VERIFY` | Google OAuth client "HamApps Discord verify" |
| `/cici/VERIFY_LINK_SECRET` | Random string that signs the verify links |
| `/cici/ANTHROPIC_API_KEY` | Claude API key for @Cici replies (console.anthropic.com) |
| `/cici/DISCORD_VERIFY_GO_LIVE` | Go-live date (not secret) |
| `/cici/GITHUB_APP_CLIENT_SECRET` | GitHub App "Cici" → Client secrets (only the Verify Lambda can read it) |
| `/cici/GITHUB_APP_PRIVATE_KEY` | GitHub App "Cici" → Private keys, the whole `.pem` text (only the Verify Lambda can read it) |
| `/cici/LOFI_STREAM_URL` | Music stream for Lofi Lounge (not secret; optional). Use only a stream you have the rights to share |

Server, role and channel IDs, Cici's public key and the Google client ID are public and live in `sst.config.ts` and `bot/index.mjs`.

After changing a secret, restart the EC2 bot (`sudo systemctl restart cici`); the Lambdas pick it up within about 15 minutes.

## Deploy

```bash
aws login --profile hamapps
npm install
(cd bot && npm install)
./deploy.sh
```

`deploy.sh` deploys the Lambdas and the instance, registers the `/commands` with Discord, and installs the new bot code on the instance. It reads every secret it needs from Parameter Store, so nothing secret is saved on disk.

## Settings outside this repo

- Discord Developer Portal → Cici → General Information → **Interactions Endpoint URL** = `https://verify.hamapps.dev/interactions`. Bot → **Server Members Intent**, **Message Content Intent** and **Presence Intent** on.
- Google Cloud → OAuth client "HamApps Discord verify" → redirect URI `https://verify.hamapps.dev/callback`.
- GitHub → HamAppsDev → Settings → Developer settings → GitHub Apps → **Cici**: only permission Organization → Members (read and write), installed on HamAppsDev only, callback URL `https://verify.hamapps.dev/github/callback`, webhook off. Its client ID is `GITHUB_APP_CLIENT_ID` in `sst.config.ts`.
- Discord Server Settings → Roles: Cici must stay above Officer, Member and the interest roles.
