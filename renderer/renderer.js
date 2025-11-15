const loginBtn = document.getElementById('loginBtn')
const codeBox = document.getElementById('code-box')
const codeText = document.getElementById('code')
const profileDiv = document.getElementById('profile')

console.log('Renderer loaded. electron =', window.electron)

const ipc = window.electron

;(async () => {
  try {
    const saved = await ipc.invoke('load-login')
    if (saved && saved.profile) {
      window.location.href = 'home.html'
      return
    }
  } catch (e) {
  }
})()

loginBtn.addEventListener('click', async () => {
  loginBtn.disabled = true
  loginBtn.textContent = 'Opening Microsoft login...'

  try {
    const result = await ipc.invoke('start-oauth')

    const { mc, profile } = result
    await ipc.invoke('save-account', { mc, profile }).catch(() => {})

    window.location.href = 'home.html'

  } catch (err) {
    alert('Login failed: ' + (err.message || String(err)))
    console.error(err)
    loginBtn.disabled = false
    loginBtn.textContent = 'Se connecter avec Microsoft'
  }
})
