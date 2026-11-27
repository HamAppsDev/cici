// One-off (safe to re-run): Cici's two messages for joining the GitHub org.
//   1. Edits the 🎭・roles menu so 💻 Development says it unlocks 🐙・join-github.
//   2. Posts the Join GitHub button in 🐙・join-github (or edits it if Cici already posted it).
// Run as Cici (only the bot that posted a message can edit it):
//   DISCORD_TOKEN="$(aws ssm get-parameter --profile hamapps --region us-east-2 --name /cici/DISCORD_MASCOT_BOT_TOKEN \
//     --with-decryption --query Parameter.Value --output text)" JOIN_GITHUB_CHANNEL_ID=... node scripts/github-onboarding-messages.mjs
// The "github" button is handled by src/github.ts. The previous roles menu is backed up in
// ~/Documents/HamApps/discord-backups/roles-menu-message-2026-11-27.json.

const ROLES_CHANNEL = '1575709072731410554'
const ROLES_MESSAGE = '1575748038100652065' // the "🎯 Pick your interests" menu
const JOIN_CHANNEL = process.env.JOIN_GITHUB_CHANNEL_ID
const DEV_TEXT = 'Build our apps. Also unlocks 🐙・join-github, where you can join the HamAppsDev GitHub org.'
if (!process.env.DISCORD_TOKEN || !JOIN_CHANNEL) throw new Error('Set DISCORD_TOKEN (Cici) and JOIN_GITHUB_CHANNEL_ID.')

async function api(method, path, body) {
  const res = await fetch(`https://discord.com/api/v10${path}`, {
    method,
    headers: { Authorization: `Bot ${process.env.DISCORD_TOKEN}`, 'Content-Type': 'application/json', 'User-Agent': 'DiscordBot (https://hamapps.dev, 1.0)' },
    body: body && JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${(await res.text()).slice(0, 300)}`)
  return res.json()
}

// 1. The roles menu: same message, new Development line and option description.
const menu = await api('GET', `/channels/${ROLES_CHANNEL}/messages/${ROLES_MESSAGE}`)
const embed = menu.embeds[0]
embed.description = embed.description.replace(/^💻 \*\*Development:\*\*.*$/m, `💻 **Development:** ${DEV_TEXT}`)
const select = menu.components[0].components[0]
for (const o of select.options) if (o.value === '1575709056142807151') o.description = DEV_TEXT
await api('PATCH', `/channels/${ROLES_CHANNEL}/messages/${ROLES_MESSAGE}`, {
  embeds: [{ title: embed.title, description: embed.description, color: embed.color }],
  components: [{ type: 1, components: [{ type: 3, custom_id: select.custom_id, placeholder: select.placeholder, min_values: select.min_values, max_values: select.max_values, options: select.options }] }],
})
console.log('roles menu updated')

// 2. The Join GitHub message.
const me = await api('GET', '/users/@me')
const join = {
  embeds: [{ color: 0x24292f, title: 'Join HamAppsDev on GitHub 🐙', description: "Click below and sign in with GitHub. I'll add you to the org. Nothing about you is stored." }],
  components: [{ type: 1, components: [{ type: 2, style: 1, custom_id: 'github', label: 'Join GitHub', emoji: { name: '🐙' } }] }],
}
const existing = (await api('GET', `/channels/${JOIN_CHANNEL}/messages?limit=50`)).find(
  (m) => m.author.id === me.id && m.components?.[0]?.components?.some((c) => c.custom_id === 'github'),
)
if (existing) await api('PATCH', `/channels/${JOIN_CHANNEL}/messages/${existing.id}`, join)
else await api('POST', `/channels/${JOIN_CHANNEL}/messages`, join)
console.log(existing ? 'join message updated' : 'join message posted')
