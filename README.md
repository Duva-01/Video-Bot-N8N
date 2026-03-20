# Bot de Videos

Sistema automatizado para generar y publicar videos cortos de `facts` y `hechos curiosos` con `n8n`, `Gemini`, `Pexels`, `FFmpeg`, `Neon` y despliegue en `Render`.

## Arquitectura

- `n8n` orquesta el workflow completo.
- `Gemini` genera ideas, guiones y narracion.
- `Pexels` aporta clips o imagenes de apoyo.
- `FFmpeg` monta el video vertical final.
- `Neon` guarda historial para evitar repetir topics.
- `YouTube` y `TikTok` reciben la publicacion automatica.
- Un proxy Node.js expone `GET /health`, mantiene vivo Render y reenvia el resto del trafico a `n8n`.

## Estructura

- `services/render-proxy.js`: proxy HTTP + keep-alive + arranque de `n8n`.
- `scripts/build-short.sh`: script reutilizable para el montaje del video en vertical.
- `scripts/generate-script.js`: genera guion estructurado con Gemini y lo guarda en JSON.
- `scripts/generate-voice.js`: sintetiza la narracion con Gemini TTS y la guarda en WAV.
- `scripts/generate-subtitles.js`: crea subtitulos `.srt` a partir de la narracion.
- `scripts/fetch-pexels.js`: busca y descarga clips verticales desde Pexels.
- `scripts/select-fact-topic.js`: elige un topic de facts y evita repeticiones si Neon esta configurado.
- `scripts/finalize-content.js`: actualiza el historial en Neon con el resultado final.
- `scripts/upload-youtube.js`: subida a YouTube con OAuth usando `googleapis`.
- `scripts/upload-tiktok.js`: subida a TikTok usando Content Posting API si la app y scopes estan aprobados.
- `workflows/shorts-automation.template.json`: workflow base para importar y adaptar en `n8n`.
- `render.yaml`: blueprint listo para desplegar en Render.
- `.env`: variables necesarias para importar en Render desde tu maquina local.
- `data/fact-topics.json`: catalogo base de topics para facts.

## Flujo previsto

1. `Schedule Trigger` o `Manual Trigger` dispara la automatizacion.
2. `Select Fact Topic` elige un topic curioso y evita repeticiones si hay Neon.
3. `Generate Script` crea el guion, titulo y keywords.
4. `Generate Voice` genera la narracion.
5. `Generate Subtitles` crea subtitulos `.srt`.
6. `Fetch Pexels` descarga clips.
7. `Build Video` monta el video vertical final con subtitulos.
8. `YouTube Upload` sube el resultado.
9. `TikTok Upload` intenta la subida si la app esta aprobada.
10. `Finalize Content` guarda el resultado en Neon.

## Keep-alive para Render

Render en free tier puede dormir el servicio si no recibe trafico. Este repositorio resuelve eso con dos capas:

- `GET /health` responde directamente desde Node.js.
- Un proceso interno hace ping cada 5 minutos a `WEBHOOK_URL/health`.

Tambien es recomendable usar un servicio externo como `UptimeRobot` apuntando a:

```text
https://tu-app.onrender.com/health
```

## Despliegue en Render

1. Crea un Web Service desde este repositorio.
2. Usa el `Dockerfile` incluido, basado en `n8nio/n8n:latest-debian` para permitir `ffmpeg`, `bash` y `Execute Command`.
3. Importa las variables de entorno desde tu archivo `.env`.
4. Ajusta `WEBHOOK_URL` al dominio real de Render.
5. Ajusta `N8N_EDITOR_BASE_URL` al mismo dominio publico y usa `N8N_PROXY_HOPS=1` al estar detras del proxy de Render.
6. Importa el workflow plantilla en `n8n` y completa credenciales/OAuth.

Variables recomendadas para YouTube:

- `YOUTUBE_CLIENT_ID`
- `YOUTUBE_CLIENT_SECRET`
- `YOUTUBE_REFRESH_TOKEN`
- `YOUTUBE_PRIVACY_STATUS`
- `YOUTUBE_CATEGORY_ID`
- `YOUTUBE_DEFAULT_TITLE`
- `YOUTUBE_DEFAULT_DESCRIPTION`
- `YOUTUBE_DEFAULT_TAGS`

Variables recomendadas para generacion:

- `TEXT_PROVIDER`
- `TTS_PROVIDER`
- `GEMINI_API_KEY`
- `GEMINI_TEXT_MODEL`
- `GEMINI_TTS_MODEL`
- `GEMINI_TTS_VOICE`
- `OPENAI_API_KEY`
- `OPENAI_MODEL`
- `VIDEO_DEFAULT_TOPIC`
- `VIDEO_DEFAULT_DURATION_SECONDS`
- `VIDEO_DEFAULT_CTA`
- `VIDEO_DEFAULT_STYLE`
- `VIDEO_DEFAULT_LANGUAGE`
- `FACT_ALLOWED_CATEGORIES`
- `NEON_DATABASE_URL`
- `PEXELS_API_KEY`
- `PEXELS_CLIPS_COUNT`

`OpenAI` y `ElevenLabs` siguen contemplados como fallback de pago, pero la configuracion por defecto del proyecto queda en `Gemini`.

Para `Render Free`, usa valores conservadores:

- `VIDEO_DEFAULT_DURATION_SECONDS=15`
- `PEXELS_CLIPS_COUNT=1`

## Neon

Neon es la opcion recomendada para evitar repetir videos. Segun la documentacion oficial, la forma estandar de conectar una app es copiar la `connection string` desde la consola de Neon y usarla como `DATABASE_URL` o variable equivalente. Neon recomienda por defecto la cadena con `pooler` y `sslmode=require`.

En este proyecto usa:

- `NEON_DATABASE_URL=postgresql://...`

Fuente oficial:

- https://neon.com/docs/connect/connect-from-any-app

## TikTok

La Content Posting API de TikTok existe, pero no es libre de restricciones. La documentacion oficial indica que:

- necesitas una app registrada
- necesitas aprobacion del scope `video.publish`
- el usuario final debe autorizar ese scope
- los clientes no auditados publican solo en modo `private`

Este repositorio deja la subida a TikTok implementada en modo `best effort`, pero no se considera cerrada hasta tener:

- `TIKTOK_ACCESS_TOKEN`
- la app aprobada para `video.publish`

Fuente oficial:

- https://developers.tiktok.com/doc/content-posting-api-get-started/

## Desarrollo local

Instalacion:

```bash
npm install
```

Comprobacion rapida:

```bash
npm run check
```

Arranque local:

```bash
npm start
```

La aplicacion publica escuchara en `N8N_PORT` y `n8n` correra internamente en `N8N_INTERNAL_PORT`.

Prueba local de subida a YouTube:

```bash
node scripts/upload-youtube.js "C:\\ruta\\a\\video.mp4"
```

Prueba local del pipeline por pasos:

```bash
node scripts/generate-script.js ./tmp-output/script.json
node scripts/generate-voice.js ./tmp-output/script.json ./tmp-output/narration.wav
node scripts/generate-subtitles.js ./tmp-output/script.json ./tmp-output/narration.wav ./tmp-output/subtitles.srt
node scripts/fetch-pexels.js ./tmp-output/script.json ./tmp-output/clips
bash scripts/build-short.sh ./tmp-output/final.mp4 ./tmp-output/narration.wav ./tmp-output/clips ./tmp-output/subtitles.srt
node scripts/upload-youtube.js ./tmp-output/final.mp4 ./tmp-output/script.json ./tmp-output/youtube-result.json
node scripts/upload-tiktok.js ./tmp-output/final.mp4 ./tmp-output/script.json ./tmp-output/tiktok-result.json
node scripts/finalize-content.js ./tmp-output/script.json ./tmp-output/youtube-result.json ./tmp-output/tiktok-result.json
```

## FFmpeg

El script `scripts/build-short.sh` espera:

```bash
bash /app/scripts/build-short.sh <output.mp4> <narration.mp3> <clips_dir> [subtitles.srt]
```

Comportamiento:

- concatena los clips disponibles
- adapta a formato `1080x1920`
- sincroniza con la narracion
- inserta subtitulos opcionales
- escribe logs claros y falla con errores explicitos

## Reintentos y logging

- Los nodos HTTP del workflow plantilla ya incluyen reintentos.
- El proxy escribe logs de arranque, health-check y keep-alive.
- El script de FFmpeg valida entradas antes de procesar.
- Los scripts de Gemini y Pexels escriben logs simples por cada paso y fallan con mensajes utiles.
- Los subtitulos se generan automaticamente en formato `.srt`.
- Neon se usa para evitar topics repetidos cuando `NEON_DATABASE_URL` esta configurado.
- La subida a YouTube usa la libreria oficial de Google y falla con errores claros si faltan credenciales o el fichero final no existe.

## Notas

- Las subidas a YouTube y TikTok requieren credenciales reales y posiblemente aprobacion de scopes en cada plataforma.
- El workflow incluido es una plantilla operativa; debes ajustar IDs de credenciales, prompts y rutas segun tu cuenta y tu estrategia de contenido.
- La subida a YouTube queda en `private` por defecto mientras pruebas el flujo completo.
- La subida a TikTok puede quedar limitada a `SELF_ONLY/private` hasta que la app pase la auditoria de TikTok.
