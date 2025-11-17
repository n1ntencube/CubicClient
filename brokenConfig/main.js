const { app, BrowserWindow, ipcMain, shell } = require('electron')
const path = require('path')
const http = require('http')
const https = require('https')
const fs = require('fs').promises
const { spawn } = require('child_process')
const os = require('os')
const { Client, Authenticator } = require('minecraft-launcher-core')
let mysql
try { mysql = require('mysql2/promise') } catch (e) { console.warn('mysql2 not installed yet') }
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
let minecraftProcess = null
let launcherClient = null
let dbPool = null
let modsDbPool = null

async function getDbPool() {
  if (dbPool) return dbPool
  if (!mysql) throw new Error('mysql2 not available')
  const configPath = path.join(__dirname, 'dbconfig.json')
  let raw
  try { raw = await fs.readFile(configPath, 'utf8') } catch (e) { throw new Error('dbconfig.json missing') }
  let cfg
  try { cfg = JSON.parse(raw) } catch (e) { throw new Error('dbconfig.json invalid JSON') }
  const { host, port, user, password, database } = cfg
  dbPool = mysql.createPool({ host, port, user, password, database, waitForConnections: true, connectionLimit: 5 })
  return dbPool
}

async function getModsDbPool() {
  if (modsDbPool) return modsDbPool
  if (!mysql) throw new Error('mysql2 not available')
  const configPath = path.join(__dirname, 'modsdb.json')
  let raw
  try { raw = await fs.readFile(configPath, 'utf8') } catch (e) { 
    console.warn('[ModsDB] modsdb.json not found, falling back to dbconfig.json')
    return getDbPool()
  }
  let cfg
  try { cfg = JSON.parse(raw) } catch (e) { 
    console.warn('[ModsDB] modsdb.json invalid, falling back to dbconfig.json')
    return getDbPool()
  }
  const { host, port, user, password, database } = cfg
  modsDbPool = mysql.createPool({ host, port, user, password, database, waitForConnections: true, connectionLimit: 5 })
  return modsDbPool
}

async function ensureLuckPermsPlayer(uuid, username) {
  try {
    if (!uuid || !username) return { ok: false, skipped: true, reason: 'missing uuid/username' }
    const pool = await getDbPool()
    const configPath = path.join(__dirname, 'dbconfig.json')
    const raw = await fs.readFile(configPath, 'utf8')
    const cfg = JSON.parse(raw)
    const prefix = cfg.tablePrefix || 'luckperms_'

    const uuidWithDashes = String(uuid).toLowerCase()
    const uuidNoDashes = uuidWithDashes.replace(/-/g, '')

    const [rows] = await pool.query(
      `SELECT uuid FROM \`${prefix}players\` WHERE uuid IN (?, ?) OR LOWER(username) = LOWER(?) LIMIT 1`,
      [uuidWithDashes, uuidNoDashes, username]
    )

    if (rows && rows.length) {
      await pool.query(
        `UPDATE \`${prefix}players\` SET username = ? WHERE uuid = ? OR uuid = ? OR LOWER(username) = LOWER(?)`,
        [username, uuidWithDashes, uuidNoDashes, username]
      )
      return { ok: true, updated: true }
    }

    try {
      await pool.query(
        `INSERT INTO \`${prefix}players\` (uuid, username, primary_group) VALUES (?, ?, ?)`,
        [uuidWithDashes, username, 'default']
      )
      return { ok: true, inserted: true, format: 'dashed' }
    } catch (e1) {
      try {
        await pool.query(
          `INSERT INTO \`${prefix}players\` (uuid, username, primary_group) VALUES (?, ?, ?)`,
          [uuidNoDashes, username, 'default']
        )
        return { ok: true, inserted: true, format: 'nodash' }
      } catch (e2) {
        console.warn('[LuckPerms] Insert failed (both formats):', e1.message, e2.message)
        return { ok: false, error: e2.message }
      }
    }
  } catch (err) {
    console.warn('[LuckPerms] ensure player error:', err.message)
    return { ok: false, error: err.message }
  }
}

ipcMain.handle('get-user-rank', async (_event, payload) => {
  const { uuid, username } = payload || {}
  if (!uuid && !username) return { ok: false, rank: null, error: 'uuid or username required' }
  try {
    const pool = await getDbPool()
    const configPath = path.join(__dirname, 'dbconfig.json')
    const raw = await fs.readFile(configPath, 'utf8')
    const cfg = JSON.parse(raw)
    const prefix = cfg.tablePrefix || 'luckperms_'
    let queryTried = []
    let rank = null

    if (uuid) {
      const uuidWithDashes = uuid.toLowerCase()
      const uuidNoDashes = uuidWithDashes.replace(/-/g, '')
      const [rowsDash] = await pool.query(`SELECT primary_group FROM \`${prefix}players\` WHERE uuid = ? LIMIT 1`, [uuidWithDashes])
      queryTried.push({ by: 'uuid-dash', count: rowsDash.length })
      if (rowsDash.length && rowsDash[0].primary_group) rank = rowsDash[0].primary_group
      if (!rank) {
        const [rowsNoDash] = await pool.query(`SELECT primary_group FROM \`${prefix}players\` WHERE uuid = ? LIMIT 1`, [uuidNoDashes])
        queryTried.push({ by: 'uuid-nodash', count: rowsNoDash.length })
        if (rowsNoDash.length && rowsNoDash[0].primary_group) rank = rowsNoDash[0].primary_group
      }
    }

    if (!rank && username) {
      const [rowsUser] = await pool.query(`SELECT primary_group FROM \`${prefix}players\` WHERE LOWER(username) = LOWER(?) LIMIT 1`, [username])
      queryTried.push({ by: 'username', count: rowsUser.length })
      if (rowsUser.length && rowsUser[0].primary_group) rank = rowsUser[0].primary_group
    }

    console.log('[RankLookup] attempts:', queryTried, 'resolved rank:', rank)
    if (rank) return { ok: true, rank, debug: queryTried }
    return { ok: true, rank: null, debug: queryTried }
  } catch (err) {
    console.error('Rank lookup error:', err)
    return { ok: false, rank: null, error: err.message, debug: 'exception' }
  }
})

function createWindow() {
  mainWindow = new BrowserWindow({
    autoHideMenuBar: true,
    width: 600,
    height: 700,
    resizable: false,
    icon: path.join(__dirname, 'renderer/img/logo_cl_small.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      enableRemoteModule: false
    }
  })

  mainWindow.loadFile(path.join(__dirname, 'renderer/loading.html'))
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
    
    const gameDir = path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), '.cubiclauncher', 'minecraft')
    await fs.mkdir(gameDir, { recursive: true })

    console.log(`[Launcher] Launching Minecraft 1.12.2 with Forge for ${mcProfile.name}`)
    console.log(`[Launcher] Game directory: ${gameDir}`)
    
    // Keep any existing Forge profile directory; it is created by our installer.

    // Forge version to install/use
    const forgeVersion = '14.23.5.2860'
    const forgeProfileId = `1.12.2-forge-${forgeVersion}`
    const forgeProfileDir = path.join(gameDir, 'versions', forgeProfileId)
    const forgeProfileJar = path.join(forgeProfileDir, `${forgeProfileId}.jar`)
    
    try {
      const profileJson = path.join(forgeProfileDir, `${forgeProfileId}.json`)
      await fs.access(profileJson)
      console.log(`[Launcher] Using Forge profile ${forgeProfileId}`)
    } catch (e) {
      console.warn(`[Launcher] Forge profile ${forgeProfileId} not found. The install step may have failed.`)
    }
    
    launcherClient = new Client()

    const launchOptions = {
      authorization: {
        access_token: accessToken,
        client_token: mcProfile.id,
        uuid: mcProfile.id,
        name: mcProfile.name,
        user_properties: '{}',
        meta: { type: 'msa', demo: false }
      },
      root: gameDir,
      version: {
        number: forgeProfileId,
        type: 'release'
      },
      memory: {
        max: '2G',
        min: '1G'
      },
      overrides: {
        detached: false
      }
    }

    if (mainWindow && mainWindow.webContents) {
      mainWindow.webContents.send('minecraft-log', { text: '[Launcher] Starting Minecraft with minecraft-launcher-core...' })
    }

    launcherClient.on('debug', (message) => {
      console.log('[MCLC Debug]', message)
      if (mainWindow && mainWindow.webContents) {
        mainWindow.webContents.send('minecraft-log', { text: `[Debug] ${message}` })
      }
    })

    launcherClient.on('data', (chunk) => {
      try {
        let text = ''
        if (typeof chunk === 'string') text = chunk
        else if (chunk) text = chunk.toString()
        text = text.trim()
        if (!text) return
        console.log('[MC]', text)
        if (mainWindow && mainWindow.webContents) {
          mainWindow.webContents.send('minecraft-log', { text })
        }
      } catch (e) {
        console.error('[MC data parse error]', e)
      }
    })

    launcherClient.on('progress', (progress) => {
      console.log(`[MCLC Progress] ${progress.type}: ${progress.task}/${progress.total}`)
      if (mainWindow && mainWindow.webContents) {
        const percent = Math.round((progress.task / progress.total) * 100)
        mainWindow.webContents.send('install-progress', {
          status: progress.type,
          progress: percent
        })
      }
    })

    launcherClient.on('error', (err) => {
      console.error('[MCLC Error]', err)
      if (mainWindow && mainWindow.webContents) {
        mainWindow.webContents.send('minecraft-log', { text: `[MCLC ERROR] ${err.message || err}` })
        mainWindow.webContents.send('minecraft-error', { error: err.message || String(err) })
      }
    })

    launcherClient.on('close', (code) => {
      const exitCode = (typeof code === 'number') ? code : 0
      const crashed = exitCode !== 0
      console.log(`[Launcher] Minecraft process exited with code ${exitCode}`)
      if (mainWindow && mainWindow.webContents) {
        mainWindow.webContents.send('minecraft-exit', { code: exitCode, crashed })
      }
      minecraftProcess = null
      launcherClient = null
    })

    const sanitizedOptions = JSON.parse(JSON.stringify(launchOptions))
    if (sanitizedOptions.authorization && sanitizedOptions.authorization.access_token) {
      sanitizedOptions.authorization.access_token = '[REDACTED]'
    }
    console.log('[Launcher] Launch options:', JSON.stringify(sanitizedOptions, null, 2))
    launcherClient.launch(launchOptions)

    console.log('[Launcher] Launch initiated')
    return { ok: true, message: 'Minecraft 1.12.2 launched', navigateToConsole: true }
  } catch (err) {
    console.error('[Launcher] Error:', err)
    if (mainWindow && mainWindow.webContents) {
      mainWindow.webContents.send('minecraft-error', { error: err.message })
    }
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
  // Best-effort: add/update player in LuckPerms database
  try {
    const res = await ensureLuckPermsPlayer(profile.id, profile.name)
    if (!res.ok) {
      console.warn('[LuckPerms] upsert skipped/failed:', res)
    } else {
      console.log('[LuckPerms] player ensured:', { uuid: profile.id, username: profile.name, ...res })
    }
  } catch (e) {
    console.warn('[LuckPerms] ensure error:', e.message)
  }
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
    const fsSync = require('fs')

    const requestFile = (requestUrl) => {
      try {
        const parsed = new URL(requestUrl)
        const protoMod = parsed.protocol === 'https:' ? https : http

        const req = protoMod.get(requestUrl, (response) => {
          // Handle redirects (3xx)
          if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
            const nextUrl = new URL(response.headers.location, requestUrl).toString()
            return requestFile(nextUrl)
          }

          if (response.statusCode !== 200) {
            reject(new Error(`Download failed: HTTP ${response.statusCode}`))
            return
          }

          const contentLength = parseInt(response.headers['content-length'] || '0', 10)
          let downloadedLength = 0

          const fileStream = fsSync.createWriteStream(destPath)

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

          response.pipe(fileStream)
          fileStream.on('finish', () => {
            fileStream.close()
            resolve()
          })
          fileStream.on('error', (err) => {
            try { fileStream.close() } catch (_) {}
            fsSync.unlink(destPath, () => {})
            reject(err)
          })
        })

        req.on('error', reject)
      } catch (err) {
        reject(err)
      }
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
    const modsDir = path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), '.cubiclauncher', 'minecraft', 'mods')
    const files = await fs.readdir(modsDir).catch(() => [])
    return files.filter(f => f.endsWith('.jar')).map(f => ({ name: f }))
  } catch (err) {
    return []
  }
})

ipcMain.handle('remove-mod', async (event, { modName }) => {
  try {
    const modPath = path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), '.cubiclauncher', 'minecraft', 'mods', modName)
    await fs.unlink(modPath)
    console.log(`[Mods] Removed: ${modName}`)
    return { ok: true }
  } catch (err) {
    console.error('[Mods] Failed to remove:', err)
    throw err
  }
})

ipcMain.handle('get-nintencube-mods', async () => {
  try {
    console.log('[NintenCube] Fetching mod list from database')
    const pool = await getModsDbPool()
    if (!pool) {
      console.warn('[NintenCube] Database connection not available')
      return { ok: true, mods: [] }
    }

    // Detect columns to support both `mandatory` and legacy `required`
    const [columns] = await pool.query('SHOW COLUMNS FROM mods')
    const columnNames = columns.map(c => c.Field)
    const hasMandatory = columnNames.includes('mandatory')
    const hasRequired = columnNames.includes('required')

    let selectClause = 'SELECT mod_name, mod_url, mod_version'
    // enabled might not exist in some schemas; guard it
    const hasEnabled = columnNames.includes('enabled')
    if (hasEnabled) selectClause += ', enabled'
    if (hasMandatory) selectClause += ', mandatory as mandatory'
    else if (hasRequired) selectClause += ', required as mandatory'
    else selectClause += ', 0 as mandatory'

    let whereParts = []
    if (hasEnabled) whereParts.push('enabled = 1')
    if (hasMandatory) whereParts.push('mandatory = 1')
    else if (hasRequired) whereParts.push('required = 1')
    // If neither column exists, we won't filter for mandatory

    const where = whereParts.length ? (' WHERE ' + whereParts.join(' AND ')) : ''
    const sql = `${selectClause} FROM mods${where} ORDER BY mod_name`

    console.log('[NintenCube] Executing:', sql)
    const [rows] = await pool.query(sql)

    console.log(`[NintenCube] Found ${rows.length} mandatory mods in database`)

    const mods = rows.map(row => ({
      name: row.mod_name,
      url: row.mod_url,
      version: row.mod_version,
      mandatory: Boolean(row.mandatory)
    }))
    return { ok: true, mods }
  } catch (err) {
    console.error('[NintenCube] Database error:', err)
    return { ok: false, mods: [], error: err.message }
  }
})

ipcMain.handle('get-all-mods', async () => {
  try {
    console.log('[ModShop] Fetching all mods from database')
    const pool = await getModsDbPool()
    if (!pool) {
      console.warn('[ModShop] Database connection not available')
      return { ok: false, mods: [], error: 'Database not configured' }
    }

    console.log('[ModShop] Database pool created, checking table structure...')
    
    const [columns] = await pool.query("SHOW COLUMNS FROM mods")
    const columnNames = columns.map(col => col.Field)
    console.log('[ModShop] Available columns:', columnNames)
    
    const hasMandatory = columnNames.includes('mandatory')
    const hasRequired = columnNames.includes('required')
    
    let query = 'SELECT id, mod_name, mod_url, mod_version, enabled, description'
    if (hasMandatory) {
      query += ', mandatory FROM mods ORDER BY mod_name'
    } else if (hasRequired) {
      query += ', required as mandatory FROM mods ORDER BY mod_name'
    } else {
      query += ', 0 as mandatory FROM mods ORDER BY mod_name'
    }
    
    console.log('[ModShop] Executing query:', query)
    const [rows] = await pool.query(query)
    
    console.log(`[ModShop] Found ${rows.length} total mods in database`)
    
    const mods = rows.map(row => ({
      id: row.id,
      name: row.mod_name,
      url: row.mod_url,
      version: row.mod_version,
      enabled: Boolean(row.enabled),
      mandatory: Boolean(row.mandatory),
      description: row.description || ''
    }))
    
    return { ok: true, mods }
  } catch (err) {
    console.error('[ModShop] Database error:', err)
    console.error('[ModShop] Error stack:', err.stack)
    return { ok: false, mods: [], error: err.message }
  }
})

ipcMain.handle('toggle-mod', async (_event, { modId, enable }) => {
  try {
    console.log(`[ModShop] ${enable ? 'Enabling' : 'Disabling'} mod ID ${modId}`)
    const pool = await getModsDbPool()
    if (!pool) {
      return { ok: false, error: 'Database not configured' }
    }

    const [result] = await pool.query(
      'UPDATE mods SET enabled = ? WHERE id = ?',
      [enable ? 1 : 0, modId]
    )
    
    if (result.affectedRows === 0) {
      return { ok: false, error: 'Mod not found' }
    }

    console.log(`[ModShop] Mod ${modId} ${enable ? 'enabled' : 'disabled'} successfully`)
    return { ok: true }
  } catch (err) {
    console.error('[ModShop] Error toggling mod:', err)
    return { ok: false, error: err.message }
  }
})

ipcMain.handle('install-forge-mods', async (event, { modsUrls, onProgress }) => {
  try {
    const gameDir = path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), '.cubiclauncher', 'minecraft')
    const versionsDir = path.join(gameDir, 'versions')
    const modsDir = path.join(gameDir, 'mods')
    const librariesDir = path.join(gameDir, 'libraries')

    console.log('[ForgeInstaller] Starting Forge 1.12.2 installation')
    console.log('[ForgeInstaller] Game dir:', gameDir)

    await fs.mkdir(versionsDir, { recursive: true })
    await fs.mkdir(modsDir, { recursive: true })
    await fs.mkdir(librariesDir, { recursive: true })

    const forgeVersion = '14.23.5.2860'
    const forgeProfileId = `1.12.2-forge-${forgeVersion}`
    const forgeProfileDir = path.join(versionsDir, forgeProfileId)
    const forgeProfileJar = path.join(forgeProfileDir, `${forgeProfileId}.jar`)

    let forgeExists = false
    try {
      await fs.access(forgeProfileJar)
      forgeExists = true
      console.log('[ForgeInstaller] Forge already installed')
      event.sender.send('install-progress', { status: 'installing-forge', progress: 50 })
    } catch (e) {
    }

    // Always ensure LaunchWrapper is available
    console.log('[ForgeInstaller] Ensuring LaunchWrapper...')
    const launchWrapperDir = path.join(librariesDir, 'net', 'minecraft', 'launchwrapper', '1.12')
    await fs.mkdir(launchWrapperDir, { recursive: true })
    const launchWrapperPath = path.join(launchWrapperDir, 'launchwrapper-1.12.jar')
    
    try {
      await fs.access(launchWrapperPath)
      console.log('[ForgeInstaller] LaunchWrapper already exists')
    } catch (e) {
      try {
        console.log('[ForgeInstaller] Downloading LaunchWrapper...')
        await downloadFile(
          'https://libraries.minecraft.net/net/minecraft/launchwrapper/1.12/launchwrapper-1.12.jar',
          launchWrapperPath,
          (progress) => {
            event.sender.send('install-progress', {
              status: 'downloading-forge',
              progress: 30 + Math.round((progress.percent || 0) * 0.1)
            })
          }
        )
        console.log('[ForgeInstaller] LaunchWrapper downloaded')
      } catch (err) {
        console.warn('[ForgeInstaller] LaunchWrapper download failed:', err.message)
      }
    }

    // Ensure Forge library jar exists and matches expected sha1/size
    try {
      const crypto = require('crypto')
      const expectedSha1 = '029250575d3aa2cf80b56dffb66238a1eeaea2ac'
      const expectedSize = 4466148
      const forgeLibDir = path.join(librariesDir, 'net', 'minecraftforge', 'forge', `1.12.2-${forgeVersion}`)
      const forgeLibJar = path.join(forgeLibDir, `forge-1.12.2-${forgeVersion}.jar`)
      await fs.mkdir(forgeLibDir, { recursive: true })

      async function fileSha1(p) {
        try {
          const buf = await fs.readFile(p)
          const hash = crypto.createHash('sha1').update(buf).digest('hex')
          return { ok: true, sha1: hash, size: buf.length }
        } catch (e) {
          return { ok: false }
        }
      }

      async function ensureForgeJarFromSource(sourcePath) {
        try {
          const st = await fs.stat(sourcePath)
          if (st.size > 0) {
            await fs.copyFile(sourcePath, forgeLibJar)
            console.log('[ForgeInstaller] Placed Forge JAR into libraries path')
          }
        } catch (e) {
          // ignore
        }
      }

      let needDownload = true
      try {
        await fs.access(forgeLibJar)
        const info = await fileSha1(forgeLibJar)
        if (info.ok && info.sha1 === expectedSha1 && info.size === expectedSize) {
          needDownload = false
          console.log('[ForgeInstaller] Forge library JAR already valid')
        } else {
          console.warn('[ForgeInstaller] Forge library JAR invalid; will repair')
        }
      } catch (_) {
        // missing, will create
      }

      if (needDownload) {
        // Attempt 1: copy from profile jar if valid
        let repaired = false
        try {
          const st = await fs.stat(forgeProfileJar)
          if (st.size > 0) {
            await ensureForgeJarFromSource(forgeProfileJar)
            const chk = await fileSha1(forgeLibJar)
            if (chk.ok && chk.sha1 === expectedSha1 && chk.size === expectedSize) repaired = true
          }
        } catch (_) {}

        // Attempt 2: extract from Forge installer (contains maven/.../forge-... .jar)
        if (!repaired) {
          try {
            const forgeInstallerUrl = `https://maven.minecraftforge.net/net/minecraftforge/forge/1.12.2-${forgeVersion}/forge-1.12.2-${forgeVersion}-installer.jar`
            const tmpInstaller = path.join(forgeProfileDir, 'forge-installer-repair.jar')
            console.log('[ForgeInstaller] Fetching installer to extract library jar...')
            await downloadFile(forgeInstallerUrl, tmpInstaller, (progress) => {
              event.sender.send('install-progress', {
                status: 'downloading-forge-lib',
                progress: 30 + Math.round((progress.percent || 0) * 0.2)
              })
            })
            const AdmZip = require('adm-zip')
            const zip = new AdmZip(tmpInstaller)
            const mavenEntryPath = `maven/net/minecraftforge/forge/1.12.2-${forgeVersion}/forge-1.12.2-${forgeVersion}.jar`
            const mavenEntry = zip.getEntry(mavenEntryPath)
            if (!mavenEntry) throw new Error('forge library jar not found inside installer')
            await fs.mkdir(path.dirname(forgeLibJar), { recursive: true })
            zip.extractEntryTo(mavenEntry, path.dirname(forgeLibJar), false, true)
            // The extracted filename will be forge-... .jar in the target dir already
            const chk2 = await fileSha1(forgeLibJar)
            if (chk2.ok && chk2.sha1 === expectedSha1 && chk2.size === expectedSize) {
              repaired = true
              console.log('[ForgeInstaller] Extracted valid Forge library from installer')
            } else {
              throw new Error('extracted library failed validation')
            }
            await fs.unlink(tmpInstaller).catch(() => {})
          } catch (e) {
            console.warn('[ForgeInstaller] Installer extraction failed:', e.message)
          }
        }

        if (!repaired) {
          throw new Error('Could not repair Forge library jar')
        }
      }

      // Ensure a copy exists in versions/<forge>/ as the profile jar
      try {
        await fs.mkdir(forgeProfileDir, { recursive: true })
        await fs.access(forgeProfileJar).catch(async () => {
          await fs.copyFile(forgeLibJar, forgeProfileJar)
        })
      } catch (e) {
        console.warn('[ForgeInstaller] Could not ensure forge profile jar:', e.message)
      }
    } catch (libErr) {
      console.warn('[ForgeInstaller] Libraries ensure failed:', libErr.message)
    }

    // Ensure Forge JSON has required fields (downloads.client, assetIndex.url)
    try {
      const forgeJsonFile = path.join(forgeProfileDir, `${forgeProfileId}.json`)
      const baseJsonPath = path.join(versionsDir, '1.12.2', '1.12.2.json')
      const [forgeTxt2, baseTxt2] = await Promise.all([
        fs.readFile(forgeJsonFile, 'utf8'),
        fs.readFile(baseJsonPath, 'utf8')
      ])
      const forgeJson2 = JSON.parse(forgeTxt2)
      const baseJson2 = JSON.parse(baseTxt2)

      if (!forgeJson2.id) forgeJson2.id = forgeProfileId
      if (!forgeJson2.type) forgeJson2.type = 'release'
      if (!forgeJson2.downloads || !forgeJson2.downloads.client) {
        if (baseJson2 && baseJson2.downloads && baseJson2.downloads.client) {
          forgeJson2.downloads = forgeJson2.downloads || {}
          forgeJson2.downloads.client = baseJson2.downloads.client
        }
      }
      if (!forgeJson2.assetIndex || !forgeJson2.assetIndex.url) {
        if (baseJson2 && baseJson2.assetIndex) {
          forgeJson2.assetIndex = baseJson2.assetIndex
          forgeJson2.assets = baseJson2.assetIndex.id
        }
      }

      // Ensure critical base libraries (e.g., Guava) are present
      try {
        const baseLibs = Array.isArray(baseJson2.libraries) ? baseJson2.libraries : []
        const forgeLibs = Array.isArray(forgeJson2.libraries) ? forgeJson2.libraries : []
        const have = new Set(forgeLibs.map(l => l && l.name))
        const critical = baseLibs.filter(l => l && typeof l.name === 'string' && l.name.startsWith('com.google.guava:guava:'))
        for (const lib of critical) {
          if (!have.has(lib.name)) {
            forgeLibs.push(lib)
          }
        }
        forgeJson2.libraries = forgeLibs
      } catch (e) {
        console.warn('[ForgeInstaller] Could not merge critical base libraries:', e.message)
      }

      await fs.writeFile(forgeJsonFile, JSON.stringify(forgeJson2, null, 2), 'utf8')
      console.log('[ForgeInstaller] Ensured Forge profile JSON fields + critical libraries')
    } catch (ensureJsonErr) {
      console.warn('[ForgeInstaller] Could not ensure Forge JSON fields:', ensureJsonErr.message)
    }

    if (!forgeExists) {
      // Download Forge installer instead of universal
      const forgeInstallerUrl = `https://maven.minecraftforge.net/net/minecraftforge/forge/1.12.2-${forgeVersion}/forge-1.12.2-${forgeVersion}-installer.jar`
      const forgeInstallerPath = path.join(forgeProfileDir, 'forge-installer.jar')
      
      console.log('[ForgeInstaller] Downloading Forge installer...')
      event.sender.send('install-progress', { status: 'downloading-forge', progress: 0 })

      await fs.mkdir(forgeProfileDir, { recursive: true })

      try {
        await downloadFile(forgeInstallerUrl, forgeInstallerPath, (progress) => {
          console.log(`[ForgeInstaller] Download progress: ${progress.percent}%`)
          event.sender.send('install-progress', {
            status: 'downloading-forge',
            progress: Math.round((progress.percent || 0) * 0.3)
          })
        })
        console.log('[ForgeInstaller] Forge installer downloaded')
        
        // Extract version.json and universal JAR from installer
        console.log('[ForgeInstaller] Extracting Forge files from installer...')
        const AdmZip = require('adm-zip')
        const zip = new AdmZip(forgeInstallerPath)
        
        // Extract version.json
        const versionEntry = zip.getEntry('version.json')
        if (versionEntry) {
          zip.extractEntryTo(versionEntry, forgeProfileDir, false, true)
          const extractedVersionPath = path.join(forgeProfileDir, 'version.json')
          await fs.rename(extractedVersionPath, path.join(forgeProfileDir, `${forgeProfileId}.json`))
          console.log('[ForgeInstaller] Extracted version.json')
        }

        // Extract universal JAR (into forge profile dir), then rename to <forgeProfileId>.jar
        const universalEntry = zip.getEntry(`maven/net/minecraftforge/forge/1.12.2-${forgeVersion}/forge-1.12.2-${forgeVersion}-universal.jar`)
        if (universalEntry) {
          zip.extractEntryTo(universalEntry, forgeProfileDir, false, true)
          const extractedUniversal = path.join(forgeProfileDir, `forge-1.12.2-${forgeVersion}-universal.jar`)
          try {
            await fs.rename(extractedUniversal, forgeProfileJar)
          } catch (_) {}
          console.log('[ForgeInstaller] Extracted universal JAR')

          // Also place the forge library jar extracted from installer (non-universal) into libraries path
          try {
            const forgeLibDir = path.join(librariesDir, 'net', 'minecraftforge', 'forge', `1.12.2-${forgeVersion}`)
            const forgeLibJar = path.join(forgeLibDir, `forge-1.12.2-${forgeVersion}.jar`)
            await fs.mkdir(forgeLibDir, { recursive: true })
            const mavenEntryPath = `maven/net/minecraftforge/forge/1.12.2-${forgeVersion}/forge-1.12.2-${forgeVersion}.jar`
            const mavenEntry = zip.getEntry(mavenEntryPath)
            if (mavenEntry) {
              zip.extractEntryTo(mavenEntry, forgeLibDir, false, true)
              console.log('[ForgeInstaller] Extracted Forge library JAR to libraries path')
            } else {
              // Fallback: copy universal as placeholder (will be validated later)
              await fs.copyFile(forgeProfileJar, forgeLibJar)
              console.warn('[ForgeInstaller] Library JAR not found in installer, copied universal instead')
            }
          } catch (copyErr) {
            console.warn('[ForgeInstaller] Could not place Forge JAR to libraries:', copyErr.message)
          }
        }

        // Ensure Forge JSON has downloads.client by copying from base 1.12.2 JSON
        try {
          const forgeJsonFile = path.join(forgeProfileDir, `${forgeProfileId}.json`)
          const baseJsonPath = path.join(versionsDir, '1.12.2', '1.12.2.json')
          const [forgeTxt, baseTxt] = await Promise.all([
            fs.readFile(forgeJsonFile, 'utf8'),
            fs.readFile(baseJsonPath, 'utf8')
          ])
          const forgeJson = JSON.parse(forgeTxt)
          const baseJson = JSON.parse(baseTxt)

          if (!forgeJson.id) forgeJson.id = forgeProfileId
          if (!forgeJson.type) forgeJson.type = 'release'
          if (!forgeJson.downloads || !forgeJson.downloads.client) {
            if (baseJson && baseJson.downloads && baseJson.downloads.client) {
              forgeJson.downloads = forgeJson.downloads || {}
              forgeJson.downloads.client = baseJson.downloads.client
            }
          }

          // Ensure assetIndex has url and assets is set
          if (!forgeJson.assetIndex || !forgeJson.assetIndex.url) {
            if (baseJson && baseJson.assetIndex) {
              forgeJson.assetIndex = baseJson.assetIndex
              forgeJson.assets = baseJson.assetIndex.id
            }
          }

          // Ensure critical base libraries (e.g., Guava) are present
          try {
            const baseLibs = Array.isArray(baseJson.libraries) ? baseJson.libraries : []
            const forgeLibs = Array.isArray(forgeJson.libraries) ? forgeJson.libraries : []
            const have = new Set(forgeLibs.map(l => l && l.name))
            const critical = baseLibs.filter(l => l && typeof l.name === 'string' && l.name.startsWith('com.google.guava:guava:'))
            for (const lib of critical) {
              if (!have.has(lib.name)) {
                forgeLibs.push(lib)
              }
            }
            forgeJson.libraries = forgeLibs
          } catch (e) {
            console.warn('[ForgeInstaller] Could not merge critical base libraries:', e.message)
          }

          await fs.writeFile(forgeJsonFile, JSON.stringify(forgeJson, null, 2), 'utf8')
          console.log('[ForgeInstaller] Normalized Forge profile JSON (assets + critical libs)')
        } catch (normErr) {
          console.warn('[ForgeInstaller] Could not normalize Forge JSON:', normErr.message)
        }
        
        // Clean up installer
        await fs.unlink(forgeInstallerPath).catch(() => {})
        
      } catch (err) {
        console.error('[ForgeInstaller] Forge installer download/extract failed:', err)
        throw new Error(`Failed to install Forge: ${err.message}`)
      }
    }

    console.log('[ForgeInstaller] Forge installation complete')
    event.sender.send('install-progress', { status: 'complete', progress: 100 })

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
          console.error(`[ForgeInstaller] Failed to download mod ${modName}:`, err.message)
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
  const gameDir = path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), '.cubiclauncher', 'minecraft')
  await fs.mkdir(gameDir, { recursive: true })
  return gameDir
})

ipcMain.handle('resize-window', async (event, { width, height }) => {
  if (mainWindow) {
    mainWindow.setSize(width, height)
    mainWindow.setResizable(true)
    mainWindow.center()
  }
  return { ok: true }
})

ipcMain.handle('kill-minecraft', async () => {
  if (minecraftProcess) {
    try {
      minecraftProcess.kill()
      return { ok: true, message: 'Process killed' }
    } catch (err) {
      throw new Error(`Failed to kill process: ${err.message}`)
    }
  }
  return { ok: false, message: 'No process running' }
})

ipcMain.handle('download-minecraft', async (event, { version }) => {
  try {
    const gameDir = path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), '.cubiclauncher', 'minecraft')
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
      if (!versionManifest.url) {
        throw new Error(`Version ${targetVersion} has no download URL`)
      }
      
      console.log(`[Minecraft] Found version ${targetVersion}, downloading...`)
    } catch (err) {
      console.error('[Minecraft] Failed to get manifest:', err)
      throw new Error(`Failed to fetch version manifest: ${err.message}`)
    }

    const versionDir = path.join(versionsDir, `${targetVersion}`)
    await fs.mkdir(versionDir, { recursive: true })
    const versionPath = path.join(versionDir, `${targetVersion}.json`)
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

    if (!versionJson.downloads || !versionJson.downloads.client || !versionJson.downloads.client.url) {
      throw new Error('Version JSON missing client download information')
    }
    const clientJarUrl = versionJson.downloads.client.url
    const clientJarPath = path.join(versionDir, `${targetVersion}.jar`)
    
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
        if (!lib.downloads || !lib.downloads.artifact || !lib.downloads.artifact.url) continue
        
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

    // Download asset index
    if (versionJson.assetIndex && versionJson.assetIndex.url) {
      console.log(`[Minecraft] Downloading asset index...`)
      const assetsDir = path.join(gameDir, 'assets', 'indexes')
      await fs.mkdir(assetsDir, { recursive: true })
      const assetIndexPath = path.join(assetsDir, `${versionJson.assetIndex.id}.json`)
      
      try {
        await downloadFile(versionJson.assetIndex.url, assetIndexPath, () => {})
        console.log(`[Minecraft] Asset index downloaded`)
        
        // Download assets
        const assetIndexContent = await fs.readFile(assetIndexPath, 'utf8')
        const assetIndex = JSON.parse(assetIndexContent)
        
        if (assetIndex.objects) {
          console.log(`[Minecraft] Downloading ${Object.keys(assetIndex.objects).length} assets...`)
          const objectsDir = path.join(gameDir, 'assets', 'objects')
          let assetCount = 0
          
          for (const [assetName, assetInfo] of Object.entries(assetIndex.objects)) {
            if (!assetInfo.hash) continue
            
            const hashPrefix = assetInfo.hash.substring(0, 2)
            const assetPath = path.join(objectsDir, hashPrefix, assetInfo.hash)
            
            // Skip if already exists
            try {
              await fs.access(assetPath)
              continue
            } catch (e) {
              // File doesn't exist, download it
            }
            
            const assetUrl = `https://resources.download.minecraft.net/${hashPrefix}/${assetInfo.hash}`
            
            try {
              await fs.mkdir(path.dirname(assetPath), { recursive: true })
              await downloadFile(assetUrl, assetPath, () => {})
              assetCount++
              
              if (assetCount % 100 === 0) {
                console.log(`[Minecraft] Downloaded ${assetCount} assets...`)
                event.sender.send('install-progress', { 
                  status: 'downloading-assets', 
                  progress: 85 + Math.round((assetCount / Object.keys(assetIndex.objects).length) * 15)
                })
              }
            } catch (err) {
              console.warn(`[Minecraft] Failed to download asset ${assetName}: ${err.message}`)
            }
          }
          console.log(`[Minecraft] Downloaded ${assetCount} new assets`)
        }
      } catch (err) {
        console.warn(`[Minecraft] Failed to download assets: ${err.message}`)
      }
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
