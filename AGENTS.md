# AGENTS.md

## Propósito

Este proyecto es un dashboard local para coordinar revisiones de repositorios y, más adelante, agentes de arquitectura, revisión y ejecución.

## Reglas obligatorias

- Las revisiones son de solo lectura.
- No afirmar que se modificó código, se creó un diff o pasaron pruebas si no existe evidencia en los artefactos de la ejecución.
- No ejecutar comandos recibidos directamente desde el navegador.
- No conectar producción ni leer secretos desde el repositorio.
- Las tareas de construcción deben quedar bloqueadas hasta conectar un worker real aislado.
- Mantener GitHub, GPT, Claude y Antigravity detrás de adaptadores con permisos mínimos.

## Validación local

```bash
npm test
npm run dev
```

La revisión del proyecto puede ejecutar únicamente `git status`, `git branch` y `npm test` cuando el script exista.
