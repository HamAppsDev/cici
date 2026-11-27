// Joining the HamAppsDev GitHub org from Discord (🐙・join-github, visible only to the Development role).
//
//   "github" button        -> checks Member + Development, then privately sends a personal 15-minute link
//   GET /github/start?t=   -> sends the person to GitHub to sign in (so nobody types a username)
//   GET /github/callback   -> GitHub sends them back. Cici checks their Discord roles again, invites their
//                             GitHub account to the org as a plain member, tries to accept the invite for
//                             them, logs it in #mod-log, and throws away their GitHub sign-in.
//
// Uses the GitHub App "Cici" owned by HamAppsDev, whose only permission is Organization > Members (read and
// write). Its secrets are in Parameter Store (us-east-2), never in this repo:
//   /cici/GITHUB_APP_CLIENT_SECRET   App settings > Client secrets
//   /cici/GITHUB_APP_PRIVATE_KEY     App settings > Private keys (the whole .pem text)
// The client ID is public and lives in sst.config.ts.
//
// Nothing about the person is stored. Their GitHub sign-in is revoked as soon as the invite is done.

import { createHash, createSign, randomBytes } from 'node:crypto'
import { GetParametersCommand, SSMClient } from '@aws-sdk/client-ssm'
import { modLog } from './commands'
import { cfg, discord, DiscordError, seal, unseal } from './shared'
import { esc, page, readCookie, type UrlEvent, type UrlResult } from './web'

const COOKIE = 'cici_github'
const LINK_MINUTES = 15
const GH = 'https://api.github.com'
const ORG = () => cfg.githubOrg
const INVITATION_URL = () => `https://github.com/orgs/${ORG()}/invitation`

// ---------- Secrets (only this feature reads them) ----------
const ssm = new SSMClient({})
let secrets: { clientSecret: string; privateKey: string } | undefined
async function githubSecrets() {
  if (secrets) return secrets
  const res = await ssm.send(
    new GetParametersCommand({ Names: ['/cici/GITHUB_APP_CLIENT_SECRET', '/cici/GITHUB_APP_PRIVATE_KEY'], WithDecryption: true }),
  )
  const get = (n: string) => res.Parameters?.find((p) => p.Name === `/cici/${n}`)?.Value ?? ''
  secrets = { clientSecret: get('GITHUB_APP_CLIENT_SECRET'), privateKey: get('GITHUB_APP_PRIVATE_KEY') }
  return secrets
}

// ---------- GitHub REST ----------
class GitHubError extends Error {
  constructor(public status: number, public body: string) {
    super(`GitHub ${status}: ${body.slice(0, 200)}`)
  }
}

async function gh<T = unknown>(method: string, path: string, auth: string, body?: unknown): Promise<T> {
  const res = await fetch(GH + path, {
    method,
    headers: {
      Authorization: auth,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'HamApps-Cici',
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(8000),
  })
  const text = await res.text()
  if (!res.ok) throw new GitHubError(res.status, text)
  return (text ? JSON.parse(text) : undefined) as T
}

/** A 9-minute token that proves "this is the Cici GitHub App" (signed with the app's private key). */
function appJwt(privateKey: string): string {
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url')
  const now = Math.floor(Date.now() / 1000)
  const unsigned = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({ iat: now - 60, exp: now + 540, iss: cfg.githubClientId })}`
  return `${unsigned}.${createSign('RSA-SHA256').update(unsigned).sign(privateKey, 'base64url')}`
}

let install: { token: string; until: number } | undefined
/** The app's token for the HamAppsDev org (lasts an hour; reused until 5 minutes before it expires). */
async function orgToken(): Promise<string> {
  if (install && install.until > Date.now()) return install.token
  const jwt = `Bearer ${appJwt((await githubSecrets()).privateKey)}`
  const { id } = await gh<{ id: number }>('GET', `/orgs/${ORG()}/installation`, jwt)
  const t = await gh<{ token: string; expires_at: string }>('POST', `/app/installations/${id}/access_tokens`, jwt)
  install = { token: t.token, until: Date.parse(t.expires_at) - 5 * 60_000 }
  return t.token
}

// ======================================= The button =======================================

type Reply = { content: string; components?: unknown[] }

/** What Cici privately says when someone clicks Join GitHub. */
export async function joinButton(userId: string, roles: string[]): Promise<Reply> {
  if (!roles.includes(cfg.memberRoleId)) return { content: 'Verify first in ✅・verify, then come back here. 📦' }
  if (!roles.includes(cfg.devRoleId))
    return { content: `Pick **💻 Development** in <#${cfg.rolesChannelId}> first, then click Join GitHub again.` }
  if (!cfg.githubClientId) return { content: "GitHub joining isn't switched on yet. Ask an officer! 📦" }
  const t = await seal({ u: userId, k: 'gh', exp: Date.now() + LINK_MINUTES * 60_000 })
  return {
    content:
      `Click below and sign in with **GitHub**. I'll add you to **${ORG()}**. ` +
      `This link is just for you and works for ${LINK_MINUTES} minutes. Nothing about you is stored.`,
    components: [{ type: 1, components: [{ type: 2, style: 5, label: 'Sign in with GitHub', url: `${cfg.baseUrl}/github/start?t=${t}` }] }],
  }
}

// ======================================= GitHub sign-in =======================================

interface Pending {
  u: string // Discord user id
  k: 'ghp'
  state: string
  verifier: string
  exp: number
}

const AGAIN = `Go back to <b>🐙・join-github</b> in Discord and click <b>Join GitHub</b> again.`

export async function githubStart(event: UrlEvent): Promise<UrlResult> {
  const link = await unseal<{ u: string; k?: string; exp: number }>(event.queryStringParameters?.t)
  if (!link || link.k !== 'gh') return page(400, 'That link expired', `<p>Personal links work for ${LINK_MINUTES} minutes. ${AGAIN}</p>`)
  const p: Pending = {
    u: link.u,
    k: 'ghp',
    state: randomBytes(16).toString('base64url'),
    verifier: randomBytes(32).toString('base64url'),
    exp: Date.now() + 10 * 60_000,
  }
  const q = new URLSearchParams({
    client_id: cfg.githubClientId,
    redirect_uri: `${cfg.baseUrl}/github/callback`,
    state: p.state,
    code_challenge: createHash('sha256').update(p.verifier).digest('base64url'),
    code_challenge_method: 'S256',
    allow_signup: 'true', // people without a GitHub account can make one on the way
  })
  return {
    statusCode: 302,
    headers: { Location: `https://github.com/login/oauth/authorize?${q}`, 'Cache-Control': 'no-store' },
    cookies: [`${COOKIE}=${await seal(p)}; Path=/github; HttpOnly; Secure; SameSite=Lax; Max-Age=600`],
  }
}

type Outcome = 'joined' | 'invited' | 'already-member' | 'rate-limited'

export async function githubCallback(event: UrlEvent): Promise<UrlResult> {
  const clear = `${COOKIE}=; Path=/github; HttpOnly; Secure; SameSite=Lax; Max-Age=0`
  const p = await unseal<Pending>(readCookie(event, COOKIE))
  const qs = event.queryStringParameters ?? {}
  if (qs.error === 'access_denied') return page(200, 'No problem', `<p>You didn't sign in, so nothing happened. ${AGAIN}</p>`, [clear])
  if (!p || p.k !== 'ghp' || !qs.code || qs.state !== p.state) return page(400, 'Sign-in timed out', `<p>${AGAIN}</p>`, [clear])

  // 1. Who are they on GitHub? (GitHub tells us; nobody types it.)
  const { clientSecret } = await githubSecrets()
  const res = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: cfg.githubClientId,
      client_secret: clientSecret,
      code: qs.code,
      redirect_uri: `${cfg.baseUrl}/github/callback`,
      code_verifier: p.verifier,
    }),
    signal: AbortSignal.timeout(8000),
  })
  const tok = (await res.json().catch(() => ({}))) as { access_token?: string; error?: string }
  if (!tok.access_token) throw new Error(`GitHub token exchange failed: ${res.status} ${tok.error ?? ''}`)
  const userAuth = `Bearer ${tok.access_token}`

  try {
    const { login } = await gh<{ login: string }>('GET', '/user', userAuth)

    // 2. Still in the server, with Member and Development? (Checked fresh, not trusted from the click.)
    const member = await discord<{ roles: string[] }>('GET', `/guilds/${cfg.guildId}/members/${p.u}`).catch((e) => {
      if (e instanceof DiscordError && e.status === 404) return null
      throw e
    })
    if (!member) return page(404, 'Join the server first', `<p>Join the HamApps Discord from <a href="${cfg.joinUrl}">${cfg.joinUrl.replace('https://', '')}</a> first.</p>`, [clear])
    if (!member.roles.includes(cfg.memberRoleId) || !member.roles.includes(cfg.devRoleId)) {
      return page(403, 'Pick Development first', `<p>The GitHub org is for verified members with the <b>💻 Development</b> role. Pick it in <b>🎭・roles</b>, then try again.</p>`, [clear])
    }

    // 3. Invite, then try to accept for them.
    const outcome = await inviteAndAccept(login, userAuth)
    if (outcome !== 'rate-limited') {
      const what = { joined: 'joined (invite accepted automatically)', invited: 'invited; they still need to click Accept', 'already-member': 'was already in the org, nothing changed' }[outcome]
      await modLog('🐙 GitHub org', `<@${p.u}> → [${login}](https://github.com/${login}) ${what} · ${ORG()}`, 0x24292f).catch((e) =>
        console.error('mod log failed', e instanceof Error ? e.message : e),
      )
    }
    console.log('github join', outcome) // no names: Cici doesn't keep a record of people
    return resultPage(outcome, login, [clear])
  } finally {
    // 4. Throw away their GitHub sign-in. Cici never keeps it.
    await revoke(tok.access_token, clientSecret)
  }
}

async function inviteAndAccept(login: string, userAuth: string): Promise<Outcome> {
  const org = `Bearer ${await orgToken()}`
  // Never PUT a membership for someone already in the org: that call CHANGES their role, so an owner
  // who clicked the button would be demoted to member. Check first.
  const existing = await gh<{ state: 'active' | 'pending' }>('GET', `/orgs/${ORG()}/memberships/${encodeURIComponent(login)}`, org).catch((e) => {
    if (e instanceof GitHubError && e.status === 404) return null
    throw e
  })
  if (existing?.state === 'active') return 'already-member'
  if (!existing) {
    try {
      await gh('PUT', `/orgs/${ORG()}/memberships/${encodeURIComponent(login)}`, org, { role: 'member' })
    } catch (e) {
      // GitHub limits how many invites an org can send in a day (about 50).
      if (e instanceof GitHubError && [403, 422, 429].includes(e.status) && /rate limit/i.test(e.body)) return 'rate-limited'
      throw e
    }
  }
  // Accept the invite with their own sign-in. If GitHub doesn't allow it, they click Accept once.
  try {
    await gh('PATCH', `/user/memberships/orgs/${ORG()}`, userAuth, { state: 'active' })
    return 'joined'
  } catch (e) {
    console.log('auto-accept not allowed', e instanceof GitHubError ? e.status : e)
    return 'invited'
  }
}

async function revoke(accessToken: string, clientSecret: string) {
  const basic = Buffer.from(`${cfg.githubClientId}:${clientSecret}`).toString('base64')
  await gh('DELETE', `/applications/${cfg.githubClientId}/token`, `Basic ${basic}`, { access_token: accessToken }).catch((e) =>
    console.error('revoke failed', e instanceof Error ? e.message : e),
  )
}

function resultPage(outcome: Outcome, login: string, cookies: string[]): UrlResult {
  const orgUrl = `https://github.com/${ORG()}`
  const name = `<b>${esc(login)}</b>`
  switch (outcome) {
    case 'joined':
      return page(200, `You're in ${ORG()} 🐙`, `<p>${name} is now a member of the HamApps GitHub org.</p>
        <p><a class="btn" href="${orgUrl}">Open ${ORG()}</a></p>`, cookies)
    case 'invited':
      return page(200, 'One last click', `<p>I invited ${name} to ${ORG()}. GitHub wants you to accept it yourself:</p>
        <p><a class="btn" href="${INVITATION_URL()}">Accept the invite</a></p>`, cookies)
    case 'already-member':
      return page(200, "You're already in 🐙", `<p>${name} is already a member of ${ORG()}. Nothing changed.</p>
        <p><a class="btn" href="${orgUrl}">Open ${ORG()}</a></p>`, cookies)
    case 'rate-limited':
      return page(429, 'Busy day!', `<p>GitHub only lets our org send a limited number of invites per day, and we've hit it. 📦</p>
        <p>Please try again tomorrow. Nothing was sent for ${name} yet.</p>`, cookies)
  }
}
