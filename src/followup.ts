// Finishes slow /commands (status, menu, officers, idea, issue, request, ask, warn, dm, timeout, purge)
// and the officers' "Send to GitHub" button on /issue posts (src/github-issues.ts).
// src/verify.ts answers Discord within its 3-second limit ("Cici is thinking…") and starts this
// Lambda in the background with the interaction; this edits that reply with the real answer.

import { slow, type CommandInteraction } from './commands'
import { sendIssueToGithub, type ButtonInteraction } from './github-issues'

export async function handler(event: CommandInteraction | ButtonInteraction) {
  if (event.type === 3) await sendIssueToGithub(event)
  else await slow(event)
}
