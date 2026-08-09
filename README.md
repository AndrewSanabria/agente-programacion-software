# Forge Control — agente de programación software

MVP local de un dashboard tipo Codex para coordinar arquitectos de IA, revisores y un worker local sobre proyectos Git.

## Arranque

Requiere Node.js 18 o superior. No necesita instalar dependencias:

```bash
npm run dev
```

Abre [http://localhost:4173](http://localhost:4173).

En otra terminal, arranca el worker local:

```bash
npm run worker
```

Servidor y worker comparten automáticamente el token privado `data/.worker-token`.
También puedes proporcionar un token explícito con `FORGE_WORKER_TOKEN`; no uses tokens
hardcodeados en el código.

## Conectar OpenAI

La clave se mantiene solo en memoria del servidor y nunca se guarda en `data/state.json`.
Puedes configurarla desde el botón de ajustes del dashboard o antes de arrancar:

```bash
export OPENAI_API_KEY="sk-..."
export OPENAI_MODEL="gpt-5.6-luna"
npm run dev
```

El servidor valida la clave contra `GET /v1/models` y usa la Responses API para el chat.
Para pruebas locales se puede cambiar el endpoint con `OPENAI_BASE_URL`; no se debe enviar
la clave directamente desde el navegador a OpenAI.

## Qué incluye esta primera versión

- Dashboard responsive con resumen, tareas, proyectos y actividad.
- Persistencia local en `data/state.json`.
- Flujo de revisión real en modo solo lectura: inspección de archivos, documentación, Git y pruebas configuradas.
- Las solicitudes de construcción se mantienen bloqueadas hasta recibir un parche verificable; el worker no declara cambios que no aplicó.
- Lectura segura del estado Git del propio proyecto.
- Formularios para crear tareas y conectar repositorios.
- Contrato de API preparado para conectar GPT, Claude y un engine remoto de Antigravity mediante `ANTIGRAVITY_URL` y opcionalmente `ANTIGRAVITY_TOKEN`.

## Siguiente integración

1. Añadir autenticación de usuario/OAuth cuando el dashboard deje de ser exclusivamente local.
2. Completar el flujo de parches verificables y revisión de diffs en worktrees efímeros.
3. Conectar los adaptadores de OpenAI, Anthropic y Antigravity detrás del orquestador.

No se ejecutan comandos recibidos desde el navegador. El servidor y el worker no ejecutan scripts definidos por el repositorio; las pruebas se ejecutan en CI o en un sandbox dedicado. El sistema no modifica archivos durante una revisión ni afirma que las pruebas pasaron sin evidencia.

## Revisar el proyecto

Crea una tarea con un título o descripción que incluya `revisar`, `auditar`, `analizar` o `review`. El sistema:

1. Inspecciona la estructura y documentos del proyecto.
2. Comprueba el estado Git y la rama.
3. Reporta el script de pruebas; no lo ejecuta desde el servidor ni desde el worker.
4. Devuelve hallazgos con severidad, evidencia y recomendación.
5. No genera diffs ni modifica archivos durante una revisión.
