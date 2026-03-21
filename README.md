# Facts Engine OS

Monorepo dividido en:

- `backend/`: `Render + n8n + Neon + APIs`
- `frontend/`: panel estático para `Cloudflare Pages`

## Objetivo

Mantener `Render Free` lo más ligero posible:

- backend solo para runtime, workflow y persistencia
- frontend separado para dashboard, logs y controles
- Neon como base de datos persistente tanto para `n8n` como para histórico de contenido

## Estructura

```text
backend/
  data/
  db/
  public/auth/
  scripts/
  services/
  workflows/
frontend/
  index.html
  app.js
  styles.css
  config.js
Dockerfile
render.yaml
package.json
```

## Backend

El backend publica:

- `GET /health`
- `POST /api/auth/login`
- `GET /api/control-center`
- `GET /api/logs`
- `GET|POST /api/workflow-automation`
- `GET|POST /api/run-now`
- `GET /login`
- `GET /app/` para abrir `n8n`

Notas:

- `n8n` persiste en Neon
- el workflow puede autoactivarse en arranque
- `Render` ya no sirve shell/dashboard pesados

## Frontend

El frontend es estático y se despliega aparte.

Su función:

- login contra la API del backend
- dashboard de métricas
- logs y últimas ejecuciones
- botón `Run now`
- botón `Automation ON/OFF`
- enlace a `n8n` en pestaña aparte

## Render

Render sigue usando el `Dockerfile` de la raíz, pero ese `Dockerfile` solo copia `backend/`.

Variables importantes:

```text
NEON_DATABASE_URL=postgresql://...
N8N_DB_SCHEMA=n8n
N8N_ENCRYPTION_KEY=...
WEBHOOK_URL=https://tu-backend.onrender.com
N8N_EDITOR_BASE_URL=https://tu-backend.onrender.com/app/
N8N_PATH=/app/
APP_FRONTEND_ORIGIN=https://tu-frontend.pages.dev
N8N_SHELL_WORKFLOW_ID=1
N8N_AUTO_ACTIVATE_WORKFLOW_ID=1
```

## Cloudflare Pages

Despliega la carpeta `frontend/`.

Antes de subirla, edita:

- [config.js](c:/Users/Usuario/Desktop/Personal/Proyectos/Automatizaciones/Bot%20de%20Videos/frontend/config.js)

poniendo tu backend real de Render.

## Desarrollo local

```bash
npm install
npm run check
npm start
```

## Simulación Render Free

```bash
npm run simulate:render
```

## Nota

El punto crítico de memoria en `Render Free` ya no debe ser la shell, porque:

- se eliminó el iframe pesado de `n8n` del panel
- se eliminaron procesos extra de `n8n` para resolver workflows
- el backend ahora usa consultas directas a Neon para estado y logs
