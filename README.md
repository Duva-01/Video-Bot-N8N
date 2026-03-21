# Bot de Videos

Sistema automatizado para generar `YouTube Shorts` de `facts` y `hechos curiosos` con `n8n`, `Gemini`, `Pexels`, `FFmpeg`, `Neon` y despliegue en `Render`.

## Objetivo

- generar shorts verticales con voz y subtitulos
- cubrir categorias variadas de hechos curiosos
- evitar repetir temas usando `Neon`
- publicar automaticamente en `YouTube Shorts`
- exponer un dashboard en `/dashboard`

## Arquitectura

- `n8n` orquesta el workflow
- `Gemini` genera topic, guion y narracion
- `Pexels` aporta clips de apoyo
- `FFmpeg` monta el video final con subtitulos
- `Neon` guarda historial, evita reutilizar topics y persiste la base de datos de `n8n`
- `YouTube` recibe la publicacion
- `render-proxy.js` expone `GET /health`, `GET /dashboard` y proxya `n8n`

## Flujo

1. `Manual Trigger` o `Schedule Trigger`
2. `Select Fact Topic`
3. `Generate Script`
4. `Generate Voice`
5. `Generate Subtitles`
6. `Fetch Pexels`
7. `Build Video`
8. `YouTube Upload`
9. `Finalize Content`

## No repeticion

Si `NEON_DATABASE_URL` esta configurado:

- el bot registra cada `topic_key` en `content_runs`
- primero intenta generar topics nuevos con `Gemini`
- valida contra `Neon` antes de reservar el topic
- si Gemini falla o devuelve duplicados, usa el catalogo fijo como fallback
- cuando se agota tambien el catalogo fijo, falla de forma explicita

Eso evita repeticiones silenciosas. Si quieres mas volumen, amplias `data/fact-topics.json`.

Variables relacionadas:

- `FACT_TOPIC_MODE=dynamic-first`
- `FACT_DYNAMIC_TOPIC_ATTEMPTS=4`

## Dashboard

La app publica un panel visual en:

```text
https://tu-app.onrender.com/dashboard
```

Incluye:

- metricas totales
- timeline de actividad
- distribucion por estado
- distribucion por categoria
- lista de videos recientes

Si `Neon` no esta configurado, el dashboard carga pero sin historico real.

## Login

El acceso ya no usa el popup incomodo de `basic auth` del navegador.

Ahora el proxy publica:

- `/login` para entrar con formulario
- cookie de sesion persistente
- `/auth/logout` para cerrar sesion

Dentro de `n8n`:

- `Dashboard` se abre en un panel inline
- `Health` se abre inline con el JSON del estado
- no saca al usuario a otra pagina aparte

Por defecto reutiliza:

- `N8N_BASIC_AUTH_USER`
- `N8N_BASIC_AUTH_PASSWORD`

Opcionalmente puedes separar las credenciales del proxy con:

- `APP_AUTH_USER`
- `APP_AUTH_PASSWORD`
- `APP_SESSION_SECRET`

## Archivos clave

- `services/render-proxy.js`
- `services/dashboard-data.js`
- `scripts/select-fact-topic.js`
- `scripts/generate-script.js`
- `scripts/generate-subtitles.js`
- `scripts/build-short.sh`
- `scripts/upload-youtube.js`
- `scripts/finalize-content.js`
- `workflows/shorts-automation.template.json`
- `data/fact-topics.json`
- `.env`

## Variables importantes

- `GEMINI_API_KEY`
- `PEXELS_API_KEY`
- `NEON_DATABASE_URL`
- `N8N_ENCRYPTION_KEY`
- `YOUTUBE_CLIENT_ID`
- `YOUTUBE_CLIENT_SECRET`
- `YOUTUBE_REFRESH_TOKEN`
- `YOUTUBE_PRIVACY_STATUS`
- `FACT_ALLOWED_CATEGORIES`
- `VIDEO_DEFAULT_DURATION_SECONDS`
- `PEXELS_CLIPS_COUNT`

## Render

1. crea un `Web Service`
2. usa el `Dockerfile` incluido
3. importa variables desde `.env`
4. define:
   - `WEBHOOK_URL=https://tu-app.onrender.com`
   - `N8N_EDITOR_BASE_URL=https://tu-app.onrender.com`
5. importa el workflow JSON en `n8n`

Para `Render Free`, mantien:

- `VIDEO_DEFAULT_DURATION_SECONDS=12`
- `PEXELS_CLIPS_COUNT=1`
- `RENDER_LOW_MEMORY_MODE=true`
- `SHORTS_WIDTH=540`
- `SHORTS_HEIGHT=960`
- `SHORTS_FPS=20`
- `FFMPEG_THREADS=1`
- `PEXELS_QUERY_LIMIT=3`
- `PEXELS_PER_PAGE=3`
- `PEXELS_TARGET_WIDTH=540`

Con esa configuracion el video final consume bastante menos memoria al montar en `FFmpeg`, que es justo donde `Render Free` suele matar la instancia por pasar de `512MB`.

## Persistencia de n8n en Neon

Si `NEON_DATABASE_URL` esta configurado, el proxy arranca `n8n` con `Postgres` en vez de `SQLite`.

Eso hace que sobrevivan a los redeploys:

- workflows
- credenciales
- ejecuciones
- ajustes internos de `n8n`

Configuracion minima recomendada:

```text
NEON_DATABASE_URL=postgresql://...
N8N_DB_SCHEMA=n8n
N8N_ENCRYPTION_KEY=una-clave-larga-y-estable
```

Nota importante:

- el primer despliegue con Neon no puede rescatar automaticamente el SQLite efimero anterior
- a partir de que importes el workflow una vez en la base `Neon`, ya queda persistente

## Simulacion de Render Free

Hay un simulador local que ejecuta el pipeline dentro de Docker con:

- `512 MB`
- `0.10 CPU`

Comando:

```bash
npm run simulate:render
```

Genera artefactos en:

- `tmp/render-free-sim/container.log`
- `tmp/render-free-sim/stats.json`
- `tmp/render-free-sim/summary.json`

Sirve para ver:

- donde cae el proceso
- uso de memoria del contenedor
- si el MP4 final se llego a construir

## Pexels

El nodo ahora esta optimizado para consumir menos memoria:

- limita queries y resultados
- elige ficheros mas cercanos a la resolucion objetivo
- descarga clips en streaming a disco
- registra errores por query y por descarga

Variables utiles:

- `PEXELS_QUERY_LIMIT`
- `PEXELS_PER_PAGE`
- `PEXELS_TARGET_WIDTH`
- `PEXELS_SEARCH_TIMEOUT_MS`
- `PEXELS_DOWNLOAD_TIMEOUT_MS`

## Neon

Usa la connection string completa:

```text
NEON_DATABASE_URL=postgresql://...
```

Fuente oficial:

- https://neon.com/docs/connect/connect-from-any-app

## Desarrollo local

```bash
npm install
npm run check
npm start
```

Prueba por pasos:

```bash
node scripts/select-fact-topic.js ./tmp/bot-videos/topic.json
node scripts/generate-script.js ./tmp/bot-videos/script.json ./tmp/bot-videos/topic.json
node scripts/generate-voice.js ./tmp/bot-videos/script.json ./tmp/bot-videos/narration.wav
node scripts/generate-subtitles.js ./tmp/bot-videos/script.json ./tmp/bot-videos/narration.wav ./tmp/bot-videos/subtitles.srt
node scripts/fetch-pexels.js ./tmp/bot-videos/script.json ./tmp/bot-videos/clips
bash scripts/build-short.sh ./tmp/bot-videos/final.mp4 ./tmp/bot-videos/narration.wav ./tmp/bot-videos/clips ./tmp/bot-videos/subtitles.srt
node scripts/upload-youtube.js ./tmp/bot-videos/final.mp4 ./tmp/bot-videos/script.json ./tmp/bot-videos/youtube-result.json
node scripts/finalize-content.js ./tmp/bot-videos/script.json ./tmp/bot-videos/youtube-result.json
```

## Notas

- el workflow esta orientado a `facts only`
- no mete CTA de portfolio ni de servicios
- la subida a YouTube queda en `private` por defecto mientras pruebas

