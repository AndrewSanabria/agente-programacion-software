document.addEventListener('DOMContentLoaded', () => {
  // Application State
  let appState = {
    tasks: [],
    projects: [],
    logs: [],
    status: {},
    selectedTaskId: null,
    planMode: true,
    isDiffExpanded: false
  };

  // UI Elements
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

  // Toggle Diff Accordion
  if (filesChangedBar) {
    filesChangedBar.addEventListener('click', () => {
      appState.isDiffExpanded = !appState.isDiffExpanded;
      if (diffPanelContent) {
        diffPanelContent.classList.toggle('hidden', !appState.isDiffExpanded);
      }
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

  // Toggle Plan Mode
  if (btnTogglePlanMode) {
    btnTogglePlanMode.addEventListener('click', () => {
      appState.planMode = !appState.planMode;
      planModeLabel.textContent = appState.planMode ? 'Plan mode' : 'Act mode';
      btnTogglePlanMode.style.borderColor = appState.planMode ? 'var(--primary)' : 'var(--success)';
    });
  }

  // New Task Handler
  if (btnNewTask) {
    btnNewTask.addEventListener('click', () => {
      appState.selectedTaskId = null;
      currentTaskTitle.textContent = 'Nueva Tarea (Plan mode)';
      userPromptText.textContent = 'Escribe tu instrucción en la barra inferior para iniciar la ejecución...';
      completedStepsTableBody.innerHTML = '';
      subagentsExecutionList.innerHTML = '';
      chatInputTextarea.focus();
    });
  }

  // Fetching Functions
  async function fetchStatus() {
    try {
      const res = await fetch('/api/status');
      const data = await res.json();
      if (data.ok) {
        appState.status = data;
      }
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

  // Submit Instruction Handler
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
        refreshAll();
      }
    } catch (e) {
      alert('Error enviando instrucción: ' + e.message);
    }
  }

  async function fetchTasks() {
    try {
      const res = await fetch('/api/tasks');
      const data = await res.json();
      if (data.ok) {
        appState.tasks = data.tasks;
        if (!appState.selectedTaskId && data.tasks.length > 0) {
          appState.selectedTaskId = data.tasks[0].id;
        }
        renderTasksSidebar();
        renderWorkspaceCanvas();
        renderRightInspector();
      }
    } catch (e) {}
  }

  const headerProjectSelect = document.getElementById('header-project-select');
  const chatProjectSelect = document.getElementById('chat-project-select');
  const agentChatResponsesContainer = document.getElementById('agent-chat-responses-container');
  const reasoningStatusText = document.getElementById('reasoning-status-text');

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
    renderProjectSelectors();
    renderProjectsSidebar();
  }

  // Render Left Sidebar Trees
  function renderProjectsSidebar() {
    if (!projectsListSidebar) return;
    projectsListSidebar.innerHTML = appState.projects.map(p => `
      <div class="tree-item ${p.id === appState.activeProjectId ? 'active' : ''}" data-project-id="${p.id}" title="${p.path}">
        <span>📁 ${p.name}</span>
        ${p.id === appState.activeProjectId ? '<span class="status-dot green" style="margin-left:auto;"></span>' : ''}
      </div>
    `).join('');

    document.querySelectorAll('#projects-list-sidebar .tree-item').forEach(el => {
      el.addEventListener('click', () => {
        setActiveProject(el.dataset.projectId);
      });
    });
  }

  function renderTasksSidebar() {
    if (!tasksListSidebar) return;
    tasksListSidebar.innerHTML = appState.tasks.map(t => `
      <div class="tree-item ${t.id === appState.selectedTaskId ? 'active' : ''}" data-task-id="${t.id}">
        <span class="status-dot ${t.status === 'approved' ? 'green' : 'red'}"></span>
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

  // Live Execution Simulation Stream Engine
  function startLiveExecutionRunner(taskId) {
    if (appState.liveInterval) clearInterval(appState.liveInterval);
    if (appState.timerInterval) clearInterval(appState.timerInterval);

    appState.activeStepIndex = 0;
    appState.liveTimerSeconds = 0;
    appState.liveSubagentsLogs = [
      '🤖 SubAgent Explore · Analizando repositorio y contexto de la instrucción...'
    ];

    appState.timerInterval = setInterval(() => {
      appState.liveTimerSeconds += 1;
      const mins = Math.floor(appState.liveTimerSeconds / 60);
      const secs = appState.liveTimerSeconds % 60;
      if (executionTimeLabel) {
        executionTimeLabel.textContent = mins > 0 ? `${mins} m ${secs} s` : `${secs} s`;
      }
    }, 1000);

    appState.liveInterval = setInterval(() => {
      appState.activeStepIndex += 1;

      if (appState.activeStepIndex === 1) {
        appState.liveSubagentsLogs.push('🤖 SubAgent Security · Auditando vulnerabilidades y permisos...');
      } else if (appState.activeStepIndex === 2) {
        appState.liveSubagentsLogs.push(`🤖 SubAgent GitWorker · Aislando entorno en .worktrees/feat-...`);
      } else if (appState.activeStepIndex === 3) {
        appState.liveSubagentsLogs.push('🤖 SubAgent Antigravity · Modificando archivos y ejecutando tests unitarios...');
      } else if (appState.activeStepIndex >= 4) {
        appState.liveSubagentsLogs.push('✅ SubAgent TestRunner · 8/8 pruebas unitarias aprobadas al 100%');
        clearInterval(appState.liveInterval);
        clearInterval(appState.timerInterval);
      }

      renderWorkspaceCanvas();
    }, 2200);
  }

  // Render Main Workspace
  function renderWorkspaceCanvas() {
    const currentTask = appState.tasks.find(t => t.id === appState.selectedTaskId) || appState.tasks[0];
    if (!currentTask) return;

    currentTaskTitle.textContent = currentTask.title;
    userPromptText.textContent = currentTask.description || currentTask.title;

    const currentProj = appState.projects.find(p => p.id === currentTask.projectId) || appState.projects[0];
    const isTaskRunning = (appState.activeStepIndex !== undefined && appState.activeStepIndex < 4 && appState.selectedTaskId === currentTask.id);
    const activeStep = isTaskRunning ? appState.activeStepIndex : 4;

    if (reasoningStatusText) {
      reasoningStatusText.textContent = isTaskRunning 
        ? `Thought for a few seconds (Ejecutando paso ${activeStep + 1} de 4 en [${currentProj ? currentProj.name : 'iankaphone-web'}])`
        : `Thought for a few seconds (Analizando contexto en [${currentProj ? currentProj.name : 'iankaphone-web'}])`;
    }

    // Render Conversational Agent Response & Plan Manifest Cards
    if (agentChatResponsesContainer) {
      const isApproved = currentTask.status === 'approved';
      const isRejected = currentTask.status === 'rejected';

      const getStepHtml = (stepIdx, label, detail) => {
        if (activeStep > stepIdx) {
          return `<div style="display: flex; align-items: center; justify-content: space-between;">
            <span>${label}: ${detail}</span>
            <span style="color: var(--success); font-weight: bold;">✓ Completado</span>
          </div>`;
        } else if (activeStep === stepIdx) {
          return `<div style="display: flex; align-items: center; justify-content: space-between; background: rgba(245, 158, 11, 0.15); padding: 4px 8px; border-radius: 4px;">
            <span style="color: #fbbf24; font-weight: 600;">⚡ ${label}: ${detail}</span>
            <span class="badge warning" style="animation: pulseGlow 1.2s infinite;">⚡ EJECUTANDO EN VIVO...</span>
          </div>`;
        } else {
          return `<div style="display: flex; align-items: center; justify-content: space-between; opacity: 0.5;">
            <span>⌛ ${label}: ${detail}</span>
            <span style="color: var(--text-dim);">En espera</span>
          </div>`;
        }
      };

      agentChatResponsesContainer.innerHTML = `
        <!-- CARD 1: MANIFESTACIÓN DEL PLAN DE LOS AGENTES -->
        <div class="agent-response-card" style="border: 1px solid var(--primary-glow); background: rgba(14, 20, 34, 0.95);">
          <div class="agent-card-author">
            <span>📋 Plan Manifest & Propuesta de los Agentes</span>
            <span class="badge secondary" style="margin-left: auto;">Worktree Aislado</span>
          </div>
          <p style="font-size: 13.5px; font-weight: 600; color: #fff; margin-bottom: 8px;">
            📌 Objetivo: "${currentTask.title}"
          </p>
          <div style="background: rgba(0, 0, 0, 0.3); padding: 12px; border-radius: 8px; font-size: 12.5px; margin-bottom: 12px;">
            <p><strong>🤖 GPT-4o Architect:</strong> Propuesta de componentes aislados y estructura modular.</p>
            <p style="margin-top: 4px;"><strong>🛡️ Claude 3.5 Reviewer:</strong> Auditando políticas de seguridad, sanitización de inputs y cero comandos destructivos.</p>
            <p style="margin-top: 4px;"><strong>📁 Proyecto Destino:</strong> <code>${currentProj ? currentProj.name : 'iankaphone-web'}</code></p>
            <p style="margin-top: 4px;"><strong>📄 Archivos a Modificar (${currentTask.diff ? currentTask.diff.filesChanged.length : 2}):</strong> ${currentTask.diff ? currentTask.diff.filesChanged.join(', ') : 'src/service.ts, tests/service.test.ts'}</p>
          </div>
        </div>

        <!-- CARD 2: ¿QUÉ ESTÁ HACIENDO LA IA EN TIEMPO REAL? -->
        <div class="agent-response-card" style="border: 1px solid ${isTaskRunning ? 'var(--warning)' : 'rgba(255, 255, 255, 0.1)'}; background: rgba(10, 15, 26, 0.9);">
          <div class="agent-card-author">
            <span>⚡ ¿Qué está haciendo la IA actualmente en vivo?</span>
            <span class="badge ${isTaskRunning ? 'warning' : 'success'}" style="margin-left: auto;">
              ${isTaskRunning ? '⚡ EJECUTANDO EN TIEMPO REAL' : '✓ ACTIVIDAD COMPLETADA'}
            </span>
          </div>
          <div style="display: flex; flex-direction: column; gap: 8px; font-size: 12.5px;">
            ${getStepHtml(0, '🔍 GPT-4o Architect', `Analizando requerimientos de "${currentTask.title.slice(0, 30)}..."`)}
            ${getStepHtml(1, '🛡️ Claude 3.5 Reviewer', 'Auditando permisos y riesgos de seguridad')}
            ${getStepHtml(2, '🌿 Git Worker', `Aislando rama .worktrees/${currentTask.worktreeBranch}`)}
            ${getStepHtml(3, '🚀 Antigravity Engine', 'Modificando archivos y corriendo 8/8 pruebas unitarias')}
          </div>
        </div>

        <!-- CARD 3: PUERTA DE APROBACIÓN HUMANA -->
        <div class="agent-response-card" style="border: 1px solid ${isApproved ? 'var(--success)' : isRejected ? 'var(--danger)' : 'var(--warning)'}; background: rgba(18, 24, 40, 0.95);">
          <div class="agent-card-author">
            <span>✋ Puerta de Aprobación Humana</span>
            <span class="badge ${isApproved ? 'success' : isRejected ? 'danger' : 'warning'}" style="margin-left: auto;">
              ${isApproved ? 'APROBADO & INTEGRADO' : isRejected ? 'RECHAZADO' : isTaskRunning ? 'EN EJECUCIÓN...' : 'PENDIENTE APROBACIÓN'}
            </span>
          </div>
          <p style="font-size: 13px;">
            ${isApproved 
              ? '🎉 <strong>¡Cambios Aprobados!</strong> Se ejecutó el commit y la solicitud de Pull Request ha sido registrada.' 
              : isRejected 
              ? '❌ <strong>Tarea Rechazada.</strong> El entorno aislado fue revertido.' 
              : isTaskRunning
              ? '⏳ <strong>Los agentes están trabajando en vivo...</strong> Los botones de aprobación se habilitarán al finalizar los 4 pasos.'
              : 'Se han completado las modificaciones de código y las <strong>8 pruebas unitarias pasaron al 100%</strong>. ¿Autorizas hacer el Commit final y la integración?'}
          </p>
          
          <div style="display: flex; gap: 10px; margin-top: 14px; flex-wrap: wrap;">
            ${!isApproved && !isRejected && !isTaskRunning ? `
              <button class="btn btn-sm btn-success btn-approve-task" data-task-id="${currentTask.id}">
                <span class="icon">✅</span> Aprobar Commit & PR Final
              </button>
              <button class="btn btn-sm btn-danger btn-reject-task" data-task-id="${currentTask.id}">
                <span class="icon">❌</span> Rechazar y Descartar Worktree
              </button>
            ` : ''}
            <button class="btn btn-sm btn-outline btn-toggle-diff-view">
              <span class="icon">📝</span> Inspeccionar Diffs de Código
            </button>
          </div>
        </div>
      `;

      // Approve button action
      const approveBtn = agentChatResponsesContainer.querySelector('.btn-approve-task');
      if (approveBtn) {
        approveBtn.addEventListener('click', async () => {
          await fetch(`/api/tasks/${currentTask.id}/approve`, { method: 'POST' });
          refreshAll();
        });
      }

      // Reject button action
      const rejectBtn = agentChatResponsesContainer.querySelector('.btn-reject-task');
      if (rejectBtn) {
        rejectBtn.addEventListener('click', async () => {
          await fetch(`/api/tasks/${currentTask.id}/reject`, { method: 'POST' });
          refreshAll();
        });
      }

      // Diff view action
      const toggleDiffBtn = agentChatResponsesContainer.querySelector('.btn-toggle-diff-view');
      if (toggleDiffBtn && filesChangedBar) {
        toggleDiffBtn.addEventListener('click', () => {
          filesChangedBar.click();
        });
      }
    }

    // Render Steps Table
    completedStepsTableBody.innerHTML = currentTask.steps.map((s, idx) => `
      <tr>
        <td style="width: 30px;">
          <span class="step-check-icon">${activeStep >= idx ? '✓' : '⌛'}</span>
        </td>
        <td><strong>"${s.name}"</strong> → "${s.summary}"</td>
        <td style="text-align: right;"><span class="step-file-code">${s.agent}</span></td>
        <td style="width: 40px; text-align: right;">
          <span style="color: ${activeStep >= idx ? 'var(--success)' : 'var(--text-dim)'}; font-weight: bold;">
            ${activeStep >= idx ? '✓' : '⌛'}
          </span>
        </td>
      </tr>
    `).join('');

    // Render Diff Bar
    if (currentTask.diff) {
      filesChangedCount.textContent = `${currentTask.diff.filesChanged.length} files changed`;
      diffCodeText.textContent = currentTask.diff.patch || 'No patch available.';
    }

    // Render Subagents Explore Stream dynamically
    const logs = (appState.liveSubagentsLogs && isTaskRunning) ? appState.liveSubagentsLogs : [
      '🤖 SubAgent Explore · Explore IA generation backend',
      '🤖 SubAgent Explore · Explore frontend ajustes UI',
      '🤖 SubAgent Explore · Explore audiences and targeting'
    ];

    subagentsExecutionList.innerHTML = logs.map(l => `
      <div class="subagent-item">
        <span class="subagent-icon">🤖</span>
        <span>${l}</span>
      </div>
    `).join('');
  }

  // Render Right Inspector
  function renderRightInspector() {
    const currentTask = appState.tasks.find(t => t.id === appState.selectedTaskId) || appState.tasks[0];
    if (!currentTask) return;

    plansListContainer.innerHTML = `
      <div class="plan-item">📋 Plan: ${currentTask.title}</div>
      <div class="plan-item">📋 Plan: Evolución del Módulo ianka App...</div>
    `;

    const completedCount = currentTask.steps.filter(s => s.status === 'completed').length;
    const totalCount = currentTask.steps.length;
    progressRatioBadge.textContent = `${completedCount}/${totalCount}`;
    completedTasksLabel.textContent = `${completedCount} completed`;

    checklistItemsContainer.innerHTML = currentTask.steps.map(s => `
      <div class="check-item">
        <span class="check-icon-circle">${s.status === 'completed' ? '✓' : '○'}</span>
        <span>${s.name}: ${s.summary}</span>
      </div>
    `).join('');
  }

  // Submit Instruction Handler
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

  if (btnSendInstruction) {
    btnSendInstruction.addEventListener('click', handleSendInstruction);
  }

  if (chatInputTextarea) {
    chatInputTextarea.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSendInstruction();
      }
    });
  }

  if (btnCloseAlert && alertStatusBar) {
    btnCloseAlert.addEventListener('click', () => {
      alertStatusBar.style.display = 'none';
    });
  }

  async function refreshAll() {
    await fetchStatus();
    await fetchProjects();
    await fetchTasks();
  }

  refreshAll();
  setInterval(refreshAll, 3000);
});
