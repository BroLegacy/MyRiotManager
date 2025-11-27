<script setup>
import { ref, onMounted, computed, toRaw, watch } from 'vue'
import draggable from 'vuedraggable'

// --- State Management ---
const accounts = ref([])
const riotPath = ref('')
const statusMessage = ref('')
const isLoading = ref(false)
const launchingAccountId = ref(null)
const isPro = ref(false)
const stayLoggedIn = ref(false) // NOUVEAU: État pour la case à cocher

// --- UI State ---
const isSettingsOpen = ref(false)
const isReorderMode = ref(false)

// Modale Ajout/Modification
const isAccountModalOpen = ref(false)
const modalMode = ref('add') // 'add' ou 'edit'
const form = ref({
  id: null,
  displayName: '',
  username: '',
  password: '',
  rank: ''
})
// État pour les erreurs de formulaire
const formError = ref('')

// Modale de suppression
const isDeleteModalOpen = ref(false)
const accountToDelete = ref(null)

// États pour la licence
const licenseKey = ref('')
const licenseError = ref('')
const gumroadUrl = 'https://voidbis.gumroad.com/l/flekds?wanted=true'

// --- Window Controls ---
const minimizeWindow = () => window.api.minimizeApp()
const closeWindow = () => window.api.closeApp()

// --- Lifecycle Hooks ---
onMounted(async () => {
  console.log('[VUE] App montée, récupération des données initiales.')
  try {
    if (!window.api) {
      throw new Error("L'API du preload n'est pas chargée.")
    }
    // On récupère toutes les données en parallèle
    ;[accounts.value, riotPath.value, isPro.value, stayLoggedIn.value] = await Promise.all([
      window.api.getAccounts(),
      window.api.getRiotPath(),
      window.api.getProStatus(),
      window.api.getStayLoggedIn() // NOUVEAU: Récupération de la préférence
    ])
    console.log('[VUE] Données initiales reçues:', {
      accounts: accounts.value.length,
      isPro: isPro.value,
      stayLoggedIn: stayLoggedIn.value
    })
  } catch (error) {
    console.error('[VUE] Erreur critique lors du chargement initial:', error)
    statusMessage.value = "Erreur de communication. Veuillez redémarrer l'application."
  }
})

// NOUVEAU: Watcher pour sauvegarder la préférence quand elle change
watch(stayLoggedIn, (newValue) => {
  window.api.setStayLoggedIn(newValue)
})

// --- Computed Properties ---
const isAccountListEmpty = computed(() => accounts.value.length === 0)
const modalTitle = computed(() => (modalMode.value === 'add' ? 'Ajouter un nouveau compte' : 'Modifier le compte'))

// --- Methods ---
const handleSelectPath = async () => {
  try {
    const path = await window.api.selectRiotPath()
    if (path) riotPath.value = path
  } catch (error) {
    console.error('Erreur lors de la sélection du chemin:', error)
    statusMessage.value = 'Une erreur est survenue.'
  }
}

const resetForm = () => {
  form.value = { id: null, displayName: '', username: '', password: '', rank: '' }
  formError.value = ''
}

// Modale Ajout/Modification
const openAddModal = () => {
  resetForm()
  modalMode.value = 'add'
  isAccountModalOpen.value = true
}

const openEditModal = (account) => {
  resetForm()
  form.value = {
    id: account.id,
    displayName: account.displayName,
    username: account.username,
    password: '',
    rank: account.rank || ''
  }
  modalMode.value = 'edit'
  isAccountModalOpen.value = true
}

const handleSaveAccount = async () => {
  formError.value = ''
  const plainFormData = toRaw(form.value)

  if (!plainFormData.username || !plainFormData.username.trim()) {
    formError.value = 'Le pseudo de connexion est requis.'
    return
  }
  if (modalMode.value === 'add' && (!plainFormData.password || !plainFormData.password.trim())) {
    formError.value = 'Le mot de passe est requis pour un nouveau compte.'
    return
  }

  try {
    let result
    if (modalMode.value === 'edit') {
      result = await window.api.editAccount(plainFormData)
    } else {
      result = await window.api.addAccount(plainFormData)
    }

    if (result && result.error === 'LIMIT_REACHED') {
      formError.value = 'Limite de 3 comptes atteinte. Passez à la version PRO pour en ajouter plus !'
      return // On arrête ici
    }

    if (result) {
      accounts.value = result
      isAccountModalOpen.value = false
    } else {
      throw new Error("La liste des comptes n'a pas été retournée par l'API.")
    }
  } catch (error) {
    console.error(`[VUE] Erreur lors de la sauvegarde du compte:`, error)
    formError.value = 'Une erreur est survenue lors de la sauvegarde.'
  }
}

// Logique pour la modale de suppression
const openDeleteModal = (account) => {
  accountToDelete.value = account
  isDeleteModalOpen.value = true
}

const confirmDelete = async () => {
  if (!accountToDelete.value) return
  try {
    const updatedAccounts = await window.api.deleteAccount(accountToDelete.value.id)
    accounts.value = updatedAccounts
    isDeleteModalOpen.value = false
    accountToDelete.value = null
  } catch (error) {
    console.error(`[VUE] Erreur lors de la suppression:`, error)
    statusMessage.value = 'Erreur lors de la suppression du compte.'
    isDeleteModalOpen.value = false
  }
}

const toggleReorderMode = () => {
  isReorderMode.value = !isReorderMode.value
}

const onDragEnd = async () => {
  await window.api.reorderAccounts(toRaw(accounts.value))
}

const handlePlay = async (account, game) => {
  isLoading.value = true
  launchingAccountId.value = account.id
  statusMessage.value = `Lancement de ${game} pour ${account.displayName}...`
  try {
    const res = await window.api.launchGame({ id: account.id, game })
    statusMessage.value = res
  } catch (error) {
    console.error('Erreur de lancement:', error)
    statusMessage.value = 'Une erreur est survenue lors du lancement.'
  } finally {
    setTimeout(() => {
      statusMessage.value = ''
      isLoading.value = false
      launchingAccountId.value = null
    }, 5000)
  }
}

const buyLicense = () => {
  window.api.openExternalLink(gumroadUrl)
}

const handleVerifyLicense = async () => {
  licenseError.value = ''
  if (!licenseKey.value.trim()) {
    licenseError.value = 'Veuillez entrer une clé.'
    return
  }
  try {
    const result = await window.api.verifyLicense(licenseKey.value)
    if (result.success) {
      isPro.value = true
      statusMessage.value = 'Félicitations, votre licence PRO est activée !'
      licenseKey.value = '' // On vide le champ
      setTimeout(() => {
        statusMessage.value = ''
      }, 5000)
    } else {
      licenseError.value = result.error || 'Clé invalide.'
    }
  } catch (error) {
    console.error('Erreur lors de la vérification de la licence:', error)
    licenseError.value = 'Une erreur est survenue lors de la vérification.'
  }
}
</script>

<template>
  <div class="app-container" :class="{ 'reorder-active': isReorderMode }">
    <!-- ... (barre de titre) ... -->
    <div class="title-bar">
      <div class="title-bar-drag-region"></div>
      <div class="window-controls">
        <button class="win-btn" @click="minimizeWindow" title="Réduire">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <line x1="5" y1="12" x2="19" y2="12"></line>
          </svg>
        </button>
        <button class="win-btn close" @click="closeWindow" title="Fermer">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
      </div>
    </div>

    <!-- ... (overlay de configuration) ... -->
    <div v-if="!riotPath" class="setup-overlay">
      <div class="setup-box">
        <h2>Bienvenue, Invocateur</h2>
        <p>
          Pour commencer, veuillez localiser l'exécutable
          <strong>RiotClientServices.exe</strong> sur votre ordinateur.
        </p>
        <button @click="handleSelectPath" class="btn btn-primary">Sélectionner le fichier</button>
      </div>
    </div>

    <!-- Header principal -->
    <header class="app-header">
      <div class="logo">
        <span class="logo-riot">RIOT</span>
        <span class="logo-manager">MANAGER</span>
        <span v-if="isPro" class="pro-badge">PRO</span>
      </div>
      <div class="header-actions">
        <!-- ... (autres boutons) ... -->
        <button
          v-if="!isReorderMode"
          @click="toggleReorderMode"
          class="btn btn-secondary"
          title="Modifier l'ordre des comptes"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <polyline points="15 3 21 3 21 9"></polyline>
            <polyline points="9 21 3 21 3 15"></polyline>
            <line x1="21" y1="3" x2="14" y2="10"></line>
            <line x1="3" y1="21" x2="10" y2="14"></line>
          </svg>
          Modifier l'ordre
        </button>
        <button
          v-if="isReorderMode"
          @click="toggleReorderMode"
          class="btn btn-primary"
          title="Valider le nouvel ordre"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <polyline points="20 6 9 17 4 12"></polyline>
          </svg>
          Valider l'ordre
        </button>

        <button @click="openAddModal" class="btn btn-primary">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <line x1="12" y1="5" x2="12" y2="19"></line>
            <line x1="5" y1="12" x2="19" y2="12"></line>
          </svg>
          Ajouter un compte
        </button>
        <button @click="isSettingsOpen = true" class="btn btn-icon" title="Paramètres">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <circle cx="12" cy="12" r="3"></circle>
            <path
              d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"
            ></path>
          </svg>
        </button>
      </div>
    </header>

    <div class="main-wrapper">
      <!-- ... (contenu principal, grille de comptes, etc.) ... -->
      <main class="content-area">
        <div v-if="isSettingsOpen" class="content-overlay" @click="isSettingsOpen = false"></div>

        <div v-if="isAccountListEmpty" class="empty-state">
          <img src="./assets/poro.png" alt="Poro triste" class="empty-state-img" />
          <h2>Aucun compte pour le moment</h2>
          <p>Cliquez sur "Ajouter un compte" pour commencer.</p>
        </div>

        <draggable
          v-else
          v-model="accounts"
          class="accounts-grid"
          item-key="id"
          :disabled="!isReorderMode"
          @end="onDragEnd"
          ghost-class="ghost"
          drag-class="dragging"
        >
          <template #item="{ element: acc }">
            <div
              class="account-card"
              :class="{ 'is-loading': isLoading && launchingAccountId === acc.id, 'is-draggable': isReorderMode }"
            >
              <div class="card-header">
                <div class="account-info">
                  <span class="account-name">{{ acc.displayName }}</span>
                  <span class="account-user">{{ acc.username }}</span>
                  <span v-if="acc.rank" class="account-rank">{{ acc.rank }}</span>
                </div>
                <div class="card-actions">
                  <button @click="openEditModal(acc)" class="btn-card-action" title="Modifier le compte">
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                    >
                      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                    </svg>
                  </button>
                  <button
                    @click="openDeleteModal(acc)"
                    class="btn-card-action btn-delete"
                    title="Supprimer le compte"
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                    >
                      <polyline points="3 6 5 6 21 6"></polyline>
                      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                    </svg>
                  </button>
                </div>
              </div>

              <div class="card-body">
                <button @click="handlePlay(acc, 'valorant')" :disabled="isLoading" class="btn-play valorant">
                  <div class="btn-play-content">
                    <img src="./assets/valo.avif" class="game-logo" alt="Valorant Logo" />
                    <span>JOUER</span>
                  </div>
                </button>
                <button @click="handlePlay(acc, 'league_of_legends')" :disabled="isLoading" class="btn-play league">
                  <div class="btn-play-content">
                    <img src="./assets/lol.png" class="game-logo" alt="League of Legends Logo" />
                    <span>JOUER</span>
                  </div>
                </button>
              </div>

              <div v-if="isLoading && launchingAccountId === acc.id" class="loading-overlay">
                <div class="spinner"></div>
              </div>
            </div>
          </template>
        </draggable>
      </main>

      <aside class="settings-panel" :class="{ 'is-open': isSettingsOpen }">
        <div class="panel-header">
          <h3>Paramètres</h3>
          <button @click="isSettingsOpen = false" class="btn-close">×</button>
        </div>
        <div class="panel-body">
          <!-- Section PRO -->
          <div class="setting-item pro-section">
            <label>Licence PRO</label>
            <div v-if="isPro" class="pro-status-box">
              <span class="pro-badge">PRO</span>
              <span>Version PRO activée. Merci !</span>
            </div>
            <div v-else>
              <p class="pro-description">Passez PRO pour un nombre de comptes illimité.</p>
              <button @click="buyLicense" class="btn btn-primary" style="margin-bottom: 20px">
                Acheter une licence (0.99€/mois)
              </button>
              <div class="form-group">
                <label for="license-key">Ou entrez votre clé de licence</label>
                <input
                  id="license-key"
                  v-model="licenseKey"
                  @keyup.enter="handleVerifyLicense"
                  placeholder="Ex: 5AE082B4-F630-4B1A-A959-ED46CC4B5C16"
                />
              </div>
              <div v-if="licenseError" class="form-error-box" style="margin-bottom: 10px">
                {{ licenseError }}
              </div>
              <button @click="handleVerifyLicense" class="btn btn-secondary">Activer</button>
            </div>
          </div>

          <!-- NOUVEAU: Section pour "Rester connecté" -->
          <div class="setting-item">
            <label>Options de connexion</label>
            <div class="checkbox-group">
              <input type="checkbox" id="stay-logged-in" v-model="stayLoggedIn" />
              <label for="stay-logged-in">Cocher "Rester connecté" automatiquement</label>
            </div>
          </div>

          <!-- Section Chemin Riot -->
          <div class="setting-item">
            <label>Chemin du client Riot</label>
            <div class="path-box">{{ riotPath || 'Non défini' }}</div>
            <button @click="handleSelectPath" class="btn btn-secondary">Modifier le chemin</button>
          </div>
        </div>
      </aside>
    </div>

    <!-- ... (footer, modales, etc.) ... -->
    <footer v-if="statusMessage" class="app-footer">
      <p>{{ statusMessage }}</p>
    </footer>

    <!-- Modale unifiée pour Ajout/Modification -->
    <div v-if="isAccountModalOpen" class="modal-backdrop" @click="isAccountModalOpen = false">
      <div class="modal" @click.stop>
        <div class="modal-header">
          <h3>{{ modalTitle }}</h3>
          <button @click="isAccountModalOpen = false" class="btn-close">×</button>
        </div>
        <div class="modal-body">
          <div v-if="formError" class="form-error-box">
            {{ formError }}
          </div>
          <div class="form-group">
            <label>Nom d'affichage (Optionnel)</label>
            <input v-model="form.displayName" placeholder="Ex: Mon Smurf" />
          </div>
          <div class="form-group">
            <label>Pseudo de connexion Riot</label>
            <input v-model="form.username" placeholder="Votre pseudo" required />
          </div>
          <div class="form-group">
            <label>Mot de passe</label>
            <input
              v-model="form.password"
              type="password"
              :placeholder="modalMode === 'edit' ? 'Laisser vide pour ne pas changer' : '••••••••'"
            />
          </div>
          <div class="form-group">
            <label>Rang (Optionnel)</label>
            <input v-model="form.rank" placeholder="Ex: Diamant II" />
          </div>
        </div>
        <div class="modal-footer">
          <button @click="handleSaveAccount" class="btn btn-primary">Enregistrer</button>
        </div>
      </div>
    </div>

    <!-- Modale de confirmation de suppression -->
    <div v-if="isDeleteModalOpen" class="modal-backdrop" @click="isDeleteModalOpen = false">
      <div class="modal" @click.stop>
        <div class="modal-header">
          <h3>Supprimer le compte</h3>
          <button @click="isDeleteModalOpen = false" class="btn-close">×</button>
        </div>
        <div class="modal-body" v-if="accountToDelete">
          <p class="delete-confirm-text">
            Êtes-vous sûr de vouloir supprimer définitivement le compte
            <strong>{{ accountToDelete.displayName }}</strong> ?
            <br />
            Cette action est irréversible.
          </p>
        </div>
        <div class="modal-footer">
          <button @click="isDeleteModalOpen = false" class="btn btn-secondary">Annuler</button>
          <button @click="confirmDelete" class="btn btn-primary">Confirmer la suppression</button>
        </div>
      </div>
    </div>
  </div>
</template>
