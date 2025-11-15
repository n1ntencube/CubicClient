const TRANSLATIONS = {
  en: {
    title: 'nintencube',
    ready: 'Ready to play!',
    launch: '▶ PLAY',
    accountSettings: 'Account Settings',
    manageAccount: 'Manage your account',
    logout: 'Logout',
    close: 'Close',
    launcherSettings: 'Launcher Settings',
    configureLauncher: 'Configure launcher options',
    autoLaunch: 'Auto-launch on start',
    ramAlloc: 'RAM Allocation (GB)',
    language: 'Language',
    save: 'Save'
  },
  fr: {
    title: 'nintencube',
    ready: 'Prêt à jouer!',
    launch: '▶ JOUER',
    accountSettings: 'Paramètres du compte',
    manageAccount: 'Gérez votre compte',
    logout: 'Déconnexion',
    close: 'Fermer',
    launcherSettings: 'Paramètres du Lanceur',
    configureLauncher: 'Configurez les options du lanceur',
    autoLaunch: 'Lancement automatique au démarrage',
    ramAlloc: 'Allocation RAM (GB)',
    language: 'Langue',
    save: 'Enregistrer'
  },
  es: {
    title: 'nintencube',
    ready: '¡Listo para jugar!',
    launch: '▶ JUGAR',
    accountSettings: 'Configuración de Cuenta',
    manageAccount: 'Administra tu cuenta',
    logout: 'Cerrar Sesión',
    close: 'Cerrar',
    launcherSettings: 'Configuración del Lanzador',
    configureLauncher: 'Configura las opciones del lanzador',
    autoLaunch: 'Iniciar automáticamente al comenzar',
    ramAlloc: 'Asignación de RAM (GB)',
    language: 'Idioma',
    save: 'Guardar'
  },
  de: {
    title: 'nintencube',
    ready: 'Bereit zum Spielen!',
    launch: '▶ SPIELEN',
    accountSettings: 'Kontoeinstellungen',
    manageAccount: 'Verwalten Sie Ihr Konto',
    logout: 'Abmelden',
    close: 'Schließen',
    launcherSettings: 'Launcher-Einstellungen',
    configureLauncher: 'Konfigurieren Sie Launcher-Optionen',
    autoLaunch: 'Automatischer Start beim Starten',
    ramAlloc: 'RAM-Zuweisung (GB)',
    language: 'Sprache',
    save: 'Speichern'
  }
}

class LanguageManager {
  constructor() {
    this.currentLang = this.detectLanguage()
    this.loadLanguage(this.currentLang)
  }

  detectLanguage() {
    const savedLang = localStorage.getItem('cubicLauncherLang')
    if (savedLang && TRANSLATIONS[savedLang]) {
      return savedLang
    }

    const browserLang = navigator.language || navigator.userLanguage
    const langCode = browserLang.split('-')[0]

    if (TRANSLATIONS[langCode]) {
      return langCode
    }

    return 'en'
  }

  loadLanguage(lang) {
    this.currentLang = lang
    localStorage.setItem('cubicLauncherLang', lang)
    this.updateUI()
  }

  updateUI() {
    const elements = document.querySelectorAll('[data-i18n]')
    elements.forEach(element => {
      const key = element.getAttribute('data-i18n')
      const translation = TRANSLATIONS[this.currentLang][key]
      if (translation) {
        element.textContent = translation
      }
    })

    document.querySelectorAll('.lang-btn').forEach(btn => {
      btn.classList.remove('active')
    })
    document.querySelector(`.lang-btn[data-lang="${this.currentLang}"]`)?.classList.add('active')
  }

  switchLanguage(lang) {
    if (TRANSLATIONS[lang]) {
      this.loadLanguage(lang)
    }
  }

  getTranslation(key) {
    return TRANSLATIONS[this.currentLang]?.[key] || TRANSLATIONS['en'][key] || key
  }
}

window.LanguageManager = LanguageManager
