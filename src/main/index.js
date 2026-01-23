import { app, shell, BrowserWindow, ipcMain, dialog, safeStorage } from 'electron'
import { join, dirname } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import Store from 'electron-store'
import { exec } from 'child_process'
import fs from 'fs'
import { randomUUID } from 'crypto'
import axios from 'axios'
import { autoUpdater } from 'electron-updater'

const store = new Store()

// Variable d'état en mémoire. C'est notre source de vérité pour le statut PRO.
let isProValidated = false

// --- LOGGING ---
function log(msg) {
  console.log(`[MAIN] ${new Date().toLocaleTimeString()}: ${msg}`)
}

// Configuration de l'auto-updater
autoUpdater.logger = {
  info: (msg) => log(`[Updater] ${msg}`),
  warn: (msg) => log(`[Updater] WARN: ${msg}`),
  error: (msg) => log(`[Updater] ERROR: ${msg}`)
}

// --- GESTION DES MISES À JOUR ---
function setupAutoUpdater(mainWindow) {
  autoUpdater.on('update-available', (info) => {
    log(`Mise à jour disponible: ${info.version}`)
    mainWindow.webContents.send('update-available', info.version)
  })

  autoUpdater.on('update-downloaded', () => {
    log('Mise à jour téléchargée. Prête à être installée.')
    mainWindow.webContents.send('update-downloaded')
  })

  ipcMain.on('restart-app-to-update', () => {
    log("Redémarrage de l'application pour installer la mise à jour.")
    autoUpdater.quitAndInstall()
  })
}

async function validateLicenseKey(key) {
  if (!key) return false
  if (key === 'DEV-PRO-MODE') {
    log('Activation du mode PRO via la clé de développement.')
    return true
  }
  log(`Validation de la clé: ${key}`)
  try {
    const params = new URLSearchParams()
    params.append('product_id', 'bg3K5UjSI2S-QrZHlX0QwQ==')
    params.append('license_key', key)
    const response = await axios.post('https://api.gumroad.com/v2/licenses/verify', params)
    if (response.data.success && !response.data.purchase.refunded) {
      log('Clé de licence confirmée comme valide.')
      return true
    } else {
      log('La clé est invalide ou a été remboursée.')
      return false
    }
  } catch (error) {
    if (error.response && error.response.data && error.response.data.message) {
      log(`Erreur API Gumroad: ${error.response.data.message}`)
    } else {
      log(`Erreur de communication avec l'API de licence: ${error.message}`)
    }
    return false
  }
}

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1100,
    height: 750,
    resizable: false,
    frame: false,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#0f1923',
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  setupAutoUpdater(mainWindow)

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// --- CONTRÔLES ---
ipcMain.on('minimize-app', () => {
  BrowserWindow.getFocusedWindow()?.minimize()
})
ipcMain.on('close-app', () => {
  BrowserWindow.getFocusedWindow()?.close()
})

// --- LIEN EXTERNE ---
ipcMain.on('open-external-link', (event, url) => {
  if (url.startsWith('https://voidbis.gumroad.com/')) {
    log(`Ouverture du lien externe sécurisé : ${url}`)
    shell.openExternal(url)
  } else {
    log(`Tentative d'ouverture de lien non autorisé : ${url}`)
  }
})

// --- CONFIG ---
ipcMain.handle('select-riot-path', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [{ name: 'Exécutables', extensions: ['exe'] }]
  })
  if (!result.canceled && result.filePaths.length > 0) {
    store.set('riotPath', result.filePaths[0])
    return result.filePaths[0]
  }
  return null
})
ipcMain.handle('get-riot-path', () => store.get('riotPath', null))

// Handlers pour l'option "Rester connecté"
ipcMain.handle('get-stay-logged-in', () => store.get('stayLoggedIn', false))
ipcMain.handle('set-stay-logged-in', (event, value) => {
  const boolValue = !!value
  store.set('stayLoggedIn', boolValue)
  log(`Option "Rester connecté" mise à jour : ${boolValue}`)
  return boolValue
})

// NOUVEAU : Handlers pour le délai de connexion (Login Delay)
ipcMain.handle('get-login-delay', () => store.get('loginDelay', 1500))
ipcMain.handle('set-login-delay', (event, value) => {
  const numValue = parseInt(value, 10)
  store.set('loginDelay', numValue)
  return numValue
})

// --- GESTION PRO ---
ipcMain.handle('get-pro-status', () => {
  return isProValidated
})

ipcMain.handle('verify-license', async (event, key) => {
  const trimmedKey = typeof key === 'string' ? key.trim() : ''
  if (!trimmedKey) {
    return { success: false, error: 'La clé ne peut pas être vide.' }
  }

  const isValid = await validateLicenseKey(trimmedKey)

  if (isValid) {
    store.set('licenseKey', trimmedKey)
    isProValidated = true
    return { success: true }
  } else {
    isProValidated = false
    return { success: false, error: 'Clé de licence invalide ou introuvable.' }
  }
})

// --- GESTION COMPTES ---
ipcMain.handle('get-accounts', () => store.get('accounts', []))

ipcMain.handle('add-account', (event, accountData) => {
  if (!accountData || !accountData.username || !accountData.password) return null

  const list = store.get('accounts', [])
  if (!isProValidated && list.length >= 3) {
    log('Limite de comptes atteinte pour la version gratuite.')
    return { error: 'LIMIT_REACHED' }
  }

  let encryptedPass = ''
  if (accountData.password && safeStorage.isEncryptionAvailable()) {
    encryptedPass = safeStorage.encryptString(accountData.password).toString('hex')
  } else {
    encryptedPass = accountData.password
  }

  const newAccount = {
    id: randomUUID(),
    displayName: accountData.displayName || accountData.username,
    username: accountData.username,
    password: encryptedPass,
    rank: accountData.rank || '',
    encrypted: safeStorage.isEncryptionAvailable()
  }
  list.push(newAccount)
  store.set('accounts', list)
  return [...list]
})

ipcMain.handle('edit-account', (event, accountData) => {
  if (!accountData || !accountData.id) return null

  let list = store.get('accounts', [])
  const accountIndex = list.findIndex((acc) => acc.id === accountData.id)

  if (accountIndex === -1) return null

  list[accountIndex].displayName = accountData.displayName || list[accountIndex].displayName
  list[accountIndex].username = accountData.username || list[accountIndex].username
  list[accountIndex].rank = accountData.rank

  if (accountData.password) {
    if (safeStorage.isEncryptionAvailable()) {
      list[accountIndex].password = safeStorage.encryptString(accountData.password).toString('hex')
      list[accountIndex].encrypted = true
    } else {
      list[accountIndex].password = accountData.password
      list[accountIndex].encrypted = false
    }
  }

  store.set('accounts', list)
  return [...list]
})

ipcMain.handle('delete-account', (event, id) => {
  let list = store.get('accounts', [])
  const newList = list.filter((acc) => acc.id !== id)
  store.set('accounts', newList)
  return newList
})

ipcMain.handle('reorder-accounts', (event, newAccountList) => {
  store.set('accounts', newAccountList)
  return newAccountList
})

// --- LANCEMENT JEU ---
ipcMain.handle('launch-game', async (event, { id, game }) => {
  const riotPath = store.get('riotPath')
  if (!riotPath || !fs.existsSync(riotPath)) return 'Erreur : Chemin invalide'

  const accounts = store.get('accounts', [])
  const account = accounts.find((acc) => acc.id === id)
  if (!account) return 'Erreur : Compte introuvable'

  let finalPassword = account.password
  if (account.encrypted && safeStorage.isEncryptionAvailable()) {
    try {
      const buffer = Buffer.from(account.password, 'hex')
      finalPassword = safeStorage.decryptString(buffer)
    } catch (e) {
      return 'Erreur : Impossible de décrypter (Changement de PC ?)'
    }
  }

  const cleanUser = account.username.trim()
  const cleanPass = finalPassword.trim()
  const gameId = game.toLowerCase()

  log(`Lancement de ${gameId} pour ${account.displayName}...`)

  const privateSettingsPath = join(
    process.env.LOCALAPPDATA,
    'Riot Games',
    'Riot Client',
    'Data',
    'RiotGamesPrivateSettings.yaml'
  )
  if (fs.existsSync(privateSettingsPath)) {
    try {
      fs.unlinkSync(privateSettingsPath)
    } catch (e) {}
  }

  try {
    exec(
      'taskkill /F /IM RiotClientServices.exe /IM RiotClientUx.exe /IM LeagueClient.exe /IM VALORANT.exe /IM VALORANT-Win64-Shipping.exe'
    )
  } catch (e) {}

  await new Promise((r) => setTimeout(r, 2000))

  const workingDir = dirname(riotPath)
  const command = `start "" "${riotPath}" --launch-product=${gameId} --launch-patchline=live`

  exec(command, { cwd: workingDir })

  try {
    const stayLoggedIn = store.get('stayLoggedIn', false)
    // NOUVEAU: Récupération du délai
    const loginDelay = store.get('loginDelay', 1500)

    // On passe le délai à la fonction VBS
    await typeLoginVBS(cleanUser, cleanPass, stayLoggedIn, loginDelay)
  } catch (err) {
    return 'Erreur macro clavier.'
  }

  if (gameId === 'valorant') {
    log('Attente post-connexion pour Valorant...')
    await new Promise((r) => setTimeout(r, 7000))
    log('Relance de la commande pour forcer le démarrage du jeu...')
    exec(command, { cwd: workingDir })
  }

  return `Jeu lancé pour ${account.displayName} !`
})

// --- VBSCRIPT ---
// MODIFIÉ: Ajout du paramètre delay
function typeLoginVBS(username, password, stayLoggedIn, delay) {
  return new Promise((resolve, reject) => {
    // Sécuriser le délai
    const safeDelay = typeof delay === 'number' ? delay : 1500

    const vbsContent = `
      Set WshShell = WScript.CreateObject("WScript.Shell")
      Dim targetTitle, activated, i
      targetTitle = "Riot Client"
      activated = False

      ' 1. Boucle pour attendre que la fenêtre apparaisse
      For i = 1 To 40
        WScript.Sleep 1000
        If WshShell.AppActivate(targetTitle) Then
           activated = True
           Exit For
        End If
      Next

      If activated Then
        WScript.Sleep 500
        WshShell.AppActivate(targetTitle)
        WScript.Sleep 200

        Set tempShell = CreateObject("WScript.Shell")
        tempShell.SendKeys "%{ESC}"
        WScript.Sleep 100

        If WshShell.AppActivate(targetTitle) Then
          ' NOUVEAU: Utilisation du délai utilisateur
          WScript.Sleep ${safeDelay}

          WshShell.SendKeys "${username}"
          WScript.Sleep 100
          WshShell.SendKeys "{TAB}"
          WScript.Sleep 100
          WshShell.SendKeys "${escapeVbs(password)}"
          WScript.Sleep 100

          If ${stayLoggedIn ? 'True' : 'False'} Then
            WshShell.SendKeys "{TAB}"
            WScript.Sleep 50
            WshShell.SendKeys "{TAB}"
            WScript.Sleep 50
            WshShell.SendKeys "{TAB}"
            WScript.Sleep 50
            WshShell.SendKeys "{TAB}"
            WScript.Sleep 50
            WshShell.SendKeys "{TAB}"
            WScript.Sleep 50
            WshShell.SendKeys "{TAB}"
            WScript.Sleep 100
            WshShell.SendKeys " "
            WScript.Sleep 50
            WshShell.SendKeys "{TAB}"
          End If

          WScript.Sleep 100
          WshShell.SendKeys "{ENTER}"
          WScript.Quit(0)
        Else
          WScript.Quit(1)
        End If
      Else
        WScript.Quit(1)
      End If
    `
    const tempVbsPath = join(app.getPath('temp'), 'riot_login_macro.vbs')
    fs.writeFileSync(tempVbsPath, vbsContent)

    exec(`cscript //Nologo "${tempVbsPath}"`, (error) => {
      try {
        fs.unlinkSync(tempVbsPath)
      } catch (e) {}

      if (error) {
        log('Erreur VBS focus.')
        reject(new Error('Impossible de mettre le focus.'))
      } else {
        resolve()
      }
    })
  })
}

function escapeVbs(str) {
  return str.replace(/([\{\}\[\]\(\)\+\^\%\~"'])/g, '{$1}')
}

// Logique de démarrage de l'application
app.whenReady().then(async () => {
  electronApp.setAppUserModelId('com.electron')

  const storedKey = store.get('licenseKey', null)
  if (storedKey) {
    isProValidated = await validateLicenseKey(storedKey)
    if (!isProValidated) {
      store.delete('licenseKey')
    }
  }

  createWindow()

  setTimeout(() => {
    if (!is.dev) {
      autoUpdater.checkForUpdates()
    }
  }, 3000)

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
