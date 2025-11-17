(async () => {
  const ipc = window.electron

  const consoleContainer = document.getElementById('consoleContainer')
  const clearBtn = document.getElementById('clearBtn')
  const backBtn = document.getElementById('backBtn')
  const killBtn = document.getElementById('killBtn')
  const statusText = document.getElementById('statusText')

  let autoScroll = true

  function addLogLine(text, type = 'info') {
    if (!consoleContainer) return
    
    const line = document.createElement('div')
    line.className = `console-line ${type}`
    
    const timestamp = new Date().toLocaleTimeString()
    line.innerHTML = `<span class="timestamp">[${timestamp}]</span> ${escapeHtml(text)}`
    
    consoleContainer.appendChild(line)
    
    if (autoScroll) {
      consoleContainer.scrollTop = consoleContainer.scrollHeight
    }
    
    const maxLines = 1000
    while (consoleContainer.children.length > maxLines) {
      consoleContainer.removeChild(consoleContainer.firstChild)
    }
  }

  function escapeHtml(text) {
    const div = document.createElement('div')
    div.textContent = text
    return div.innerHTML
  }

  if (window.electron && window.electron.on) {
    window.electron.on('minecraft-log', (payload) => {
      if (!payload) return
      let text = ''
      if (typeof payload === 'string') text = payload
      else if (payload.text) text = payload.text
      else text = JSON.stringify(payload)

      if (!text) return

      let type = 'info'
      const lower = text.toLowerCase()
      if (lower.includes('error') || lower.includes('exception')) type = 'error'
      else if (lower.includes('warn')) type = 'warn'
      else if (lower.includes('done') || lower.includes('success')) type = 'success'

      addLogLine(text, type)
    })

    window.electron.on('minecraft-exit', (payload) => {
      const code = (payload && typeof payload.code === 'number') ? payload.code : 0
      const crashed = payload && payload.crashed
      if (statusText) statusText.textContent = crashed ? 'Crashed' : 'Exited'
      addLogLine(`[CubicLauncher] Minecraft process exited with code ${code}${crashed ? ' (crashed)' : ''}`, crashed ? 'error' : 'success')
      if (killBtn) {
        killBtn.disabled = true
        killBtn.textContent = 'Process Ended'
      }
    })

    window.electron.on('minecraft-error', (payload) => {
      const message = (payload && payload.error) ? payload.error : String(payload)
      addLogLine(`[CubicLauncher] Error: ${message}`,'error')
    })
  }

  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      if (consoleContainer) {
        consoleContainer.innerHTML = ''
        addLogLine('[CubicLauncher] Console cleared', 'info')
      }
    })
  }

  if (backBtn) {
    backBtn.addEventListener('click', () => {
      window.location.href = 'home.html'
    })
  }

  if (killBtn) {
    killBtn.addEventListener('click', async () => {
      if (confirm('Are you sure you want to force close Minecraft?')) {
        try {
          await ipc.invoke('kill-minecraft')
          addLogLine('[CubicLauncher] Kill signal sent', 'warn')
        } catch (err) {
          addLogLine(`[CubicLauncher] Failed to kill process: ${err.message}`, 'error')
        }
      }
    })
  }

  if (consoleContainer) {
    consoleContainer.addEventListener('scroll', () => {
      const isAtBottom = consoleContainer.scrollHeight - consoleContainer.scrollTop <= consoleContainer.clientHeight + 50
      autoScroll = isAtBottom
    })
  }

  addLogLine('[CubicLauncher] Console initialized', 'success')
})()
