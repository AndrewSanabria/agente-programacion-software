# Forge Control — agente de programación software

MVP local de un dashboard tipo Codex para coordinar arquitectos de IA, revisores y un worker local sobre proyectos Git.

## Arranque

Requiere Node.js 18 o superior. No necesita instalar dependencias:

```bash
npm run dev
```

Abre [http://localhost:4173](http://localhost:4173).

## Qué incluye esta primera versión

- Dashboard responsive con resumen, tareas, proyectos y actividad.
- Persistencia local en `data/state.json`.
- Flujo de revisión real en modo solo lectura: inspección de archivos, documentación, Git y pruebas configuradas.
- Las solicitudes de construcción todavía usan el flujo simulado del MVP y se identifican por separado de una revisión.
- Lectura segura del estado Git del propio proyecto.
- Formularios para crear tareas y conectar repositorios.
- Contrato de API preparado para sustituir los agentes simulados por GPT, Claude y Antigravity.

## Siguiente integración

1. Sustituir `runTask` por una cola persistente y un `worker-local` separado.
2. Añadir autenticación y OAuth/GitHub App con permisos mínimos.
3. Añadir worktrees efímeros, lista blanca de comandos y revisión de diffs.
4. Conectar los adaptadores de OpenAI, Anthropic y Antigravity detrás del orquestador.

No se ejecutan comandos recibidos desde el navegador. La revisión solo ejecuta comandos fijos y de lectura (`git status`, `git branch` y `npm test` cuando `package.json` lo declara); no modifica archivos ni afirma que las pruebas pasaron si no existe un script ejecutable.

## Revisar el proyecto

Crea una tarea con un título o descripción que incluya `revisar`, `auditar`, `analizar` o `review`. El sistema:

1. Inspecciona la estructura y documentos del proyecto.
2. Comprueba el estado Git y la rama.
3. Ejecuta `npm test` únicamente si está configurado.
4. Devuelve hallazgos con severidad, evidencia y recomendación.
5. No genera diffs ni modifica archivos durante una revisión.
