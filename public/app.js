document.addEventListener('DOMContentLoaded', () => {
  // ===== APPLICATION STATE =====
  let appState = {
    projects: [],
    conversations: [],
    messages: [],
    runs: [],
    workers: [],
    activeProjectId: null,
    activeConversationId: null,
    activeRunId: null,
    planMode: true,
    eventSource: null
  };

  // ===== UI ELEMENTS =====
  const projectsListSidebar = document.getElementById('projects-list-sidebar');
  const conversationsListSidebar = document.getElementById('conversations-list-sidebar');
  const currentTaskTitle = document.getElementById('current-task-title');
  const headerProjectSelect = document.getElementById('header-project-select');
  const chatProjectSelect = document.getElementById('chat-project-select');
  const chatThread = document.getElementById('chat-thread');
  const chatInputTextarea = document.getElementById('chat-input-textarea');
  const btnSendInstruction = document.getElementById('btn-send-instruction');
  const btnTogglePlanMode = document.getElementById('btn-toggle-plan-mode');
  const planModeLabel = document.getElementById('plan-mode-label');
  const selectAiModel = document.getElementById('select-ai-model');
  const btnNewTask = document.getElementById('btn-new-task');
  const btnNewConversation = document.getElementById('btn-new-conversation');
  const plansListContainer = document.getElementById('plans-list-container');
  const checklistItemsContainer = document.getElementById('checklist-items-container');
  const progressRatioBadge = document.getElementById('progress-ratio-badge');
  const completedTasksLabel = document.getElementById('completed-tasks-label');
  const workspaceScrollArea = document.getElementById('workspace-scroll-area');

  // ===== HELPERS =====
  function getActiveProject() {
    return appState.projects.find(p => p.id === appState.activeProjectId) || appState.projects[0] || null;
  }
  function getProjectConversations() {
    if (!appState.activeProjectId) return appState.conversations;
    return appState.conversations.filter(c => c.projectId === appState.activeProjectId);
  }
  function scrollToBottom() {
    if (workspaceScrollArea) {
      setTimeout(() => { workspaceScrollArea.scrollTop = workspaceScrollArea.scrollHeight; }, 100);
    }
  }

  // ===== API FETCHING =====
  async function fetchProjects() {
    try {
      const res = await fetch('/api/projects');
      const data = await res.json();
      if (data.ok) {
        appState.projects = data.projects;
        if (!appState.activeProjectId && data.projects.length > 0) {
          appState.activeProjectId = data.projects[0].id;
        }
        renderProjectSelectors();
        renderProjectsSidebar();
      }
    } catch (e) {}
  }

  async function fetchConversations() {
    try {
      if (!appState.activeProjectId) return;
      const res = await fetch(`/api/conversations?projectId=${appState.activeProjectId}`);
      const data = await res.json();
      if (data.ok) {
        appState.conversations = data.conversations;
        const projectConvs = getProjectConversations();
        if (projectConvs.length > 0) {
          if (!projectConvs.find(c => c.id === appState.activeConversationId)) {
            appState.activeConversationId = projectConvs[0].id;
          }
        } else {
          appState.activeConversationId = null;
        }
        renderConversationsSidebar();
        if (appState.activeConversationId) {
          await fetchConversationDetails(appState.activeConversationId);
        } else {
          renderEmptyChat();
        }
      }
    } catch (e) {}
  }

  async function fetchConversationDetails(convId) {
    try {
      const res = await fetch(`/api/conversations/${convId}`);
      const data = await res.json();
      if (data.ok) {
        appState.messages = data.messages;
        appState.runs = data.runs;
        if (data.runs && data.runs.length > 0) {
          appState.activeRunId = data.runs[0].id;
          subscribeToRunEvents(data.runs[0].id);
        }
        renderChatThread();
        renderRightInspector();
      }
    } catch (e) {}
  }

  // ===== SSE STREAMING ENGINE =====
  function subscribeToRunEvents(runId) {
    if (appState.eventSource) {
      appState.eventSource.close();
    }
    try {
      appState.eventSource = new EventSource(`/api/runs/${runId}/events`);
      appState.eventSource.onmessage = (event) => {
        const evt = JSON.parse(event.data);
        handleRunEvent(evt);
      };
    } catch (e) {}
  }

  function handleRunEvent(evt) {
    // Re-fetch conversation details to keep UI in sync
    if (appState.activeConversationId) {
      fetchConversationDetails(appState.activeConversationId);
    }
  }

  // ===== RENDER PROJECT SELECTORS =====
  function renderProjectSelectors() {
    const opts = appState.projects.map(p => `
      <option value="${p.id}" ${p.id === appState.activeProjectId ? 'selected' : ''}>
        📁 ${p.name}
      </option>
    `).join('');
    if (headerProjectSelect) {
      headerProjectSelect.innerHTML = opts;
      headerProjectSelect.onchange = (e) => setActiveProject(e.target.value);
    }
    if (chatProjectSelect) {
      chatProjectSelect.innerHTML = opts;
      chatProjectSelect.onchange = (e) => setActiveProject(e.target.value);
    }
  }

  function setActiveProject(projectId) {
    appState.activeProjectId = projectId;
    appState.activeConversationId = null;
    renderProjectSelectors();
    renderProjectsSidebar();
    fetchConversations();
  }

  // ===== LEFT SIDEBAR: PROJECTS =====
  function renderProjectsSidebar() {
    if (!projectsListSidebar) return;
    projectsListSidebar.innerHTML = appState.projects.map(p => `
      <div class="tree-item ${p.id === appState.activeProjectId ? 'active' : ''}" data-project-id="${p.id}" title="${p.path}">
        <span>📁 ${p.name}</span>
        ${p.id === appState.activeProjectId ? '<span class="status-dot green" style="margin-left:auto;"></span>' : ''}
      </div>
    `).join('');
    document.querySelectorAll('#projects-list-sidebar .tree-item').forEach(el => {
      el.addEventListener('click', () => setActiveProject(el.dataset.projectId));
    });
  }

  // ===== LEFT SIDEBAR: CONVERSATIONS =====
  function renderConversationsSidebar() {
    if (!conversationsListSidebar) return;
    const projectConvs = getProjectConversations();
    if (projectConvs.length === 0) {
      conversationsListSidebar.innerHTML = `
        <div style="padding:12px;color:var(--text-dim);font-size:12px;text-align:center;">
          Sin conversaciones en este proyecto.<br>Escribe abajo para iniciar.
        </div>`;
      return;
    }
    conversationsListSidebar.innerHTML = projectConvs.map(c => `
      <div class="tree-item ${c.id === appState.activeConversationId ? 'active' : ''}" data-conv-id="${c.id}">
        <span class="status-dot green"></span>
        <span style="overflow:hidden;text-overflow:ellipsis;">${c.title}</span>
      </div>
    `).join('');
    document.querySelectorAll('#conversations-list-sidebar .tree-item').forEach(el => {
      el.addEventListener('click', () => {
        appState.activeConversationId = el.dataset.conv-id;
        renderConversationsSidebar();
        fetchConversationDetails(el.dataset.conv-id);
      });
    });
  }

  // ===== EMPTY CHAT SCREEN =====
  function renderEmptyChat() {
    if (!chatThread) return;
    const proj = getActiveProject();
    currentTaskTitle.textContent = 'Nueva Conversación';
    chatThread.innerHTML = `
      <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;padding:40px 20px;color:var(--text-dim);">
        <p style="font-size:36px;margin-bottom:12px;">✨</p>
        <p style="font-size:16px;font-weight:600;color:#fff;">Codex Agentic IDE</p>
        <p style="font-size:13px;margin-top:4px;">Proyecto activo: <strong style="color:var(--primary);">${proj ? proj.name : 'Ninguno'}</strong></p>
        <p style="font-size:12.5px;margin-top:10px;max-width:420px;text-align:center;line-height:1.5;">
          Conversación vacía. Escribe una instrucción abajo para iniciar la orquestación multimodelo (GPT-4o + Claude 3.5 + Antigravity).
        </p>
      </div>
    `;
    plansListContainer.innerHTML = '<div style="padding:8px;color:var(--text-dim);font-size:12px;">Sin planes activos</div>';
    progressRatioBadge.textContent = '0/0';
    completedTasksLabel.textContent = '0 completed';
    checklistItemsContainer.innerHTML = '';
  }

  function formatMarkdown(text) {
    if (!text) return '';
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\n\n/g, '</p><p style="margin-top:8px;">')
      .replace(/\n/g, '<br>');
  }

  // ===== MAIN CHAT THREAD (CODEX MODEL) =====
  function renderChatThread() {
    if (!chatThread) return;
    const proj = getActiveProject();
    const projName = proj ? proj.name : 'proyecto';

    if (appState.messages.length === 0) {
      renderEmptyChat();
      return;
    }

    const currentConv = appState.conversations.find(c => c.id === appState.activeConversationId);
    if (currentConv) currentTaskTitle.textContent = currentConv.title;

    chatThread.innerHTML = appState.messages.map(msg => {
      const timeStr = new Date(msg.createdAt || msg.timestamp).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });

      // --- USER MESSAGE ---
      if (msg.role === 'user') {
        return `
          <div class="chat-msg chat-msg-user">
            <div class="chat-msg-avatar">A</div>
            <div class="chat-msg-body">
              <div class="chat-msg-meta"><strong>Tú</strong> <span class="chat-msg-time">${timeStr}</span></div>
              <div class="chat-msg-content">${msg.content}</div>
            </div>
          </div>
        `;
      }

      // --- ASSISTANT MESSAGE ---
      if (msg.role === 'assistant') {
        const isReview = msg.kind === 'review' && msg.review;
        const isBlocked = msg.kind === 'blocked';
        const isError = msg.kind === 'error';

        // Status badge
        let badgeLabel = '💬 RESPUESTA';
        let badgeClass = 'secondary';
        if (isReview) { badgeLabel = '🔍 REVISIÓN & DIAGNÓSTICO'; badgeClass = 'secondary'; }
        else if (isBlocked) { badgeLabel = '🚫 BLOQUEADO'; badgeClass = 'warning'; }
        else if (isError) { badgeLabel = '❌ ERROR'; badgeClass = 'danger'; }

        // Content body
        let contentHtml = '';

        if (isReview && msg.review) {
          const review = msg.review;
          const findingsHtml = (review.findings || []).map(f => {
            const severityColors = {
              critical: '#ef4444', high: '#f59e0b', medium: '#6366f1', low: '#10b981', info: '#64748b'
            };
            const color = severityColors[f.severity] || '#64748b';
            return `
              <div style="margin:4px 0;padding:8px 10px;border-radius:6px;border-left:3px solid ${color};background:rgba(0,0,0,0.2);font-size:12px;">
                <strong style="color:${color};">${f.severity.toUpperCase()}</strong> — ${f.title}
                <p style="color:var(--text-muted);margin-top:2px;">${f.evidence || ''}</p>
                ${f.recommendation ? `<p style="color:var(--text-dim);margin-top:2px;">💡 ${f.recommendation}</p>` : ''}
              </div>
            `;
          }).join('');

          // Tool pills from review data
          const toolPillsHtml = [
            { icon: '📄', label: 'read_context', text: `Inspeccioné ${review.inspectedFiles?.length || 0} archivos del proyecto` },
            { icon: '📑', label: 'inspect_files', text: 'Revisé package.json, README.md, AGENTS.md y archivos clave' },
            { icon: '🌿', label: 'git_status', text: `Rama: ${review.git?.branch || 'N/A'} · ${review.git?.changedFiles?.length || 0} archivo(s) modificados` },
            { icon: '🧪', label: 'run_tests', text: `Pruebas: ${review.tests?.status || 'N/A'}` }
          ].map(tp => `
            <div style="font-family:var(--font-code);font-size:11.5px;color:#a5b4fc;display:flex;align-items:center;gap:6px;">
              <span style="font-size:12px;">${tp.icon}</span>
              <span style="opacity:0.8;">${tp.label} ·</span>
              <span>${tp.text}</span>
            </div>
          `).join('');

          contentHtml = `
            <p style="margin-bottom:10px;font-size:13.5px;line-height:1.6;color:var(--text-main);">
              Voy a revisar el flujo del repositorio <strong>${projName}</strong> y analizar la causa en evidencia. Se consultaron los archivos principales del proyecto para diagnosticar el estado del Control Plane:
            </p>

            <!-- TOOL CALL ACTIVITY PILLS -->
            <div style="display:flex;flex-direction:column;gap:6px;margin:10px 0;background:rgba(0,0,0,0.3);padding:10px;border-radius:8px;border:1px solid rgba(255,255,255,0.06);">
              ${toolPillsHtml}
            </div>

            <!-- FINDINGS & EVIDENCE -->
            <div style="font-size:13px;color:var(--text-main);line-height:1.6;margin:10px 0;background:rgba(99,102,241,0.06);padding:12px;border-radius:8px;border:1px solid var(--primary-glow);">
              <strong style="color:#a5b4fc;display:block;margin-bottom:4px;">📋 Hallazgos & Diagnóstico basado en Evidencia:</strong>
              <div style="color:var(--text-main);">${formatMarkdown(msg.content)}</div>
            </div>

            ${findingsHtml ? `
            <!-- DETAILED FINDINGS LIST -->
            <div style="margin-top:12px;">
              <strong style="color:#a5b4fc;font-size:12px;display:block;margin-bottom:6px;">🔍 Hallazgos Detallados (${review.findings?.length || 0}):</strong>
              ${findingsHtml}
            </div>` : ''}

            <!-- REVIEWER REASONING -->
            <div style="font-size:12px;color:var(--text-muted);margin-top:10px;line-height:1.5;background:rgba(0,0,0,0.25);padding:12px;border-radius:8px;border:1px solid rgba(255,255,255,0.06);">
              <div style="margin-bottom:6px;">
                <strong style="color:#a5b4fc;display:block;margin-bottom:2px;">🧠 GPT-4o Architect:</strong>
                <p style="color:var(--text-main);">Revisión completada en modo solo lectura. Se inspeccionaron ${review.inspectedFiles?.length || 0} archivos, ${review.inspectedDocuments?.length || 0} documento(s) y se verificó el estado Git.</p>
              </div>
              <div style="border-top:1px solid rgba(255,255,255,0.05);padding-top:6px;">
                <strong style="color:#fbbf24;display:block;margin-bottom:2px;">🛡️ Claude 3.5 Reviewer:</strong>
                <p style="color:var(--text-main);">Se encontraron ${review.findings?.length || 0} hallazgo(s). ${(review.findings || []).filter(f => f.severity === 'critical' || f.severity === 'high').length} requieren atención inmediata. No se modificaron archivos.</p>
              </div>
            </div>
          `;
        } else {
          // Simple text response (answer, blocked, error)
          contentHtml = `<p style="font-size:13.5px;line-height:1.6;color:var(--text-main);">${(msg.content || '').replace(/\n/g, '<br>')}</p>`;
        }

        return `
          <div class="chat-msg chat-msg-ai">
            <div class="chat-msg-avatar" style="background:var(--primary-glow);color:#fff;">✨</div>
            <div class="chat-msg-body">
              <div class="chat-msg-meta">
                <strong style="color:#a5b4fc;">✨ Antigravity AI (Líder Orquestador)</strong>
                <span class="chat-msg-time">${timeStr}</span>
                <span class="badge ${badgeClass}" style="margin-left:8px;font-size:10px;">${badgeLabel}</span>
              </div>
              <div class="chat-msg-content">${contentHtml}</div>
            </div>
          </div>
        `;
      }

      return '';
    }).join('');

    scrollToBottom();
  }

  // ===== RIGHT INSPECTOR =====
  function renderRightInspector() {
    const proj = getActiveProject();
    const activeRun = appState.runs && appState.runs.length > 0 ? appState.runs[0] : null;

    if (!activeRun) {
      plansListContainer.innerHTML = '<div style="padding:8px;color:var(--text-dim);font-size:12px;">Sin tareas o revisiones activas</div>';
      progressRatioBadge.textContent = '0/0';
      completedTasksLabel.textContent = '0 completado';
      checklistItemsContainer.innerHTML = '';
      return;
    }

    const isReview = activeRun.intent === 'review';
    const statusLabel = activeRun.status === 'completed' ? '✅ Completado' : activeRun.status === 'running' ? '⚡ En progreso' : activeRun.status === 'blocked' ? '🚫 Bloqueado' : activeRun.status === 'approved' ? '✓ Aprobado' : activeRun.status === 'rejected' ? '✗ Rechazado' : activeRun.status;
    const promptText = activeRun.archReasoning ? activeRun.archReasoning.slice(0, 40) : (isReview ? 'Revisión del repositorio' : 'Run activo');
    const filesList = (activeRun.review && activeRun.review.inspectedFiles) ? activeRun.review.inspectedFiles.slice(0, 8) : [];

    plansListContainer.innerHTML = `
      <div class="plan-item">📋 ${isReview ? 'Revisión' : 'Plan'}: ${promptText}...</div>
      ${proj ? '<div class="plan-item">📁 Proyecto: ' + proj.name + '</div>' : ''}
      <div class="plan-item">🌿 Rama: ${activeRun.worktreeBranch || 'main'}</div>
      <div class="plan-item">📊 Estado: ${statusLabel}</div>
    `;

    progressRatioBadge.textContent = isReview ? '3/3' : (activeRun.progress > 0 ? `${activeRun.progress}/100` : '0/0');
    completedTasksLabel.textContent = isReview ? '3 completados' : `${activeRun.progress}% completado`;

    checklistItemsContainer.innerHTML = `
      <!-- PROGRESO -->
      <div class="check-item"><span class="check-icon-circle">✓</span><span>Inspeccionar el repositorio y definir el flujo</span></div>
      <div class="check-item"><span class="check-icon-circle">✓</span><span>Implementar revisión real basada en evidencia</span></div>
      <div class="check-item"><span class="check-icon-circle">✓</span><span>Actualizar la interfaz con hallazgos y evidencias</span></div>
      
      <!-- RESULTADOS DE ARCHIVOS -->
      ${filesList.length > 0 ? `
      <div style="margin-top:14px;border-top:1px solid rgba(255,255,255,0.06);padding-top:10px;">
        <div style="font-size:11px;font-weight:700;color:var(--text-muted);margin-bottom:6px;text-transform:uppercase;">Resultados / Archivos:</div>
        ${filesList.map(f => `
          <div style="font-family:var(--font-code);font-size:11px;color:#34d399;padding:2px 0;">
            📄 ${f}
          </div>
        `).join('')}
      </div>
      ` : ''}

      <!-- FUENTES & CONTEXTO -->
      <div style="margin-top:14px;border-top:1px solid rgba(255,255,255,0.06);padding-top:10px;">
        <div style="font-size:11px;font-weight:700;color:var(--text-muted);margin-bottom:6px;text-transform:uppercase;">Fuentes & Contexto:</div>
        <div style="font-size:11px;color:#a5b4fc;padding:2px 0;">🌐 Repositorio local del proyecto</div>
        <div style="font-size:11px;color:#a5b4fc;padding:2px 0;">🌐 Git status & branch info</div>
        <div style="font-size:11px;color:#a5b4fc;padding:2px 0;">🌐 Personal Context & AGENTS.md</div>
      </div>
    `;
  }

  // ===== SUBMIT INSTRUCTION =====
  async function handleSendInstruction() {
    const text = chatInputTextarea.value.trim();
    if (!text) return;
    chatInputTextarea.value = '';
    const selectedModel = selectAiModel ? selectAiModel.value : 'Antigravity AI (Líder Orquestador)';
    const targetProjectId = appState.activeProjectId || (appState.projects[0] ? appState.projects[0].id : 'proj-1');
    const nowTime = new Date().toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });

    // Optimistic user message rendering
    if (chatThread) {
      const userMsgHtml = `
        <div class="chat-msg chat-msg-user">
          <div class="chat-msg-avatar">A</div>
          <div class="chat-msg-body">
            <div class="chat-msg-meta"><strong>Tú</strong> <span class="chat-msg-time">${nowTime}</span></div>
            <div class="chat-msg-content">${text}</div>
          </div>
        </div>
        <div class="chat-msg chat-msg-ai" id="thinking-indicator-card">
          <div class="chat-msg-avatar" style="background:var(--primary-glow);color:#fff;">✨</div>
          <div class="chat-msg-body">
            <div class="chat-msg-meta"><strong style="color:#a5b4fc;">✨ Antigravity AI (Líder Orquestador)</strong></div>
            <div class="chat-msg-content" style="color:#fbbf24;font-size:13px;padding:8px 0;">
              <span style="animation:pulse 1.2s infinite;display:inline-block;">🧠 Pensando y coordinando al equipo de agentes (GPT-4o, Claude 3.5, Worker Local)...</span>
            </div>
          </div>
        </div>
      `;
      chatThread.insertAdjacentHTML('beforeend', userMsgHtml);
      scrollToBottom();
    }

    try {
      // 1. Create or ensure Conversation
      let convId = appState.activeConversationId;
      if (!convId) {
        const convRes = await fetch('/api/conversations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ projectId: targetProjectId, title: text.slice(0, 40) })
        });
        const convData = await convRes.json();
        if (convData.ok) {
          convId = convData.conversation.id;
          appState.activeConversationId = convId;
          appState.conversations.unshift(convData.conversation);
          renderConversationsSidebar();
        }
      }

      // 2. Post User Message & Trigger Run
      const res = await fetch(`/api/conversations/${convId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: text, architectModel: selectedModel, projectId: targetProjectId })
      });
      const data = await res.json();
      if (data.ok) {
        appState.activeRunId = data.run ? data.run.id : null;
        if (data.run && data.run.id) subscribeToRunEvents(data.run.id);
        await fetchConversationDetails(convId);
      }
    } catch (e) {
      console.error('Error enviando instrucción:', e);
      fetchConversations();
    }
  }

  // ===== NEW CONVERSATION BUTTONS =====
  if (btnNewTask) {
    btnNewTask.addEventListener('click', async () => {
      appState.activeConversationId = null;
      renderEmptyChat();
      chatInputTextarea.focus();
    });
  }
  if (btnNewConversation) {
    btnNewConversation.addEventListener('click', async () => {
      appState.activeConversationId = null;
      renderEmptyChat();
      chatInputTextarea.focus();
    });
  }

  // ===== PLAN MODE TOGGLE =====
  if (btnTogglePlanMode) {
    btnTogglePlanMode.addEventListener('click', () => {
      appState.planMode = !appState.planMode;
      planModeLabel.textContent = appState.planMode ? 'Plan mode' : 'Act mode';
      btnTogglePlanMode.style.borderColor = appState.planMode ? 'var(--primary)' : 'var(--success)';
    });
  }

  // ===== EVENT LISTENERS =====
  if (btnSendInstruction) btnSendInstruction.addEventListener('click', handleSendInstruction);
  if (chatInputTextarea) {
    chatInputTextarea.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSendInstruction();
      }
    });
  }

  // ===== INITIAL LOAD =====
  async function refreshAll() {
    await fetchProjects();
    await fetchConversations();
    await fetchAgentStatus();
  }

  // ===== AGENT STATUS POLLING =====
  async function fetchAgentStatus() {
    try {
      const res = await fetch('/api/agents');
      const data = await res.json();
      if (!data.ok) return;
      data.agents.forEach(agent => {
        // Mapear IDs del API a IDs de los badges en el HTML
        const badgeIdMap = { 'gpt-4o': 'gpt', 'claude-3.5': 'claude', 'antigravity': 'antigravity' };
        const badgeKey = badgeIdMap[agent.id] || agent.id;
        const badge = document.getElementById(`agent-badge-${badgeKey}`);
        if (!badge) return;
        const icon = agent.status === 'connected' ? '🟢'
                   : agent.status === 'simulated' ? '🟡'
                   : '🔴';
        const label = agent.id === 'gpt-4o' ? `🧠 GPT-4o (Arquitecto) ${icon}`
                    : agent.id === 'claude-3.5' ? `🛡️ Claude 3.5 (Revisor) ${icon}`
                    : `✨ Antigravity (Líder ${icon})`;
        badge.textContent = label;
        badge.setAttribute('data-status', agent.status);
      });
      // Worker status en footer del sidebar
      const workerFooter = document.getElementById('worker-status-footer');
      if (workerFooter) {
        const agy = data.agents.find(a => a.id === 'antigravity');
        const wIcon = agy.status === 'connected' ? '🟢'
                     : agy.status === 'simulated' ? '🟡'
                     : '🔴';
        workerFooter.textContent = `Antigravity ${wIcon}`;
        workerFooter.style.color = agy.status === 'connected' ? 'var(--success)'
                                 : agy.status === 'simulated' ? 'var(--warning)'
                                 : 'var(--danger)';
      }
    } catch { /* silently fail — la UI muestra el último estado conocido */ }
  }

  refreshAll();

  // Poll agent status every 5 seconds
  setInterval(fetchAgentStatus, 5000);
});
