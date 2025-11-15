const { app, BrowserWindow, ipcMain, shell } = require('electron')
const path = require('path')
const http = require('http')
const https = require('https')
const fs = require('fs').promises
const { spawn } = require('child_process')
const os = require('os')
const {
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
} = require('./auth')

let mainWindow

function createWindow() {
  mainWindow = new BrowserWindow({
    autoHideMenuBar: true,
    width: 1000,
    height: 630,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      enableRemoteModule: false
    }
  })

  mainWindow.loadFile(path.join(__dirname, 'renderer/index.html'))
}

app.whenReady().then(createWindow)
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})


ipcMain.handle('get-device-code', async () => {
  try {
    const deviceData = await getDeviceCode()
    console.log('Device code:', deviceData.user_code)
    return deviceData
  } catch (err) {
    console.error('get-device-code error:', err)
    throw err
  }
})

ipcMain.handle('poll-for-minecraft', async (event, deviceData) => {
  try {
    const tokenData = await pollForToken(
      deviceData.device_code,
      deviceData.interval,
      deviceData.expires_in
    )

    const { xblToken, userHash } = await authenticateWithXBL(tokenData.access_token)
    const { xstsToken } = await getXSTSToken(xblToken)
    const mc = await getMinecraftAccessToken(userHash, xstsToken)
    const profile = await getMinecraftProfile(mc.access_token)

    console.log('Minecraft login successful for:', profile.name)
    return { mc, profile }
  } catch (err) {
    console.error('poll-for-minecraft error:', err)
    throw err
  }
})

ipcMain.handle('launch', async (event, args) => {
  try {
    const { mcProfile, accessToken } = args
    
    const gameDir = path.join(os.homedir(), '.cubiclauncher', 'minecraft')
    const versionsDir = path.join(gameDir, 'versions')
    const clientJar = path.join(versionsDir, '1.12.2', '1.12.2.jar')
    
    await fs.mkdir(gameDir, { recursive: true })
    await fs.mkdir(versionsDir, { recursive: true })

    console.log(`[Launcher] Attempting to launch Minecraft 1.12.2 for ${mcProfile.name}`)
    console.log(`[Launcher] Game directory: ${gameDir}`)
    console.log(`[Launcher] Client JAR: ${clientJar}`)
    console.log(`[Launcher] Minecraft UUID: ${mcProfile.id}`)
    
    let jarExists = false
    try {
      await fs.access(clientJar)
      jarExists = true
      console.log(`[Launcher] Found Minecraft 1.12.2 JAR`)
    } catch (e) {
      console.log('[Launcher] Minecraft JAR not found, downloading...')
      event.sender.send('install-progress', { status: 'downloading-minecraft', progress: 0 })
      
      try {
        const res = await new Promise((resolve) => {
          ipcMain.emit('invoke', 'download-minecraft', { version: '1.12.2' }, resolve)
        })
      } catch (err) {
        throw new Error(`Failed to download Minecraft: ${err.message}`)
      }
    }

    let launchCmd = []
    let launchArgs = []

    const javaCheck = await ensureJavaAvailableLocal()
    if (!javaCheck.ok) throw new Error('Java not available: ' + (javaCheck.error || 'unknown'))
    const javaExec = javaCheck.path

    let installedForgeJar = null
    try {
      const entries = await fs.readdir(versionsDir).catch(() => [])
      for (const name of entries) {
        if (name && name.startsWith('1.12.2-forge')) {
          const cand = path.join(versionsDir, name, `${name}.jar`)
          try {
            await fs.access(cand)
            installedForgeJar = cand
            break
          } catch (e) {}
        }
      }
    } catch (e) {}

    if (installedForgeJar) {
      launchCmd = javaExec
      launchArgs = [
        `-Xmx2G`,
        `-Xms1G`,
        `-Dfile.encoding=UTF-8`,
        `-Duser.country=US`,
        `-Duser.language=en`,
        `-cp`,
        `${clientJar}${path.delimiter}${installedForgeJar}`,
        `net.minecraft.launchwrapper.Launch`,
        `--username=${mcProfile.name}`,
        `--version=1.12.2-forge`,
        `--gameDir=${gameDir}`,
        `--assetsDir=${path.join(gameDir, 'assets')}`,
        `--uuid=${mcProfile.id}`,
        `--userType=mojang`
      ]
    } else {
      launchCmd = javaExec
      launchArgs = [
        `-Xmx2G`,
        `-Xms1G`,
        `-Dfile.encoding=UTF-8`,
        `--add-modules=ALL-SYSTEM`,
        `-Djava.net.preferIPv4Stack=true`,
        `-p`,
        path.join(gameDir, 'libraries'),
        `-cp`,
        clientJar,
        `net.minecraft.client.main.Main`,
        `--username=${mcProfile.name}`,
        `--version=1.12.2`,
        `--gameDir=${gameDir}`,
        `--assetsDir=${path.join(gameDir, 'assets')}`,
        `--assetIndex=1.12`,
        `--uuid=${mcProfile.id}`,
        `--accessToken=${accessToken}`,
        `--userType=mojang`
      ]
    }

    try {
      const proc = spawn(launchCmd, launchArgs, {
        detached: true,
        cwd: gameDir,
        stdio: 'ignore'
      })
      proc.unref()
      
      console.log('[Launcher] Minecraft launched successfully')
      return { ok: true, message: 'Minecraft 1.12.2 launched' }
    } catch (err) {
      throw new Error(`Failed to spawn Minecraft process: ${err.message}`)
    }
  } catch (err) {
    console.error('[Launcher] Error:', err)
    throw err
  }
})


const AUTH_FILE = () => path.join(app.getPath('userData'), 'auth.json')

const ACCOUNTS_FILE = () => path.join(app.getPath('userData'), 'accounts.json')

async function readAccountsFile() {
  try {
    const file = ACCOUNTS_FILE()
    const txt = await fs.readFile(file, { encoding: 'utf8' })
    return JSON.parse(txt)
  } catch (e) {
    return { current: null, accounts: [] }
  }
}

async function writeAccountsFile(obj) {
  const file = ACCOUNTS_FILE()
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, JSON.stringify(obj, null, 2), { encoding: 'utf8' })
}

ipcMain.handle('list-accounts', async () => {
  const data = await readAccountsFile()
  return data
})

ipcMain.handle('save-account', async (event, { profile, mc }) => {
  const data = await readAccountsFile()
  const idx = data.accounts.findIndex(a => a.profile && a.profile.id === profile.id)
  const entry = { profile, mc }
  if (idx >= 0) data.accounts[idx] = entry
  else data.accounts.push(entry)
  data.current = profile.id
  await writeAccountsFile(data)
  const file = AUTH_FILE()
  await fs.writeFile(file, JSON.stringify({ profile, mc }, null, 2), { encoding: 'utf8' })
  return { ok: true }
})

ipcMain.handle('set-current-account', async (event, profileId) => {
  const data = await readAccountsFile()
  const exists = data.accounts.find(a => a.profile && a.profile.id === profileId)
  if (!exists) throw new Error('Account not found')
  data.current = profileId
  await writeAccountsFile(data)
  const file = AUTH_FILE()
  await fs.writeFile(file, JSON.stringify(exists, null, 2), { encoding: 'utf8' })
  return { ok: true }
})

ipcMain.handle('remove-account', async (event, profileId) => {
  const data = await readAccountsFile()
  data.accounts = data.accounts.filter(a => !(a.profile && a.profile.id === profileId))
  if (data.current === profileId) data.current = data.accounts.length ? data.accounts[0].profile.id : null
  await writeAccountsFile(data)
  if (data.current) {
    const current = data.accounts.find(a => a.profile.id === data.current)
    await fs.writeFile(AUTH_FILE(), JSON.stringify(current, null, 2), { encoding: 'utf8' })
  } else {
    await fs.unlink(AUTH_FILE()).catch(() => {})
  }
  return { ok: true }
})

ipcMain.handle('load-current-account', async () => {
  try {
    const txt = await fs.readFile(AUTH_FILE(), { encoding: 'utf8' })
    return JSON.parse(txt)
  } catch (e) {
    return null
  }
})

async function findFileRecursive(dir, targetFile) {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true })
    for (const ent of entries) {
      const full = path.join(dir, ent.name)
      if (ent.isFile() && ent.name.toLowerCase() === targetFile.toLowerCase()) return full
      if (ent.isDirectory()) {
        const found = await findFileRecursive(full, targetFile)
        if (found) return found
      }
    }
  } catch (e) {
    return null
  }
  return null
}

async function ensureJavaAvailableLocal() {
  const { spawnSync, spawn } = require('child_process')
  const check = spawnSync('java', ['-version'], { windowsHide: true })
  if (check.status === 0) return { ok: true, path: 'java' }

  try {
    const runtimeDir = path.join(app.getPath('userData'), 'runtime')
    await fs.mkdir(runtimeDir, { recursive: true })

    let jreUrl = null
    let zipName = 'jre.zip'
    if (process.platform === 'win32' && os.arch() === 'x64') {
      jreUrl = 'https://github.com/adoptium/temurin8-binaries/releases/download/jdk8u372-b07/OpenJDK8U-jre_x64_windows_hotspot_8u372b07.zip'
    } else if (process.platform === 'linux') {
      jreUrl = 'https://github.com/adoptium/temurin8-binaries/releases/download/jdk8u372-b07/OpenJDK8U-jre_x64_linux_hotspot_8u372b07.tar.gz'
      zipName = 'jre.tar.gz'
    } else if (process.platform === 'darwin') {
      jreUrl = 'https://github.com/adoptium/temurin8-binaries/releases/download/jdk8u372-b07/OpenJDK8U-jre_x64_mac_hotspot_8u372b07.tar.gz'
      zipName = 'jre.tar.gz'
    } else {
      throw new Error('Unsupported platform for automatic JRE download')
    }

    const zipPath = path.join(runtimeDir, zipName)
    console.log('[Java] Downloading JRE from', jreUrl)
    await downloadFile(jreUrl, zipPath, (p) => {
      mainWindow && mainWindow.webContents && mainWindow.webContents.send('install-progress', { status: 'downloading-java', progress: Math.round(p.percent || 0) })
    })

    console.log('[Java] Extracting JRE')
    if (process.platform === 'win32') {
      await new Promise((resolve, reject) => {
        const ps = spawn('powershell', ['-NoProfile', '-Command', `Expand-Archive -Path '${zipPath}' -DestinationPath '${runtimeDir}' -Force`], { stdio: 'inherit' })
        ps.on('close', (c) => c === 0 ? resolve() : reject(new Error('Failed to extract JRE')))
        ps.on('error', reject)
      })
    } else {
      await new Promise((resolve, reject) => {
        const t = spawn('tar', ['-xzf', zipPath, '-C', runtimeDir], { stdio: 'inherit' })
        t.on('close', (c) => c === 0 ? resolve() : reject(new Error('Failed to extract JRE')))
        t.on('error', reject)
      })
    }

    const javaExeName = process.platform === 'win32' ? 'java.exe' : 'java'
    const found = await findFileRecursive(runtimeDir, javaExeName)
    if (!found) throw new Error('Java executable not found inside extracted runtime')

    console.log('[Java] Bundled java found at', found)
    return { ok: true, path: found }
  } catch (err) {
    console.error('[Java] ensure-java error:', err)
    return { ok: false, error: err.message }
  }
}

ipcMain.handle('ensure-java', async () => {
  return await ensureJavaAvailableLocal()
})
ipcMain.handle('save-login', async (event, data) => {
  try {
    const file = AUTH_FILE()
    await fs.mkdir(path.dirname(file), { recursive: true })
    await fs.writeFile(file, JSON.stringify(data, null, 2), { encoding: 'utf8' })
    return { ok: true }
  } catch (err) {
    console.error('save-login error', err)
    throw err
  }
})

ipcMain.handle('load-login', async () => {
  try {
    const file = AUTH_FILE()
    const txt = await fs.readFile(file, { encoding: 'utf8' })
    return JSON.parse(txt)
  } catch (err) {
    return null
  }
})

ipcMain.handle('clear-login', async () => {
  try {
    const file = AUTH_FILE()
    await fs.unlink(file).catch(() => {})
    return { ok: true }
  } catch (err) {
    console.error('clear-login error', err)
    throw err
  }
})


async function downloadFile(url, destPath, onProgress) {
  return new Promise((resolve, reject) => {
    const proto = url.startsWith('https') ? https : http
    const fsSync = require('fs')
    const file = fsSync.createWriteStream(destPath)
    
    const requestFile = (requestUrl) => {
      proto.get(requestUrl, (response) => {
        if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          file.close()
          fsSync.unlink(destPath, () => {})
          return requestFile(response.headers.location)
        }

        if (response.statusCode !== 200) {
          reject(new Error(`Download failed: HTTP ${response.statusCode}`))
          return
        }

        const contentLength = parseInt(response.headers['content-length'], 10)
        let downloadedLength = 0

        response.on('data', (chunk) => {
          downloadedLength += chunk.length
          if (onProgress && contentLength) {
            onProgress({ 
              downloaded: downloadedLength, 
              total: contentLength, 
              percent: Math.round((downloadedLength / contentLength) * 100)
            })
          }
        })

        response.pipe(file)
        file.on('finish', () => {
          file.close()
          resolve()
        })
        file.on('error', (err) => {
          fsSync.unlink(destPath, () => {})
          reject(err)
        })
      }).on('error', reject)
    }

    requestFile(url)
  })
}

const MOD_PACKS = {
  'vanilla': { name: 'Vanilla', mods: [] },
  'skyblock': { 
    name: 'SkyBlock Pack',
    mods: []
  },
  'tech': {
    name: 'Tech Pack',
    mods: []
  }
}

ipcMain.handle('get-mod-packs', async () => {
  return Object.entries(MOD_PACKS).map(([key, pack]) => ({
    id: key,
    name: pack.name,
    modCount: pack.mods.length
  }))
})

ipcMain.handle('get-installed-mods', async () => {
  try {
    const modsDir = path.join(os.homedir(), '.cubiclauncher', 'minecraft', 'mods')
    const files = await fs.readdir(modsDir).catch(() => [])
    return files.filter(f => f.endsWith('.jar')).map(f => ({ name: f }))
  } catch (err) {
    return []
  }
})

ipcMain.handle('remove-mod', async (event, { modName }) => {
  try {
    const modPath = path.join(os.homedir(), '.cubiclauncher', 'minecraft', 'mods', modName)
    await fs.unlink(modPath)
    console.log(`[Mods] Removed: ${modName}`)
    return { ok: true }
  } catch (err) {
    console.error('[Mods] Failed to remove:', err)
    throw err
  }
})

ipcMain.handle('install-forge-mods', async (event, { modsUrls, onProgress }) => {
  try {
    const gameDir = path.join(os.homedir(), '.cubiclauncher', 'minecraft')
    const versionsDir = path.join(gameDir, 'versions')
    const modsDir = path.join(gameDir, 'mods')
    const librariesDir = path.join(gameDir, 'libraries')

    console.log('[ForgeInstaller] Starting Forge 1.12.2 installation')
    console.log('[ForgeInstaller] Game dir:', gameDir)

    await fs.mkdir(versionsDir, { recursive: true })
    await fs.mkdir(modsDir, { recursive: true })
    await fs.mkdir(librariesDir, { recursive: true })

    const forgeVersion = '14.23.5.2860'
    const forgeUrl = `https://files.minecraftforge.net/maven/net/minecraftforge/forge/1.12.2-${forgeVersion}/forge-1.12.2-${forgeVersion}-installer.jar`
    const forgeInstallerPath = path.join(versionsDir, `forge-1.12.2-installer.jar`)
    const forgeProfileDir = path.join(versionsDir, `1.12.2-forge`)
    const forgeProfileJar = path.join(forgeProfileDir, `1.12.2-forge.jar`)

    console.log('[ForgeInstaller] Forge URL:', forgeUrl)
    console.log('[ForgeInstaller] Downloading Forge...')
    event.sender.send('install-progress', { status: 'downloading-forge', progress: 0 })

    try {
      await downloadFile(forgeUrl, forgeInstallerPath, (progress) => {
        event.sender.send('install-progress', {
          status: 'downloading-forge',
          progress: Math.round(progress.percent || 0)
        })
      })
    } catch (err) {
      console.error('[ForgeInstaller] Forge download failed:', err)
      throw new Error(`Failed to download Forge: ${err.message}`)
    }

    console.log('[ForgeInstaller] Extracting Forge...')
    event.sender.send('install-progress', { status: 'installing-forge', progress: 40 })

    await fs.mkdir(forgeProfileDir, { recursive: true })

    try {
      const AdmZip = require('adm-zip')
      const zip = new AdmZip(forgeInstallerPath)
      const extractDir = path.join(versionsDir, '_forge_extract_temp')
      await fs.mkdir(extractDir, { recursive: true })
      zip.extractAllTo(extractDir, true)

      const profileJsonPath = path.join(extractDir, 'install_profile.json')
      let profileJson = null
      try {
        const profileContent = await fs.readFile(profileJsonPath, 'utf8')
        profileJson = JSON.parse(profileContent)
      } catch (e) {
        console.warn('[ForgeInstaller] Could not read install_profile.json, creating basic profile')
      }

      const versionJsonPath = path.join(extractDir, 'version.json')
      let versionJson = null
      try {
        const versionContent = await fs.readFile(versionJsonPath, 'utf8')
        versionJson = JSON.parse(versionContent)
      } catch (e) {
        console.warn('[ForgeInstaller] Could not read version.json')
      }

      const mavenPath = path.join(extractDir, 'maven')
      if (mavenPath && await fs.stat(mavenPath).catch(() => null)) {
        console.log('[ForgeInstaller] Copying maven libraries...')
        const copyRecursive = async (src, dest) => {
          await fs.mkdir(dest, { recursive: true })
          const files = await fs.readdir(src)
          for (const file of files) {
            const srcPath = path.join(src, file)
            const destPath = path.join(dest, file)
            const stat = await fs.stat(srcPath)
            if (stat.isDirectory()) {
              await copyRecursive(srcPath, destPath)
            } else {
              await fs.copyFile(srcPath, destPath)
            }
          }
        }
        await copyRecursive(mavenPath, librariesDir)
      }

      const forgeJsonPath = path.join(forgeProfileDir, '1.12.2-forge.json')
      const forgeProfileData = {
        id: '1.12.2-forge',
        inheritsFrom: '1.12.2',
        releaseTime: new Date().toISOString(),
        time: new Date().toISOString(),
        type: 'release',
        mainClass: versionJson?.mainClass || 'net.minecraft.launchwrapper.Launch',
        minecraftArguments: versionJson?.minecraftArguments || '--username ${auth_player_name} --version ${version_name} --gameDir ${game_directory} --assetsDir ${assets_root} --assetIndex ${assets_index_name} --uuid ${auth_uuid} --accessToken ${auth_access_token} --userType ${user_type}',
        libraries: versionJson?.libraries || [],
        jar: '1.12.2'
      }
      await fs.writeFile(forgeJsonPath, JSON.stringify(forgeProfileData, null, 2), 'utf8')

      const forgeClientPath = path.join(extractDir, 'forge-1.12.2-universal.jar')
      if (forgeClientPath && await fs.stat(forgeClientPath).catch(() => null)) {
        await fs.copyFile(forgeClientPath, forgeProfileJar)
        console.log('[ForgeInstaller] Copied Forge client JAR')
      }

      await fs.rm(extractDir, { recursive: true, force: true }).catch(() => {})

      console.log('[ForgeInstaller] Forge installation complete')
      event.sender.send('install-progress', { status: 'complete', progress: 100 })
    } catch (err) {
      console.error('[ForgeInstaller] Extraction/setup failed:', err)
      throw new Error(`Forge setup failed: ${err.message}`)
    }

    if (modsUrls && Array.isArray(modsUrls) && modsUrls.length > 0) {
      console.log(`[ForgeInstaller] Installing ${modsUrls.length} mods...`)
      
      for (let i = 0; i < modsUrls.length; i++) {
        const modUrl = modsUrls[i]
        const modName = path.basename(new URL(modUrl).pathname) || `mod-${i}.jar`
        const modPath = path.join(modsDir, modName)
        
        console.log(`[ForgeInstaller] Downloading mod ${i + 1}/${modsUrls.length}: ${modName}`)
        event.sender.send('install-progress', { 
          status: `downloading-mod-${i + 1}`, 
          modName,
          progress: 40 + Math.round((i / modsUrls.length) * 60)
        })
        
        try {
          await downloadFile(modUrl, modPath, (prog) => {
            event.sender.send('install-progress', {
              status: `downloading-mod-${i + 1}`,
              modName,
              progress: 40 + Math.round(((i + prog.percent / 100) / modsUrls.length) * 60)
            })
          })
          console.log(`[ForgeInstaller] Installed: ${modName}`)
        } catch (err) {
          console.error(`[ForgeInstaller] Failed to download mod ${i + 1}: ${modUrl}`, err)
          throw new Error(`Failed to download mod "${modName}": ${err.message}`)
        }
      }
    }

    console.log('[ForgeInstaller] Installation complete!')
    return { ok: true, message: 'Forge 1.12.2 installed successfully', modsDir }
  } catch (err) {
    console.error('[ForgeInstaller] Error:', err)
    event.sender.send('install-progress', { status: 'error', error: err.message })
    throw err
  }
})


ipcMain.handle('start-oauth', async () => {
  return await new Promise((resolve, reject) => {
    const server = http.createServer()

    const timeoutMs = 1000 * 60 * 2
    const timeout = setTimeout(() => {
      try { server.close() } catch (e) {}
      reject(new Error('Timeout waiting for OAuth redirect'))
    }, timeoutMs)

    server.on('request', async (req, res) => {
      try {
        const reqUrl = new URL(req.url, `http://127.0.0.1`)
        if (reqUrl.pathname === '/callback') {
          const code = reqUrl.searchParams.get('code')
          const error = reqUrl.searchParams.get('error')

          if (code) {
            res.writeHead(200, { 'Content-Type': 'text/html' })
            res.end('<html><body><h2>Authentication successful</h2><p>You can close this window and return to the launcher.</p></body></html>')
            clearTimeout(timeout)

            let port = null
            try {
              const addr = server.address()
              if (addr && typeof addr.port === 'number') port = addr.port
            } catch (e) {}

            try { server.close() } catch (e) {}
            try { if (authWindow) authWindow.close() } catch (e) {}

            try {
              const redirectUri = port ? `http://127.0.0.1:${port}/callback` : 'http://127.0.0.1/callback'
              const tokens = await exchangeAuthCode(code, redirectUri)
              const accessToken = tokens.access_token
              const { xblToken, userHash } = await authenticateWithXBL(accessToken)
              const { xstsToken } = await getXSTSToken(xblToken)
              const mc = await getMinecraftAccessToken(userHash, xstsToken)
              const profile = await getMinecraftProfile(mc.access_token)
              resolve({ mc, profile })
            } catch (err) {
              reject(err)
            }
            return
          }

          res.writeHead(400, { 'Content-Type': 'text/plain' })
          res.end('Missing code')
          clearTimeout(timeout)
          try { server.close() } catch (e) {}
          try { if (authWindow) authWindow.close() } catch (e) {}
          reject(new Error(error || 'No code returned'))
          return
        }

        res.writeHead(404)
        res.end()
      } catch (err) {
        try { res.writeHead(500); res.end('Server error') } catch (e) {}
        clearTimeout(timeout)
        try { server.close() } catch (e) {}
        try { if (authWindow) authWindow.close() } catch (e) {}
        reject(err)
      }
    })

    const FIXED_PORT = 53123

    server.listen(FIXED_PORT, '127.0.0.1', () => {
      const redirectUri = `http://127.0.0.1:${FIXED_PORT}/callback`
      const authorizeUrl = `https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize?client_id=${CLIENT_ID}&response_type=code&scope=${encodeURIComponent(
        SCOPE
      )}&redirect_uri=${encodeURIComponent(redirectUri)}`

      shell.openExternal(authorizeUrl).catch(err => {
        clearTimeout(timeout)
        try { server.close() } catch (e) {}
        reject(err)
      })
    })
  })
})

ipcMain.handle('get-game-dir', async () => {
  const gameDir = path.join(os.homedir(), '.cubiclauncher', 'minecraft')
  await fs.mkdir(gameDir, { recursive: true })
  return gameDir
})

ipcMain.handle('download-minecraft', async (event, { version }) => {
  try {
    const gameDir = path.join(os.homedir(), '.cubiclauncher', 'minecraft')
    const versionsDir = path.join(gameDir, 'versions')
    const targetVersion = version || '1.12.2'
    
    console.log(`[Minecraft] Starting Minecraft ${targetVersion} download from Piston`)
    event.sender.send('install-progress', { status: 'downloading-minecraft', progress: 0 })

    await fs.mkdir(versionsDir, { recursive: true })

    console.log(`[Minecraft] Fetching version manifest...`)
    const manifestUrl = 'https://launcher.mojang.com/v1/objects/d0d0fe2b6ab05408c73c3fc31256c6cc7c122d06/launcher.json'
    let versionManifest = null
    
    try {
      const manifestJson = await new Promise((resolve, reject) => {
        https.get('https://launchermeta.mojang.com/mc/game/version_manifest.json', (res) => {
          let data = ''
          res.on('data', chunk => data += chunk)
          res.on('end', () => {
            try {
              resolve(JSON.parse(data))
            } catch (e) {
              reject(e)
            }
          })
        }).on('error', reject)
      })
      
      versionManifest = manifestJson.versions.find(v => v.id === targetVersion)
      if (!versionManifest) {
        throw new Error(`Version ${targetVersion} not found in manifest`)
      }
      
      console.log(`[Minecraft] Found version ${targetVersion}, downloading...`)
    } catch (err) {
      console.error('[Minecraft] Failed to get manifest:', err)
      throw new Error(`Failed to fetch version manifest: ${err.message}`)
    }

    const versionPath = path.join(versionsDir, `${targetVersion}.json`)
    const versionJsonUrl = versionManifest.url
    
    console.log(`[Minecraft] Downloading version JSON...`)
    event.sender.send('install-progress', { status: 'downloading-minecraft', progress: 10 })
    
    try {
      await downloadFile(versionJsonUrl, versionPath, (progress) => {
        event.sender.send('install-progress', {
          status: 'downloading-minecraft',
          progress: 10 + Math.round(progress.percent * 0.1)
        })
      })
    } catch (err) {
      console.error('[Minecraft] Version JSON download failed:', err)
      throw new Error(`Failed to download version JSON: ${err.message}`)
    }

    let versionJson = null
    try {
      const versionJsonContent = await fs.readFile(versionPath, 'utf8')
      versionJson = JSON.parse(versionJsonContent)
    } catch (err) {
      throw new Error(`Failed to parse version JSON: ${err.message}`)
    }

    const clientJarUrl = versionJson.downloads.client.url
    const clientJarPath = path.join(versionsDir, `${targetVersion}`, `${targetVersion}.jar`)
    
    console.log(`[Minecraft] Creating version directory...`)
    await fs.mkdir(path.dirname(clientJarPath), { recursive: true })
    
    console.log(`[Minecraft] Downloading game JAR (~150MB)...`)
    event.sender.send('install-progress', { status: 'downloading-minecraft', progress: 20 })
    
    try {
      await downloadFile(clientJarUrl, clientJarPath, (progress) => {
        event.sender.send('install-progress', {
          status: 'downloading-minecraft',
          progress: 20 + Math.round(progress.percent * 0.6)
        })
      })
    } catch (err) {
      console.error('[Minecraft] Game JAR download failed:', err)
      throw new Error(`Failed to download game JAR: ${err.message}`)
    }

    console.log(`[Minecraft] Downloading libraries...`)
    event.sender.send('install-progress', { status: 'downloading-minecraft', progress: 80 })
    
    const librariesDir = path.join(gameDir, 'libraries')
    await fs.mkdir(librariesDir, { recursive: true })
    
    if (versionJson.libraries && Array.isArray(versionJson.libraries)) {
      let libCount = 0
      for (const lib of versionJson.libraries) {
        if (!lib.downloads || !lib.downloads.artifact) continue
        
        const libUrl = lib.downloads.artifact.url
        const libPath = path.join(librariesDir, lib.downloads.artifact.path)
        
        try {
          await fs.mkdir(path.dirname(libPath), { recursive: true })
          await downloadFile(libUrl, libPath, () => {})
          libCount++
        } catch (err) {
          console.warn(`[Minecraft] Failed to download library ${lib.name}: ${err.message}`)
        }
      }
      console.log(`[Minecraft] Downloaded ${libCount} libraries`)
    }

    console.log(`[Minecraft] Minecraft ${targetVersion} download complete!`)
    event.sender.send('install-progress', { status: 'minecraft-ready', progress: 100 })
    return { ok: true, message: `Minecraft ${targetVersion} downloaded and ready for Forge installation` }
  } catch (err) {
    console.error('[Minecraft] Error:', err)
    event.sender.send('install-progress', { status: 'error', error: err.message })
    throw err
  }
})
