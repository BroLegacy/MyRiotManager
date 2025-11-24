import { app, shell, BrowserWindow, ipcMain, dialog, safeStorage } from 'electron'
import { join } from 'path'
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

// --- CONTRÔLES DE LA FENÊTRE ---
ipcMain.on('minimize-app', () => {
  BrowserWindow.getFocusedWindow()?.minimize()
})

ipcMain.on('close-app', () => {
  BrowserWindow.getFocusedWindow()?.close()
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

// --- GESTION COMPTES (SÉCURISÉE) ---
ipcMain.handle('get-accounts', () => {
  log('Demande de la liste des comptes.')
  return store.get('accounts', [])
})

ipcMain.handle('add-account', (event, accountData) => {
  log(`Tentative d'ajout du compte: ${accountData.username}`)
  // Validation backend
  if (!accountData || !accountData.username || !accountData.password) {
    log("Erreur: Données invalides pour l'ajout de compte.")
    return null // On ne fait rien et on renvoie null
  }

  const list = store.get('accounts', [])
  let encryptedPass = ''
  if (accountData.password && safeStorage.isEncryptionAvailable()) {
    encryptedPass = safeStorage.encryptString(accountData.password).toString('hex')
  } else if (accountData.password) {
    log('ATTENTION: Cryptage indisponible.')
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
  log(`Compte ${newAccount.displayName} ajouté. Nouvelle liste envoyée.`)
  return [...list]
})

ipcMain.handle('edit-account', (event, accountData) => {
  log(`Tentative de modification du compte ID: ${accountData.id}`)
  // Validation backend
  if (!accountData || !accountData.id || !accountData.username) {
    log("Erreur: Données invalides pour la modification de compte.")
    return null
  }

  const list = store.get('accounts', [])
  const accountIndex = list.findIndex((acc) => acc.id === accountData.id)

  if (accountIndex === -1) {
    log(`Erreur: Compte ID ${accountData.id} non trouvé.`)
    return store.get('accounts', []) // Renvoie la liste actuelle sans changement
  }

  const accountToEdit = list[accountIndex]
  accountToEdit.displayName = accountData.displayName || accountData.username
  accountToEdit.username = accountData.username
  accountToEdit.rank = accountData.rank || ''

  if (accountData.password) {
    log(`Mise à jour du mot de passe pour ${accountData.username}.`)
    if (safeStorage.isEncryptionAvailable()) {
      accountToEdit.password = safeStorage.encryptString(accountData.password).toString('hex')
      accountToEdit.encrypted = true
    } else {
      log('ATTENTION: Cryptage indisponible pour la mise à jour du mot de passe.')
      accountToEdit.password = accountData.password
      accountToEdit.encrypted = false
    }
  }

  list[accountIndex] = accountToEdit
  store.set('accounts', list)
  log(`Compte ${accountToEdit.displayName} modifié. Nouvelle liste envoyée.`)
  return [...list]
})

ipcMain.handle('delete-account', (event, id) => {
  log(`Tentative de suppression du compte ID: ${id}`)
  let list = store.get('accounts', [])
  const newList = list.filter((acc) => acc.id !== id)
  store.set('accounts', newList)
  log(`Compte ID ${id} supprimé. Nouvelle liste envoyée.`)
  return newList
})

ipcMain.handle('reorder-accounts', (event, newAccountList) => {
  log('Réorganisation des comptes.')
  store.set('accounts', newAccountList)
  return newAccountList
})

// --- LANCEMENT (inchangé) ---
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
      log('Erreur décryptage : ' + e.message)
      return 'Erreur : Impossible de décrypter le mot de passe (fichier corrompu ou changé de PC ?)'
    }
  }

  const cleanUser = account.username.trim()
  const cleanPass = finalPassword.trim()
  log(`Lancement pour ${account.displayName}...`)

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
    exec('taskkill /F /IM RiotClientServices.exe /IM RiotClientUx.exe /IM LeagueClient.exe /IM VALORANT.exe')
  } catch (e) {}
  await new Promise((r) => setTimeout(r, 2000))

  const command = `start "" "${riotPath}" --launch-product=${game} --launch-patchline=live`
  exec(command)

  try {
    await typeLoginVBS(cleanUser, cleanPass)
    return `Connexion de ${account.displayName}...`
  } catch (err) {
    return 'Erreur macro clavier.'
  }
})

// --- VBSCRIPT (Inchangé) ---
function typeLoginVBS(username, password) {
  return new Promise((resolve, reject) => {
    const vbsContent = `
      Set WshShell = WScript.CreateObject("WScript.Shell")
      Dim i
      For i = 1 To 30
        WScript.Sleep 1000
        If WshShell.AppActivate("Riot Client") Then
           Exit For
        End If
      Next
      WScript.Sleep 500
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
      try {
        fs.unlinkSync(tempVbsPath)
      } catch (e) {}
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
