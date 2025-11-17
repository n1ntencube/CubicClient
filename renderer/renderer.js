const loginBtn = document.getElementById('loginBtn')
const codeBox = document.getElementById('code-box')
const codeText = document.getElementById('code')
const profileDiv = document.getElementById('profile')

console.log('Renderer loaded. electron =', window.electron)

const ipc = window.electron

const langManager = new window.LanguageManager()

;(async () => {
  try {
    await ipc.invoke('resize-window', { width: 1000, height: 630 })
  } catch (e) {
    console.warn('Failed to resize window:', e)
  }

  try {
    const saved = await ipc.invoke('load-login')
    if (saved && saved.profile) {
      document.body.style.transition = 'opacity 0.3s ease-out'
      document.body.style.opacity = '0'
      setTimeout(() => {
        window.location.href = 'home.html'
      }, 300)
      return
    }
  } catch (e) {
  }
})()

loginBtn.addEventListener('click', async () => {
  loginBtn.disabled = true
  loginBtn.textContent = 'Waiting for login...'

  try {
    const result = await ipc.invoke('start-oauth')

    const { mc, profile } = result
    await ipc.invoke('save-account', { mc, profile }).catch(() => {})

    document.body.style.transition = 'opacity 0.3s ease-out'
    document.body.style.opacity = '0'
    setTimeout(() => {
      window.location.href = 'home.html'
    }, 300)

  } catch (err) {
    alert('Login failed: ' + (err.message || String(err)))
    console.error(err)
    loginBtn.disabled = false
    loginBtn.textContent = 'Se connecter avec Microsoft'
  }
})
