const { app, BrowserWindow, ipcMain, shell } = require('electron')
const path = require('path')
const http = require('http')
const https = require('https')
const fs = require('fs').promises
const { spawn } = require('child_process')
const os = require('os')
const crypto = require('crypto')
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
    
    const gameDir = path.join(app.getPath('appData'), '.cubiclauncher', 'minecraft')
    await fs.mkdir(gameDir, { recursive: true })

    console.log(`[Launcher] Launching Minecraft 1.12.2 with Forge for ${mcProfile.name}`)
    console.log(`[Launcher] Game directory: ${gameDir}`)
    
    const brokenForgeDir = path.join(gameDir, 'versions', '1.12.2-forge14.23.5.2860')
    try {
      await fs.rm(brokenForgeDir, { recursive: true, force: true })
      console.log('[Launcher] Removed previous Forge version directory to ensure clean setup.')
    } catch (e) {
    }

    const forgeVersion = '14.23.5.2860'
    const forgeProfileId = `1.12.2-forge-${forgeVersion}`
    const forgeProfileDir = path.join(gameDir, 'versions', forgeProfileId)
    const forgeProfileJar = path.join(forgeProfileDir, `${forgeProfileId}.jar`)
    const forgeUniversalName = `forge-1.12.2-${forgeVersion}-universal.jar`
    const forgeUniversalPath = path.join(gameDir, forgeUniversalName)
    const forgeUniversalUrl = `https://maven.minecraftforge.net/net/minecraftforge/forge/1.12.2-${forgeVersion}/${forgeUniversalName}`

    let forgeExists = false
    try {
      const profileJson = path.join(forgeProfileDir, `${forgeProfileId}.json`)
      await fs.access(profileJson)
      forgeExists = true
      console.log(`[Launcher] Using Forge profile ${forgeProfileId}`)
    } catch (e) {
      console.log('[Launcher] Forge profile not found, will download...')
      try {
        await fs.mkdir(forgeProfileDir, { recursive: true })
        
        await new Promise((resolve, reject) => {
          https.get(forgeUniversalUrl, (res) => {
            if (res.statusCode !== 200) {
              reject(new Error(`Forge download failed HTTP ${res.statusCode}`))
              return
            }
            const fileStream = require('fs').createWriteStream(forgeProfileJar)
            res.pipe(fileStream)
            fileStream.on('finish', () => fileStream.close(resolve))
            fileStream.on('error', reject)
          }).on('error', reject)
        })
        
        const forgeProfileData = {
          id: forgeProfileId,
          inheritsFrom: '1.12.2',
          releaseTime: new Date().toISOString(),
          time: new Date().toISOString(),
          type: 'release',
          mainClass: 'net.minecraft.launchwrapper.Launch',
          minecraftArguments: '--username ${auth_player_name} --version ${version_name} --gameDir ${game_directory} --assetsDir ${assets_root} --assetIndex ${assets_index_name} --uuid ${auth_uuid} --accessToken ${auth_access_token} --userType ${user_type} --tweakClass net.minecraftforge.fml.common.launcher.FMLTweaker',
          libraries: [
            {
              name: 'net.minecraftforge:forge:1.12.2-14.23.5.2860',
              downloads: {
                artifact: {
                  path: `versions/${forgeProfileId}/${forgeProfileId}.jar`,
                  url: '',
                  sha1: '',
                  size: 0
                }
              }
            },
            {
              name: 'net.minecraft:launchwrapper:1.12',
              downloads: {
                artifact: {
                  path: 'net/minecraft/launchwrapper/1.12/launchwrapper-1.12.jar',
                  url: 'https://libraries.minecraft.net/net/minecraft/launchwrapper/1.12/launchwrapper-1.12.jar',
                  sha1: '111e7bea9c968cdb3d06ef4ea43dae71fa27cf3c',
                  size: 32999
                }
              }
            },
            {
              name: 'org.ow2.asm:asm-all:5.2',
              downloads: {
                artifact: {
                  path: 'org/ow2/asm/asm-all/5.2/asm-all-5.2.jar',
                  url: 'https://libraries.minecraft.net/org/ow2/asm/asm-all/5.2/asm-all-5.2.jar',
                  sha1: '3354e11e2b34215f06dab629ab88e06aca477c19',
                  size: 247742
                }
              }
            },
            {
              name: 'org.ow2.asm:asm:5.2',
              downloads: {
                artifact: {
                  path: 'org/ow2/asm/asm/5.2/asm-5.2.jar',
                  url: 'https://maven.minecraftforge.net/org/ow2/asm/asm/5.2/asm-5.2.jar',
                  sha1: '4ce3ecdc7115bcbf9d4ff4e6ec638e60760819df',
                  size: 53043
                }
              }
            },
            {
              name: 'org.ow2.asm:asm-commons:5.2',
              downloads: {
                artifact: {
                  path: 'org/ow2/asm/asm-commons/5.2/asm-commons-5.2.jar',
                  url: 'https://maven.minecraftforge.net/org/ow2/asm/asm-commons/5.2/asm-commons-5.2.jar',
                  sha1: 'adc56f649d9177e99e36e7e6c9a8f9185e6e4a5d',
                  size: 66393
                }
              }
            },
            {
              name: 'org.ow2.asm:asm-tree:5.2',
              downloads: {
                artifact: {
                  path: 'org/ow2/asm/asm-tree/5.2/asm-tree-5.2.jar',
                  url: 'https://maven.minecraftforge.net/org/ow2/asm/asm-tree/5.2/asm-tree-5.2.jar',
                  sha1: '368b0c18c3310e5d66039cfb9e9ec393c5bf0d01',
                  size: 50689
                }
              }
            },
            {
              name: 'com.typesafe.akka:akka-actor_2.11:2.3.3',
              downloads: {
                artifact: {
                  path: 'com/typesafe/akka/akka-actor_2.11/2.3.3/akka-actor_2.11-2.3.3.jar',
                  url: 'https://libraries.minecraft.net/com/typesafe/akka/akka-actor_2.11/2.3.3/akka-actor_2.11-2.3.3.jar',
                  sha1: '25a0633456c8aafba9b9e8dde736695ca2d1532a',
                  size: 2476675
                }
              }
            },
            {
              name: 'com.typesafe:config:1.2.1',
              downloads: {
                artifact: {
                  path: 'com/typesafe/config/1.2.1/config-1.2.1.jar',
                  url: 'https://libraries.minecraft.net/com/typesafe/config/1.2.1/config-1.2.1.jar',
                  sha1: 'f771f71fdae3df231bcd54d5ca2d57f0bf93f467',
                  size: 219554
                }
              }
            },
            {
              name: 'org.scala-lang:scala-actors-migration_2.11:1.1.0',
              downloads: {
                artifact: {
                  path: 'org/scala-lang/scala-actors-migration_2.11/1.1.0/scala-actors-migration_2.11-1.1.0.jar',
                  url: 'https://libraries.minecraft.net/org/scala-lang/scala-actors-migration_2.11/1.1.0/scala-actors-migration_2.11-1.1.0.jar',
                  sha1: '5f5e4affe0e0c7c6e2f1ea4c7095e9bdac4b65c7',
                  size: 58171
                }
              }
            },
            {
              name: 'org.scala-lang:scala-compiler:2.11.1',
              downloads: {
                artifact: {
                  path: 'org/scala-lang/scala-compiler/2.11.1/scala-compiler-2.11.1.jar',
                  url: 'https://libraries.minecraft.net/org/scala-lang/scala-compiler/2.11.1/scala-compiler-2.11.1.jar',
                  sha1: '56ea2e6c025e0821f28d73ca271218b8dd04874a',
                  size: 13449765
                }
              }
            },
            {
              name: 'org.scala-lang.plugins:scala-continuations-library_2.11:1.0.2',
              downloads: {
                artifact: {
                  path: 'org/scala-lang/plugins/scala-continuations-library_2.11/1.0.2/scala-continuations-library_2.11-1.0.2.jar',
                  url: 'https://libraries.minecraft.net/org/scala-lang/plugins/scala-continuations-library_2.11/1.0.2/scala-continuations-library_2.11-1.0.2.jar',
                  sha1: '53c61e3823e3e2ebc7cb70c20b4b7e90c7cf5c2b',
                  size: 23868
                }
              }
            },
            {
              name: 'org.scala-lang.plugins:scala-continuations-plugin_2.11.1:1.0.2',
              downloads: {
                artifact: {
                  path: 'org/scala-lang/plugins/scala-continuations-plugin_2.11.1/1.0.2/scala-continuations-plugin_2.11.1-1.0.2.jar',
                  url: 'https://libraries.minecraft.net/org/scala-lang/plugins/scala-continuations-plugin_2.11.1/1.0.2/scala-continuations-plugin_2.11.1-1.0.2.jar',
                  sha1: 'fef1e0027e6e5ab36fdf50db203fc2ecb85af50d',
                  size: 206599
                }
              }
            },
            {
              name: 'org.scala-lang:scala-library:2.11.1',
              downloads: {
                artifact: {
                  path: 'org/scala-lang/scala-library/2.11.1/scala-library-2.11.1.jar',
                  url: 'https://libraries.minecraft.net/org/scala-lang/scala-library/2.11.1/scala-library-2.11.1.jar',
                  sha1: '0e11da23da3eabab9f4777b9220e60d44c1aab6a',
                  size: 5538130
                }
              }
            },
            {
              name: 'org.scala-lang:scala-parser-combinators_2.11:1.0.1',
              downloads: {
                artifact: {
                  path: 'org/scala-lang/scala-parser-combinators_2.11/1.0.1/scala-parser-combinators_2.11-1.0.1.jar',
                  url: 'https://libraries.minecraft.net/org/scala-lang/scala-parser-combinators_2.11/1.0.1/scala-parser-combinators_2.11-1.0.1.jar',
                  sha1: 'f05d7345bf5a58924f2837c6c1f4d73a938e1ff0',
                  size: 419701
                }
              }
            },
            {
              name: 'org.scala-lang:scala-reflect:2.11.1',
              downloads: {
                artifact: {
                  path: 'org/scala-lang/scala-reflect/2.11.1/scala-reflect-2.11.1.jar',
                  url: 'https://libraries.minecraft.net/org/scala-lang/scala-reflect/2.11.1/scala-reflect-2.11.1.jar',
                  sha1: '6580347e61cc7f8e802941e7fde40fa83b8badeb',
                  size: 4372467
                }
              }
            },
            {
              name: 'org.scala-lang:scala-swing_2.11:1.0.1',
              downloads: {
                artifact: {
                  path: 'org/scala-lang/scala-swing_2.11/1.0.1/scala-swing_2.11-1.0.1.jar',
                  url: 'https://libraries.minecraft.net/org/scala-lang/scala-swing_2.11/1.0.1/scala-swing_2.11-1.0.1.jar',
                  sha1: 'b1cdd92bd47b1e1837139c1c53020e86bb9112ae',
                  size: 726500
                }
              }
            },
            {
              name: 'org.scala-lang:scala-xml_2.11:1.0.2',
              downloads: {
                artifact: {
                  path: 'org/scala-lang/scala-xml_2.11/1.0.2/scala-xml_2.11-1.0.2.jar',
                  url: 'https://libraries.minecraft.net/org/scala-lang/scala-xml_2.11/1.0.2/scala-xml_2.11-1.0.2.jar',
                  sha1: '820fbca7e524b530fdadc594c39d49a21ea0337e',
                  size: 648679
                }
              }
            },
            {
              name: 'lzma:lzma:0.0.1',
              downloads: {
                artifact: {
                  path: 'lzma/lzma/0.0.1/lzma-0.0.1.jar',
                  url: 'https://libraries.minecraft.net/lzma/lzma/0.0.1/lzma-0.0.1.jar',
                  sha1: '521616dc7487b42bef0e803bd2fa3faf668101d7',
                  size: 5762
                }
              }
            },
            {
              name: 'java3d:vecmath:1.5.2',
              downloads: {
                artifact: {
                  path: 'java3d/vecmath/1.5.2/vecmath-1.5.2.jar',
                  url: 'https://libraries.minecraft.net/java3d/vecmath/1.5.2/vecmath-1.5.2.jar',
                  sha1: '79846ba34cbd89e2422d74d53752f993dcc2ccaf',
                  size: 318956
                }
              }
            },
            {
              name: 'net.sf.trove4j:trove4j:3.0.3',
              downloads: {
                artifact: {
                  path: 'net/sf/trove4j/trove4j/3.0.3/trove4j-3.0.3.jar',
                  url: 'https://libraries.minecraft.net/net/sf/trove4j/trove4j/3.0.3/trove4j-3.0.3.jar',
                  sha1: '42ccaf4761f0dfdfa805c9e340d99a755907e2dd',
                  size: 2523218
                }
              }
            },
            {
              name: 'com.mojang:authlib:1.5.25',
              downloads: {
                artifact: {
                  path: 'com/mojang/authlib/1.5.25/authlib-1.5.25.jar',
                  url: 'https://libraries.minecraft.net/com/mojang/authlib/1.5.25/authlib-1.5.25.jar',
                  sha1: '9834cdf236c22e84b946bba989e2f94ef5897c3c',
                  size: 64227
                }
              }
            },
            {
              name: 'net.sf.jopt-simple:jopt-simple:5.0.3',
              downloads: {
                artifact: {
                  path: 'net/sf/jopt-simple/jopt-simple/5.0.3/jopt-simple-5.0.3.jar',
                  url: 'https://libraries.minecraft.net/net/sf/jopt-simple/jopt-simple/5.0.3/jopt-simple-5.0.3.jar',
                  sha1: 'cdd846cfc4e0f7eefafc02c0f5dce32b9303aa2a',
                  size: 78175
                }
              }
            },
            {
              name: 'com.google.guava:guava:21.0',
              downloads: {
                artifact: {
                  path: 'com/google/guava/guava/21.0/guava-21.0.jar',
                  url: 'https://libraries.minecraft.net/com/google/guava/guava/21.0/guava-21.0.jar',
                  sha1: '3a3d111be1be1b745edfa7d91678a12d7ed38709',
                  size: 2521113
                }
              }
            },
            {
              name: 'org.apache.commons:commons-lang3:3.5',
              downloads: {
                artifact: {
                  path: 'org/apache/commons/commons-lang3/3.5/commons-lang3-3.5.jar',
                  url: 'https://libraries.minecraft.net/org/apache/commons/commons-lang3/3.5/commons-lang3-3.5.jar',
                  sha1: '6c6c702c89bfff3cd9e80b04d668c5e190d588c6',
                  size: 479881
                }
              }
            },
            {
              name: 'commons-io:commons-io:2.5',
              downloads: {
                artifact: {
                  path: 'commons-io/commons-io/2.5/commons-io-2.5.jar',
                  url: 'https://libraries.minecraft.net/commons-io/commons-io/2.5/commons-io-2.5.jar',
                  sha1: '2852e6e05fbb95076fc091f6d1780f1f8fe35e0f',
                  size: 208683
                }
              }
            },
            {
              name: 'commons-codec:commons-codec:1.10',
              downloads: {
                artifact: {
                  path: 'commons-codec/commons-codec/1.10/commons-codec-1.10.jar',
                  url: 'https://libraries.minecraft.net/commons-codec/commons-codec/1.10/commons-codec-1.10.jar',
                  sha1: '4b95f4897fa13f2cd904aee711aeafc0c5295cd8',
                  size: 284184
                }
              }
            },
            {
              name: 'com.google.code.gson:gson:2.8.0',
              downloads: {
                artifact: {
                  path: 'com/google/code/gson/gson/2.8.0/gson-2.8.0.jar',
                  url: 'https://libraries.minecraft.net/com/google/code/gson/gson/2.8.0/gson-2.8.0.jar',
                  sha1: 'c4ba5371a29ac9b2ad6129b1d39ea38750043eff',
                  size: 231952
                }
              }
            },
            {
              name: 'org.apache.logging.log4j:log4j-api:2.8.1',
              downloads: {
                artifact: {
                  path: 'org/apache/logging/log4j/log4j-api/2.8.1/log4j-api-2.8.1.jar',
                  url: 'https://libraries.minecraft.net/org/apache/logging/log4j/log4j-api/2.8.1/log4j-api-2.8.1.jar',
                  sha1: 'e801d13612e22cad62a3f4f3fe7fdbe6334a8e72',
                  size: 232371
                }
              }
            },
            {
              name: 'org.apache.logging.log4j:log4j-core:2.8.1',
              downloads: {
                artifact: {
                  path: 'org/apache/logging/log4j/log4j-core/2.8.1/log4j-core-2.8.1.jar',
                  url: 'https://libraries.minecraft.net/org/apache/logging/log4j/log4j-core/2.8.1/log4j-core-2.8.1.jar',
                  sha1: '4ac28ff2f1ddf05dae3043a190451e8c46b73c31',
                  size: 1150301
                }
              }
            },
            {
              name: 'org.apache.maven:maven-artifact:3.5.3',
              downloads: {
                artifact: {
                  path: 'org/apache/maven/maven-artifact/3.5.3/maven-artifact-3.5.3.jar',
                  url: 'https://libraries.minecraft.net/org/apache/maven/maven-artifact/3.5.3/maven-artifact-3.5.3.jar',
                  sha1: '7dc72b6d6d8a6dced3d294ed54c2cc3515ade9f4',
                  size: 54961
                }
              }
            }
          ],
          jar: '1.12.2'
        }
        
        const profileJson = path.join(forgeProfileDir, `${forgeProfileId}.json`)
        await fs.writeFile(profileJson, JSON.stringify(forgeProfileData, null, 2), 'utf8')
        forgeExists = true
        console.log('[Launcher] Forge profile created successfully.')
      } catch (err) {
        console.error('[Launcher] Failed to set up Forge:', err)
      }
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
        number: forgeExists ? forgeProfileId : '1.12.2',
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

    console.log('[Launcher] Launching version:', forgeExists ? forgeProfileId : '1.12.2')
    if (mainWindow && mainWindow.webContents) {
      mainWindow.webContents.send('minecraft-log', { text: `[Launcher] Starting Minecraft ${forgeExists ? 'with Forge ' + forgeVersion : '1.12.2 (Vanilla)'}...` })
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

async function calculateSHA1(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha1')
    const stream = require('fs').createReadStream(filePath)
    
    stream.on('data', chunk => hash.update(chunk))
    stream.on('end', () => resolve(hash.digest('hex')))
    stream.on('error', reject)
  })
}

async function downloadFileWithChecksum(url, destPath, expectedSha1, onProgress, maxRetries = 3) {
  const fsSync = require('fs')
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`[Download] Attempt ${attempt}/${maxRetries}: ${path.basename(destPath)}`)
      
      await downloadFile(url, destPath, onProgress)
      
      if (!expectedSha1) {
        console.log(`[Download] No checksum provided for ${path.basename(destPath)}, skipping verification`)
        return
      }
      
      console.log(`[Download] Verifying checksum for ${path.basename(destPath)}...`)
      const actualSha1 = await calculateSHA1(destPath)
      
      if (actualSha1.toLowerCase() === expectedSha1.toLowerCase()) {
        console.log(`[Download] ✓ Checksum verified: ${path.basename(destPath)}`)
        return
      }
      
      console.warn(`[Download] ✗ Checksum mismatch for ${path.basename(destPath)}`)
      console.warn(`[Download]   Expected: ${expectedSha1}`)
      console.warn(`[Download]   Got:      ${actualSha1}`)
      
      try {
        fsSync.unlinkSync(destPath)
        console.log(`[Download] Deleted corrupted file`)
      } catch (e) {
        console.error(`[Download] Failed to delete corrupted file:`, e)
      }
      
      if (attempt < maxRetries) {
        console.log(`[Download] Retrying download...`)
        await new Promise(resolve => setTimeout(resolve, 1000 * attempt)) // Exponential backoff
      } else {
        throw new Error(`Checksum verification failed after ${maxRetries} attempts. Expected: ${expectedSha1}, Got: ${actualSha1}. The file may be corrupted on the server.`)
      }
    } catch (err) {
      try {
        if (fsSync.existsSync(destPath)) {
          fsSync.unlinkSync(destPath)
        }
      } catch (e) {}
      
      if (attempt >= maxRetries) {
        throw err
      }
      
      console.error(`[Download] Attempt ${attempt} failed:`, err.message)
      await new Promise(resolve => setTimeout(resolve, 1000 * attempt))
    }
  }
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
    const modsDir = path.join(app.getPath('appData'), '.cubiclauncher', 'minecraft', 'mods')
    const files = await fs.readdir(modsDir).catch(() => [])
    return files.filter(f => f.endsWith('.jar')).map(f => ({ name: f }))
  } catch (err) {
    return []
  }
})

ipcMain.handle('remove-mod', async (event, { modName }) => {
  try {
    const modPath = path.join(app.getPath('appData'), '.cubiclauncher', 'minecraft', 'mods', modName)
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

    // Check for mandatory or required column
    const [columns] = await pool.query("SHOW COLUMNS FROM mods")
    const columnNames = columns.map(col => col.Field)
    const hasMandatory = columnNames.includes('mandatory')
    const hasRequired = columnNames.includes('required')
    
    let query = 'SELECT mod_name, mod_url, mod_version, enabled'
    if (hasMandatory) {
      query += ', mandatory as required FROM mods WHERE enabled = 1 AND mandatory = 1 ORDER BY mod_name'
    } else if (hasRequired) {
      query += ', required FROM mods WHERE enabled = 1 AND required = 1 ORDER BY mod_name'
    } else {
      query += ', 0 as required FROM mods WHERE enabled = 1 ORDER BY mod_name'
    }

    const [rows] = await pool.query(query)
    
    console.log(`[NintenCube] Found ${rows.length} enabled mandatory mods in database`)
    
    const mods = rows.map(row => ({
      name: row.mod_name,
      url: row.mod_url,
      version: row.mod_version,
      required: Boolean(row.required)
    }))
    
    return { ok: true, mods }
  } catch (err) {
    console.error('[NintenCube] Database error:', err)
    return { ok: false, mods: [], error: err.message }
  }
})

// Mod Repository handlers
ipcMain.handle('get-all-mods', async () => {
  try {
    console.log('[ModRepository] Fetching all mods from database')
    const pool = await getModsDbPool()
    if (!pool) {
      console.warn('[ModRepository] Database connection not available')
      return { ok: false, mods: [], error: 'Database not configured' }
    }

    // Check for mandatory or required column
    const [columns] = await pool.query("SHOW COLUMNS FROM mods")
    const columnNames = columns.map(col => col.Field)
    console.log('[ModRepository] Available columns:', columnNames)
    
    const hasMandatory = columnNames.includes('mandatory')
    const hasRequired = columnNames.includes('required')
    
    let query = 'SELECT id, mod_name, mod_url, mod_version, enabled, description'
    if (hasMandatory) {
      query += ', mandatory FROM mods ORDER BY mandatory DESC, mod_name'
    } else if (hasRequired) {
      query += ', required as mandatory FROM mods ORDER BY required DESC, mod_name'
    } else {
      query += ', 0 as mandatory FROM mods ORDER BY mod_name'
    }
    
    console.log('[ModRepository] Executing query:', query)
    const [rows] = await pool.query(query)
    
    console.log(`[ModRepository] Found ${rows.length} total mods in database`)
    
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
    console.error('[ModRepository] Database error:', err)
    console.error('[ModRepository] Error stack:', err.stack)
    return { ok: false, mods: [], error: err.message }
  }
})

ipcMain.handle('install-mod', async (event, { modUrl, modName }) => {
  try {
    console.log(`[ModRepository] Installing mod: ${modName} from ${modUrl}`)
    const modsDir = path.join(app.getPath('appData'), '.cubiclauncher', 'minecraft', 'mods')
    await fs.mkdir(modsDir, { recursive: true })
    
    const fileName = path.basename(new URL(modUrl).pathname)
    const modPath = path.join(modsDir, fileName)
    
    await downloadFileWithChecksum(modUrl, modPath, null, (progress) => {
      console.log(`[ModRepository] Download progress: ${progress.percent}%`)
    })
    
    console.log(`[ModRepository] Successfully installed: ${fileName}`)
    return { ok: true, fileName }
  } catch (err) {
    console.error('[ModRepository] Error installing mod:', err)
    return { ok: false, error: err.message }
  }
})

ipcMain.handle('install-forge-mods', async (event, { modsUrls, onProgress }) => {
  try {
    const gameDir = path.join(app.getPath('appData'), '.cubiclauncher', 'minecraft')
    const versionsDir = path.join(gameDir, 'versions')
    const modsDir = path.join(gameDir, 'mods')
    const librariesDir = path.join(gameDir, 'libraries')

    console.log('[ForgeInstaller] Starting Forge 1.12.2 installation')
    console.log('[ForgeInstaller] Game dir:', gameDir)

    await fs.mkdir(versionsDir, { recursive: true })
    await fs.mkdir(modsDir, { recursive: true })
    await fs.mkdir(librariesDir, { recursive: true })

    const forgeVersion = '14.23.5.2860'
    const forgeProfileDir = path.join(versionsDir, `1.12.2-forge${forgeVersion}`)
    const forgeProfileJar = path.join(forgeProfileDir, `1.12.2-forge${forgeVersion}.jar`)

    let forgeExists = false
    try {
      await fs.access(forgeProfileJar)
      forgeExists = true
      console.log('[ForgeInstaller] Forge already installed')
      event.sender.send('install-progress', { status: 'installing-forge', progress: 50 })
    } catch (e) {
    }

    if (!forgeExists) {
      const forgeUniversalUrl = `https://maven.minecraftforge.net/net/minecraftforge/forge/1.12.2-${forgeVersion}/forge-1.12.2-${forgeVersion}-universal.jar`
      const forgeChecksumUrl = `${forgeUniversalUrl}.sha1`
      console.log('[ForgeInstaller] Forge URL:', forgeUniversalUrl)
      console.log('[ForgeInstaller] Downloading Forge checksum...')
      
      let expectedSha1 = null
      try {
        expectedSha1 = await new Promise((resolve, reject) => {
          https.get(forgeChecksumUrl, (res) => {
            if (res.statusCode === 200) {
              let data = ''
              res.on('data', chunk => data += chunk)
              res.on('end', () => resolve(data.trim().split(' ')[0])) // Maven format: "hash filename"
            } else {
              resolve(null) // Checksum not available
            }
          }).on('error', () => resolve(null))
        })
        
        if (expectedSha1) {
          console.log('[ForgeInstaller] Found checksum:', expectedSha1)
        } else {
          console.warn('[ForgeInstaller] No checksum available, will download without verification')
        }
      } catch (err) {
        console.warn('[ForgeInstaller] Could not fetch checksum:', err.message)
      }
      
      console.log('[ForgeInstaller] Downloading Forge universal JAR...')
      event.sender.send('install-progress', { status: 'downloading-forge', progress: 0 })

      await fs.mkdir(forgeProfileDir, { recursive: true })

      try {
        await downloadFileWithChecksum(forgeUniversalUrl, forgeProfileJar, expectedSha1, (progress) => {
          console.log(`[ForgeInstaller] Download progress: ${progress.percent}%`)
          event.sender.send('install-progress', {
            status: 'downloading-forge',
            progress: Math.round((progress.percent || 0) * 0.3)
          })
        })
        console.log('[ForgeInstaller] Forge download complete')
      } catch (err) {
        console.error('[ForgeInstaller] Forge download failed:', err)
        throw new Error(`Failed to download Forge: ${err.message}`)
      }

      console.log('[ForgeInstaller] Downloading LaunchWrapper...')
      event.sender.send('install-progress', { status: 'downloading-forge', progress: 30 })
      
      const launchWrapperDir = path.join(librariesDir, 'net', 'minecraft', 'launchwrapper', '1.12')
      await fs.mkdir(launchWrapperDir, { recursive: true })
      const launchWrapperPath = path.join(launchWrapperDir, 'launchwrapper-1.12.jar')
      
      try {
        await downloadFileWithChecksum(
          'https://libraries.minecraft.net/net/minecraft/launchwrapper/1.12/launchwrapper-1.12.jar',
          launchWrapperPath,
          '111e7bea9c968cdb3d06ef4ea43dae71fa27cf3c', // Known SHA1 for launchwrapper 1.12
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

    console.log('[ForgeInstaller] Setting up Forge profile...')
    event.sender.send('install-progress', { status: 'installing-forge', progress: 50 })

    const forgeJsonPath = path.join(forgeProfileDir, `1.12.2-forge${forgeVersion}.json`)
    const forgeProfileData = {
      id: `1.12.2-forge${forgeVersion}`,
      inheritsFrom: '1.12.2',
      releaseTime: new Date().toISOString(),
      time: new Date().toISOString(),
      type: 'release',
      mainClass: 'net.minecraft.launchwrapper.Launch',
      minecraftArguments: '--username ${auth_player_name} --version 1.12.2-forge --gameDir ${game_directory} --assetsDir ${assets_root} --assetIndex 1.12 --uuid ${auth_uuid} --accessToken ${auth_access_token} --userType ${user_type} --tweakClass net.minecraftforge.fml.common.launcher.FMLTweaker',
      libraries: [],
      jar: '1.12.2'
    }
    
    try {
      await fs.writeFile(forgeJsonPath, JSON.stringify(forgeProfileData, null, 2), 'utf8')
      console.log('[ForgeInstaller] Forge profile created')
    } catch (err) {
      console.error('[ForgeInstaller] Failed to write profile JSON:', err)
      throw new Error(`Failed to create Forge profile: ${err.message}`)
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
          await downloadFileWithChecksum(modUrl, modPath, null, (prog) => {
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
  const gameDir = path.join(app.getPath('appData'), '.cubiclauncher', 'minecraft')
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
    const gameDir = path.join(app.getPath('appData'), '.cubiclauncher', 'minecraft')
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
    const clientJarSha1 = versionJson.downloads.client.sha1
    const clientJarPath = path.join(versionsDir, `${targetVersion}`, `${targetVersion}.jar`)
    
    console.log(`[Minecraft] Creating version directory...`)
    await fs.mkdir(path.dirname(clientJarPath), { recursive: true })
    
    console.log(`[Minecraft] Downloading game JAR (~150MB)...`)
    event.sender.send('install-progress', { status: 'downloading-minecraft', progress: 20 })
    
    try {
      await downloadFileWithChecksum(clientJarUrl, clientJarPath, clientJarSha1, (progress) => {
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
        const libSha1 = lib.downloads.artifact.sha1
        const libPath = path.join(librariesDir, lib.downloads.artifact.path)
        
        try {
          await fs.mkdir(path.dirname(libPath), { recursive: true })
          await downloadFileWithChecksum(libUrl, libPath, libSha1, () => {})
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
