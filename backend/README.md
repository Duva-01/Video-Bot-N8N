# Backend

Runtime principal del sistema.

## Responsabilidades

- arrancar `n8n`
- persistir `n8n` en `Neon`
- exponer `health`
- ejecutar el workflow manualmente
- activar o desactivar el workflow
- servir login mínimo para abrir `/app/`

## Base de datos

Hay dos capas persistidas en Neon:

1. Base de datos de `n8n` en schema `n8n`
2. Historial de contenido en `content_runs`

El esquema del historial está en:

- [schema.sql](c:/Users/Usuario/Desktop/Personal/Proyectos/Automatizaciones/Bot%20de%20Videos/backend/db/schema.sql)

## Endpoints

- `GET /health`
- `POST /api/auth/login`
- `GET /api/control-center`
- `GET /api/logs`
- `GET /api/run-now`
- `POST /api/run-now`
- `GET /api/workflow-automation`
- `POST /api/workflow-automation`
- `GET /login`
- `GET /app/`
