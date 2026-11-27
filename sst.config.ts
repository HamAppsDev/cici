/// <reference path="./.sst/platform/config.d.ts" />

// Cici, the HamApps Discord mascot bot, on AWS (us-east-2):
//   - https://verify.hamapps.dev: Discord button clicks + Hamilton Google sign-in (src/verify.ts)
//   - an hourly job that kicks new joiners who didn't verify within 48 hours (src/cleanup.ts)
//
// Deploy: ./deploy.sh (reads the Cloudflare values from Parameter Store; nothing secret on disk).
// Secrets are read by the functions at run time from Parameter Store /cici/*, never from this repo.

export default $config({
  app(input) {
    return {
      name: 'hamapps-cici',
      home: 'aws',
      removal: input?.stage === 'production' ? 'retain' : 'remove',
      protect: input?.stage === 'production',
      providers: {
        aws: { region: 'us-east-2', ...(process.env.AWS_ACCESS_KEY_ID ? {} : { profile: 'hamapps' }) },
        cloudflare: '6.15.0',
      },
    }
  },
  async run() {
    if (!process.env.CLOUDFLARE_API_TOKEN || !process.env.CLOUDFLARE_DEFAULT_ACCOUNT_ID) {
      throw new Error('Run ./deploy.sh (it loads the Cloudflare values from Parameter Store).')
    }
    const account = aws.getCallerIdentityOutput({}).accountId
    const param = (name: string) => $interpolate`arn:aws:ssm:us-east-2:${account}:parameter/cici/${name}`
    const readParams = {
      actions: ['ssm:GetParameters'],
      resources: [
        param('DISCORD_MASCOT_BOT_TOKEN'),
        param('GOOGLE_OAUTH_CLIENT_SECRET_VERIFY'),
        param('VERIFY_LINK_SECRET'),
        param('DISCORD_VERIFY_GO_LIVE'),
      ],
    }
    // IDs from the HamApps Discord server and public client IDs. None of these are secret.
    const env = {
      DISCORD_GUILD_ID: '1454213555321704727',
      DISCORD_MEMBER_ROLE_ID: '1575706930444369930',
      DISCORD_INTEREST_ROLES: JSON.stringify({
        '1575709056142807151': { label: '💻 Development', channelId: '1575709088333959179' },
        '1575709057128341555': { label: '🎨 Design', channelId: '1575709089839972534' },
        '1575709058902655108': { label: '📋 Product', channelId: '1575709092935106630' },
        '1575709059603234869': { label: '📣 Marketing', channelId: '1575709094088675441' },
      }),
      DISCORD_GENERAL_CHANNEL_ID: '1574132642969034782',
      DISCORD_ROLES_CHANNEL_ID: '1575709072731410554',
      DISCORD_INTRODUCTIONS_CHANNEL_ID: '1575709078947238078',
      DISCORD_PUBLIC_KEY: 'eed1350d995b63a39fcbdc4b1fc1a699337558c2a8603a0b467fea737708fa7f', // Cici's Public Key (public)
      GOOGLE_OAUTH_CLIENT_ID: '985964992339-238ra3871ci4l2l8612bk02g18d9linc.apps.googleusercontent.com', // public
      VERIFY_BASE_URL: 'https://verify.hamapps.dev',
      JOIN_URL: 'https://discord.gg/DgsvrQeJjr',
      KICK_AFTER_HOURS: '48',
    }

    const router = new sst.aws.Router('VerifyRouter', {
      domain: { name: 'verify.hamapps.dev', dns: sst.cloudflare.dns() },
    })
    new sst.aws.Function('Verify', {
      handler: 'src/verify.handler',
      runtime: 'nodejs22.x',
      timeout: '10 seconds',
      memory: '256 MB',
      url: { router: { instance: router } },
      environment: env,
      permissions: [readParams],
    })
    new sst.aws.CronV2('Cleanup', {
      schedule: 'rate(1 hour)',
      function: {
        handler: 'src/cleanup.handler',
        runtime: 'nodejs22.x',
        timeout: '60 seconds',
        memory: '128 MB',
        environment: env,
        permissions: [readParams],
      },
    })

    return { verify: router.url }
  },
})
