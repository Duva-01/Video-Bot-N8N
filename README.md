# Facts Engine OS

Sistema de automatizacion para generar y subir YouTube Shorts de hechos curiosos usando `n8n`, `Render`, `Neon`, `Cloudflare Pages`, `Groq`, `Cloudflare Workers AI`, `Pexels` y `FFmpeg`.

El proyecto esta dividido para mantener el runtime de `Render Free` lo mas ligero posible:

- `backend/`: runtime, `n8n`, API REST, scripts del pipeline, persistencia y observabilidad
- `frontend/`: landing + dashboard desplegado en `Cloudflare Pages`

## Estado actual

Actualmente el sistema hace esto de extremo a extremo:

1. selecciona un topic de facts
2. genera el guion
3. genera la voz
4. genera subtitulos
5. descarga clips de Pexels
6. monta el short con FFmpeg
7. sube el video a YouTube
8. persiste estado, eventos, artefactos y ejecuciones en Neon

Limitacion importante actual:

- las subidas a YouTube por API quedan en `private`
- esto no es un bug del proyecto; es la restriccion actual de YouTube para proyectos API no auditados

## Arquitectura

```text
frontend (Cloudflare Pages)
  -> login contra backend
  -> dashboard
  -> logs y health
  -> enlace a n8n

backend (Render)
  -> render-proxy.js
  -> n8n
  -> API REST
  -> scripts del pipeline
  -> FFmpeg
  -> keep-alive local

postgres (Neon)
  -> base de datos de n8n
  -> content_runs
  -> content_events
  -> content_artifacts
  -> execution_logs
  -> workflow_snapshots
  -> system_samples
  -> api_audit_logs
```

## Estructura del repo

```text
backend/
  data/
    fact-topics.json
  db/
    schema.sql
  scripts/
    build-short.sh
    cleanup-failed-runs.js
    cleanup-stale-runs.js
    fetch-pexels.js
    finalize-content.js
    generate-script.js
    generate-subtitles.js
    generate-voice.js
    normalize-uploaded-runs.js
    record-build-output.js
    select-fact-topic.js
    simulate-render-free.js
    upload-youtube.js
    lib/
      content-db.js
      llm-text.js
      script-observer.js
  services/
    dashboard-data.js
    render-proxy.js
  workflows/
    shorts-automation.template.json

frontend/
  app.js
  config.js
  index.html
  styles.css

.github/workflows/
  keep-render-awake.yml

Dockerfile
render.yaml
package.json
README.md
```

## Stack actual

### Texto
- proveedor: `Groq`
- modelo actual: `llama-3.1-8b-instant`

### Voz
- proveedor: `Cloudflare Workers AI`
- modelo actual: `@cf/deepgram/aura-2-es`
- speaker actual: `aquila`

### Visuales
- `Pexels API`

### Video
- `FFmpeg`
- perfil low-memory pensado para `Render Free`

### Subida
- `YouTube Data API`

### Orquestacion
- `n8n`

### Persistencia
- `Neon PostgreSQL`

## Flujo del workflow

Plantilla actual:
- [shorts-automation.template.json](backend/workflows/shorts-automation.template.json)

Nodos principales:

1. `Manual Trigger`
2. `Schedule Trigger`
3. `Prepare Workspace`
4. `Select Fact Topic`
5. `Generate Script`
6. `Generate Voice`
7. `Generate Subtitles`
8. `Fetch Pexels`
9. `Build Video`
10. `YouTube Upload`
11. `Finalize Content`

Frecuencia actual de la plantilla:
- cada `2 horas`

Workspace temporal usado en runtime:
- `/tmp/bot-videos`

## Backend

Archivo principal:
- [render-proxy.js](backend/services/render-proxy.js)

Responsabilidades del backend:

- arrancar `n8n`
- exponer `GET /health`
- exponer autenticacion y API del dashboard
- proxy hacia `n8n`
- guardar snapshots de workflow y observabilidad en Neon
- mantener keep-alive interno ligero

### Endpoints principales

- `GET /health`
- `POST /api/auth/login`
- `GET /api/control-center`
- `GET /api/logs`
- `GET|POST /api/run-now`
- `GET|POST /api/workflow-automation`
- `GET /` -> UI de `n8n`

## Frontend

Archivos principales:
- [index.html](frontend/index.html)
- [app.js](frontend/app.js)
- [styles.css](frontend/styles.css)
- [config.js](frontend/config.js)

El frontend hace esto:

- landing publica
- login contra backend
- dashboard operativo
- consola de logs
- vista health
- acceso a `n8n` en otra pestana

## Base de datos

Esquema principal:
- [schema.sql](backend/db/schema.sql)

Tablas de negocio y observabilidad:

- `content_runs`
- `content_events`
- `content_artifacts`
- `execution_logs`
- `workflow_snapshots`
- `system_samples`
- `api_audit_logs`

### Que guarda Neon

#### `content_runs`
- topic_key
- categoria
- topic
- title
- status
- stage actual
- urls de YouTube
- metadata de publicacion

#### `content_events`
- eventos de cada etapa del pipeline

#### `content_artifacts`
- audio
- subtitulos
- clips
- resultados JSON
- referencias de publicacion

#### `execution_logs`
- logs tecnicos y de pipeline

#### `workflow_snapshots`
- estado del workflow de `n8n`
- activo o no
- trigger count
- ultima ejecucion

#### `system_samples`
- muestras de memoria y runtime

#### `api_audit_logs`
- acciones de API y accesos al backend

## Scripts utiles

### Calidad / validacion
```bash
npm run check
```

### Arranque local
```bash
npm install
npm start
```

### Simulacion de Render Free
```bash
npm run simulate:render
```

### Limpiar runs fallidos en Neon
```bash
node backend/scripts/cleanup-failed-runs.js
node backend/scripts/cleanup-failed-runs.js --apply
```

### Normalizar runs subidos a YouTube pero mal marcados en DB
```bash
node backend/scripts/normalize-uploaded-runs.js
node backend/scripts/normalize-uploaded-runs.js --apply
```

### Limpiar runs `selected/generated` viejos de pruebas
```bash
node backend/scripts/cleanup-stale-runs.js --older-than-hours=24
node backend/scripts/cleanup-stale-runs.js --older-than-hours=24 --apply
```

## Despliegue

### Render
Archivo:
- [render.yaml](render.yaml)

El servicio usa:
- `Dockerfile` de la raiz
- `plan: free`
- `healthCheckPath: /health`

El contenedor copia solo backend y runtime necesario.

### Cloudflare Pages
Se despliega la carpeta:
- `frontend/`

### GitHub Actions
Workflows actuales:
- [.github/workflows/keep-render-awake.yml](.github/workflows/keep-render-awake.yml)
- [.github/workflows/run-content-trigger.yml](.github/workflows/run-content-trigger.yml)

`keep-render-awake.yml` hace ping a:
- `/health`
- cada `5 minutos`

Objetivo:
- reducir suspensiones del servicio free de Render

`run-content-trigger.yml`:
- hace login contra `POST /api/auth/login`
- obtiene un token bearer temporal
- llama a `POST /api/run-now`
- `POST /api/run-now` dispara internamente el workflow por webhook
- corre cada `2 horas`
- también se puede lanzar manualmente desde GitHub Actions

Secrets requeridos en GitHub:
- `FACTS_ENGINE_APP_USER`
- `FACTS_ENGINE_APP_PASSWORD`

Importante:
- la plantilla del workflow incluye `Webhook Trigger` con path `facts-engine-run`
- si tu instancia de `n8n` tiene un workflow antiguo importado antes de este cambio, debes reimportar la plantilla o añadir ese nodo manualmente y conectarlo a `Prepare Workspace`

## Variables importantes

### Core / runtime
```text
NEON_DATABASE_URL=
N8N_DB_SCHEMA=n8n
N8N_ENCRYPTION_KEY=
WEBHOOK_URL=
N8N_EDITOR_BASE_URL=
N8N_PATH=/
APP_FRONTEND_ORIGIN=
APP_AUTH_ENABLED=true
APP_AUTH_USER=
APP_AUTH_PASSWORD=
```

### Workflow / facts
```text
VIDEO_DEFAULT_TOPIC=hechos curiosos
VIDEO_DEFAULT_DURATION_SECONDS=12
VIDEO_DEFAULT_STYLE=curioso, rapido, directo
VIDEO_DEFAULT_LANGUAGE=es
FACT_ALLOWED_CATEGORIES=space,science,history,technology,animals,psychology,geography,food,sports,culture,internet
FACT_TOPIC_MODE=dynamic-first
FACT_DYNAMIC_TOPIC_ATTEMPTS=4
```

### Texto
```text
TEXT_PROVIDER=groq
GROQ_API_KEY=
GROQ_TEXT_MODEL=llama-3.1-8b-instant
```

### TTS
```text
TTS_PROVIDER=cloudflare
CLOUDFLARE_AI_API_TOKEN=
CLOUDFLARE_ACCOUNT_ID=
CLOUDFLARE_TTS_MODEL=@cf/deepgram/aura-2-es
CLOUDFLARE_TTS_LANG=es
CLOUDFLARE_TTS_SPEAKER=aquila
```

### Pexels
```text
PEXELS_API_KEY=
PEXELS_CLIPS_COUNT=1
PEXELS_QUERY_LIMIT=3
PEXELS_PER_PAGE=3
```

### YouTube
```text
YOUTUBE_CLIENT_ID=
YOUTUBE_CLIENT_SECRET=
YOUTUBE_REFRESH_TOKEN=
YOUTUBE_PRIVACY_STATUS=private
YOUTUBE_CATEGORY_ID=28
YOUTUBE_DEFAULT_TITLE=Dato curioso del dia
YOUTUBE_DEFAULT_DESCRIPTION=Video generado automaticamente con n8n.
YOUTUBE_DEFAULT_TAGS=facts,curiosidades,shorts
```

### FFmpeg low-memory
```text
RENDER_LOW_MEMORY_MODE=true
SHORTS_WIDTH=540
SHORTS_HEIGHT=960
SHORTS_FPS=20
FFMPEG_THREADS=1
FFMPEG_PRESET=ultrafast
FFMPEG_CRF=30
FFMPEG_VIDEO_BITRATE=1200k
FFMPEG_AUDIO_BITRATE=64k
FFMPEG_AUDIO_RATE=22050
```

## Operacion diaria

### Flujo normal
1. `n8n` dispara cada 2 horas
2. genera el video
3. lo sube a YouTube en `private`
4. Neon guarda el estado
5. el frontend muestra:
   - uploaded
   - pending
   - finalized
   - latest generated
   - latest public

### Si hay descuadres en el dashboard
Usa:
- `normalize-uploaded-runs.js`
- `cleanup-stale-runs.js`
- `cleanup-failed-runs.js`

## Limitaciones conocidas

### YouTube
- los videos se suben en `private`
- para publicar automatico en `public` hace falta auditoria del proyecto API de YouTube
- mientras no exista esa auditoria, el paso final no se puede resolver de forma oficial con la API

### Render Free
- puede suspenderse
- puede reiniciarse por memoria si se sube mucho la carga
- el perfil de FFmpeg esta reducido a proposito para evitar OOM

### Browser automation sobre YouTube Studio
- no esta montado en el proyecto
- se considero como workaround, pero no forma parte del flujo oficial actual

## Recomendaciones operativas

1. mantener el workflow activo en `n8n`
2. dejar el keep-alive de GitHub Actions habilitado
3. revisar periodicamente Neon para limpiar runs de prueba
4. no subir `.env` ni secretos al repo
5. rotar claves si alguna se expone

## Estado recomendado para produccion ligera

- frontend en `Cloudflare Pages`
- backend en `Render`
- Neon como base de verdad
- facts cada `2 horas`
- subidas en `private`
- publicacion manual en lote mientras YouTube no apruebe auditoria
