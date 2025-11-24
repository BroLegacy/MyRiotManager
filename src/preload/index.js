import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

const api = {
  // Fonctions de gestion de compte
  getAccounts: () => ipcRenderer.invoke('get-accounts'),
  addAccount: (account) => ipcRenderer.invoke('add-account', account),
  editAccount: (accountData) => ipcRenderer.invoke('edit-account', accountData),
  deleteAccount: (id) => ipcRenderer.invoke('delete-account', id),
  reorderAccounts: (newList) => ipcRenderer.invoke('reorder-accounts', newList),

  // Fonctions de jeu et de configuration
  launchGame: (data) => ipcRenderer.invoke('launch-game', data),
  selectRiotPath: () => ipcRenderer.invoke('select-riot-path'),
  getRiotPath: () => ipcRenderer.invoke('get-riot-path'),

  // Fonctions pour contrôler la fenêtre
  minimizeApp: () => ipcRenderer.send('minimize-app'),
  closeApp: () => ipcRenderer.send('close-app')
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  window.electron = electronAPI
  window.api = api
}
