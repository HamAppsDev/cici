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

New members join with the permanent invite (https://discord.gg/DgsvrQeJjr) and can only see ✅・verify (formerly #welcome), 📖・rules and the stat channels until they verify:

1. They click **Verify** in ✅・verify. Cici privately replies with a personal 15-minute link.
2. The link signs them in with Google. Only Hamilton accounts (`hd` = `hamilton.edu`) pass.
3. They get the **Member** role, their server nickname becomes their real name, and Cici welcomes them in #general. Nothing about them is stored.
4. In 🎭・roles, Cici's menu gives interest roles (💻 Development, 🎨 Design, 📋 Product, 📣 Marketing).

People who joined **before** go-live (`/cici/DISCORD_VERIFY_GO_LIVE`) are never kicked. Delete that parameter to stop all kicks.

### The EC2 instance

- No open ports and no SSH. For a shell: AWS Console → Systems Manager → **Session Manager** → `cici-live`.
- Logs: `journalctl -u cici -n 100` in that shell. Restart: `sudo systemctl restart cici`.
- Security updates install automatically every day. Node.js 24 is in `/usr/local`; the bot is in `/opt/cici/app`.
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
- Discord Server Settings → Roles: Cici must stay above Officer, Member and the interest roles.
