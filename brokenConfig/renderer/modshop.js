(async () => {
  const ipc = window.electron

  const modsContainer = document.getElementById('modsContainer')
  const searchBar = document.getElementById('searchBar')
  const homeBtn = document.getElementById('homeBtn')
  const filterBtns = document.querySelectorAll('.filter-btn')

  let allMods = []
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
      
      console.log('[ModShop] Result from get-all-mods:', result)
      
      if (!result || !result.ok) {
        const errorMsg = result?.error || 'Unknown error'
        console.error('[ModShop] Failed to load mods:', errorMsg)
        modsContainer.innerHTML = `<div class="error">Failed to load mods: ${errorMsg}<br><br>Please check:<br>1. Database connection in modsdb.json<br>2. The 'mods' table exists<br>3. Check console for details</div>`
        return
      }

      allMods = result.mods || []
      
      if (allMods.length === 0) {
        modsContainer.innerHTML = '<div class="empty">No mods found in database. Run mods_schema.sql to add sample mods!</div>'
        return
      }

      renderMods()
    } catch (err) {
      console.error('[ModShop] Error loading mods:', err)
      modsContainer.innerHTML = `<div class="error">Error: ${err.message}<br><br>Check the console for details.</div>`
    }
  }

  function renderMods() {
    let filteredMods = allMods

    if (currentFilter === 'enabled') {
      filteredMods = allMods.filter(m => m.enabled)
    } else if (currentFilter === 'disabled') {
      filteredMods = allMods.filter(m => !m.enabled)
    } else if (currentFilter === 'required') {
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
      
      const isEnabled = mod.enabled
      const isMandatory = mod.mandatory
      
      card.innerHTML = `
        <div class="mod-header">
          <div>
            <div class="mod-name">${escapeHtml(mod.name)}</div>
            ${mod.version ? `<div class="mod-version">v${escapeHtml(mod.version)}</div>` : ''}
          </div>
          <div style="display:flex; gap:6px; flex-direction:column;">
            ${isEnabled ? '<span class="mod-badge badge-enabled">ENABLED</span>' : '<span class="mod-badge badge-disabled">DISABLED</span>'}
            ${isMandatory ? '<span class="mod-badge badge-required">MANDATORY</span>' : ''}
          </div>
        </div>
        <div class="mod-description">${mod.description ? escapeHtml(mod.description) : 'No description available.'}</div>
        <div class="mod-footer">
          <button class="mod-toggle ${isEnabled ? 'disable' : 'enable'}" data-id="${mod.id}" ${isMandatory ? 'disabled' : ''}>
            ${isEnabled ? '❌ Disable' : '✅ Enable'}
          </button>
        </div>
      `
      
      const toggleBtn = card.querySelector('.mod-toggle')
      toggleBtn.addEventListener('click', () => toggleMod(mod.id, !isEnabled, toggleBtn))
      
      modsContainer.appendChild(card)
    })
  }

  async function toggleMod(modId, enable, button) {
    const originalText = button.textContent
    button.disabled = true
    button.textContent = enable ? 'Enabling...' : 'Disabling...'

    try {
      const result = await ipc.invoke('toggle-mod', { modId, enable })
      
      if (!result || !result.ok) {
        throw new Error(result?.error || 'Failed to toggle mod')
      }

      const modIndex = allMods.findIndex(m => m.id === modId)
      if (modIndex !== -1) {
        allMods[modIndex].enabled = enable
      }

      renderMods()
    } catch (err) {
      console.error('[ModShop] Error toggling mod:', err)
      alert(`Failed to ${enable ? 'enable' : 'disable'} mod: ${err.message}`)
      button.disabled = false
      button.textContent = originalText
    }
  }

  function escapeHtml(text) {
    const div = document.createElement('div')
    div.textContent = text
    return div.innerHTML
  }

  loadMods()
})()
