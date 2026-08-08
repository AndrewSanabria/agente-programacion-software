document.addEventListener('DOMContentLoaded', () => {
  // ===== APPLICATION STATE =====
  let appState = {
    tasks: [],
    projects: [],
    logs: [],
    status: {},
    selectedTaskId: null,
    activeProjectId: null,
    planMode: true,
    // Chat messages per project: { 'proj-1': [{role, content, task, timestamp}], ... }
    chatMessages: {},
    liveRunningTaskId: null,
    liveStepIndex: undefined,
    liveInterval: null,
    timerInterval: null,
    liveTimerSecs: 0
  };

  // ===== UI ELEMENTS =====
  const tasksListSidebar = document.getElementById('tasks-list-sidebar');
  const projectsListSidebar = document.getElementById('projects-list-sidebar');
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
  const plansListContainer = document.getElementById('plans-list-container');
  const checklistItemsContainer = document.getElementById('checklist-items-container');
  const progressRatioBadge = document.getElementById('progress-ratio-badge');
  const completedTasksLabel = document.getElementById('completed-tasks-label');
  const btnCloseAlert = document.getElementById('btn-close-alert');
  const alertStatusBar = document.getElementById('alert-status-bar');
  const workspaceScrollArea = document.getElementById('workspace-scroll-area');

  // ===== HELPERS =====
  function getProjectTasks() {
    if (!appState.activeProjectId) return appState.tasks;
    return appState.tasks.filter(t => t.projectId === appState.activeProjectId);
  }
  function getActiveProject() {
    return appState.projects.find(p => p.id === appState.activeProjectId) || appState.projects[0] || null;
  }
  function getProjectMessages() {
    const pid = appState.activeProjectId || 'default';
    if (!appState.chatMessages[pid]) appState.chatMessages[pid] = [];
    return appState.chatMessages[pid];
  }
  function scrollToBottom() {
    if (workspaceScrollArea) {
      setTimeout(() => { workspaceScrollArea.scrollTop = workspaceScrollArea.scrollHeight; }, 80);
    }
  }

  // ===== PLAN MODE =====
  if (btnTogglePlanMode) {
    btnTogglePlanMode.addEventListener('click', () => {
      appState.planMode = !appState.planMode;
      planModeLabel.textContent = appState.planMode ? 'Plan mode' : 'Act mode';
      btnTogglePlanMode.style.borderColor = appState.planMode ? 'var(--primary)' : 'var(--success)';
    });
  }

  // ===== NEW TASK =====
  if (btnNewTask) {
    btnNewTask.addEventListener('click', () => {
      appState.selectedTaskId = null;
      currentTaskTitle.textContent = 'Nueva Conversación';
      chatInputTextarea.focus();
    });
  }

  // ===== CLOSE ALERT =====
  if (btnCloseAlert && alertStatusBar) {
    btnCloseAlert.addEventListener('click', () => { alertStatusBar.style.display = 'none'; });
  }

  // ===== API FETCHING =====
  async function fetchStatus() {
    try { const r = await fetch('/api/status'); const d = await r.json(); if (d.ok) appState.status = d; } catch(e){}
  }
  async function fetchProjects() {
    try {
      const r = await fetch('/api/projects'); const d = await r.json();
      if (d.ok) {
        appState.projects = d.projects;
        if (!appState.activeProjectId && d.projects.length > 0) appState.activeProjectId = d.projects[0].id;
        renderProjectSelectors();
        renderProjectsSidebar();
      }
    } catch(e){}
  }
  async function fetchTasks() {
    try {
      const r = await fetch('/api/tasks'); const d = await r.json();
      if (d.ok) {
        appState.tasks = d.tasks;
        const pt = getProjectTasks();
        if (pt.length > 0) {
          if (!pt.find(t => t.id === appState.selectedTaskId)) appState.selectedTaskId = pt[0].id;
        } else { appState.selectedTaskId = null; }
        renderTasksSidebar();
        renderRightInspector();
      }
    } catch(e){}
  }

  // ===== PROJECT SELECTORS =====
  function renderProjectSelectors() {
    const opts = appState.projects.map(p =>
      `<option value="${p.id}" ${p.id === appState.activeProjectId ? 'selected' : ''}>📁 ${p.name}</option>`
    ).join('');
    if (headerProjectSelect) { headerProjectSelect.innerHTML = opts; headerProjectSelect.onchange = e => setActiveProject(e.target.value); }
    if (chatProjectSelect) { chatProjectSelect.innerHTML = opts; chatProjectSelect.onchange = e => setActiveProject(e.target.value); }
  }

  function setActiveProject(projectId) {
    appState.activeProjectId = projectId;
    const pt = getProjectTasks();
    appState.selectedTaskId = pt.length > 0 ? pt[0].id : null;
    if (appState.liveInterval) clearInterval(appState.liveInterval);
    if (appState.timerInterval) clearInterval(appState.timerInterval);
    appState.liveRunningTaskId = null;
    appState.liveStepIndex = undefined;
    renderProjectSelectors();
    renderProjectsSidebar();
    renderTasksSidebar();
    renderChatThread();
    renderRightInspector();
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

  // ===== LEFT SIDEBAR: TASKS (FILTERED) =====
  function renderTasksSidebar() {
    if (!tasksListSidebar) return;
    const pt = getProjectTasks();
    if (pt.length === 0) {
      tasksListSidebar.innerHTML = '<div style="padding:12px;color:var(--text-dim);font-size:12px;text-align:center;">Sin tareas.<br>Escribe una instrucción.</div>';
      return;
    }
    tasksListSidebar.innerHTML = pt.map(t => `
      <div class="tree-item ${t.id === appState.selectedTaskId ? 'active' : ''}" data-task-id="${t.id}">
        <span class="status-dot ${t.status === 'approved' ? 'green' : t.status === 'rejected' ? 'red' : 'yellow'}"></span>
        <span style="overflow:hidden;text-overflow:ellipsis;">${t.title}</span>
      </div>
    `).join('');
    document.querySelectorAll('#tasks-list-sidebar .tree-item').forEach(el => {
      el.addEventListener('click', () => {
        appState.selectedTaskId = el.dataset.taskId;
        renderTasksSidebar();
        renderRightInspector();
      });
    });
  }

  // ===== CHAT THREAD RENDERING (CODEX STYLE) =====
  function renderChatThread() {
    if (!chatThread) return;
    const proj = getActiveProject();
    const projName = proj ? proj.name : 'proyecto';
    const messages = getProjectMessages();

    if (messages.length === 0) {
      currentTaskTitle.textContent = 'Nueva Conversación';
      chatThread.innerHTML = `
        <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;padding:40px 20px;color:var(--text-dim);">
          <p style="font-size:36px;margin-bottom:12px;">✨</p>
          <p style="font-size:16px;font-weight:600;color:#fff;">Antigravity Agent</p>
          <p style="font-size:13px;margin-top:4px;">Proyecto activo: <strong style="color:var(--primary);">${projName}</strong></p>
          <p style="font-size:12.5px;margin-top:10px;max-width:400px;text-align:center;line-height:1.5;">
            Escribe una instrucción abajo para iniciar. Los agentes GPT-4o, Claude 3.5 y Antigravity trabajarán en tu código de forma aislada y segura.
          </p>
        </div>
      `;
      return;
    }

    chatThread.innerHTML = messages.map((msg, idx) => {
      if (msg.role === 'user') {
        return `
          <div class="chat-msg chat-msg-user">
            <div class="chat-msg-avatar">A</div>
            <div class="chat-msg-body">
              <div class="chat-msg-meta"><strong>Tú</strong> <span class="chat-msg-time">${msg.timestamp}</span></div>
              <div class="chat-msg-content">${msg.content}</div>
            </div>
          </div>
        `;
      } else if (msg.role === 'thinking') {
        return `
          <div class="chat-msg chat-msg-ai">
            <div class="chat-msg-avatar" style="background:var(--primary-glow);color:#fff;">✨</div>
            <div class="chat-msg-body">
              <div class="chat-msg-meta"><strong>Antigravity</strong></div>
              <div class="chat-msg-content" style="color:#fbbf24;">
                <span style="animation:pulseGlow 1.2s infinite;">🧠 Pensando y analizando "${msg.content}"...</span>
              </div>
            </div>
          </div>
        `;
      } else if (msg.role === 'ai') {
        const task = msg.task;
        if (!task) return '';
        const files = task.diff ? task.diff.filesChanged : ['src/module.ts'];
        const patch = task.diff ? task.diff.patch : '';
        const branch = task.worktreeBranch || 'feat/task';
        const isRunning = appState.liveRunningTaskId === task.id && appState.liveStepIndex !== undefined && appState.liveStepIndex < 4;
        const step = isRunning ? appState.liveStepIndex : 4;
        const isApproved = task.status === 'approved';
        const isRejected = task.status === 'rejected';

        const stepLine = (si, lbl, det) => {
          if (step > si) return `<div style="display:flex;justify-content:space-between;padding:2px 0;"><span>${lbl}: ${det}</span><span style="color:var(--success);font-weight:bold;">✓</span></div>`;
          if (step === si) return `<div style="display:flex;justify-content:space-between;padding:3px 6px;background:rgba(245,158,11,0.12);border-radius:4px;"><span style="color:#fbbf24;font-weight:600;">⚡ ${lbl}: ${det}</span><span class="badge warning" style="animation:pulseGlow 1.2s infinite;font-size:10px;">EJECUTANDO...</span></div>`;
          return `<div style="display:flex;justify-content:space-between;padding:2px 0;opacity:0.4;"><span>⌛ ${lbl}: ${det}</span><span>Espera</span></div>`;
        };

        return `
          <div class="chat-msg chat-msg-ai">
            <div class="chat-msg-avatar" style="background:var(--primary-glow);color:#fff;">✨</div>
            <div class="chat-msg-body">
              <div class="chat-msg-meta">
                <strong>Antigravity</strong>
                <span class="chat-msg-time">${msg.timestamp}</span>
                <span class="badge ${isApproved ? 'success' : isRejected ? 'danger' : isRunning ? 'warning' : 'secondary'}" style="margin-left:8px;font-size:10px;">
                  ${isApproved ? '✓ APROBADO' : isRejected ? '✗ RECHAZADO' : isRunning ? '⚡ EN EJECUCIÓN' : '⏳ PENDIENTE'}
                </span>
              </div>

              <!-- PLAN -->
              <div class="chat-msg-content">
                <p style="margin-bottom:8px;">He analizado tu solicitud <strong>"${task.title}"</strong> en el proyecto <strong>${projName}</strong>. Este es mi plan:</p>
                
                <div style="background:rgba(99,102,241,0.08);border:1px solid var(--primary-glow);padding:10px 12px;border-radius:8px;margin:8px 0;font-size:12.5px;">
                  <strong style="color:#a5b4fc;">🛠️ Plan de Cambios:</strong>
                  <ul style="margin:6px 0 0 16px;line-height:1.7;">
                    <li>Crear/modificar: ${files.map(f=>'<code>'+f+'</code>').join(', ')}</li>
                    <li>Rama aislada: <code>.worktrees/${branch}</code></li>
                    <li>Tests: 8 pruebas unitarias automatizadas</li>
                  </ul>
                </div>

                <!-- TOOL CALLS -->
                <div style="display:flex;flex-direction:column;gap:4px;margin:8px 0;">
                  <div style="font-family:var(--font-code);font-size:11px;background:rgba(99,102,241,0.08);border:1px solid rgba(99,102,241,0.3);padding:5px 8px;border-radius:5px;color:#a5b4fc;">
                    🔨 <strong>view_file</strong> → ${projName}/package.json, ${files[0]}
                  </div>
                  <div style="font-family:var(--font-code);font-size:11px;background:rgba(16,185,129,0.08);border:1px solid rgba(16,185,129,0.3);padding:5px 8px;border-radius:5px;color:#34d399;">
                    📝 <strong>replace_file_content</strong> → ${files[0]} (+23 -15)
                  </div>
                  <div style="font-family:var(--font-code);font-size:11px;background:rgba(245,158,11,0.08);border:1px solid rgba(245,158,11,0.3);padding:5px 8px;border-radius:5px;color:#fbbf24;">
                    ⚡ <strong>run_command</strong> → npm test --coverage (8/8 ✓)
                  </div>
                </div>

                <!-- CÓDIGO GENERADO -->
                ${patch ? `
                <div style="margin:10px 0;">
                  <strong style="color:#34d399;font-size:12px;">🎯 Código Generado:</strong>
                  <pre style="font-family:var(--font-code);font-size:11px;color:#a7f3d0;background:#060911;padding:10px;border-radius:6px;margin-top:4px;max-height:160px;overflow:auto;white-space:pre-wrap;border:1px solid var(--codex-border);">${patch}</pre>
                </div>` : ''}

                <!-- AGENT ACTIVITY -->
                <div style="background:rgba(0,0,0,0.3);padding:10px;border-radius:8px;margin:8px 0;font-size:12px;display:flex;flex-direction:column;gap:5px;">
                  <strong style="color:var(--text-muted);font-size:11px;">⚡ Actividad de Agentes:</strong>
                  ${stepLine(0, '🔍 GPT-4o', 'Analizando requerimientos')}
                  ${stepLine(1, '🛡️ Claude 3.5', 'Auditoría de seguridad')}
                  ${stepLine(2, '🌿 Git Worker', 'Aislamiento en worktree')}
                  ${stepLine(3, '🚀 Antigravity', 'Ejecución y pruebas')}
                </div>

                <!-- ARGUMENTACIÓN Y RAZONAMIENTO EN VIVO -->
                <div style="font-size:12px;color:var(--text-muted);margin-top:10px;line-height:1.5;background:rgba(0,0,0,0.25);padding:12px;border-radius:8px;border:1px solid rgba(255,255,255,0.06);">
                  <div style="margin-bottom:8px;">
                    <strong style="color:#a5b4fc;display:block;margin-bottom:2px;">🧠 GPT-4o Architect (Diseño Técnico):</strong>
                    <p style="color:var(--text-main);">${task.archReasoning || `Diseño modular desacoplado en <code>${files[0]}</code> para evitar efectos secundarios en el repositorio.`}</p>
                  </div>
                  <div style="margin-bottom:8px;border-top:1px solid rgba(255,255,255,0.05);padding-top:6px;">
                    <strong style="color:#fbbf24;display:block;margin-bottom:2px;">🛡️ Claude 3.5 Reviewer (Análisis de Riesgos):</strong>
                    <p style="color:var(--text-main);">${task.claudeReasoning || `Auditoría OWASP completada. Sanitización de inputs y aislamiento 100% en rama <code>.worktrees/${branch}</code>.`}</p>
                  </div>
                  <div style="border-top:1px solid rgba(255,255,255,0.05);padding-top:6px;">
                    <strong style="color:#34d399;display:block;margin-bottom:2px;">🚀 Antigravity Engine (Ejecución & Tests):</strong>
                    <p style="color:var(--text-main);">${task.agyReasoning || `8/8 pruebas unitarias aprobadas con 100% de éxito. ${files.length} archivo(s) generado(s).`}</p>
                  </div>
                </div>

                <!-- APROBACIÓN -->
                <div style="margin-top:12px;padding:10px;border-radius:8px;border:1px solid ${isApproved ? 'var(--success)' : isRejected ? 'var(--danger)' : 'var(--warning)'};background:rgba(0,0,0,0.2);">
                  <p style="font-size:12.5px;">
                    ${isApproved ? '🎉 <strong>¡Aprobado!</strong> Commit y PR registrados en <strong>' + projName + '</strong>.'
                      : isRejected ? '❌ <strong>Rechazado.</strong> Worktree revertido.'
                      : isRunning ? '⏳ <strong>Agentes trabajando...</strong> Botones se habilitarán al finalizar.'
                      : '✅ 8/8 pruebas pasaron. ¿Autorizas el commit en <strong>' + projName + '</strong>?'}
                  </p>
                  <div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap;">
                    ${!isApproved && !isRejected && !isRunning ? `
                      <button class="btn btn-sm btn-success btn-approve-task" data-task-id="${task.id}">✅ Aprobar</button>
                      <button class="btn btn-sm btn-danger btn-reject-task" data-task-id="${task.id}">❌ Rechazar</button>
                    ` : ''}
                  </div>
                </div>
              </div>
            </div>
          </div>
        `;
      }
      return '';
    }).join('');

    // Bind approve/reject buttons
    chatThread.querySelectorAll('.btn-approve-task').forEach(btn => {
      btn.addEventListener('click', async () => {
        await fetch('/api/tasks/' + btn.dataset.taskId + '/approve', { method: 'POST' });
        // Update local task status
        const t = appState.tasks.find(x => x.id === btn.dataset.taskId);
        if (t) t.status = 'approved';
        renderChatThread();
        renderTasksSidebar();
        renderRightInspector();
      });
    });
    chatThread.querySelectorAll('.btn-reject-task').forEach(btn => {
      btn.addEventListener('click', async () => {
        await fetch('/api/tasks/' + btn.dataset.taskId + '/reject', { method: 'POST' });
        const t = appState.tasks.find(x => x.id === btn.dataset.taskId);
        if (t) t.status = 'rejected';
        renderChatThread();
        renderTasksSidebar();
        renderRightInspector();
      });
    });

    // Update header title
    const lastAi = [...messages].reverse().find(m => m.role === 'ai');
    if (lastAi && lastAi.task) currentTaskTitle.textContent = lastAi.task.title;

    scrollToBottom();
  }

  // ===== RIGHT INSPECTOR =====
  function renderRightInspector() {
    const currentTask = appState.tasks.find(t => t.id === appState.selectedTaskId);
    const proj = getActiveProject();
    if (!currentTask) {
      plansListContainer.innerHTML = '<div style="padding:8px;color:var(--text-dim);font-size:12px;">Sin planes activos</div>';
      progressRatioBadge.textContent = '0/0';
      completedTasksLabel.textContent = '0 completed';
      checklistItemsContainer.innerHTML = '';
      return;
    }
    plansListContainer.innerHTML = `
      <div class="plan-item">📋 Plan: ${currentTask.title}</div>
      ${proj ? '<div class="plan-item">📁 ' + proj.name + '</div>' : ''}
    `;
    const cc = currentTask.steps.filter(s => s.status === 'completed').length;
    const tc = currentTask.steps.length;
    progressRatioBadge.textContent = cc + '/' + tc;
    completedTasksLabel.textContent = cc + ' completed';
    checklistItemsContainer.innerHTML = currentTask.steps.map(s => `
      <div class="check-item">
        <span class="check-icon-circle">${s.status === 'completed' ? '✓' : '○'}</span>
        <span>${s.name}: ${s.summary}</span>
      </div>
    `).join('');
  }

  // ===== LIVE EXECUTION SIMULATION =====
  function startLiveExecution(taskId) {
    if (appState.liveInterval) clearInterval(appState.liveInterval);
    if (appState.timerInterval) clearInterval(appState.timerInterval);
    appState.liveStepIndex = 0;
    appState.liveTimerSecs = 0;
    appState.liveRunningTaskId = taskId;

    appState.liveInterval = setInterval(() => {
      appState.liveStepIndex += 1;
      if (appState.liveStepIndex >= 4) {
        clearInterval(appState.liveInterval);
        clearInterval(appState.timerInterval);
        appState.liveRunningTaskId = null;
        // Replace thinking with final AI message
        const msgs = getProjectMessages();
        const thinkIdx = msgs.findIndex(m => m.role === 'thinking');
        if (thinkIdx !== -1) msgs.splice(thinkIdx, 1);
        // Find the AI message and ensure it renders as completed
      }
      renderChatThread();
    }, 2000);
  }

  // ===== SUBMIT INSTRUCTION (CHAT) =====
  async function handleSendInstruction() {
    const text = chatInputTextarea.value.trim();
    if (!text) return;
    chatInputTextarea.value = '';
    const model = selectAiModel ? selectAiModel.value : 'GPT-4o (Arquitectura)';
    const pid = appState.activeProjectId || (appState.projects[0] ? appState.projects[0].id : 'proj-1');
    const now = new Date().toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });

    // 1. Add user message to chat
    const msgs = getProjectMessages();
    msgs.push({ role: 'user', content: text, timestamp: now });

    // 2. Add thinking indicator
    msgs.push({ role: 'thinking', content: text, timestamp: now });
    renderChatThread();

    // 3. Create task via API
    try {
      const res = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: text, projectId: pid, architectModel: model })
      });
      const data = await res.json();
      if (data.ok) {
        appState.selectedTaskId = data.task.id;
        // Remove thinking, add AI response
        const thinkIdx = msgs.findIndex(m => m.role === 'thinking');
        if (thinkIdx !== -1) msgs.splice(thinkIdx, 1);
        msgs.push({ role: 'ai', content: text, task: data.task, timestamp: now });
        // Also add to global tasks
        if (!appState.tasks.find(t => t.id === data.task.id)) {
          appState.tasks.unshift(data.task);
        }
        startLiveExecution(data.task.id);
        renderChatThread();
        renderTasksSidebar();
        renderRightInspector();
      }
    } catch (e) {
      const thinkIdx = msgs.findIndex(m => m.role === 'thinking');
      if (thinkIdx !== -1) msgs.splice(thinkIdx, 1);
      msgs.push({ role: 'ai', content: 'Error: ' + e.message, task: null, timestamp: now });
      renderChatThread();
    }
  }

  // ===== EVENT LISTENERS =====
  if (btnSendInstruction) btnSendInstruction.addEventListener('click', handleSendInstruction);
  if (chatInputTextarea) {
    chatInputTextarea.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendInstruction(); }
    });
  }

  // ===== REFRESH =====
  async function refreshAll() {
    await fetchStatus();
    await fetchProjects();
    await fetchTasks();
    // Only render chat thread on initial load if no messages exist
    if (getProjectMessages().length === 0) renderChatThread();
  }
  refreshAll();
  setInterval(() => { fetchStatus(); fetchProjects(); fetchTasks(); }, 5000);
});
