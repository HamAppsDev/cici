// Shared helpers for Cici, the HamApps Discord mascot bot (verify.hamapps.dev + hourly cleanup).
//
// Secrets are NOT in this repo or in GitHub. They are read at run time from AWS Systems Manager
// Parameter Store (us-east-2), under /cici/ (SecureString):
//   /cici/DISCORD_MASCOT_BOT_TOKEN          Cici's bot token (Developer Portal > Cici > Bot > Reset Token)
//   /cici/GOOGLE_OAUTH_CLIENT_SECRET_VERIFY Google OAuth client "HamApps Discord verify"
//   /cici/VERIFY_LINK_SECRET                random string that signs the personal verify links and cookies
// and one plain String:
//   /cici/DISCORD_VERIFY_GO_LIVE            ISO date. Only people who join AFTER this can be kicked. Missing = never kick.
// The local copy of every secret is ~/Documents/HamApps/shared-secrets.env on the club laptop.

import { createHmac, timingSafeEqual } from 'node:crypto'
import { SSMClient, GetParametersCommand } from '@aws-sdk/client-ssm'

const ssm = new SSMClient({})
let cache: Record<string, string> | undefined

/** Reads the /cici/ parameters once per Lambda container. Missing ones come back as ''. */
export async function params(): Promise<Record<string, string>> {
  if (cache) return cache
  const names = [
    'DISCORD_MASCOT_BOT_TOKEN',
    'GOOGLE_OAUTH_CLIENT_SECRET_VERIFY',
    'VERIFY_LINK_SECRET',
    'DISCORD_VERIFY_GO_LIVE',
  ]
  const res = await ssm.send(
    new GetParametersCommand({ Names: names.map((n) => `/cici/${n}`), WithDecryption: true }),
  )
  cache = Object.fromEntries(names.map((n) => [n, '']))
  for (const p of res.Parameters ?? []) cache[p.Name!.replace('/cici/', '')] = p.Value ?? ''
  return cache
}

// ---------- Config that is not secret (IDs from the HamApps Discord server) ----------
export const cfg = {
  guildId: process.env.DISCORD_GUILD_ID!,
  memberRoleId: process.env.DISCORD_MEMBER_ROLE_ID!,
  /** role id -> channel shown to people with that role */
  interests: JSON.parse(process.env.DISCORD_INTEREST_ROLES ?? '{}') as Record<string, { label: string; channelId: string }>,
  generalChannelId: process.env.DISCORD_GENERAL_CHANNEL_ID!,
  rolesChannelId: process.env.DISCORD_ROLES_CHANNEL_ID!,
  introductionsChannelId: process.env.DISCORD_INTRODUCTIONS_CHANNEL_ID!,
  publicKey: process.env.DISCORD_PUBLIC_KEY!,
  googleClientId: process.env.GOOGLE_OAUTH_CLIENT_ID!,
  baseUrl: process.env.VERIFY_BASE_URL!, // https://verify.hamapps.dev
  joinUrl: process.env.JOIN_URL!, // the permanent Discord invite
  kickAfterHours: Number(process.env.KICK_AFTER_HOURS ?? '48'),
}

// ---------- Discord REST ----------
export class DiscordError extends Error {
  constructor(public status: number, public body: string) {
    super(`Discord ${status}: ${body.slice(0, 200)}`)
  }
}

export async function discord<T = unknown>(method: string, path: string, body?: unknown, reason?: string): Promise<T> {
  const { DISCORD_MASCOT_BOT_TOKEN: token } = await params()
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`https://discord.com/api/v10${path}`, {
      method,
      headers: {
        Authorization: `Bot ${token}`,
        'User-Agent': 'DiscordBot (https://hamapps.dev, 1.0)',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(reason ? { 'X-Audit-Log-Reason': encodeURIComponent(reason) } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
    if (res.status === 429 && attempt < 3) {
      const wait = Number((await res.json().catch(() => ({}))).retry_after ?? 1)
      await new Promise((r) => setTimeout(r, Math.min(wait, 5) * 1000 + 100))
      continue
    }
    const text = await res.text()
    if (!res.ok) throw new DiscordError(res.status, text)
    return (text ? JSON.parse(text) : undefined) as T
  }
}

// ---------- Signed values (personal verify links, sign-in cookie) ----------
const b64url = (b: Buffer) => b.toString('base64url')

export async function seal(data: object): Promise<string> {
  const { VERIFY_LINK_SECRET: secret } = await params()
  const body = b64url(Buffer.from(JSON.stringify(data)))
  return `${body}.${b64url(createHmac('sha256', secret).update(body).digest())}`
}

/** Returns the data if the signature is valid and its `exp` (ms) is in the future. */
export async function unseal<T extends { exp: number }>(value: string | undefined): Promise<T | null> {
  if (!value) return null
  const { VERIFY_LINK_SECRET: secret } = await params()
  const [body, sig] = value.split('.')
  if (!body || !sig) return null
  const want = createHmac('sha256', secret).update(body).digest()
  const got = Buffer.from(sig, 'base64url')
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null
  try {
    const data = JSON.parse(Buffer.from(body, 'base64url').toString()) as T
    return data.exp > Date.now() ? data : null
  } catch {
    return null
  }
}
