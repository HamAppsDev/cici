// Runs every hour (EventBridge Scheduler). Kicks people who joined the HamApps Discord AFTER go-live
// and still haven't verified (no Member role) KICK_AFTER_HOURS (48) hours later. Cici DMs them first
// with the join link so they can come back and verify.
//
// Never touches: bots, anyone with the Member role, or anyone who joined before go-live
// (/cici/DISCORD_VERIFY_GO_LIVE in Parameter Store). If that parameter is missing, it does nothing.
// Needs "Server Members Intent" ON in Developer Portal > Cici > Bot.

import { cfg, discord, params } from './shared'

interface Member {
  joined_at: string
  roles: string[]
  user: { id: string; bot?: boolean }
}

export async function handler() {
  const { DISCORD_VERIFY_GO_LIVE: goLiveRaw } = await params()
  const goLive = Date.parse(goLiveRaw)
  if (!goLiveRaw || Number.isNaN(goLive)) {
    console.log('DISCORD_VERIFY_GO_LIVE not set; nothing to do')
    return { kicked: 0 }
  }
  const cutoff = Date.now() - cfg.kickAfterHours * 3_600_000

  const members: Member[] = []
  for (let after = '0'; ; ) {
    const page = await discord<Member[]>('GET', `/guilds/${cfg.guildId}/members?limit=1000&after=${after}`)
    members.push(...page)
    if (page.length < 1000) break
    after = page[page.length - 1].user.id
  }

  const overdue = members.filter((m) => {
    const joined = Date.parse(m.joined_at)
    return !m.user.bot && !m.roles.includes(cfg.memberRoleId) && joined >= goLive && joined < cutoff
  })

  let kicked = 0
  for (const m of overdue) {
    try {
      const dm = await discord<{ id: string }>('POST', '/users/@me/channels', { recipient_id: m.user.id })
      await discord('POST', `/channels/${dm.id}/messages`, {
        content:
          `Hi, it's Cici from HamApps 📦🐱. You were removed from the HamApps Discord because your Hamilton ` +
          `account wasn't verified within ${cfg.kickAfterHours} hours. You're welcome back any time: ` +
          `${cfg.joinUrl}, then click **Verify** in ✅・verify.`,
      })
    } catch {
      // DMs closed; kick anyway.
    }
    try {
      await discord('DELETE', `/guilds/${cfg.guildId}/members/${m.user.id}`, undefined, `Not verified within ${cfg.kickAfterHours} hours`)
      kicked++
      console.log('kicked', m.user.id)
    } catch (e) {
      console.error('kick failed', m.user.id, e instanceof Error ? e.message : e)
    }
  }
  console.log(`checked ${members.length} members, kicked ${kicked}`)
  return { kicked }
}
