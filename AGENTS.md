# AGENTS.md

## Propósito

Este proyecto es un dashboard local para coordinar revisiones de repositorios y, más adelante, agentes de arquitectura, revisión y ejecución.

## Reglas obligatorias

- Las revisiones son de solo lectura.
- No afirmar que se modificó código, se creó un diff o pasaron pruebas si no existe evidencia en los artefactos de la ejecución.
- No ejecutar comandos recibidos directamente desde el navegador.
- No conectar producción ni leer secretos desde el repositorio.
- Las tareas de construcción deben quedar bloqueadas si no incluyen un parche verificable; preparar un worktree no equivale a modificar código.
- Mantener GitHub, GPT, Claude y Antigravity detrás de adaptadores con permisos mínimos.

## Validación local

```bash
npm test
npm run dev
```

La revisión del proyecto puede leer archivos y ejecutar `git status`/`git branch`. No debe ejecutar scripts definidos por el repositorio desde el servidor o el worker.
El worker y el servidor deben usar `FORGE_WORKER_TOKEN` o el token privado generado en `data/.worker-token`; nunca un token hardcodeado.
