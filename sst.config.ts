/// <reference path="./.sst/platform/config.d.ts" />

// Cici, the HamApps Discord mascot bot, on AWS (us-east-2):
//   - https://verify.hamapps.dev: Discord button clicks + Hamilton Google sign-in (src/verify.ts)
//     + GitHub sign-in for joining the HamAppsDev org (src/github.ts)
//   - an hourly job that kicks new joiners who didn't verify within 48 hours (src/cleanup.ts)
//   - /commands (src/commands.ts); slow ones are finished by the Followup Lambda (src/followup.ts)
//   - "Cici live" on one small EC2 instance (bot/): online status, greetings, mod log, AI replies, Lofi Lounge
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
        param('EXTRA_LOGIN_DOMAINS'),
      ],
    }
    const region = 'us-east-2'
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
      DISCORD_PUBLIC_KEY: 'eed1350d995b63a39fcbdc4b1fc1a699337558c2a8603a0b467fea737708fa7f', // Cici's Public Key (public)
      GOOGLE_OAUTH_CLIENT_ID: '985964992339-238ra3871ci4l2l8612bk02g18d9linc.apps.googleusercontent.com', // public
      VERIFY_BASE_URL: 'https://verify.hamapps.dev',
      JOIN_URL: 'https://discord.gg/7edtbs8pua',
      KICK_AFTER_HOURS: '48',
      DISCORD_OFFICER_ROLE_ID: '1575706929551118426',
      DISCORD_MODLOG_CHANNEL_ID: '1575763408823918672',
      // Joining the GitHub org (src/github.ts): 🐙・join-github, the Development role, and the public client ID
      // of the GitHub App "Cici" owned by HamAppsDev (its secrets are in Parameter Store /cici/GITHUB_*).
      DISCORD_DEV_ROLE_ID: '1575709056142807151',
      DISCORD_JOIN_GITHUB_CHANNEL_ID: '1575987610835361953', // 🐙・join-github
      GITHUB_ORG: 'HamAppsDev',
      GITHUB_APP_CLIENT_ID: 'Iv23litYDQL3O3zUdIf7', // GitHub App "HamApps Cici" (public)
      // Forum channels in "➤ Submit" that /idea, /issue, /request and /ask post into, with their tag IDs.
      DISCORD_FORUMS: JSON.stringify({
        idea: { id: '1575787389266428034', tags: { scheduler: '1575787389266428035', hameats: '1575787389266428036', homepage: '1575787389266428037', cici: '1575787389266428038', new: '1575787389266428039' } },
        issue: { id: '1575787390788829214', tags: { scheduler: '1575787390788829215', hameats: '1575787390788829216', homepage: '1575787390788829217', cici: '1575787390788829218' } },
        request: { id: '1575787392005185566', tags: { student: '1575787392005185567', faculty: '1575787392005185568', office: '1575787392005185569' } },
        ask: { id: '1575787393078923278', tags: { code: '1575787393078923279', setup: '1575787393078923280', other: '1575787393078923281' } },
      }),
    }

    // Finishes slow /commands in the background (Discord only waits 3 seconds for the first answer).
    const followup = new sst.aws.Function('Followup', {
      handler: 'src/followup.handler',
      runtime: 'nodejs22.x',
      timeout: '30 seconds',
      memory: '256 MB',
      environment: env,
      permissions: [readParams],
    })

    const router = new sst.aws.Router('VerifyRouter', {
      domain: { name: 'verify.hamapps.dev', dns: sst.cloudflare.dns() },
    })
    // Only the Verify function can read the GitHub App's secrets.
    const readGithubParams = {
      actions: ['ssm:GetParameters'],
      resources: [param('GITHUB_APP_CLIENT_SECRET'), param('GITHUB_APP_PRIVATE_KEY')],
    }
    new sst.aws.Function('Verify', {
      handler: 'src/verify.handler',
      runtime: 'nodejs22.x',
      timeout: '20 seconds', // the GitHub sign-in makes several calls to GitHub and Discord in a row
      memory: '256 MB',
      url: { router: { instance: router } },
      environment: { ...env, FOLLOWUP_FUNCTION: followup.name },
      permissions: [readParams, readGithubParams, { actions: ['lambda:InvokeFunction'], resources: [followup.arn] }],
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

    // ---------- Cici live: one always-on EC2 instance (t4g.nano, about $7/month) ----------
    // No open ports and no SSH. Officers get a shell through AWS Session Manager if ever needed.
    // Code: ./deploy.sh uploads bot/ to this bucket and tells the instance to restart with it.
    const code = new sst.aws.Bucket('BotCode')
    const archive = new aws.s3.BucketObjectv2('BotCodeArchive', {
      bucket: code.name,
      key: 'bot.tgz',
      source: new $util.asset.FileAsset(`${$cli.paths.root}/.build/bot.tgz`),
    })
    const role = new aws.iam.Role('LiveRole', {
      assumeRolePolicy: aws.iam.assumeRolePolicyForPrincipal({ Service: 'ec2.amazonaws.com' }),
      managedPolicyArns: ['arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore'],
      inlinePolicies: [
        {
          name: 'cici-live',
          policy: $jsonStringify({
            Version: '2012-10-17',
            Statement: [
              {
                Effect: 'Allow',
                Action: ['ssm:GetParameters'],
                Resource: [
                  param('DISCORD_MASCOT_BOT_TOKEN'),
                  param('ANTHROPIC_API_KEY'),
                  param('DISCORD_VERIFY_GO_LIVE'),
                  param('LOFI_STREAM_URL'),
                ],
              },
              { Effect: 'Allow', Action: ['s3:GetObject'], Resource: [$interpolate`${code.arn}/bot.tgz`] },
            ],
          }),
        },
      ],
    })
    const profile = new aws.iam.InstanceProfile('LiveProfile', { role: role.name })
    const vpc = aws.ec2.getVpcOutput({ default: true })
    const noInbound = new aws.ec2.SecurityGroup('LiveSecurityGroup', {
      vpcId: vpc.id,
      description: 'Cici live: no inbound traffic; outbound to Discord, Anthropic and AWS',
      egress: [{ protocol: '-1', fromPort: 0, toPort: 0, cidrBlocks: ['0.0.0.0/0'], ipv6CidrBlocks: ['::/0'] }],
    })
    const ami = aws.ec2.getAmiOutput({
      owners: ['amazon'],
      mostRecent: true,
      filters: [
        { name: 'name', values: ['al2023-ami-2023.*-kernel-*-arm64'] },
        { name: 'architecture', values: ['arm64'] },
      ],
    })
    const live = new aws.ec2.Instance(
      'Live',
      {
        instanceType: 't4g.nano',
        ami: ami.id,
        iamInstanceProfile: profile.name,
        vpcSecurityGroupIds: [noInbound.id],
        associatePublicIpAddress: true,
        metadataOptions: { httpTokens: 'required', httpEndpoint: 'enabled' },
        rootBlockDevice: { volumeSize: 8, volumeType: 'gp3', encrypted: true },
        creditSpecification: { cpuCredits: 'standard' },
        tags: { Name: 'cici-live' },
        userData: $interpolate`#!/bin/bash
# First boot only. Later code updates come from ./deploy.sh through Session Manager (runs /usr/local/bin/cici-update).
set -euxo pipefail
fallocate -l 1G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
# Automatic security updates (applied daily).
dnf install -y dnf-automatic tar xz
sed -i 's/^apply_updates.*/apply_updates = yes/; s/^upgrade_type.*/upgrade_type = security/' /etc/dnf/automatic.conf
systemctl enable --now dnf-automatic.timer
# Node.js 24 (LTS) from nodejs.org, checked against its published checksum.
cd /tmp
FILE=$(curl -fsSL https://nodejs.org/dist/latest-v24.x/SHASUMS256.txt | grep 'linux-arm64.tar.xz' | awk '{print $2}')
curl -fsSLO https://nodejs.org/dist/latest-v24.x/$FILE
curl -fsSL https://nodejs.org/dist/latest-v24.x/SHASUMS256.txt | grep " $FILE\$" | sha256sum -c -
tar -xJf $FILE -C /usr/local --strip-components=1
useradd --system --create-home --home-dir /opt/cici cici || true
cat > /usr/local/bin/cici-update <<'UPD'
#!/bin/bash
set -euo pipefail
aws s3 cp s3://${code.name}/bot.tgz /tmp/bot.tgz --region ${region}
rm -rf /opt/cici/app.new && mkdir -p /opt/cici/app.new && tar -xzf /tmp/bot.tgz -C /opt/cici/app.new
cd /opt/cici/app.new && HOME=/tmp npm ci --omit=dev --no-audit --no-fund
rm -rf /opt/cici/app.old && { [ -d /opt/cici/app ] && mv /opt/cici/app /opt/cici/app.old || true; }
mv /opt/cici/app.new /opt/cici/app && chown -R cici:cici /opt/cici
systemctl restart cici
UPD
chmod +x /usr/local/bin/cici-update
cat > /etc/systemd/system/cici.service <<'SVC'
[Unit]
Description=Cici live (HamApps Discord bot)
After=network-online.target
Wants=network-online.target
[Service]
User=cici
WorkingDirectory=/opt/cici/app
Environment=AWS_REGION=${region} NODE_ENV=production
ExecStart=/usr/local/bin/node index.mjs
Restart=always
RestartSec=5
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
ReadWritePaths=/opt/cici
[Install]
WantedBy=multi-user.target
SVC
systemctl daemon-reload
systemctl enable cici
/usr/local/bin/cici-update
`,
      },
      // A newer Amazon Linux image or a changed first-boot script must not replace the running instance.
      { ignoreChanges: ['ami', 'userData'], dependsOn: [archive] },
    )

    return { verify: router.url, liveInstance: live.id }
  },
})
