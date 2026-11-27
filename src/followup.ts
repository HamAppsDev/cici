// Finishes slow /commands (status, menu, officers, idea, issue, request, ask, warn, dm, timeout, purge).
// src/verify.ts answers Discord within its 3-second limit ("Cici is thinking…") and starts this
// Lambda in the background with the interaction; this edits that reply with the real answer.

import { slow, type CommandInteraction } from './commands'

export async function handler(event: CommandInteraction) {
  await slow(event)
}
