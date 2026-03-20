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
- `Neon` guarda historial y evita reutilizar topics
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

- `VIDEO_DEFAULT_DURATION_SECONDS=15`
- `PEXELS_CLIPS_COUNT=1`

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

