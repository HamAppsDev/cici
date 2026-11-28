// Officers can copy a /issue report from 🐛・issues to the app's GitHub Issues tab.
//
//   /issue posts in 🐛・issues with a "Send to GitHub" button (src/commands.ts)
//   an officer clicks it -> src/verify.ts checks the Officer role, says "thinking…" (Discord only waits 3 s)
//                           and hands the click to the Followup Lambda, which runs `sendIssueToGithub`
//   Cici creates the issue in that app's repo (label "bug"), swaps the button for a "View on GitHub" link,
//   posts the link in the thread (so the reporter hears about it) and logs it in #mod-log.
//
// The repos are public, so the GitHub issue never names the reporter or the officer: it says
// "a HamApps member" and links to the Discord thread (only server members can open it).
// Screenshots stay in Discord (GitHub's API can't attach images).
// Uses the GitHub App "HamApps Cici" (needs Repository > Issues: read and write, installed on the repos below).

import { modLog } from './commands'
import { gh, GitHubError, orgToken } from './github'
import { cfg, discord } from './shared'

/** Which repo each /issue app goes to (the app keys match the /issue choices). */
const REPOS: Record<string, string> = { scheduler: 'HamiltonScheduler', hameats: 'hameats', homepage: 'homepage', cici: 'cici' }
const BUTTON_PREFIX = 'gh_issue:'

export const isIssueButton = (customId?: string) => !!customId?.startsWith(BUTTON_PREFIX)

/** The button under each new /issue post. */
export const sendToGithubButton = (app: string) => ({
  type: 1,
  components: [{ type: 2, style: 2, label: 'Send to GitHub (officers)', emoji: { name: '🐙' }, custom_id: BUTTON_PREFIX + app }],
})

interface Embed {
  description?: string
  fields?: { name: string; value: string }[]
  image?: unknown
}
interface Message {
  id: string
  embeds: Embed[]
  components?: { components: { custom_id?: string }[] }[]
}
export interface ButtonInteraction {
  type: 3
  application_id: string
  token: string
  channel_id: string
  data: { custom_id: string }
  member: { user: { id: string }; roles: string[] }
  message: Message
}

/** Stops "@name" in a report from notifying a GitHub user, and "#12" from linking to another issue. */
const quiet = (s: string) => s.replace(/@/g, '@​').replace(/#(\d)/g, '#​$1')

export async function sendIssueToGithub(i: ButtonInteraction): Promise<void> {
  let content: string
  try {
    content = await send(i)
  } catch (e) {
    console.error('send to GitHub failed', e instanceof Error ? e.message : e)
    content =
      e instanceof GitHubError && [403, 404].includes(e.status)
        ? "GitHub said no. The HamApps Cici GitHub App needs **Issues: read and write** and access to this app's repo (an org owner sets that up)."
        : 'Cici tripped over a box 📦. Try again in a minute.'
  }
  await fetch(`https://discord.com/api/v10/webhooks/${i.application_id}/${i.token}/messages/@original`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content, allowed_mentions: { parse: [] } }),
  })
}

async function send(i: ButtonInteraction): Promise<string> {
  if (!i.member.roles.includes(cfg.officerRoleId)) return 'Only officers can send reports to GitHub.'
  const app = i.data.custom_id.slice(BUTTON_PREFIX.length)
  const repo = REPOS[app]
  if (!repo) return "I don't know which GitHub repo that app lives in."

  // Read the post again, so a second click (or a second officer) doesn't make a duplicate issue.
  const msg = await discord<Message>('GET', `/channels/${i.channel_id}/messages/${i.message.id}`)
  const stillUnsent = msg.components?.some((row) => row.components.some((c) => c.custom_id === i.data.custom_id))
  if (!stillUnsent) return 'This report was already sent to GitHub.'

  const embed = msg.embeds[0] ?? {}
  const problem = (embed.description ?? '').trim() || '(no description)'
  const steps = embed.fields?.find((f) => f.name === 'Steps to reproduce')?.value
  const thread = `https://discord.com/channels/${cfg.guildId}/${i.channel_id}`
  const oneLine = problem.replace(/\s+/g, ' ')
  const body = [
    quiet(problem),
    steps ? `\n### Steps to reproduce\n${quiet(steps)}` : '',
    '\n---',
    `Reported by a HamApps member on Discord ([see the thread](${thread}), HamApps server members only)` +
      (embed.image ? '. A screenshot is attached there.' : '.'),
  ].join('\n')

  const issue = await gh<{ number: number; html_url: string }>('POST', `/repos/${cfg.githubOrg}/${repo}/issues`, `Bearer ${await orgToken()}`, {
    title: quiet(oneLine.length > 90 ? oneLine.slice(0, 89) + '…' : oneLine),
    body,
    labels: ['bug'],
  })

  const link = { type: 1, components: [{ type: 2, style: 5, label: `View on GitHub (#${issue.number})`, emoji: { name: '🐙' }, url: issue.html_url }] }
  await discord('PATCH', `/channels/${i.channel_id}/messages/${msg.id}`, { components: [link] })
  await discord('POST', `/channels/${i.channel_id}/messages`, {
    content: `🐙 An officer sent this to GitHub: ${issue.html_url}`,
    allowed_mentions: { parse: [] },
  })
  await modLog('🐙 Issue sent to GitHub', `<@${i.member.user.id}> sent <#${i.channel_id}> to ${repo} #${issue.number}\n${issue.html_url}`, 0x6e5494)
  return `Sent! ${issue.html_url}`
}
