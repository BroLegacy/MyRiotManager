import { app, shell, BrowserWindow, ipcMain, dialog, safeStorage } from 'electron'
import { join, dirname } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import Store from 'electron-store'
import { exec } from 'child_process'
import fs from 'fs'
import { randomUUID } from 'crypto'

const store = new Store()

// --- LOGGING ---
function log(msg) {
  console.log(`[MAIN] ${new Date().toLocaleTimeString()}: ${msg}`)
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

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// --- CONTRÔLES ---
ipcMain.on('minimize-app', () => { BrowserWindow.getFocusedWindow()?.minimize() })
ipcMain.on('close-app', () => { BrowserWindow.getFocusedWindow()?.close() })

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

// --- GESTION COMPTES ---
ipcMain.handle('get-accounts', () => store.get('accounts', []))

ipcMain.handle('add-account', (event, accountData) => {
  if (!accountData || !accountData.username || !accountData.password) return null

  const list = store.get('accounts', [])
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

// --- LANCEMENT JEU (AVEC DOUBLE INJECTION POUR VALORANT) ---
ipcMain.handle('launch-game', async (event, { id, game }) => {
  const riotPath = store.get('riotPath')
  if (!riotPath || !fs.existsSync(riotPath)) return 'Erreur : Chemin invalide'

  const accounts = store.get('accounts', [])
  const account = accounts.find((acc) => acc.id === id)
  if (!account) return 'Erreur : Compte introuvable'

  // Décryptage
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

  // 1. Suppression Cache
  const privateSettingsPath = join(process.env.LOCALAPPDATA, 'Riot Games', 'Riot Client', 'Data', 'RiotGamesPrivateSettings.yaml')
  if (fs.existsSync(privateSettingsPath)) { try { fs.unlinkSync(privateSettingsPath) } catch (e) {} }

  // 2. Kill Processus
  try {
    exec('taskkill /F /IM RiotClientServices.exe /IM RiotClientUx.exe /IM LeagueClient.exe /IM VALORANT.exe /IM VALORANT-Win64-Shipping.exe')
  } catch (e) {}

  await new Promise((r) => setTimeout(r, 2000))

  // 3. PREMIER LANCEMENT (Pour ouvrir le client et se connecter)
  const workingDir = dirname(riotPath)
  const command = `start "" "${riotPath}" --launch-product=${gameId} --launch-patchline=live`

  exec(command, { cwd: workingDir })

  // 4. Macro Clavier (Connexion)
  try {
    await typeLoginVBS(cleanUser, cleanPass)
  } catch (err) {
    return 'Erreur macro clavier.'
  }

  // --- LE FIX POUR LE BOUTON "JOUER" ---
  if (gameId === 'valorant') {
    log("Attente post-connexion pour Valorant...")
    // On attend 7 secondes que le login se finisse et que le bouton "JOUER" apparaisse
    await new Promise((r) => setTimeout(r, 7000))

    log("Relance de la commande pour forcer le démarrage du jeu...")
    // On renvoie EXACTEMENT la même commande.
    // Comme le client est déjà ouvert et connecté, cette commande va "cliquer" sur Jouer pour nous.
    exec(command, { cwd: workingDir })
  }

  return `Jeu lancé pour ${account.displayName} !`
})

// --- VBSCRIPT ---
function typeLoginVBS(username, password) {
  return new Promise((resolve, reject) => {
    // J'ai augmenté un peu le délai initial (Wait 2000) pour laisser le temps
    // à la fenêtre de mise à jour de disparaître
    const vbsContent = `
      Set WshShell = WScript.CreateObject("WScript.Shell")
      Dim i
      For i = 1 To 40
        WScript.Sleep 1000
        If WshShell.AppActivate("Riot Client") Then
           Exit For
        End If
      Next
      WScript.Sleep 2000
      WshShell.SendKeys "${username}"
      WScript.Sleep 100
      WshShell.SendKeys "{TAB}"
      WScript.Sleep 100
      WshShell.SendKeys "${escapeVbs(password)}"
      WScript.Sleep 100
      WshShell.SendKeys "{ENTER}"
    `
    const tempVbsPath = join(app.getPath('temp'), 'riot_login_macro.vbs')
    fs.writeFileSync(tempVbsPath, vbsContent)
    exec(`cscript //Nologo "${tempVbsPath}"`, (error) => {
      try { fs.unlinkSync(tempVbsPath) } catch (e) {}
      if (error) reject(error)
      else resolve()
    })
  })
}

function escapeVbs(str) {
  return str.replace(/([\{\}\[\]\(\)\+\^\%\~])/g, '{$1}')
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.electron')
  createWindow()
  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
