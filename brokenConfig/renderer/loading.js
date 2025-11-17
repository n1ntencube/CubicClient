(async () => {
  const ipc = window.electron

  const progressBar = document.getElementById('progressBar')
  const statusText = document.getElementById('statusText')
  const errorMessage = document.getElementById('errorMessage')
  const errorText = document.getElementById('errorText')
  const retryButton = document.getElementById('retryButton')

  const checkJava = document.getElementById('checkJava')
  const checkMinecraft = document.getElementById('checkMinecraft')
  const checkAuth = document.getElementById('checkAuth')
  const checkDirectories = document.getElementById('checkDirectories')

  function updateProgress(percent) {
    if (progressBar) progressBar.style.width = `${percent}%`
  }

  function updateStatus(text) {
    if (statusText) statusText.textContent = text
  }

  function updateCheckItem(element, status, statusText) {
    if (!element) return
    element.className = `check-item ${status}`
    const statusEl = element.querySelector('.check-status')
    const iconEl = element.querySelector('.check-icon')
    
    if (statusEl) statusEl.textContent = statusText
    
    if (iconEl) {
      if (status === 'checking') iconEl.innerHTML = '<span class="spinner">⟳</span>'
      else if (status === 'success') iconEl.textContent = '✓'
      else if (status === 'error') iconEl.textContent = '✗'
      else iconEl.textContent = '⏳'
    }
  }

  function showError(message) {
    if (errorText) errorText.textContent = message
    if (errorMessage) errorMessage.classList.add('show')
    if (retryButton) retryButton.classList.add('show')
  }

  async function performChecks() {
    try {
      if (errorMessage) errorMessage.classList.remove('show')
      if (retryButton) retryButton.classList.remove('show')

      updateProgress(10)
      updateStatus('Creating game directories...')
      updateCheckItem(checkDirectories, 'checking', 'Checking...')

      try {
        const gameDir = await ipc.invoke('get-game-dir')
        updateCheckItem(checkDirectories, 'success', 'Ready')
        console.log('[Loading] Game directory:', gameDir)
      } catch (err) {
        updateCheckItem(checkDirectories, 'error', 'Failed')
        throw new Error(`Failed to create game directories: ${err.message}`)
      }

      updateProgress(30)
      updateStatus('Checking Java installation...')
      updateCheckItem(checkJava, 'checking', 'Checking...')

      try {
        const javaResult = await ipc.invoke('ensure-java')
        if (!javaResult || !javaResult.ok) {
          throw new Error(javaResult?.error || 'Java check failed')
        }
        updateCheckItem(checkJava, 'success', 'Installed')
        console.log('[Loading] Java available at:', javaResult.path)
      } catch (err) {
        updateCheckItem(checkJava, 'error', 'Missing')
        throw new Error(`Java runtime error: ${err.message}`)
      }

      updateProgress(60)
      updateStatus('Verifying Minecraft installation...')
      updateCheckItem(checkMinecraft, 'checking', 'Checking...')

      try {
        const gameDir = await ipc.invoke('get-game-dir')
        updateCheckItem(checkMinecraft, 'success', 'Ready')
      } catch (err) {
        updateCheckItem(checkMinecraft, 'error', 'Failed')
        throw new Error(`Minecraft check failed: ${err.message}`)
      }

      updateProgress(80)
      updateStatus('Checking authentication...')
      updateCheckItem(checkAuth, 'checking', 'Checking...')

      try {
        const saved = await ipc.invoke('load-login')
        if (saved && saved.profile) {
          updateCheckItem(checkAuth, 'success', 'Logged in')
          console.log('[Loading] User logged in as:', saved.profile.name)
          
          updateProgress(100)
          updateStatus('Loading launcher...')
          setTimeout(() => {
            document.body.style.transition = 'opacity 0.3s ease-out'
            document.body.style.opacity = '0'
            setTimeout(() => {
              window.location.href = 'home.html'
            }, 300)
          }, 500)
        } else {
          updateCheckItem(checkAuth, 'success', 'Not logged in')
          console.log('[Loading] No saved login, redirecting to login page')
          
          updateProgress(100)
          updateStatus('Ready to sign in...')
          setTimeout(() => {
            document.body.style.transition = 'opacity 0.3s ease-out'
            document.body.style.opacity = '0'
            setTimeout(() => {
              window.location.href = 'index.html'
            }, 300)
          }, 500)
        }
      } catch (err) {
        updateCheckItem(checkAuth, 'error', 'Failed')
        throw new Error(`Authentication check failed: ${err.message}`)
      }

    } catch (err) {
      console.error('[Loading] Check failed:', err)
      updateStatus('Initialization failed')
      showError(err.message || 'An unknown error occurred')
    }
  }

  if (retryButton) {
    retryButton.addEventListener('click', () => {
      window.location.reload()
    })
  }

  setTimeout(() => {
    performChecks()
  }, 500)
})()
