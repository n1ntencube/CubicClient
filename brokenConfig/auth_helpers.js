const fetch = require('node-fetch')
const child_process = require('child_process')
const path = require('path')

async function authenticateWithXBL(msAccessToken) {
  const res = await fetch('https://user.auth.xboxlive.com/user/authenticate', {
    method: 'POST',
    body: JSON.stringify({
      Properties: {
        AuthMethod: 'RPS',
        SiteName: 'user.auth.xboxlive.com',
        RpsTicket: 'd=' + msAccessToken
      },
      RelyingParty: 'http://auth.xboxlive.com',
      TokenType: 'JWT'
    }),
    headers: { 'Content-Type': 'application/json' }
  })

  if (!res.ok) throw new Error('XBL failed: ' + await res.text())
  const data = await res.json()
  const userHash = data.DisplayClaims?.xui?.[0]?.uhs || null
  if (!userHash) throw new Error('Missing user hash from XBL response')
  return { xblToken: data.Token, userHash }
}

async function getXSTSToken(xblToken) {
  const res = await fetch('https://xsts.auth.xboxlive.com/xsts/authorize', {
    method: 'POST',
    body: JSON.stringify({
      Properties: { SandboxId: 'RETAIL', UserTokens: [xblToken] },
      RelyingParty: 'rp://api.minecraftservices.com/',
      TokenType: 'JWT'
    }),
    headers: { 'Content-Type': 'application/json' }
  })

  if (!res.ok) throw new Error('XSTS failed: ' + await res.text())
  const data = await res.json()
  return { xstsToken: data.Token }
}

async function getMinecraftAccessToken(userHash, xstsToken) {
  const identityToken = `XBL3.0 x=${userHash};${xstsToken}`
  const res = await fetch('https://api.minecraftservices.com/authentication/login_with_xbox', {
    method: 'POST',
    body: JSON.stringify({ identityToken }),
    headers: { 'Content-Type': 'application/json' }
  })

  if (!res.ok) throw new Error('Minecraft login failed: ' + await res.text())
  return await res.json()
}

async function getMinecraftProfile(mcAccessToken) {
  const res = await fetch('https://api.minecraftservices.com/minecraft/profile', {
    headers: { 'Authorization': `Bearer ${mcAccessToken}` }
  })
  if (!res.ok) throw new Error('Profile fetch failed: ' + await res.text())
  return await res.json()
}

function launchMinecraft({ mcProfile, accessToken, javaPath = 'java', versionJarPath, gameDir = '.' }) {
  if (!mcProfile || !accessToken || !versionJarPath)
    return { ok: false, error: 'missing args' }

  const launchArgs = [
    '-Xmx2G',
    '-Djava.library.path=' + path.join(gameDir, 'natives'),
    '-cp',
    `${versionJarPath}${path.delimiter}${path.join(gameDir, 'libraries', '*')}`,
    'net.minecraft.client.main.Main',
    '--username', mcProfile.name,
    '--uuid', mcProfile.id,
    '--accessToken', accessToken,
    '--version', 'custom',
    '--gameDir', gameDir,
    '--assetsDir', path.join(gameDir, 'assets')
  ]

  const child = child_process.spawn(javaPath, launchArgs, { stdio: 'inherit' })
  child.on('close', code => console.log('Minecraft exited with', code))
  return { ok: true }
}

module.exports = {
  authenticateWithXBL,
  getXSTSToken,
  getMinecraftAccessToken,
  getMinecraftProfile,
  launchMinecraft
}
