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
- solo elige topics no usados
- cuando se agota el catalogo actual, falla de forma explicita

Eso evita repeticiones silenciosas. Si quieres mas volumen, amplias `data/fact-topics.json`.

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
node scripts/select-fact-topic.js ./tmp-output/topic.json
node scripts/generate-script.js ./tmp-output/script.json ./tmp-output/topic.json
node scripts/generate-voice.js ./tmp-output/script.json ./tmp-output/narration.wav
node scripts/generate-subtitles.js ./tmp-output/script.json ./tmp-output/narration.wav ./tmp-output/subtitles.srt
node scripts/fetch-pexels.js ./tmp-output/script.json ./tmp-output/clips
bash scripts/build-short.sh ./tmp-output/final.mp4 ./tmp-output/narration.wav ./tmp-output/clips ./tmp-output/subtitles.srt
node scripts/upload-youtube.js ./tmp-output/final.mp4 ./tmp-output/script.json ./tmp-output/youtube-result.json
node scripts/finalize-content.js ./tmp-output/script.json ./tmp-output/youtube-result.json
```

## Notas

- el workflow esta orientado a `facts only`
- no mete CTA de portfolio ni de servicios
- la subida a YouTube queda en `private` por defecto mientras pruebas
