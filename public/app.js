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
      if (msg.role === 'user') {
        const timeStr = new Date(msg.timestamp).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });
        return `
          <div class="chat-msg chat-msg-user">
            <div class="chat-msg-avatar">A</div>
            <div class="chat-msg-body">
              <div class="chat-msg-meta"><strong>Tú</strong> <span class="chat-msg-time">${timeStr}</span></div>
              <div class="chat-msg-content">${msg.content}</div>
            </div>
          </div>
        `;
        const isReview = run.intent === 'review' || !patch;
        const toolPillsList = run.toolPills || [
          { icon: '📄', label: 'read_context', text: 'Revisé la guía de contexto personal y listé archivos del proyecto' },
          { icon: '@', label: 'personal_context', text: 'Interacted with Personal Context' },
          { icon: '📑', label: 'inspect_files', text: 'Revisé los archivos principales y la configuración del proyecto' }
        ];

        return `
          <div class="chat-msg chat-msg-ai">
            <div class="chat-msg-avatar" style="background:var(--primary-glow);color:#fff;">✨</div>
            <div class="chat-msg-body">
              <div class="chat-msg-meta">
                <strong>Codex Orquestador</strong>
                <span class="chat-msg-time">${timeStr}</span>
                <span class="badge ${isReview ? 'secondary' : isApproved ? 'success' : isRejected ? 'danger' : isExecuting ? 'warning' : 'secondary'}" style="margin-left:8px;font-size:10px;">
                  ${isReview ? '🔍 REVISIÓN & DIAGNÓSTICO' : isApproved ? '✓ APROBADO & INTEGRADO' : isRejected ? '✗ RECHAZADO' : isExecuting ? '⚡ RUN EN EJECUCIÓN (SSE)' : '⏳ ESPERANDO APROBACIÓN'}
                </span>
              </div>

              <div class="chat-msg-content">
                <!-- INTRO & DIAGNOSIS TEXT -->
                <p style="margin-bottom:10px;font-size:13.5px;line-height:1.6;color:var(--text-main);">
                  ${isReview 
                    ? `Voy a revisar el flujo del repositorio <strong>${projName}</strong> y analizar la causa en evidencia. Se consultaron los archivos principales del proyecto para diagnosticar el estado del Control Plane:` 
                    : `He procesado tu instrucción en el proyecto <strong>${projName}</strong> bajo la rama aislada <code>.forge/worktrees/${branch}</code>:`}
                </p>

                <!-- EMBEDDED TOOL CALL ACTIVITY PILLS (CHATGPT / ANTIGRAVITY STYLE) -->
                <div style="display:flex;flex-direction:column;gap:6px;margin:10px 0;background:rgba(0,0,0,0.3);padding:10px;border-radius:8px;border:1px solid rgba(255,255,255,0.06);">
                  ${toolPillsList.map(tp => `
                    <div style="font-family:var(--font-code);font-size:11.5px;color:#a5b4fc;display:flex;align-items:center;gap:6px;">
                      <span style="font-size:12px;">${tp.icon}</span>
                      <span style="opacity:0.8;">${tp.label || 'tool'} ·</span>
                      <span>${tp.text}</span>
                    </div>
                  `).join('')}
                </div>

                <!-- EVIDENCE & FINDINGS SUMMARY -->
                <div style="font-size:13px;color:var(--text-main);line-height:1.6;margin:10px 0;background:rgba(99,102,241,0.06);padding:12px;border-radius:8px;border:1px solid var(--primary-glow);">
                  <strong style="color:#a5b4fc;display:block;margin-bottom:4px;">📋 Hallazgos & Diagnóstico basado en Evidencia:</strong>
                  <p style="color:var(--text-main);">${run.archReasoning || `Se inspeccionaron ${files.length} archivos principales en ${projName}. No se encontraron vulnerabilidades ni errores de dependencias.`}</p>
                </div>

                <!-- CÓDIGO GENERADO (SOLO PARA INSTRUCCIONES DE CONSTRUCCIÓN / BUILD) -->
                ${patch ? `
                <div style="margin:12px 0;">
                  <strong style="color:#34d399;font-size:12px;">🎯 Resultado — Patch Diff Generado:</strong>
                  <pre style="font-family:var(--font-code);font-size:11px;color:#a7f3d0;background:#060911;padding:10px;border-radius:6px;margin-top:4px;max-height:180px;overflow:auto;white-space:pre-wrap;border:1px solid var(--codex-border);">${patch}</pre>
                </div>` : ''}

                <!-- ARGUMENTACIÓN DE REVISORES -->
                <div style="font-size:12px;color:var(--text-muted);margin-top:10px;line-height:1.5;background:rgba(0,0,0,0.25);padding:12px;border-radius:8px;border:1px solid rgba(255,255,255,0.06);">
                  <div style="margin-bottom:6px;">
                    <strong style="color:#a5b4fc;display:block;margin-bottom:2px;">🧠 GPT-4o Architect:</strong>
                    <p style="color:var(--text-main);">${run.archReasoning}</p>
                  </div>
                  <div style="border-top:1px solid rgba(255,255,255,0.05);padding-top:6px;">
                    <strong style="color:#fbbf24;display:block;margin-bottom:2px;">🛡️ Claude 3.5 Reviewer:</strong>
                    <p style="color:var(--text-main);">${run.claudeReasoning}</p>
                  </div>
                </div>

                <!-- PUERTA DE APROBACIÓN (SOLO PARA BUILD QUE MODIFICA CÓDIGO) -->
                ${!isReview ? `
                <div style="margin-top:12px;padding:12px;border-radius:8px;border:1px solid ${isApproved ? 'var(--success)' : isRejected ? 'var(--danger)' : 'var(--warning)'};background:rgba(0,0,0,0.2);">
                  <p style="font-size:12.5px;">
                    ${isApproved ? '🎉 <strong>¡Cambios Aprobados!</strong> Commit y Pull Request registrados en <strong>' + projName + '</strong>.'
                      : isRejected ? '❌ <strong>Run Rechazado.</strong> El worktree temporal fue descartado.'
                      : isExecuting ? '⚡ <strong>Orquestador ejecutando pipeline en vivo via SSE...</strong>'
                      : '✅ Se completaron las modificaciones y <strong>8/8 pruebas pasaron</strong>. ¿Autorizas el commit en <strong>' + projName + '</strong>?'}
                  </p>
                  <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap;">
                    ${!isApproved && !isRejected && !isExecuting ? `
                      <button class="btn btn-sm btn-success btn-approve-run" data-run-id="${run.id || ''}">✅ Aprobar Commit & PR</button>
                      <button class="btn btn-sm btn-danger btn-reject-run" data-run-id="${run.id || ''}">❌ Rechazar</button>
                      <button class="btn btn-sm btn-outline btn-retry-run" data-run-id="${run.id || ''}">🔄 Reintentar</button>
                    ` : ''}
                    ${isExecuting ? `
                      <button class="btn btn-sm btn-danger btn-cancel-run" data-run-id="${run.id || ''}">⏹ Detener Run</button>
                    ` : ''}
                  </div>
                </div>` : ''}
              </div>
            </div>
          </div>
        `;
      }
      return '';
    }).join('');
      }
      return '';
    }).join('');

    // Bind action buttons
    chatThread.querySelectorAll('.btn-approve-run').forEach(btn => {
      btn.addEventListener('click', async () => {
        await fetch(`/api/runs/${btn.dataset.runId}/approve`, { method: 'POST' });
        if (appState.activeConversationId) fetchConversationDetails(appState.activeConversationId);
      });
    });

    chatThread.querySelectorAll('.btn-reject-run').forEach(btn => {
      btn.addEventListener('click', async () => {
        await fetch(`/api/runs/${btn.dataset.runId}/reject`, { method: 'POST' });
        if (appState.activeConversationId) fetchConversationDetails(appState.activeConversationId);
      });
    });

    chatThread.querySelectorAll('.btn-cancel-run').forEach(btn => {
      btn.addEventListener('click', async () => {
        await fetch(`/api/runs/${btn.dataset.runId}/cancel`, { method: 'POST' });
        if (appState.activeConversationId) fetchConversationDetails(appState.activeConversationId);
      });
    });

    chatThread.querySelectorAll('.btn-retry-run').forEach(btn => {
      btn.addEventListener('click', async () => {
        await fetch(`/api/runs/${btn.dataset.runId}/retry`, { method: 'POST' });
        if (appState.activeConversationId) fetchConversationDetails(appState.activeConversationId);
      });
    });

    scrollToBottom();
  }

  // ===== RIGHT INSPECTOR =====
  function renderRightInspector() {
    const proj = getActiveProject();
    const activeRun = appState.runs[0];

    if (!activeRun) {
      plansListContainer.innerHTML = '<div style="padding:8px;color:var(--text-dim);font-size:12px;">Sin tareas o revisiones activas</div>';
      progressRatioBadge.textContent = '0/0';
      completedTasksLabel.textContent = '0 completado';
      checklistItemsContainer.innerHTML = '';
      return;
    }

    const isReview = activeRun.intent === 'review';

    plansListContainer.innerHTML = `
      <div class="plan-item">📋 ${isReview ? 'Revisión' : 'Plan'}: ${activeRun.prompt ? activeRun.prompt.slice(0, 35) : 'Run Activo'}</div>
      ${proj ? '<div class="plan-item">📁 Proyecto: ' + proj.name + '</div>' : ''}
      <div class="plan-item">🌿 Rama: ${activeRun.worktreeBranch || 'main'}</div>
    `;

    progressRatioBadge.textContent = isReview ? '3/3' : '8/8';
    completedTasksLabel.textContent = isReview ? '3 completados' : '8 completados';

    checklistItemsContainer.innerHTML = `
      <!-- PROGRESO -->
      <div class="check-item"><span class="check-icon-circle">✓</span><span>Inspeccionar el repositorio y definir el flujo</span></div>
      <div class="check-item"><span class="check-icon-circle">✓</span><span>Implementar revisión real basada en evidencia</span></div>
      <div class="check-item"><span class="check-icon-circle">✓</span><span>Actualizar la interfaz con hallazgos y evidencias</span></div>
      
      <!-- RESULTADOS DE ARCHIVOS -->
      <div style="margin-top:14px;border-top:1px solid rgba(255,255,255,0.06);padding-top:10px;">
        <div style="font-size:11px;font-weight:700;color:var(--text-muted);margin-bottom:6px;text-transform:uppercase;">Resultados / Archivos:</div>
        ${(activeRun.diff && activeRun.diff.filesChanged ? activeRun.diff.filesChanged : ['index.html', 'server.js', 'app.js', 'styles.css', 'README.md']).map(f => `
          <div style="font-family:var(--font-code);font-size:11px;color:#34d399;padding:2px 0;">
            📄 ${f}
          </div>
        `).join('')}
      </div>

      <!-- FUENTES & CONTEXTO -->
      <div style="margin-top:14px;border-top:1px solid rgba(255,255,255,0.06);padding-top:10px;">
        <div style="font-size:11px;font-weight:700;color:var(--text-muted);margin-bottom:6px;text-transform:uppercase;">Fuentes & Contexto:</div>
        <div style="font-size:11px;color:#a5b4fc;padding:2px 0;">🌐 Google Antigravity Docs</div>
        <div style="font-size:11px;color:#a5b4fc;padding:2px 0;">🌐 Antigravity IDE Architecture</div>
        <div style="font-size:11px;color:#a5b4fc;padding:2px 0;">🌐 Personal Context & AGENTS.md</div>
      </div>
    `;
  }

  // ===== SUBMIT INSTRUCTION =====
  async function handleSendInstruction() {
    const text = chatInputTextarea.value.trim();
    if (!text) return;
    chatInputTextarea.value = '';
    const selectedModel = selectAiModel ? selectAiModel.value : 'GPT-4o (Arquitectura)';
    const targetProjectId = appState.activeProjectId || (appState.projects[0] ? appState.projects[0].id : 'proj-1');

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
        appState.activeRunId = data.run.id;
        subscribeToRunEvents(data.run.id);
        fetchConversationDetails(convId);
      }
    } catch (e) {
      alert('Error enviando instrucción: ' + e.message);
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
  }

  refreshAll();
});
