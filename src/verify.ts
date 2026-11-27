// verify.hamapps.dev: everything Cici does when someone clicks something.
//
//   POST /interactions   Discord sends button/menu clicks here (Developer Portal > Cici >
//                        General Information > Interactions Endpoint URL). Checked with Cici's Public Key.
//        "verify" button     -> Cici privately sends that person a personal sign-in link (15 minutes)
//        "interests" menu    -> adds/removes the interest roles (and so the TEAMS channels)
//        "github" button     -> joining the HamAppsDev GitHub org (src/github.ts)
//        /commands           -> src/commands.ts (slow ones finish in src/followup.ts)
//   GET  /start?t=...    the personal link: sends the person to Google, Hamilton accounts only
//   GET  /callback       Google sends them back here. If it's a real @hamilton.edu account:
//                        gives the Member role, sets their server nickname to their real name,
//                        and Cici welcomes them in #general.
//   GET  /github/start, /github/callback   GitHub sign-in for joining the org (src/github.ts)
//
// Nothing about the person is stored. The Member role is the only record that they verified.

import { createHash, createPublicKey, randomBytes, verify as verifySig } from 'node:crypto'
import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda'
import { quick, type CommandInteraction } from './commands'
import { githubCallback, githubStart, joinButton } from './github'
import { cfg, discord, DiscordError, params, seal, unseal } from './shared'
import { esc, page, readCookie, redirect, type UrlEvent, type UrlResult } from './web'

const lambda = new LambdaClient({})

const LOGIN_DOMAIN = 'hamilton.edu'
const COOKIE = 'cici_verify'
const LINK_MINUTES = 15

export async function handler(event: UrlEvent): Promise<UrlResult> {
  const method = event.requestContext?.http?.method ?? 'GET'
  const path = event.rawPath.replace(/\/+$/, '') || '/'
  try {
    if (method === 'POST' && path === '/interactions') return await interactions(event)
    if (method === 'GET' && path === '/start') return await start(event)
    if (method === 'GET' && path === '/callback') return await callback(event)
    if (method === 'GET' && path === '/github/start') return await githubStart(event)
    if (method === 'GET' && path === '/github/callback') return await githubCallback(event)
    return redirect(cfg.joinUrl)
  } catch (err) {
    console.error('verify error', path, err instanceof Error ? err.message : err)
    const again = path.startsWith('/github') ? '<b>Join GitHub</b>' : '<b>Verify</b>'
    return page(500, 'Something went wrong', `<p>Cici tripped over a box. Please go back to Discord and click ${again} again. If it keeps happening, ask an officer.</p>`)
  }
}

// ======================================= Discord clicks =======================================

let publicKey: ReturnType<typeof createPublicKey> | undefined

function signatureOk(event: UrlEvent, rawBody: string): boolean {
  const sig = event.headers?.['x-signature-ed25519']
  const ts = event.headers?.['x-signature-timestamp']
  if (!sig || !ts) return false
  publicKey ??= createPublicKey({
    key: { kty: 'OKP', crv: 'Ed25519', x: Buffer.from(cfg.publicKey, 'hex').toString('base64url') },
    format: 'jwk',
  })
  try {
    return verifySig(null, Buffer.from(ts + rawBody), publicKey, Buffer.from(sig, 'hex'))
  } catch {
    return false
  }
}

interface Interaction {
  type: number
  data?: { custom_id?: string; values?: string[] }
  member?: { user: { id: string }; roles: string[] }
}

const json = (body: unknown): UrlResult => ({
  statusCode: 200,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})
/** A reply only the clicker can see. */
const privateReply = (content: string, components?: unknown[]) =>
  json({ type: 4, data: { content, flags: 64, components, allowed_mentions: { parse: [] } } })

async function interactions(event: UrlEvent): Promise<UrlResult> {
  const raw = event.isBase64Encoded ? Buffer.from(event.body ?? '', 'base64').toString() : (event.body ?? '')
  if (!signatureOk(event, raw)) return { statusCode: 401, body: 'invalid request signature' }
  const i = JSON.parse(raw) as Interaction
  if (i.type === 1) return json({ type: 1 }) // Discord's PING when the endpoint URL is saved
  if (i.type === 2 && i.member) {
    const cmd = i as unknown as CommandInteraction
    const { response, deferred } = quick(cmd)
    // Start the Followup Lambda in the background; it edits the "thinking" reply when done.
    if (deferred)
      await lambda.send(new InvokeCommand({ FunctionName: cfg.followupFunction, InvocationType: 'Event', Payload: Buffer.from(raw) }))
    return json(response)
  }
  if (i.type !== 3 || !i.member) return privateReply('Cici only understands her buttons in the HamApps server.')

  const userId = i.member.user.id
  const verified = i.member.roles.includes(cfg.memberRoleId)

  if (i.data?.custom_id === 'verify') {
    if (verified) return privateReply(`You're already verified ✅. Pick your interests in <#${cfg.rolesChannelId}>.`)
    const t = await seal({ u: userId, exp: Date.now() + LINK_MINUTES * 60_000 })
    return privateReply(
      `Hi! I'm Cici 📦🐱. Click below and sign in with your **@hamilton.edu** Google account. ` +
        `This link is just for you and works for ${LINK_MINUTES} minutes.`,
      [{ type: 1, components: [{ type: 2, style: 5, label: 'Sign in with Hamilton Google', url: `${cfg.baseUrl}/start?t=${t}` }] }],
    )
  }

  if (i.data?.custom_id === 'github') {
    const { content, components } = await joinButton(userId, i.member.roles)
    return privateReply(content, components)
  }

  if (i.data?.custom_id === 'interests') {
    if (!verified) return privateReply('Verify first in ✅・verify, then you can pick your interests here.')
    const all = Object.keys(cfg.interests)
    const picked = (i.data.values ?? []).filter((v) => all.includes(v))
    const add = picked.filter((r) => !i.member!.roles.includes(r))
    const remove = all.filter((r) => i.member!.roles.includes(r) && !picked.includes(r))
    const base = `/guilds/${cfg.guildId}/members/${userId}/roles/`
    await Promise.all([
      ...add.map((r) => discord('PUT', base + r, undefined, 'Picked in #roles')),
      ...remove.map((r) => discord('DELETE', base + r, undefined, 'Unpicked in #roles')),
    ])
    const now = picked.map(
      (r) =>
        `${cfg.interests[r].label} → <#${cfg.interests[r].channelId}>` +
        (r === cfg.devRoleId && cfg.joinGithubChannelId ? ` and <#${cfg.joinGithubChannelId}> (join our GitHub org)` : ''),
    )
    return privateReply(
      now.length
        ? `Saved! You'll now see:\n${now.join('\n')}\n\nWant to officially join a team? Talk to that team's lead.`
        : 'Saved. You have no interests picked right now; pick any time.',
    )
  }

  return privateReply("Hmm, I don't know that button.")
}

// ======================================= Google sign-in =======================================

interface Pending {
  u: string // Discord user id
  state: string
  nonce: string
  verifier: string
  exp: number
}

async function start(event: UrlEvent): Promise<UrlResult> {
  const link = await unseal<{ u: string; exp: number }>(event.queryStringParameters?.t)
  if (!link) {
    return page(400, 'That link expired', `<p>Personal links work for ${LINK_MINUTES} minutes. Go back to <b>✅・verify</b> in Discord and click <b>Verify</b> again.</p>`)
  }
  const p: Pending = {
    u: link.u,
    state: randomBytes(16).toString('base64url'),
    nonce: randomBytes(16).toString('base64url'),
    verifier: randomBytes(32).toString('base64url'),
    exp: Date.now() + 10 * 60_000,
  }
  const q = new URLSearchParams({
    client_id: cfg.googleClientId,
    redirect_uri: `${cfg.baseUrl}/callback`,
    response_type: 'code',
    scope: 'openid email profile',
    state: p.state,
    nonce: p.nonce,
    code_challenge: createHash('sha256').update(p.verifier).digest('base64url'),
    code_challenge_method: 'S256',
    hd: LOGIN_DOMAIN, // only makes Google offer Hamilton accounts; the real check is in callback()
    prompt: 'select_account',
  })
  return {
    statusCode: 302,
    headers: { Location: `https://accounts.google.com/o/oauth2/v2/auth?${q}`, 'Cache-Control': 'no-store' },
    cookies: [`${COOKIE}=${await seal(p)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`],
  }
}

interface IdToken {
  iss: string
  aud: string
  exp: number
  nonce?: string
  hd?: string
  email?: string
  email_verified?: boolean
  name?: string
  given_name?: string
  family_name?: string
}

async function callback(event: UrlEvent): Promise<UrlResult> {
  const clear = `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`
  const cookie = readCookie(event, COOKIE)
  const p = await unseal<Pending>(cookie)
  const qs = event.queryStringParameters ?? {}
  if (!p || !qs.code || qs.state !== p.state) {
    return page(400, 'Sign-in timed out', '<p>Go back to <b>✅・verify</b> in Discord and click <b>Verify</b> again.</p>', [clear])
  }

  // Exchange the code directly with Google over HTTPS. Per OpenID Connect, an ID token received this way
  // (straight from Google's token endpoint over TLS) doesn't need its signature checked separately.
  const { GOOGLE_OAUTH_CLIENT_SECRET_VERIFY: secret } = await params()
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code: qs.code,
      client_id: cfg.googleClientId,
      client_secret: secret,
      redirect_uri: `${cfg.baseUrl}/callback`,
      grant_type: 'authorization_code',
      code_verifier: p.verifier,
    }),
  })
  if (!res.ok) throw new Error(`Google token exchange failed: ${res.status}`)
  const { id_token } = (await res.json()) as { id_token?: string }
  const t = JSON.parse(Buffer.from((id_token ?? '').split('.')[1] ?? '', 'base64url').toString() || '{}') as IdToken

  const genuine =
    ['https://accounts.google.com', 'accounts.google.com'].includes(t.iss) &&
    t.aud === cfg.googleClientId &&
    t.exp * 1000 > Date.now() &&
    t.nonce === p.nonce
  if (!genuine) throw new Error('ID token failed checks')
  // hd is only present on accounts that belong to the Hamilton Google Workspace, so a personal
  // Gmail account can't pass this even if its address ends in hamilton.edu.
  if (t.hd !== LOGIN_DOMAIN || !t.email_verified) {
    return page(403, 'That isn’t a Hamilton account', `<p>You signed in as <b>${esc(t.email ?? 'an unknown account')}</b>. Please go back to Discord, click <b>Verify</b> again and choose your <b>@hamilton.edu</b> account.</p>`, [clear])
  }

  // Must still be in the server.
  const member = await discord<{ roles: string[] }>('GET', `/guilds/${cfg.guildId}/members/${p.u}`).catch((e) => {
    if (e instanceof DiscordError && e.status === 404) return null
    throw e
  })
  if (!member) {
    return page(404, 'Join the server first', `<p>Join the HamApps Discord from <a href="${cfg.joinUrl}">${cfg.joinUrl.replace('https://', '')}</a>, then click <b>Verify</b> in ✅・verify.</p>`, [clear])
  }

  const realName = (t.name || [t.given_name, t.family_name].filter(Boolean).join(' ') || t.email!.split('@')[0]).slice(0, 32)
  const firstTime = !member.roles.includes(cfg.memberRoleId)
  await discord('PUT', `/guilds/${cfg.guildId}/members/${p.u}/roles/${cfg.memberRoleId}`, undefined, 'Verified Hamilton account')
  // The server owner (and anyone above Cici) can't be renamed by a bot; that's fine.
  await discord('PATCH', `/guilds/${cfg.guildId}/members/${p.u}`, { nick: realName }, 'Real name from Hamilton account').catch((e) => {
    if (!(e instanceof DiscordError && e.status === 403)) throw e
  })
  if (firstTime) {
    await discord('POST', `/channels/${cfg.generalChannelId}/messages`, {
      content:
        `Welcome to HamApps, <@${p.u}>! 🎉📦\n` +
        `Pick your interests in <#${cfg.rolesChannelId}> to unlock team channels, ` +
        `and say hi right here: who you are, your class year, and what you'd like to build.`,
      allowed_mentions: { users: [p.u] },
    })
  }
  console.log('verified', p.u, firstTime ? 'first time' : 'again')

  const app = `discord://discord.com/channels/${cfg.guildId}/${cfg.rolesChannelId}`
  const web = `https://discord.com/channels/${cfg.guildId}/${cfg.rolesChannelId}`
  return page(200, `You're in, ${esc(realName.split(' ')[0])}!`, `<p>You're verified ✅ and your server name is now <b>${esc(realName)}</b>.</p>
    <p>Next, pick your interests in <b>🎭・roles</b>.</p>
    <p><a class="btn" href="${app}">Open Discord</a> <a class="btn ghost" href="${web}">Open in browser</a></p>`, [clear])
}
