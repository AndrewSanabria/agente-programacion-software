# Agente de Programación Software (Dashboard & Orquestador Codex)

MVP funcional del **Dashboard Orquestador de Agentes IA y Worker Local**, adaptado para flujos multi-agente aislados en Git local (tipo Codex / Antigravity).

---

## 🚀 Inicio Rápido

Para ejecutar el Dashboard:

```bash
cd "/Users/andressanabria/Desktop/iankaphone web/agente de programacion software"
npm run dev
```

Luego abre en tu navegador:
👉 **[http://localhost:4173](http://localhost:4173)**

> ℹ️ **Nota de Dependencias:** Este MVP utiliza Node.js nativo (módulos `http`, `fs`, `path`, `child_process`, `crypto`). **No requiere `npm install`**.

---

## 🏛️ Arquitectura

```
Dashboard Web (Puerto 4173)
   ↓
Orquestador (server.js)
   ↓
GPT-4o (Arquitecto) + Claude 3.5 (Revisor de Riesgos)
   ↓
Worker Local Autenticado
   ↓
Git Worktree Aislado (.worktrees/)
   ↓
Antigravity Engine (Ejecución de cambios)
   ↓
Pruebas + Diffs + Aprobación Humana Manual
```

---

## 📋 Características Incluidas

1. **Dashboard Responsive Modo Oscuro (Estilo Codex & Antigravity IDE)**:
   - Panel de Estadísticas en Vivo: Repos conectados, tareas activas, aprobaciones pendientes y tasa de éxito de pruebas.
   - Visor interactivo de diagramas de arquitectura.

2. **Proyectos & Repositorios**:
   - Inspección segura del estado de Git local (`git status`, rama activa, commits).
   - Monitoreo de ramas aisladas en `.worktrees/`.

3. **Flujo de Agentes (Pipeline de 7 Pasos)**:
   - **Paso 1:** GPT-4o propone la arquitectura.
   - **Paso 2:** Claude 3.5 Sonnet revisa vulnerabilidades y riesgos.
   - **Paso 3:** Creación del Git Worktree aislado.
   - **Paso 4:** Antigravity ejecuta las modificaciones de código.
   - **Paso 5:** Test Runner ejecuta las pruebas unitarias.
   - **Paso 6:** GPT + Claude realizan el Code Review del diff.
   - **Paso 7:** Puerta de Aprobación Humana.

4. **Visor de Diffs**:
   - Resaltado de líneas agregadas (verde) y eliminadas (rojo).
   - Lista de archivos modificados.

5. **Puerta de Aprobación Humana**:
   - Aprobación explícita antes de hacer commit en `main` o abrir un Pull Request.
   - Opción de rechazar y descartar el entorno aislado.

6. **Terminal y Logs del Worker**:
   - Registro en tiempo real de eventos, estado del worker local y ejecuciones.

---

## 📁 Estructura del Proyecto

```
agente de programacion software/
├── package.json          # Script "dev": "node server.js"
├── server.js             # Servidor HTTP nativo Node.js y REST API
├── data/
│   └── state.json        # Persistencia del estado, tareas y logs
├── public/
│   ├── index.html        # SPA HTML5 semántico
│   ├── styles.css        # Estilos Codex Modo Oscuro
│   └── app.js            # Lógica cliente y polling en vivo
└── README.md             # Documentación
```
