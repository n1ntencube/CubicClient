(async () => {
  const ipc = window.electron

  const langManager = new window.LanguageManager()

  function fadeTransition(element, action = 'in') {
    if (!element) return
    if (action === 'in') {
      element.style.opacity = '1'
    } else {
      element.style.opacity = '0'
    }
  }

  document.querySelectorAll('.lang-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const lang = btn.getAttribute('data-lang')
      langManager.switchLanguage(lang)
      const mainContent = document.querySelector('.main-content')
      fadeTransition(mainContent, 'out')
      setTimeout(() => {
        fadeTransition(mainContent, 'in')
      }, 150)
    })
  })

  const skinImg = document.getElementById('skinImg')
  const launchBtn = document.getElementById('launchBtn')
  const profileLink = document.getElementById('profileLink')
  const accountSettingsBtn = document.getElementById('accountSettingsBtn')
  const settingsIconBtn = document.getElementById('settingsIconBtn')
  const settingsModal = document.getElementById('settingsModal')
  const launcherSettingsModal = document.getElementById('launcherSettingsModal')
  const modalClose = document.getElementById('modalClose')
  const modalLogout = document.getElementById('modalLogout')
  const modalName = document.getElementById('modalName')
  const modalUUID = document.getElementById('modalUUID')
  const modalSkin = document.getElementById('modalSkin')
  const launcherSettingsClose = document.getElementById('launcherSettingsClose')
  const launcherSettingsSave = document.getElementById('launcherSettingsSave')
  const languageSelect = document.getElementById('languageSelect')
  const autoLaunchCheck = document.getElementById('autoLaunchCheck')
  const ramAllocation = document.getElementById('ramAllocation')

  const progressModal = document.getElementById('progressModal')
  const progressBar = document.getElementById('progressBar')
  const progressTitle = document.getElementById('progressTitle')
  const progressText = document.getElementById('progressText')
  const progressBarContainer = document.getElementById('progressBarContainer')
  const playProgressBar = document.getElementById('playProgressBar')

  function showProgressModal(title) {
    if (!progressModal) return
    progressTitle.textContent = title
    progressBar.style.width = '0%'
    progressText.textContent = 'Starting...'
    progressModal.classList.add('show')
  }

  function updateProgress(data) {
    if (!progressBar || !progressText) return
    const messages = {
      'downloading-minecraft': 'Downloading Minecraft 1.12.2...',
      'downloading-forge': 'Downloading Forge...',
      'installing-forge': 'Installing Forge...',
      'complete': 'Installation complete!',
      'error': 'Installation error!'
    }
    if (data.status && data.status.includes('downloading-mod')) {
      progressText.textContent = `Downloading mod: ${data.modName || 'mod'}`
    } else {
      progressText.textContent = messages[data.status] || data.status
    }
    progressBar.style.width = `${data.progress || 0}%`
    if (playProgressBar) playProgressBar.style.width = `${data.progress || 0}%`
  }

  function closeProgressModal() {
    if (!progressModal) return
    progressModal.classList.remove('show')
  }

  if (window.electron && window.electron.on) {
    window.electron.on('install-progress', (data) => {
      console.log('[Progress]', data)
      updateProgress(data)
    })
  }

  let saved
  try {
    saved = await ipc.invoke('load-login')
  } catch (e) {
    saved = null
  }

  if (!saved || !saved.profile) {
    window.location.href = 'index.html'
    return
  }

  const { profile, mc } = saved
  let skinUrl = ''
  try {
    skinUrl = `https://crafatar.com/avatars/${profile.id}?size=64`
    if (skinImg) skinImg.src = skinUrl
  } catch (err) {
    console.error('Failed to load skin:', err)
  }

  function openAccountSettingsModal() {
    if (!settingsModal) return
    if (modalName) modalName.textContent = profile.name
    if (modalUUID) modalUUID.textContent = profile.id
    if (modalSkin) modalSkin.src = skinUrl
    try { refreshAccountsList() } catch (e) {}
    settingsModal.classList.add('show')
    fadeTransition(settingsModal, 'in')
  }

  function closeAccountSettingsModal() {
    if (!settingsModal) return
    fadeTransition(settingsModal, 'out')
    setTimeout(() => {
      settingsModal.classList.remove('show')
    }, 300)
  }

  function openLauncherSettingsModal() {
    if (!launcherSettingsModal) return
    launcherSettingsModal.classList.add('show')
    fadeTransition(launcherSettingsModal, 'in')
    try { refreshAccountsList() } catch (e) {}
  }

  function closeLauncherSettingsModal() {
    if (!launcherSettingsModal) return
    fadeTransition(launcherSettingsModal, 'out')
    setTimeout(() => {
      launcherSettingsModal.classList.remove('show')
    }, 300)
  }

  if (profileLink) {
    profileLink.addEventListener('click', (e) => {
      e.preventDefault()
      openAccountSettingsModal()
    })
  }

  if (accountSettingsBtn) {
    accountSettingsBtn.addEventListener('click', (e) => {
      e.preventDefault()
      openAccountSettingsModal()
    })
  }

  if (modalClose) {
    modalClose.addEventListener('click', () => closeAccountSettingsModal())
  }

  if (modalLogout) {
    modalLogout.addEventListener('click', async () => {
      try {
        await ipc.invoke('clear-login')
        window.location.href = 'index.html'
      } catch (err) {
        alert('Logout failed: ' + (err.message || String(err)))
      }
    })
  }

  if (settingsIconBtn) {
    settingsIconBtn.addEventListener('click', () => {
      openLauncherSettingsModal()
    })
  }

  if (launcherSettingsClose) {
    launcherSettingsClose.addEventListener('click', () => closeLauncherSettingsModal())
  }

  if (languageSelect) {
    languageSelect.value = langManager.currentLang
    languageSelect.addEventListener('change', (e) => {
      const selectedLang = e.target.value
      langManager.switchLanguage(selectedLang)
      fadeTransition(document.querySelector('.main-content'), 'out')
      setTimeout(() => {
        fadeTransition(document.querySelector('.main-content'), 'in')
      }, 150)
    })
  }

  if (launcherSettingsSave) {
    launcherSettingsSave.addEventListener('click', () => {
      const ramValue = ramAllocation ? ramAllocation.value : '2'
      const autoLaunch = autoLaunchCheck ? autoLaunchCheck.checked : false
      localStorage.setItem('launcherSettings', JSON.stringify({
        ram: ramValue,
        autoLaunch: autoLaunch
      }))
      alert('Settings saved!')
      closeLauncherSettingsModal()
    })
  }

  
  const accountsListDiv = document.getElementById('accountsList')
  const addAccountBtn = document.getElementById('addAccountBtn')

  async function refreshAccountsList() {
    if (!accountsListDiv) return
    accountsListDiv.innerHTML = '<div style="opacity:0.7">Loading accounts...</div>'
    try {
      const data = await ipc.invoke('list-accounts')
      accountsListDiv.innerHTML = ''
      if (!data || !data.accounts || data.accounts.length === 0) {
        accountsListDiv.innerHTML = '<div style="opacity:0.7">No accounts saved</div>'
        return
      }
      for (const a of data.accounts) {
        const el = document.createElement('div')
        el.style.display = 'flex'
        el.style.justifyContent = 'space-between'
        el.style.alignItems = 'center'
        el.style.padding = '6px'
        el.style.border = '1px solid rgba(255,255,255,0.06)'
        el.style.borderRadius = '6px'
        el.style.gap = '8px'

        
        const left = document.createElement('div')
        left.style.display = 'flex'
        left.style.alignItems = 'center'
        left.style.gap = '10px'

        const avatar = document.createElement('img')
        avatar.src = a.profile && a.profile.id ? `https://crafatar.com/avatars/${a.profile.id}?size=48` : 'profile.png'
        avatar.style.width = '40px'
        avatar.style.height = '40px'
        avatar.style.borderRadius = '8px'
        avatar.style.border = '2px solid rgba(255,255,255,0.06)'

        const name = document.createElement('div')
        name.textContent = a.profile ? a.profile.name : 'Unknown'
        name.style.fontWeight = '700'

        left.appendChild(avatar)
        left.appendChild(name)

        const actions = document.createElement('div')
        actions.style.display = 'flex'
        actions.style.gap = '4px'
        actions.style.flexShrink = '0'

        const isCurrent = data.current && a.profile && data.current === a.profile.id
        if (isCurrent) {
          el.style.background = 'linear-gradient(90deg, rgba(255,255,255,0.02), rgba(255,255,255,0.01))'
          const badge = document.createElement('div')
          badge.textContent = 'Current'
          badge.style.opacity = '0.9'
          badge.style.fontSize = '0.85rem'
          badge.style.marginRight = '4px'
          actions.appendChild(badge)
        }

        const switchBtn = document.createElement('button')
        switchBtn.className = 'modal-btn modal-btn-close'
        switchBtn.textContent = isCurrent ? 'Active' : 'Use'
        switchBtn.disabled = !!isCurrent
        switchBtn.style.padding = '4px 8px'
        switchBtn.style.fontSize = '0.8rem'
        switchBtn.onclick = async () => {
          await ipc.invoke('set-current-account', a.profile.id)
          alert('Switched to ' + a.profile.name)
          refreshAccountsList()
        }

        const removeBtn = document.createElement('button')
        removeBtn.className = 'modal-btn modal-btn-logout'
        removeBtn.textContent = 'Remove'
        removeBtn.style.padding = '4px 8px'
        removeBtn.style.fontSize = '0.8rem'
        removeBtn.onclick = async () => {
          if (!confirm('Remove account ' + a.profile.name + '?')) return
          await ipc.invoke('remove-account', a.profile.id)
          refreshAccountsList()
        }

        actions.appendChild(switchBtn)
        actions.appendChild(removeBtn)
        el.appendChild(left)
        el.appendChild(actions)
        accountsListDiv.appendChild(el)
      }
    } catch (err) {
      accountsListDiv.innerHTML = '<div style="color:#f66">Failed to load accounts</div>'
    }
  }

  if (addAccountBtn) {
    addAccountBtn.addEventListener('click', async () => {
      try {
        addAccountBtn.disabled = true
        addAccountBtn.textContent = 'Opening login...'
        const result = await ipc.invoke('start-oauth')
        if (result && result.profile) {
          await ipc.invoke('save-account', { profile: result.profile, mc: result.mc })
          refreshAccountsList()
          alert('Account added: ' + result.profile.name)
        }
      } catch (err) {
        alert('Add account failed: ' + (err.message || String(err)))
      } finally {
        addAccountBtn.disabled = false
        addAccountBtn.textContent = 'Add Account'
      }
    })
  }

  

  const installForgeBtn = document.getElementById('installForgeBtn')
  
  if (launchBtn) {
    launchBtn.addEventListener('click', async () => {
      try {
        if (progressBarContainer) progressBarContainer.style.display = 'block'
        if (playProgressBar) playProgressBar.style.width = '0%'
        launchBtn.disabled = true
        launchBtn.textContent = 'Launching...'
        showProgressModal('Launching Minecraft 1.12.2')

        try {
          updateProgress({ status: 'downloading-minecraft', progress: 0 })
          const dlRes = await ipc.invoke('download-minecraft', { version: '1.12.2' })
          if (!dlRes || !dlRes.ok) {
            throw new Error((dlRes && dlRes.message) || 'Download failed')
          }
        } catch (err) {
          console.warn('Minecraft download failed:', err)
          alert('Failed to download Minecraft 1.12.2: ' + (err.message || String(err)))
          launchBtn.textContent = 'Launch Minecraft'
          launchBtn.disabled = false
          if (progressBarContainer) progressBarContainer.style.display = 'none'
          closeProgressModal()
          return
        }

        try {
          updateProgress({ status: 'downloading-forge', progress: 10 })
          const installRes = await ipc.invoke('install-forge-mods', { modsUrls: [] })
          if (!installRes || !installRes.ok) {
            throw new Error((installRes && installRes.message) || 'Forge installation failed')
          }
        } catch (err) {
          console.warn('Forge install failed:', err)
          alert('Failed to install Forge: ' + (err.message || String(err)))
          launchBtn.textContent = 'Launch Minecraft'
          launchBtn.disabled = false
          if (progressBarContainer) progressBarContainer.style.display = 'none'
          closeProgressModal()
          return
        }

        updateProgress({ status: 'installing-forge', progress: 85 })
        const res = await ipc.invoke('launch', {
          mcProfile: profile,
          accessToken: mc.access_token
        })

        closeProgressModal()
        if (res.ok) {
          launchBtn.textContent = 'Minecraft Launched!'
          if (playProgressBar) playProgressBar.style.width = '100%'
          setTimeout(() => {
            launchBtn.textContent = 'Launch Minecraft'
            launchBtn.disabled = false
            if (progressBarContainer) progressBarContainer.style.display = 'none'
          }, 3000)
        } else {
          alert('Launch failed: ' + (res.message || 'Unknown error'))
          launchBtn.textContent = 'Launch Minecraft'
          launchBtn.disabled = false
          if (progressBarContainer) progressBarContainer.style.display = 'none'
        }
      } catch (err) {
        alert('Launch error: ' + (err.message || String(err)))
        launchBtn.textContent = 'Launch Minecraft'
        launchBtn.disabled = false
        if (progressBarContainer) progressBarContainer.style.display = 'none'
        closeProgressModal()
      }
    })
  }
})()
