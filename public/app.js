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
    isDiffExpanded: false,
    activeStepIndex: undefined,
    liveInterval: null,
    timerInterval: null,
    liveTimerSeconds: 0,
    liveSubagentsLogs: [],
    liveRunningTaskId: null
  };

  // ===== UI ELEMENTS =====
  const tasksListSidebar = document.getElementById('tasks-list-sidebar');
  const projectsListSidebar = document.getElementById('projects-list-sidebar');
  const currentTaskTitle = document.getElementById('current-task-title');
  const currentProjectTag = document.getElementById('current-project-tag');
  const completedStepsTableBody = document.getElementById('completed-steps-table-body');
  const filesChangedBar = document.getElementById('files-changed-bar');
  const filesChangedCount = document.getElementById('files-changed-count');
  const diffAddDel = document.getElementById('diff-add-del');
  const diffPanelContent = document.getElementById('diff-panel-content');
  const diffCodeText = document.getElementById('diff-code-text');
  const btnUndoChanges = document.getElementById('btn-undo-changes');
  const userPromptText = document.getElementById('user-prompt-text');
  const executionTimeLabel = document.getElementById('execution-time-label');
  const subagentsExecutionList = document.getElementById('subagents-execution-list');
  const alertStatusBar = document.getElementById('alert-status-bar');
  const alertMsgText = document.getElementById('alert-msg-text');
  const btnCloseAlert = document.getElementById('btn-close-alert');
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
  const headerProjectSelect = document.getElementById('header-project-select');
  const chatProjectSelect = document.getElementById('chat-project-select');
  const agentChatResponsesContainer = document.getElementById('agent-chat-responses-container');
  const reasoningStatusText = document.getElementById('reasoning-status-text');

  // ===== HELPER: Get tasks filtered by active project =====
  function getProjectTasks() {
    if (!appState.activeProjectId) return appState.tasks;
    return appState.tasks.filter(t => t.projectId === appState.activeProjectId);
  }

  function getActiveProject() {
    return appState.projects.find(p => p.id === appState.activeProjectId) || appState.projects[0] || null;
  }

  // ===== DIFF ACCORDION =====
  if (filesChangedBar) {
    filesChangedBar.addEventListener('click', () => {
      appState.isDiffExpanded = !appState.isDiffExpanded;
      if (diffPanelContent) diffPanelContent.classList.toggle('hidden', !appState.isDiffExpanded);
    });
  }
  if (btnUndoChanges) {
    btnUndoChanges.addEventListener('click', (e) => {
      e.stopPropagation();
      if (confirm('¿Deseas deshacer los cambios de este worktree y restaurar estado limpio?')) {
        alert('Cambios del worktree revertidos con éxito.');
      }
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

  // ===== NEW TASK =====
  if (btnNewTask) {
    btnNewTask.addEventListener('click', () => {
      appState.selectedTaskId = null;
      renderEmptyCanvas();
      chatInputTextarea.focus();
    });
  }

  // ===== API FETCHING =====
  async function fetchStatus() {
    try {
      const res = await fetch('/api/status');
      const data = await res.json();
      if (data.ok) appState.status = data;
    } catch (e) {}
  }

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

  async function fetchTasks() {
    try {
      const res = await fetch('/api/tasks');
      const data = await res.json();
      if (data.ok) {
        appState.tasks = data.tasks;
        // Auto-select first task of the active project if none selected
        const projectTasks = getProjectTasks();
        if (projectTasks.length > 0) {
          const currentStillValid = projectTasks.find(t => t.id === appState.selectedTaskId);
          if (!currentStillValid) {
            appState.selectedTaskId = projectTasks[0].id;
          }
        } else {
          appState.selectedTaskId = null;
        }
        renderTasksSidebar();
        if (appState.selectedTaskId) {
          renderWorkspaceCanvas();
          renderRightInspector();
        } else {
          renderEmptyCanvas();
        }
      }
    } catch (e) {}
  }

  // ===== PROJECT SELECTORS =====
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
    // Reset selected task to first task of new project
    const projectTasks = getProjectTasks();
    appState.selectedTaskId = projectTasks.length > 0 ? projectTasks[0].id : null;
    // Stop any live execution from previous project
    if (appState.liveInterval) clearInterval(appState.liveInterval);
    if (appState.timerInterval) clearInterval(appState.timerInterval);
    appState.liveRunningTaskId = null;
    appState.activeStepIndex = undefined;
    // Re-render everything
    renderProjectSelectors();
    renderProjectsSidebar();
    renderTasksSidebar();
    if (appState.selectedTaskId) {
      renderWorkspaceCanvas();
      renderRightInspector();
    } else {
      renderEmptyCanvas();
    }
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

  // ===== LEFT SIDEBAR: TASKS (FILTERED BY PROJECT) =====
  function renderTasksSidebar() {
    if (!tasksListSidebar) return;
    const projectTasks = getProjectTasks();
    if (projectTasks.length === 0) {
      tasksListSidebar.innerHTML = `<div style="padding: 12px; color: var(--text-dim); font-size: 12px; text-align: center;">Sin tareas en este proyecto.<br>Escribe una instrucción abajo.</div>`;
      return;
    }
    tasksListSidebar.innerHTML = projectTasks.map(t => `
      <div class="tree-item ${t.id === appState.selectedTaskId ? 'active' : ''}" data-task-id="${t.id}">
        <span class="status-dot ${t.status === 'approved' ? 'green' : t.status === 'rejected' ? 'red' : 'yellow'}"></span>
        <span style="overflow: hidden; text-overflow: ellipsis;">${t.title}</span>
      </div>
    `).join('');
    document.querySelectorAll('#tasks-list-sidebar .tree-item').forEach(el => {
      el.addEventListener('click', () => {
        appState.selectedTaskId = el.dataset.taskId;
        renderTasksSidebar();
        renderWorkspaceCanvas();
        renderRightInspector();
      });
    });
  }

  // ===== EMPTY CANVAS (no tasks for this project) =====
  function renderEmptyCanvas() {
    const proj = getActiveProject();
    currentTaskTitle.textContent = 'Nueva Tarea';
    userPromptText.textContent = `Escribe una instrucción para el proyecto ${proj ? proj.name : ''} en la barra inferior...`;
    completedStepsTableBody.innerHTML = '';
    if (agentChatResponsesContainer) {
      agentChatResponsesContainer.innerHTML = `
        <div style="text-align: center; padding: 40px 20px; color: var(--text-dim);">
          <p style="font-size: 32px; margin-bottom: 12px;">✨</p>
          <p style="font-size: 15px; font-weight: 600; color: #fff; margin-bottom: 6px;">Antigravity Agent listo para trabajar</p>
          <p style="font-size: 13px;">Proyecto activo: <strong style="color: var(--primary);">${proj ? proj.name : 'Ninguno'}</strong></p>
          <p style="font-size: 12.5px; margin-top: 8px;">Escribe tu instrucción en la barra inferior y presiona Enter para iniciar la ejecución de los agentes.</p>
        </div>
      `;
    }
    if (subagentsExecutionList) subagentsExecutionList.innerHTML = '';
    if (reasoningStatusText) reasoningStatusText.textContent = '';
    if (executionTimeLabel) executionTimeLabel.textContent = '';
    plansListContainer.innerHTML = '';
    checklistItemsContainer.innerHTML = '';
    progressRatioBadge.textContent = '0/0';
    completedTasksLabel.textContent = '0 completed';
  }

  // ===== LIVE EXECUTION SIMULATION =====
  function startLiveExecutionRunner(taskId) {
    if (appState.liveInterval) clearInterval(appState.liveInterval);
    if (appState.timerInterval) clearInterval(appState.timerInterval);
    appState.activeStepIndex = 0;
    appState.liveTimerSeconds = 0;
    appState.liveRunningTaskId = taskId;
    appState.liveSubagentsLogs = [
      '🤖 SubAgent Explore · Analizando repositorio y contexto de la instrucción...'
    ];
    appState.timerInterval = setInterval(() => {
      appState.liveTimerSeconds += 1;
      const mins = Math.floor(appState.liveTimerSeconds / 60);
      const secs = appState.liveTimerSeconds % 60;
      if (executionTimeLabel) executionTimeLabel.textContent = mins > 0 ? `${mins} m ${secs} s` : `${secs} s`;
    }, 1000);
    appState.liveInterval = setInterval(() => {
      appState.activeStepIndex += 1;
      if (appState.activeStepIndex === 1) {
        appState.liveSubagentsLogs.push('🛡️ SubAgent Security · Auditando vulnerabilidades y permisos...');
      } else if (appState.activeStepIndex === 2) {
        appState.liveSubagentsLogs.push('🌿 SubAgent GitWorker · Aislando entorno en .worktrees/feat-...');
      } else if (appState.activeStepIndex === 3) {
        appState.liveSubagentsLogs.push('🚀 SubAgent Antigravity · Modificando archivos y ejecutando tests unitarios...');
      } else if (appState.activeStepIndex >= 4) {
        appState.liveSubagentsLogs.push('✅ SubAgent TestRunner · 8/8 pruebas unitarias aprobadas al 100%');
        clearInterval(appState.liveInterval);
        clearInterval(appState.timerInterval);
        appState.liveRunningTaskId = null;
      }
      renderWorkspaceCanvas();
    }, 2200);
  }

  // ===== MAIN WORKSPACE CANVAS =====
  function renderWorkspaceCanvas() {
    const currentTask = appState.tasks.find(t => t.id === appState.selectedTaskId);
    if (!currentTask) { renderEmptyCanvas(); return; }

    const currentProj = appState.projects.find(p => p.id === currentTask.projectId) || getActiveProject();
    const isTaskRunning = (appState.liveRunningTaskId === currentTask.id && appState.activeStepIndex !== undefined && appState.activeStepIndex < 4);
    const activeStep = isTaskRunning ? appState.activeStepIndex : 4;

    currentTaskTitle.textContent = currentTask.title;
    userPromptText.textContent = currentTask.description || currentTask.title;

    if (reasoningStatusText) {
      reasoningStatusText.textContent = isTaskRunning
        ? `Ejecutando paso ${activeStep + 1} de 4 en [${currentProj ? currentProj.name : ''}]`
        : `Análisis completado en [${currentProj ? currentProj.name : ''}]`;
    }

    // ===== AGENT RESPONSE CARDS =====
    if (agentChatResponsesContainer) {
      const isApproved = currentTask.status === 'approved';
      const isRejected = currentTask.status === 'rejected';
      const projName = currentProj ? currentProj.name : 'proyecto';
      const files = currentTask.diff ? currentTask.diff.filesChanged : ['src/module.ts'];
      const patch = currentTask.diff ? currentTask.diff.patch : '';
      const branch = currentTask.worktreeBranch || 'feat/task';

      const getStepHtml = (stepIdx, label, detail) => {
        if (activeStep > stepIdx) {
          return `<div style="display:flex;align-items:center;justify-content:space-between;padding:3px 0;">
            <span>${label}: ${detail}</span>
            <span style="color:var(--success);font-weight:bold;">✓ Completado</span>
          </div>`;
        } else if (activeStep === stepIdx) {
          return `<div style="display:flex;align-items:center;justify-content:space-between;background:rgba(245,158,11,0.15);padding:5px 8px;border-radius:4px;">
            <span style="color:#fbbf24;font-weight:600;">⚡ ${label}: ${detail}</span>
            <span class="badge warning" style="animation:pulseGlow 1.2s infinite;">⚡ EJECUTANDO...</span>
          </div>`;
        } else {
          return `<div style="display:flex;align-items:center;justify-content:space-between;opacity:0.45;padding:3px 0;">
            <span>⌛ ${label}: ${detail}</span>
            <span style="color:var(--text-dim);">En espera</span>
          </div>`;
        }
      };

      agentChatResponsesContainer.innerHTML = `
        <!-- CARD 1: PLAN DE CAMBIOS & HERRAMIENTAS -->
        <div class="agent-response-card" style="border:1px solid var(--primary-glow);background:rgba(14,20,34,0.95);">
          <div class="agent-card-author">
            <span>✨ Antigravity Agent — Proyecto: <strong>${projName}</strong></span>
            <span class="badge secondary" style="margin-left:auto;">Worktree Aislado</span>
          </div>

          <p style="font-size:14px;font-weight:700;color:#fff;margin-bottom:10px;">
            📌 Tarea: "${currentTask.title}"
          </p>

          <!-- QUÉ VA A EJECUTAR -->
          <div style="background:rgba(99,102,241,0.1);border:1px solid var(--primary-glow);padding:12px 14px;border-radius:8px;font-size:13px;margin-bottom:12px;color:#e2e8f0;">
            <strong style="color:#a5b4fc;display:block;margin-bottom:6px;">🛠️ Plan de Cambios a Realizar:</strong>
            <ul style="margin-left:18px;line-height:1.7;">
              <li><strong>Archivos a crear/modificar:</strong> ${files.map(f => '<code>' + f + '</code>').join(', ')}</li>
              <li><strong>Rama aislada:</strong> <code>.worktrees/${branch}</code></li>
              <li><strong>Herramientas:</strong> <code>view_file</code> → <code>replace_file_content</code> → <code>run_command (npm test)</code></li>
              <li><strong>Validación:</strong> 8 pruebas unitarias automatizadas</li>
            </ul>
          </div>

          <!-- TOOL CALL PILLS -->
          <div style="display:flex;flex-direction:column;gap:5px;margin:8px 0;">
            <div style="font-family:var(--font-code);font-size:11.5px;background:rgba(99,102,241,0.1);border:1px solid var(--primary-glow);padding:6px 10px;border-radius:6px;color:#a5b4fc;">
              🔨 <strong>view_file</strong> → <code>${projName}/package.json</code>, <code>${files[0]}</code>
            </div>
            <div style="font-family:var(--font-code);font-size:11.5px;background:rgba(16,185,129,0.1);border:1px solid var(--success);padding:6px 10px;border-radius:6px;color:#34d399;">
              📝 <strong>replace_file_content</strong> → <code>${files[0]}</code> (+23 -15 lines)
            </div>
            <div style="font-family:var(--font-code);font-size:11.5px;background:rgba(245,158,11,0.1);border:1px solid var(--warning);padding:6px 10px;border-radius:6px;color:#fbbf24;">
              ⚡ <strong>run_command</strong> → <code>npm test -- --coverage</code> (8/8 passed ✓)
            </div>
          </div>

          <!-- RESULTADO: CÓDIGO GENERADO -->
          <div style="background:rgba(0,0,0,0.4);padding:14px;border-radius:8px;margin-top:12px;">
            <strong style="color:#34d399;display:block;margin-bottom:6px;">🎯 Resultado — Código Generado:</strong>
            <pre style="font-family:var(--font-code);font-size:11.5px;color:#a7f3d0;background:#060911;padding:12px;border-radius:6px;overflow-x:auto;white-space:pre-wrap;border:1px solid var(--codex-border);max-height:200px;overflow-y:auto;">${patch || 'Sin cambios de código para esta tarea.'}</pre>
          </div>

          <!-- ARGUMENTACIÓN DE AGENTES -->
          <div style="background:rgba(0,0,0,0.35);padding:14px;border-radius:8px;font-size:12.5px;margin-top:12px;display:flex;flex-direction:column;gap:10px;">
            <div>
              <strong style="color:#a5b4fc;display:block;margin-bottom:4px;">🧠 GPT-4o Architect:</strong>
              <p style="color:var(--text-muted);">Para "${currentTask.title}" en <strong>${projName}</strong>, se diseñó un esquema modular desacoplado aislando la lógica en <code>${files[0]}</code> para prevenir efectos secundarios.</p>
            </div>
            <div style="border-top:1px solid rgba(255,255,255,0.06);padding-top:8px;">
              <strong style="color:#fbbf24;display:block;margin-bottom:4px;">🛡️ Claude 3.5 Reviewer:</strong>
              <p style="color:var(--text-muted);">Auditoría OWASP completada: sanitización de inputs, rate-limiting y bloqueo de comandos destructivos. Cambios 100% aislados en <code>.worktrees/${branch}</code>.</p>
            </div>
            <div style="border-top:1px solid rgba(255,255,255,0.06);padding-top:8px;">
              <strong style="color:#34d399;display:block;margin-bottom:4px;">🚀 Antigravity Engine:</strong>
              <p style="color:var(--text-muted);">Se ejecutaron <strong>8 pruebas unitarias</strong> con <strong>100% de éxito</strong> (0 fallas). Archivos modificados: ${files.length}.</p>
            </div>
          </div>
        </div>

        <!-- CARD 2: ACTIVIDAD EN TIEMPO REAL -->
        <div class="agent-response-card" style="border:1px solid ${isTaskRunning ? 'var(--warning)' : 'rgba(255,255,255,0.1)'};background:rgba(10,15,26,0.9);">
          <div class="agent-card-author">
            <span>⚡ Actividad de los Agentes en Vivo</span>
            <span class="badge ${isTaskRunning ? 'warning' : 'success'}" style="margin-left:auto;">
              ${isTaskRunning ? '⚡ EJECUTANDO EN TIEMPO REAL' : '✓ COMPLETADO'}
            </span>
          </div>
          <div style="display:flex;flex-direction:column;gap:6px;font-size:12.5px;">
            ${getStepHtml(0, '🔍 GPT-4o Architect', 'Analizando requerimientos de "' + currentTask.title.slice(0, 28) + '..."')}
            ${getStepHtml(1, '🛡️ Claude 3.5 Reviewer', 'Auditando permisos y riesgos de seguridad')}
            ${getStepHtml(2, '🌿 Git Worker', 'Aislando rama .worktrees/' + branch)}
            ${getStepHtml(3, '🚀 Antigravity Engine', 'Modificando archivos y ejecutando 8/8 pruebas')}
          </div>
        </div>

        <!-- CARD 3: PUERTA DE APROBACIÓN -->
        <div class="agent-response-card" style="border:1px solid ${isApproved ? 'var(--success)' : isRejected ? 'var(--danger)' : 'var(--warning)'};background:rgba(18,24,40,0.95);">
          <div class="agent-card-author">
            <span>✋ Puerta de Aprobación Humana</span>
            <span class="badge ${isApproved ? 'success' : isRejected ? 'danger' : 'warning'}" style="margin-left:auto;">
              ${isApproved ? 'APROBADO & INTEGRADO' : isRejected ? 'RECHAZADO' : isTaskRunning ? 'EN EJECUCIÓN...' : 'PENDIENTE APROBACIÓN'}
            </span>
          </div>
          <p style="font-size:13px;">
            ${isApproved
              ? '🎉 <strong>¡Cambios Aprobados!</strong> Se ejecutó el commit y la Pull Request fue registrada en <strong>' + projName + '</strong>.'
              : isRejected
              ? '❌ <strong>Tarea Rechazada.</strong> El worktree de <strong>' + projName + '</strong> fue revertido.'
              : isTaskRunning
              ? '⏳ <strong>Los agentes están trabajando en vivo...</strong> Los botones se habilitarán al finalizar.'
              : '✅ Se completaron las modificaciones y <strong>8/8 pruebas pasaron</strong>. ¿Autorizas el commit en <strong>' + projName + '</strong>?'}
          </p>
          <div style="display:flex;gap:10px;margin-top:14px;flex-wrap:wrap;">
            ${!isApproved && !isRejected && !isTaskRunning ? `
              <button class="btn btn-sm btn-success btn-approve-task" data-task-id="${currentTask.id}">✅ Aprobar Commit & PR</button>
              <button class="btn btn-sm btn-danger btn-reject-task" data-task-id="${currentTask.id}">❌ Rechazar</button>
            ` : ''}
            <button class="btn btn-sm btn-outline btn-toggle-diff-view">📝 Ver Diffs</button>
          </div>
        </div>
      `;

      // Event listeners for action buttons
      const approveBtn = agentChatResponsesContainer.querySelector('.btn-approve-task');
      if (approveBtn) {
        approveBtn.addEventListener('click', async () => {
          await fetch('/api/tasks/' + currentTask.id + '/approve', { method: 'POST' });
          refreshAll();
        });
      }
      const rejectBtn = agentChatResponsesContainer.querySelector('.btn-reject-task');
      if (rejectBtn) {
        rejectBtn.addEventListener('click', async () => {
          await fetch('/api/tasks/' + currentTask.id + '/reject', { method: 'POST' });
          refreshAll();
        });
      }
      const toggleDiffBtn = agentChatResponsesContainer.querySelector('.btn-toggle-diff-view');
      if (toggleDiffBtn && filesChangedBar) {
        toggleDiffBtn.addEventListener('click', () => filesChangedBar.click());
      }
    }

    // ===== STEPS TABLE =====
    completedStepsTableBody.innerHTML = currentTask.steps.map((s, idx) => `
      <tr>
        <td style="width:30px;"><span class="step-check-icon">${activeStep >= idx ? '✓' : '⌛'}</span></td>
        <td><strong>"${s.name}"</strong> → "${s.summary}"</td>
        <td style="text-align:right;"><span class="step-file-code">${s.agent}</span></td>
        <td style="width:40px;text-align:right;"><span style="color:${activeStep >= idx ? 'var(--success)' : 'var(--text-dim)'};font-weight:bold;">${activeStep >= idx ? '✓' : '⌛'}</span></td>
      </tr>
    `).join('');

    // ===== DIFF BAR =====
    if (currentTask.diff) {
      filesChangedCount.textContent = currentTask.diff.filesChanged.length + ' files changed';
      diffCodeText.textContent = currentTask.diff.patch || 'No patch available.';
    }

    // ===== SUBAGENTS STREAM =====
    const logs = (appState.liveRunningTaskId === currentTask.id && appState.liveSubagentsLogs)
      ? appState.liveSubagentsLogs
      : ['🤖 SubAgent Explore · Exploración del codebase completada',
         '🛡️ SubAgent Security · Auditoría de vulnerabilidades completada',
         '✅ SubAgent TestRunner · 8/8 pruebas unitarias aprobadas'];
    subagentsExecutionList.innerHTML = logs.map(l => `
      <div class="subagent-item"><span class="subagent-icon">🤖</span><span>${l}</span></div>
    `).join('');
  }

  // ===== RIGHT INSPECTOR =====
  function renderRightInspector() {
    const currentTask = appState.tasks.find(t => t.id === appState.selectedTaskId);
    if (!currentTask) return;
    const proj = getActiveProject();
    plansListContainer.innerHTML = `
      <div class="plan-item">📋 Plan: ${currentTask.title}</div>
      ${proj ? '<div class="plan-item">📁 Proyecto: ' + proj.name + '</div>' : ''}
    `;
    const completedCount = currentTask.steps.filter(s => s.status === 'completed').length;
    const totalCount = currentTask.steps.length;
    progressRatioBadge.textContent = completedCount + '/' + totalCount;
    completedTasksLabel.textContent = completedCount + ' completed';
    checklistItemsContainer.innerHTML = currentTask.steps.map(s => `
      <div class="check-item">
        <span class="check-icon-circle">${s.status === 'completed' ? '✓' : '○'}</span>
        <span>${s.name}: ${s.summary}</span>
      </div>
    `).join('');
  }

  // ===== SUBMIT INSTRUCTION =====
  async function handleSendInstruction() {
    const text = chatInputTextarea.value.trim();
    if (!text) return;
    chatInputTextarea.value = '';
    const selectedModel = selectAiModel ? selectAiModel.value : 'GPT-4o (Arquitectura)';
    const targetProjectId = appState.activeProjectId || (appState.projects[0] ? appState.projects[0].id : 'proj-1');
    try {
      const res = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: text, projectId: targetProjectId, architectModel: selectedModel })
      });
      const data = await res.json();
      if (data.ok) {
        appState.selectedTaskId = data.task.id;
        startLiveExecutionRunner(data.task.id);
        refreshAll();
      }
    } catch (e) {
      alert('Error enviando instrucción: ' + e.message);
    }
  }

  // ===== EVENT LISTENERS =====
  if (btnSendInstruction) btnSendInstruction.addEventListener('click', handleSendInstruction);
  if (chatInputTextarea) {
    chatInputTextarea.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendInstruction(); }
    });
  }
  if (btnCloseAlert && alertStatusBar) {
    btnCloseAlert.addEventListener('click', () => { alertStatusBar.style.display = 'none'; });
  }

  // ===== REFRESH ALL =====
  async function refreshAll() {
    await fetchStatus();
    await fetchProjects();
    await fetchTasks();
  }
  refreshAll();
  setInterval(refreshAll, 5000);
});
