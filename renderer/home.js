(async () => {
  const ipc = window.electron

  try {
    await ipc.invoke('resize-window', { width: 1000, height: 630 })
  } catch (e) {
    console.warn('Failed to resize window:', e)
  }

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
  const rankBadge = document.getElementById('rankBadge')
  const launchBtn = document.getElementById('launchBtn')
  const profileLink = document.getElementById('profileLink')
  const accountSettingsBtn = document.getElementById('accountSettingsBtn')
  const settingsIconBtn = document.getElementById('settingsIconBtn')
  const modRepositoryBtn = document.getElementById('modRepositoryBtn')
  const logoBtn = document.getElementById('logoBtn')
  const settingsModal = document.getElementById('settingsModal')
  const launcherSettingsModal = document.getElementById('launcherSettingsModal')
  const modalClose = document.getElementById('modalClose')
  const modalLogout = document.getElementById('modalLogout')
  const modalName = document.getElementById('modalName')
  const modalUUID = document.getElementById('modalUUID')
  const modalSkin = document.getElementById('modalSkin')
  const aboutModal = document.getElementById('aboutModal')
  const aboutClose = document.getElementById('aboutClose')
  const aboutVersionEl = document.getElementById('aboutVersion')
  const aboutRepoEl = document.getElementById('aboutRepo')
  const aboutAuthorEl = document.getElementById('aboutAuthor')
  const aboutNameEl = document.getElementById('aboutName')
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
    if (skinImg) {
      skinImg.src = skinUrl
      skinImg.onerror = () => {
        console.warn('Failed to load avatar from crafatar, using fallback')
        skinImg.src = 'img/logo_cl_small.png'
      }
    }
  } catch (err) {
    console.error('Failed to load skin:', err)
    if (skinImg) skinImg.src = 'img/logo_cl_small.png'
  }

  async function loadRank() {
    if (!rankBadge) return
    try {
      const res = await ipc.invoke('get-user-rank', { uuid: profile.id, username: profile.name })
      console.log('[Rank] Response:', res)
      let group = res && res.rank ? res.rank : null
      if (!group) {
        rankBadge.textContent = 'NO RANK'
        rankBadge.style.background = 'linear-gradient(135deg,#444,#222)'
        rankBadge.style.color = '#fff'
        rankBadge.style.display = 'block'
        return
      }
      const displayMap = {
        default: { label: 'PLAYER', gradient: 'linear-gradient(135deg,#b5b5b5,#8a8a8a)', fg: '#111' },
        player: { label: 'PLAYER', gradient: 'linear-gradient(135deg,#b5b5b5,#8a8a8a)', fg: '#111' },
        admin: { label: 'ADMIN', gradient: 'linear-gradient(135deg,#ff512f,#dd2476)', fg: '#fff' },
        owner: { label: 'OWNER', gradient: 'linear-gradient(135deg,#8e2de2,#4a00e0)', fg: '#fff' },
        dev: { label: 'DEV', gradient: 'linear-gradient(135deg,#7F00FF,#3f87f5)', fg: '#fff' },
        moderator: { label: 'MOD', gradient: 'linear-gradient(135deg,#ff5fa8,#ff2d78)', fg: '#fff' },
        mod: { label: 'MOD', gradient: 'linear-gradient(135deg,#ff5fa8,#ff2d78)', fg: '#fff' },
        builder: { label: 'BUILDER', gradient: 'linear-gradient(135deg,#ff9a00,#ffce00)', fg: '#111' },
        vip: { label: 'VIP', gradient: 'linear-gradient(135deg,#f7971e,#ffd200)', fg: '#111' },
        diamond: { label: 'DIAMOND', gradient: 'linear-gradient(135deg,#5dddff,#00b5d6)', fg: '#fff' },
        gold: { label: 'GOLD', gradient: 'linear-gradient(135deg,#ffd700,#ffae00)', fg: '#111' },
        iron: { label: 'IRON', gradient: 'linear-gradient(135deg,#d1d1d1,#9e9e9e)', fg: '#111' }
      }
      const key = group.toLowerCase()
      const style = displayMap[key] || { label: group.toUpperCase(), gradient: 'linear-gradient(135deg,#ffffff,#dbeafe)', fg: '#111' }
      rankBadge.textContent = style.label
      rankBadge.style.background = style.gradient
      rankBadge.style.color = style.fg
      rankBadge.style.display = 'block'
    } catch (e) {
      console.warn('Rank fetch failed:', e)
      if (rankBadge) {
        rankBadge.textContent = 'RANK ERR'
        rankBadge.style.background = 'linear-gradient(135deg,#ff9966,#ff5e62)'
        rankBadge.style.color = '#111'
        rankBadge.style.display = 'block'
      }
    }
  }
  loadRank()

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

  async function openAboutModal() {
    if (!aboutModal) return
    try {
      const res = await fetch('../package.json')
      if (res && res.ok) {
        const pkg = await res.json()
        if (aboutVersionEl) aboutVersionEl.textContent = pkg.version || '—'
        if (aboutNameEl) aboutNameEl.textContent = pkg.name || 'CubicLauncher'
        if (aboutAuthorEl) aboutAuthorEl.textContent = (pkg.author && (pkg.author.name || pkg.author)) || pkg.author || 'n1ntencube'
        if (aboutRepoEl && pkg.repository) {
          const repo = typeof pkg.repository === 'string' ? pkg.repository : (pkg.repository.url || pkg.repository)
          aboutRepoEl.textContent = String(repo).replace(/^git\+/, '')
          aboutRepoEl.href = repo || '#'
        }
      }
    } catch (e) {
    }
    aboutModal.classList.add('show')
    fadeTransition(aboutModal, 'in')
  }

  function closeAboutModal() {
    if (!aboutModal) return
    fadeTransition(aboutModal, 'out')
    setTimeout(() => {
      aboutModal.classList.remove('show')
    }, 300)
  }

  if (profileLink) {
    profileLink.addEventListener('click', (e) => {
      e.preventDefault()
      openAccountSettingsModal()
    })
  }

  if (logoBtn) {
    logoBtn.addEventListener('click', (e) => {
      e.preventDefault()
      openAboutModal()
    })
  }

  if (aboutClose) {
    aboutClose.addEventListener('click', () => closeAboutModal())
  }

  if (aboutModal) {
    aboutModal.addEventListener('click', (e) => {
      if (e.target === aboutModal) closeAboutModal()
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
        document.body.style.transition = 'opacity 0.3s ease-out'
        document.body.style.opacity = '0'
        setTimeout(() => {
          window.location.href = 'index.html'
        }, 300)
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

  if (modRepositoryBtn) {
    modRepositoryBtn.addEventListener('click', () => {
      window.location.href = 'modshop.html'
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
        avatar.src = a.profile && a.profile.id ? `https://crafatar.com/avatars/${a.profile.id}?size=48` : 'img/logo_cl_small.png'
        avatar.onerror = () => { avatar.src = 'img/logo_cl_small.png' }
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
          if (playProgressBar) playProgressBar.style.width = '5%'
          updateProgress({ status: 'downloading-minecraft', progress: 5 })
          const dlRes = await ipc.invoke('download-minecraft', { version: '1.12.2' })
          if (!dlRes || !dlRes.ok) {
            throw new Error((dlRes && dlRes.message) || 'Download failed')
          }
          if (playProgressBar) playProgressBar.style.width = '20%'
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
          if (playProgressBar) playProgressBar.style.width = '30%'
          updateProgress({ status: 'downloading-forge', progress: 30 })
          
          console.log('[Launch] Fetching NintenCube mod list...')
          const modListRes = await ipc.invoke('get-nintencube-mods')
          let modsUrls = []
          
          if (modListRes && modListRes.ok && modListRes.mods && modListRes.mods.length > 0) {
            modsUrls = modListRes.mods.map(mod => {
              if (typeof mod === 'string') return mod
              if (mod.url) return mod.url
              return null
            }).filter(Boolean)
            console.log(`[Launch] Found ${modsUrls.length} mods to install`)
          } else {
            console.log('[Launch] No mods found from database, continuing without mods')
          }
          
          if (playProgressBar) playProgressBar.style.width = '40%'
          const installRes = await ipc.invoke('install-forge-mods', { modsUrls })
          if (!installRes || !installRes.ok) {
            throw new Error((installRes && installRes.message) || 'Forge installation failed')
          }
          if (playProgressBar) playProgressBar.style.width = '70%'
        } catch (err) {
          console.warn('Forge install failed:', err)
          alert('Failed to install Forge: ' + (err.message || String(err)))
          launchBtn.textContent = 'Launch Minecraft'
          launchBtn.disabled = false
          if (progressBarContainer) progressBarContainer.style.display = 'none'
          closeProgressModal()
          return
        }

        if (playProgressBar) playProgressBar.style.width = '85%'
        updateProgress({ status: 'installing-forge', progress: 85 })
        const res = await ipc.invoke('launch', {
          mcProfile: profile,
          accessToken: mc.access_token
        })

        if (playProgressBar) playProgressBar.style.width = '100%'
        closeProgressModal()
        if (res.ok) {
          if (res.navigateToConsole) {
            document.body.style.transition = 'opacity 0.3s ease-out'
            document.body.style.opacity = '0'
            setTimeout(() => {
              window.location.href = 'console.html'
            }, 300)
          } else {
            launchBtn.textContent = 'Minecraft Launched!'
            if (playProgressBar) playProgressBar.style.width = '100%'
            setTimeout(() => {
              launchBtn.textContent = 'Launch Minecraft'
              launchBtn.disabled = false
              if (progressBarContainer) progressBarContainer.style.display = 'none'
            }, 3000)
          }
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

  const mojangStatusDot = document.getElementById('mojangStatusDot')
  const mojangStatus = document.getElementById('mojangStatus')
  const microsoftStatusDot = document.getElementById('microsoftStatusDot')
  const microsoftStatus = document.getElementById('microsoftStatus')
  const nintencubeStatusDot = document.getElementById('nintencubeStatusDot')
  const nintencubeStatus = document.getElementById('nintencubeStatus')

  async function checkServerStatus(url, timeoutMs = 5000) {
    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), timeoutMs)
      
      const response = await fetch(url, {
        method: 'GET',
        signal: controller.signal
      })
      
      clearTimeout(timeout)
      return response.ok || response.status < 500
    } catch (err) {
      return false
    }
  }

  async function updateServerStatuses() {
    try {
      const mojangOnline = await checkServerStatus('https://sessionserver.mojang.com/session/minecraft/profile/00000000000000000000000000000000')
      if (mojangStatusDot) mojangStatusDot.className = mojangOnline ? 'status-dot online' : 'status-dot offline'
      if (mojangStatus) mojangStatus.textContent = mojangOnline ? 'Online' : 'Offline'
    } catch (e) {
      if (mojangStatusDot) mojangStatusDot.className = 'status-dot offline'
      if (mojangStatus) mojangStatus.textContent = 'Offline'
    }

    try {
      const msOnline = await checkServerStatus('https://login.live.com/oauth20_authorize.srf')
      if (microsoftStatusDot) microsoftStatusDot.className = msOnline ? 'status-dot online' : 'status-dot offline'
      if (microsoftStatus) microsoftStatus.textContent = msOnline ? 'Online' : 'Offline'
    } catch (e) {
      if (microsoftStatusDot) microsoftStatusDot.className = 'status-dot offline'
      if (microsoftStatus) microsoftStatus.textContent = 'Offline'
    }

    try {
      const ncOnline = await checkServerStatus('https://play.nintencube.fr/')
      if (nintencubeStatusDot) nintencubeStatusDot.className = ncOnline ? 'status-dot online' : 'status-dot offline'
      if (nintencubeStatus) nintencubeStatus.textContent = ncOnline ? 'Online' : 'Offline'
    } catch (e) {
      if (nintencubeStatusDot) nintencubeStatusDot.className = 'status-dot offline'
      if (nintencubeStatus) nintencubeStatus.textContent = 'Offline'
    }
  }

  updateServerStatuses()

  setInterval(updateServerStatuses, 30000)
})()
