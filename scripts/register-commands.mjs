// Registers Cici's /commands (src/commands.json) in the HamApps server. Run by ./deploy.sh.
// Server-only commands show up instantly. Commands removed from the file are removed from Discord.
import { readFileSync } from 'node:fs'

const APP_ID = '1575711069706526720' // Cici
const GUILD_ID = '1454213555321704727' // HamApps
const commands = JSON.parse(readFileSync(new URL('../src/commands.json', import.meta.url)))
const res = await fetch(`https://discord.com/api/v10/applications/${APP_ID}/guilds/${GUILD_ID}/commands`, {
  method: 'PUT',
  headers: { Authorization: `Bot ${process.env.DISCORD_TOKEN}`, 'Content-Type': 'application/json', 'User-Agent': 'DiscordBot (https://hamapps.dev, 1.0)' },
  body: JSON.stringify(commands),
})
if (!res.ok) {
  console.error('register commands failed', res.status, (await res.text()).slice(0, 500))
  process.exit(1)
}
console.log(`registered ${(await res.json()).length} commands: ${commands.map((c) => '/' + c.name).join(' ')}`)
