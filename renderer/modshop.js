(async () => {
  const ipc = window.electron

  const modsContainer = document.getElementById('modsContainer')
  const searchBar = document.getElementById('searchBar')
  const homeBtn = document.getElementById('homeBtn')
  const filterBtns = document.querySelectorAll('.filter-btn')

  let allMods = []
  let installedMods = []
  let currentFilter = 'all'
  let searchQuery = ''

  if (homeBtn) {
    homeBtn.addEventListener('click', () => {
      window.location.href = 'home.html'
    })
  }

  filterBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      filterBtns.forEach(b => b.classList.remove('active'))
      btn.classList.add('active')
      currentFilter = btn.getAttribute('data-filter')
      renderMods()
    })
  })

  searchBar.addEventListener('input', (e) => {
    searchQuery = e.target.value.toLowerCase()
    renderMods()
  })

  async function loadMods() {
    try {
      modsContainer.innerHTML = '<div class="loading">Loading mods...</div>'
      
      const result = await ipc.invoke('get-all-mods')
      
      console.log('[ModRepository] Result from get-all-mods:', result)
      
      if (!result || !result.ok) {
        const errorMsg = result?.error || 'Unknown error'
        console.error('[ModRepository] Failed to load mods:', errorMsg)
        modsContainer.innerHTML = `<div class="error">Failed to load mods: ${errorMsg}<br><br>Please check:<br>1. Database connection in modsdb.json<br>2. The 'mods' table exists<br>3. Check console for details</div>`
        return
      }

      allMods = result.mods || []
      
      const installedResult = await ipc.invoke('get-installed-mods')
      installedMods = installedResult.map(m => m.name) || []
      
      console.log('[ModRepository] Installed mods:', installedMods)
      
      if (allMods.length === 0) {
        modsContainer.innerHTML = '<div class="empty">No mods found in database. Run mods_schema.sql to add sample mods!</div>'
        return
      }

      renderMods()
    } catch (err) {
      console.error('[ModRepository] Error loading mods:', err)
      modsContainer.innerHTML = `<div class="error">Error: ${err.message}<br><br>Check the console for details.</div>`
    }
  }

  function renderMods() {
    let filteredMods = allMods

    if (currentFilter === 'installed') {
      filteredMods = allMods.filter(m => isModInstalled(m))
    } else if (currentFilter === 'available') {
      filteredMods = allMods.filter(m => !isModInstalled(m))
    } else if (currentFilter === 'mandatory') {
      filteredMods = allMods.filter(m => m.mandatory)
    }

    if (searchQuery) {
      filteredMods = filteredMods.filter(m => 
        m.name.toLowerCase().includes(searchQuery) || 
        (m.description && m.description.toLowerCase().includes(searchQuery))
      )
    }

    if (filteredMods.length === 0) {
      modsContainer.innerHTML = '<div class="empty">No mods found matching your filters.</div>'
      return
    }

    modsContainer.innerHTML = ''

    filteredMods.forEach(mod => {
      const card = document.createElement('div')
      card.className = 'mod-card'
      
      const isInstalled = isModInstalled(mod)
      const isMandatory = mod.mandatory
      
      card.innerHTML = `
        <div class="mod-header">
          <div>
            <div class="mod-name">${escapeHtml(mod.name)}</div>
            ${mod.version ? `<div class="mod-version">v${escapeHtml(mod.version)}</div>` : ''}
          </div>
          <div style="display:flex; gap:6px; flex-direction:column;">
            ${isInstalled ? '<span class="mod-badge badge-installed">INSTALLED</span>' : '<span class="mod-badge badge-available">AVAILABLE</span>'}
            ${isMandatory ? '<span class="mod-badge badge-mandatory">MANDATORY</span>' : ''}
          </div>
        </div>
        <div class="mod-description">${mod.description ? escapeHtml(mod.description) : 'No description available.'}</div>
        <div class="mod-footer">
          <button class="mod-toggle ${isInstalled ? 'uninstall' : 'install'}" data-id="${mod.id}" data-url="${escapeHtml(mod.url)}" data-name="${escapeHtml(mod.name)}" ${isMandatory && isInstalled ? 'disabled' : ''}>
            ${isInstalled ? '🗑️ Uninstall' : '⬇️ Install'}
          </button>
        </div>
      `
      
      const toggleBtn = card.querySelector('.mod-toggle')
      toggleBtn.addEventListener('click', () => {
        if (isInstalled && !isMandatory) {
          uninstallMod(mod, toggleBtn)
        } else if (!isInstalled) {
          installMod(mod, toggleBtn)
        }
      })
      
      modsContainer.appendChild(card)
    })
  }

  function isModInstalled(mod) {
    const modFileName = getModFileName(mod.url)
    return installedMods.some(installedMod => {
      return installedMod === modFileName || 
             installedMod.toLowerCase().includes(mod.name.toLowerCase().replace(/\s+/g, ''))
    })
  }

  function getModFileName(url) {
    const parts = url.split('/')
    return parts[parts.length - 1]
  }

  async function installMod(mod, button) {
    const originalText = button.textContent
    button.disabled = true
    button.textContent = 'Installing...'

    try {
      console.log(`[ModRepository] Installing mod: ${mod.name}`)
      const result = await ipc.invoke('install-mod', { 
        modUrl: mod.url, 
        modName: mod.name 
      })
      
      if (!result || !result.ok) {
        throw new Error(result?.error || 'Failed to install mod')
      }

      const modFileName = getModFileName(mod.url)
      installedMods.push(modFileName)

      console.log(`[ModRepository] Successfully installed: ${mod.name}`)
      renderMods()
    } catch (err) {
      console.error('[ModRepository] Error installing mod:', err)
      alert(`Failed to install ${mod.name}: ${err.message}`)
      button.disabled = false
      button.textContent = originalText
    }
  }

  async function uninstallMod(mod, button) {
    const originalText = button.textContent
    button.disabled = true
    button.textContent = 'Uninstalling...'

    try {
      const modFileName = getModFileName(mod.url)
      console.log(`[ModRepository] Uninstalling mod: ${modFileName}`)
      
      const result = await ipc.invoke('remove-mod', { modName: modFileName })
      
      if (!result || !result.ok) {
        throw new Error(result?.error || 'Failed to uninstall mod')
      }

      installedMods = installedMods.filter(m => m !== modFileName)

      console.log(`[ModRepository] Successfully uninstalled: ${mod.name}`)
      renderMods()
    } catch (err) {
      console.error('[ModRepository] Error uninstalling mod:', err)
      alert(`Failed to uninstall ${mod.name}: ${err.message}`)
      button.disabled = false
      button.textContent = originalText
    }
  }

  function escapeHtml(text) {
    const div = document.createElement('div')
    div.textContent = text
    return div.innerHTML
  }

  await loadMods()
})()
