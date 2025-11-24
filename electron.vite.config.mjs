import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()]
  },
  preload: {
    // On ajoute la configuration pour s'assurer que le preload est bien traité
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        output: {
          // Le nom du fichier de sortie sera 'index.js' pour correspondre au chemin par défaut
          entryFileNames: 'index.js'
        }
      }
    }
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src')
      }
    },
    plugins: [vue()]
  }
})
