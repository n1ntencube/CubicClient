const loginBtn = document.getElementById('loginBtn')
const codeBox = document.getElementById('code-box')
const codeText = document.getElementById('code')
const profileDiv = document.getElementById('profile')

console.log('Renderer loaded. electron =', window.electron)

const ipc = window.electron

loginBtn.addEventListener('click', async () => {
  loginBtn.disabled = true
  loginBtn.textContent = 'Getting device code...'

  try {
    const deviceData = await ipc.invoke('get-device-code')

    codeText.textContent = deviceData.user_code
    codeBox.style.display = 'block'
    loginBtn.textContent = 'Waiting for authorization...'

    const { mc, profile } = await ipc.invoke('poll-for-minecraft', deviceData)
    profileDiv.style.display = 'block'
    profileDiv.textContent = `Logged in as ${profile.name} (${profile.id})`
    loginBtn.textContent = 'Launch Minecraft'
    loginBtn.disabled = false

    loginBtn.onclick = async () => {
      const result = await ipc.invoke('launch', {
        mcProfile: profile,
        accessToken: mc.access_token,
        versionJarPath: './path/to/your/minecraft.jar',
        gameDir: './.minecraft'
      })
      console.log('Launch result:', result)
    }

  } catch (err) {
    alert('Login failed: ' + err.message)
    console.error(err)
    loginBtn.disabled = false
    loginBtn.textContent = 'Login with Microsoft'
  }
})
