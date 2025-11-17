const fetch = (...args) => import('node-fetch').then(({ default: f }) => f(...args))

const CLIENT_ID = 'd00dadd7-9890-45f1-b00f-93e2f9d7b52f'
const SCOPE = 'XboxLive.signin offline_access'
const DEVICE_CODE_URL =
  'https://login.microsoftonline.com/consumers/oauth2/v2.0/devicecode'
const TOKEN_URL =
  'https://login.microsoftonline.com/consumers/oauth2/v2.0/token'

async function getDeviceCode() {
  const res = await fetch(DEVICE_CODE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      scope: SCOPE,
    }),
  })

  const text = await res.text()
  if (!res.ok) {
    throw new Error(`Device code request failed: ${res.status} – ${text}`)
  }
  const data = JSON.parse(text)
  return data
}


async function pollForToken(device_code, interval, expires_in) {
  const start = Date.now()
  while (Date.now() - start < expires_in * 1000) {
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        client_id: CLIENT_ID,
        device_code
      })
    })

    const data = await res.json()

    if (data.access_token) {
      console.log('[Microsoft] Token reçu, connexion...')
      return data
    }

    if (data.error !== 'authorization_pending') {
      throw new Error(`Token polling failed: ${data.error_description || data.error}`)
    }

    await new Promise(res => setTimeout(res, interval * 1000))
  }

  throw new Error('auth a été timeout')
}

async function authenticateWithXBL(accessToken) {
  const res = await fetch('https://user.auth.xboxlive.com/user/authenticate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      Properties: {
        AuthMethod: 'RPS',
        SiteName: 'user.auth.xboxlive.com',
        RpsTicket: `d=${accessToken}`
      },
      RelyingParty: 'http://auth.xboxlive.com',
      TokenType: 'JWT'
    })
  })

  const data = await res.json()
  console.log('[XBL] Response:', data)

  if (!res.ok || !data.Token || !data.DisplayClaims?.xui?.[0]?.uhs) {
    throw new Error(
      `[XBL] Authentication failed: ${JSON.stringify(data, null, 2)}`
    )
  }

  const userHash = data.DisplayClaims.xui[0].uhs
  return { xblToken: data.Token, userHash }
}

async function getXSTSToken(xblToken) {
  const res = await fetch('https://xsts.auth.xboxlive.com/xsts/authorize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      Properties: { SandboxId: 'RETAIL', UserTokens: [xblToken] },
      RelyingParty: 'rp://api.minecraftservices.com/',
      TokenType: 'JWT'
    })
  })

  const data = await res.json()
  console.log('[XSTS] Réponse:', data)

  if (!res.ok || !data.Token) {
    throw new Error(
      `[XSTS] Autorisation ratée: ${JSON.stringify(data, null, 2)}`
    )
  }

  return { xstsToken: data.Token }
}

async function getMinecraftAccessToken(userHash, xstsToken) {
  const identityToken = `XBL3.0 x=${userHash};${xstsToken}`

  const res = await fetch(
    'https://api.minecraftservices.com/authentication/login_with_xbox',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identityToken })
    }
  )

  const data = await res.json()
  console.log('[Minecraft] login_with_xbox response:', data)

  if (!res.ok || !data.access_token) {
    throw new Error(
      `[Minecraft] login_with_xbox failed. Response:\n${JSON.stringify(
        data,
        null,
        2
      )}`
    )
  }

  return data
}

async function getMinecraftProfile(accessToken) {
  const res = await fetch('https://api.minecraftservices.com/minecraft/profile', {
    headers: { Authorization: `Bearer ${accessToken}` }
  })

  if (res.status === 404) {
    throw new Error('Vous ne possédez pas Minecraft sur votre compte.')
  }

  const data = await res.json()
  console.log('[Minecraft] réponse du profil:', data)
  return data
}


async function exchangeAuthCode(code, redirect_uri) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      grant_type: 'authorization_code',
      code,
      redirect_uri
    })
  })

  const data = await res.json()
  if (!res.ok) {
    throw new Error(`[Microsoft] Token exchange failed: ${JSON.stringify(data)}`)
  }

  return data
}


async function launchMinecraft({ mcProfile, accessToken, versionJarPath, gameDir }) {
  console.log('Launching Minecraft for', mcProfile.name)
  console.log('Launch details:', { mcProfile, accessToken, versionJarPath, gameDir })
  return { ok: true, message: 'Minecraft launch request received. Implement actual launcher.' }
}

module.exports = {
  getDeviceCode,
  pollForToken,
  authenticateWithXBL,
  getXSTSToken,
  getMinecraftAccessToken,
  getMinecraftProfile,
  launchMinecraft,
  exchangeAuthCode,
  CLIENT_ID,
  SCOPE
}
