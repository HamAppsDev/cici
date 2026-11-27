// Cici's /commands. Discord sends every slash command to verify.hamapps.dev/interactions (src/verify.ts),
// which calls `quick()`. Quick ones answer right away. Slow ones (they call other websites) answer
// "Cici is thinking…" and are finished by the Followup Lambda (src/followup.ts) calling `slow()`.
// The list of commands Discord shows is src/commands.json (registered by scripts/register-commands.mjs).

import { cfg, discord } from './shared'

export interface CommandInteraction {
  type: 2
  id: string
  application_id: string
  token: string
  channel_id: string
  data: {
    name: string
    options?: { name: string; value: string | number | boolean }[]
    resolved?: { users?: Record<string, { id: string; username: string; global_name?: string }> }
  }
  member: { user: { id: string; username: string; global_name?: string }; roles: string[]; nick?: string }
}

const opt = <T = string>(i: CommandInteraction, name: string) =>
  i.data.options?.find((o) => o.name === name)?.value as T | undefined
const who = (i: CommandInteraction) => i.member.nick || i.member.user.global_name || i.member.user.username

const GOLD = 0xe3c06f
const NAVY = 0x102e64
const reply = (data: object, ephemeral = false) => ({ type: 4, data: { allowed_mentions: { parse: [] }, ...data, ...(ephemeral ? { flags: 64 } : {}) } })
const SLOW = new Set(['status', 'menu', 'officers', 'idea', 'warn', 'dm', 'timeout', 'purge'])
const PRIVATE = new Set(['officers', 'idea', 'warn', 'dm', 'timeout', 'purge'])

export const LINKS = [
  ['🌐 hamapps.dev', 'https://hamapps.dev'],
  ['🍽️ HamEats', 'https://hameats.app'],
  ['📅 Hamilton Scheduler', 'https://scheduler.hamapps.dev'],
  ['💻 GitHub', 'https://github.com/HamAppsDev'],
  ['📨 Discord invite', 'https://discord.gg/DgsvrQeJjr'],
]

export const HELP = [
  '**Everyone**',
  '`/help` this list · `/links` our apps and links · `/officers` who to ask',
  '`/status` are our apps up? · `/menu` today\'s dining menu',
  '`/poll` quick poll · `/idea` pitch an app idea in #ideas',
  '**@Cici** ask me anything about HamApps (20 a day each)',
  '🎵 join **Lofi Lounge** and I\'ll play music',
  '',
  '**Officers**',
  '`/warn` · `/dm` · `/timeout` · `/purge` (all logged in #mod-log)',
].join('\n')

/** Answer now, or return the "thinking" reply for slow commands (then the Followup Lambda runs `slow`). */
export function quick(i: CommandInteraction): { response: object; deferred: boolean } {
  const name = i.data.name
  const verified = i.member.roles.includes(cfg.memberRoleId)
  if (!verified && !['help', 'links'].includes(name))
    return { response: reply({ content: 'Verify first in #welcome, then I can help with that! 📦' }, true), deferred: false }

  if (name === 'help')
    return { response: reply({ embeds: [{ color: GOLD, title: '📦🐱 What Cici can do', description: HELP }] }, true), deferred: false }
  if (name === 'links')
    return {
      response: reply({ embeds: [{ color: NAVY, title: 'HamApps links', description: LINKS.map(([l, u]) => `${l}: ${u}`).join('\n') }] }),
      deferred: false,
    }
  if (name === 'poll') {
    const answers = ['option1', 'option2', 'option3', 'option4', 'option5']
      .map((n) => opt(i, n))
      .filter((a): a is string => !!a)
      .map((text) => ({ poll_media: { text } }))
    return {
      response: reply({
        content: `📊 Poll by ${who(i)}`,
        poll: {
          question: { text: opt(i, 'question')! },
          answers,
          duration: opt<number>(i, 'hours') ?? 24,
          allow_multiselect: opt<boolean>(i, 'multiple') ?? false,
        },
      }),
      deferred: false,
    }
  }
  if (SLOW.has(name)) return { response: { type: 5, data: PRIVATE.has(name) ? { flags: 64 } : {} }, deferred: true }
  return { response: reply({ content: "I don't know that command yet." }, true), deferred: false }
}

/** Finish a slow command by editing the "thinking" reply. */
export async function slow(i: CommandInteraction): Promise<void> {
  let data: object
  try {
    data = await run(i)
  } catch (e) {
    console.error('command failed', i.data.name, e instanceof Error ? e.message : e)
    data = { content: 'Cici tripped over a box 📦. Try again in a minute.' }
  }
  await fetch(`https://discord.com/api/v10/webhooks/${i.application_id}/${i.token}/messages/@original`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ allowed_mentions: { parse: [] }, ...data }),
  })
}

async function run(i: CommandInteraction): Promise<object> {
  switch (i.data.name) {
    case 'status':
      return status()
    case 'menu':
      return menu(opt(i, 'hall') ?? 'soper-commons', opt(i, 'meal'))
    case 'officers':
      return officers()
    case 'idea':
      return idea(i)
    case 'warn':
      return warn(i)
    case 'dm':
      return dm(i)
    case 'timeout':
      return timeout(i)
    case 'purge':
      return purge(i)
  }
  return { content: "I don't know that command yet." }
}

// ---------- /status ----------
async function status() {
  const sites = [
    ['hamapps.dev', 'https://hamapps.dev'],
    ['Hamilton Scheduler', 'https://scheduler.hamapps.dev'],
    ['HamEats', 'https://hameats.app'],
    ['Cici verify', 'https://verify.hamapps.dev/interactions'],
  ]
  const lines = await Promise.all(
    sites.map(async ([name, url]) => {
      const t = Date.now()
      try {
        const res = await fetch(url, { method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(8000) })
        const up = res.status < 500
        return `${up ? '🟢' : '🔴'} **${name}** ${up ? `up (${Date.now() - t} ms)` : `error ${res.status}`}`
      } catch {
        return `🔴 **${name}** not responding`
      }
    }),
  )
  return { embeds: [{ color: NAVY, title: 'HamApps status', description: lines.join('\n') }] }
}

// ---------- /menu (same source as HamEats) ----------
const HALLS: Record<string, string> = { 'soper-commons': 'Soper Commons', mcewen: 'McEwen' }
type NutrisliceWeek = { days?: { date?: string; menu_items?: { is_station_header?: boolean; text?: string; food?: { name?: string } | null }[] }[] }

function campusNow() {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' })
      .formatToParts(new Date())
      .map((x) => [x.type, x.value]),
  )
  return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) }
}

async function menu(hall: string, mealOpt?: string) {
  const { date, hour } = campusNow()
  const meal = mealOpt ?? (hour < 10 ? 'breakfast' : hour < 14 ? 'lunch' : 'dinner')
  const [y, m, d] = date.split('-').map(Number)
  const url = `https://hamiltoncollege.api.nutrislice.com/menu/api/weeks/school/${hall}/menu-type/${meal}/${y}/${m}/${d}`
  const res = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(10000) })
  const week = res.ok ? ((await res.json()) as NutrisliceWeek) : {}
  const items = week.days?.find((x) => x.date === date)?.menu_items ?? []
  const stations: [string, string[]][] = []
  for (const it of items) {
    if (it.is_station_header) stations.push([it.text?.trim() || 'Other', []])
    else if (it.food?.name) {
      if (!stations.length) stations.push(['Menu', []])
      stations[stations.length - 1][1].push(it.food.name.trim())
    }
  }
  const fields = stations
    .filter(([, f]) => f.length)
    .slice(0, 12)
    .map(([name, foods]) => ({ name: name.slice(0, 256), value: foods.slice(0, 8).map((f) => `• ${f}`).join('\n').slice(0, 1024), inline: true }))
  const title = `${HALLS[hall] ?? hall}: ${meal[0].toUpperCase()}${meal.slice(1)}, ${date}`
  if (!fields.length)
    return { embeds: [{ color: GOLD, title, description: 'No menu posted for this meal. Check https://hameats.app for other halls and days.' }] }
  return { embeds: [{ color: GOLD, title: `🍽️ ${title}`, fields, footer: { text: 'From HamEats · full menu and nutrition at hameats.app' } }] }
}

// ---------- /officers ----------
async function officers() {
  const members = await discord<{ user: { id: string; bot?: boolean }; roles: string[] }[]>('GET', `/guilds/${cfg.guildId}/members?limit=1000`)
  const list = members.filter((m) => !m.user.bot && m.roles.includes(cfg.officerRoleId)).map((m) => `• <@${m.user.id}>`)
  return {
    embeds: [{ color: NAVY, title: 'HamApps officers', description: (list.join('\n') || 'None listed yet.') + '\n\nMessage any of them, or ask in #help.' }],
  }
}

// ---------- /idea ----------
async function idea(i: CommandInteraction) {
  const msg = await discord<{ id: string }>('POST', `/channels/${cfg.ideasChannelId}/messages`, {
    embeds: [{ color: GOLD, title: '💡 New app idea', description: opt(i, 'idea'), footer: { text: `Pitched by ${who(i)} · vote below` } }],
    allowed_mentions: { parse: [] },
  })
  for (const e of ['👍', '👎']) await discord('PUT', `/channels/${cfg.ideasChannelId}/messages/${msg.id}/reactions/${encodeURIComponent(e)}/@me`)
  return { content: `Posted in <#${cfg.ideasChannelId}>! 💡` }
}

// ---------- Officer tools ----------
export async function modLog(title: string, description: string, color = 0xd9534f) {
  await discord('POST', `/channels/${cfg.modLogChannelId}/messages`, {
    embeds: [{ color, title, description: description.slice(0, 4000), timestamp: new Date().toISOString() }],
    allowed_mentions: { parse: [] },
  })
}

async function warn(i: CommandInteraction) {
  const target = opt(i, 'member')!
  const reason = opt(i, 'reason')!
  let dm = 'and DMed them'
  try {
    const ch = await discord<{ id: string }>('POST', '/users/@me/channels', { recipient_id: target })
    await discord('POST', `/channels/${ch.id}/messages`, {
      content: `Hi, it's Cici from HamApps 📦. An officer asked me to pass along a warning:\n> ${reason}\nPlease keep the server friendly. Questions? Message an officer.`,
    })
  } catch {
    dm = "but their DMs are closed, so they weren't told"
  }
  await modLog('⚠️ Warning', `<@${target}> was warned by <@${i.member.user.id}>\n**Reason:** ${reason}`, 0xf0ad4e)
  return { content: `Warned <@${target}> ${dm}. Logged in <#${cfg.modLogChannelId}>.` }
}

async function dm(i: CommandInteraction) {
  // Discord already hides /dm from non-officers; check the role too in case server settings change.
  if (!i.member.roles.includes(cfg.officerRoleId)) return { content: 'Only officers can use /dm.' }
  const target = opt(i, 'member')!
  const message = opt(i, 'message')!
  if (target === i.member.user.id) return { content: "That's you! Pick someone else 📦" }
  try {
    const ch = await discord<{ id: string }>('POST', '/users/@me/channels', { recipient_id: target })
    await discord('POST', `/channels/${ch.id}/messages`, {
      content: `Hi, it's Cici from HamApps 📦. **${who(i)}** (an officer) asked me to send you this:\n\n${message}\n\n-# Reply to ${who(i)} directly or ask in #help. I can't read replies here.`,
      allowed_mentions: { parse: [] },
    })
  } catch {
    await modLog('✉️ DM not delivered', `<@${i.member.user.id}> tried to DM <@${target}> (their DMs are closed)\n**Message:** ${message}`, 0x5bc0de)
    return { content: `Couldn't DM <@${target}>: their DMs are closed or they share no server with me. Try pinging them in a channel instead.` }
  }
  await modLog('✉️ DM sent', `<@${i.member.user.id}> sent <@${target}> a message through Cici\n**Message:** ${message}`, 0x5bc0de)
  return { content: `Sent to <@${target}>. Logged in <#${cfg.modLogChannelId}>.` }
}

async function timeout(i: CommandInteraction) {
  const target = opt(i, 'member')!
  const minutes = opt<number>(i, 'minutes')!
  const reason = opt(i, 'reason')!
  const until = new Date(Date.now() + minutes * 60_000).toISOString()
  await discord('PATCH', `/guilds/${cfg.guildId}/members/${target}`, { communication_disabled_until: until }, `By ${who(i)}: ${reason}`)
  await modLog('⏸️ Timeout', `<@${target}> timed out for ${minutes} min by <@${i.member.user.id}>\n**Reason:** ${reason}`, 0xf0ad4e)
  return { content: `<@${target}> is timed out for ${minutes} minutes.` }
}

async function purge(i: CommandInteraction) {
  const count = opt<number>(i, 'count')!
  const msgs = await discord<{ id: string; timestamp: string }[]>('GET', `/channels/${i.channel_id}/messages?limit=${count}`)
  const fresh = msgs.filter((m) => Date.now() - Date.parse(m.timestamp) < 13.9 * 86_400_000).map((m) => m.id)
  if (fresh.length >= 2) await discord('POST', `/channels/${i.channel_id}/messages/bulk-delete`, { messages: fresh }, `Purge by ${who(i)}`)
  else if (fresh.length === 1) await discord('DELETE', `/channels/${i.channel_id}/messages/${fresh[0]}`, undefined, `Purge by ${who(i)}`)
  await modLog('🧹 Purge', `<@${i.member.user.id}> deleted ${fresh.length} messages in <#${i.channel_id}>`, 0x5bc0de)
  const old = msgs.length - fresh.length
  return { content: `Deleted ${fresh.length} messages.${old ? ` ${old} were older than 14 days, which Discord doesn't allow bots to bulk-delete.` : ''}` }
}
