# Cici's commands and features

Type `/` in any channel to see these in Discord. The same list is pinned in #help, and `/help` shows it too.
Commands are defined in `src/commands.json` and handled in `src/commands.ts`.

## Everyone (after verifying)

| Command | What it does |
| --- | --- |
| `/help` | Lists everything Cici can do (works before verifying too) |
| `/links` | HamApps website, HamEats, Scheduler, GitHub, the invite (works before verifying too) |
| `/officers` | Who the officers are |
| `/status` | Whether hamapps.dev, the Scheduler, HamEats and Cici's verify page are up |
| `/menu [hall] [meal]` | Today's dining menu (Commons or McEwen), from the same source as HamEats. Defaults to the next meal |
| `/poll question option1 option2 … [hours] [multiple]` | A Discord poll with up to 5 answers, open 1 to 168 hours (default 24) |
| `/idea idea` | Posts your app idea in #ideas with 👍/👎 for voting |
| **@Cici** *message* | Cici answers in character with AI (Claude). 20 questions per person per day |
| Join **🎵 Lofi Lounge** | Cici joins and plays music while anyone is there (needs `/cici/LOFI_STREAM_URL`, see README) |

## Officers only

Discord hides these from people without the matching permission. Everything is logged in #mod-log.

| Command | What it does |
| --- | --- |
| `/warn member reason` | DMs the member a warning from Cici |
| `/timeout member minutes reason` | Mutes the member for 1 minute to 7 days |
| `/purge count` | Deletes the last 1 to 100 messages in the channel (Discord only allows messages under 14 days old) |

## Automatic (no command)

| When | What Cici does |
| --- | --- |
| Someone joins | Greets them in #welcome and points at **Verify**. Warns officers in #mod-log if the account is under 7 days old |
| 5 or more joins in 2 minutes | Raid alert: pauses invites for 2 hours and pings Officers in #mod-log |
| 24 hours without verifying | Friendly reminder DM |
| 48 hours without verifying | Removed, with a DM containing the invite (only people who joined after go-live) |
| Someone verifies | Member role, real-name nickname, welcome in #general, tour DM, greeting in #welcome cleaned up |
| A member leaves | Notice in #leadership |
| Messages deleted or edited, kicks, bans, role changes | Logged in #mod-log |
| A scheduled Discord event is 1 hour away | Reminder in #events |
| Always | Online, with a rotating status |

## Discord's own protections (AutoMod, set up in Server Settings → AutoMod)

These run even if Cici is offline; hits are reported in #mod-log.

- **Slurs & sexual content**: blocked.
- **Mention spam**: 5 or more mentions is blocked, with a 10-minute timeout; raid protection on.
- **Spam**: blocked.
- **Other server invites**: blocked, except our own invite and Officers.
- **Scams** (fake Nitro, fake Steam and similar): blocked, with a 1-hour timeout.

Server settings: verification level Medium, explicit-image filter for everyone, and only Officers can create invites or ping @everyone.
