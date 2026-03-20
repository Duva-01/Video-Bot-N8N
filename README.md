# Bot de Videos

Sistema automatizado para generar y publicar videos cortos con `n8n`, `Gemini`, `Pexels`, `FFmpeg` y despliegue en `Render`.

## Arquitectura

- `n8n` orquesta el workflow completo.
- `Gemini` genera ideas, guiones y narracion.
- `Pexels` aporta clips o imagenes de apoyo.
- `FFmpeg` monta el video vertical final.
- `YouTube` y `TikTok` reciben la publicacion automatica.
- Un proxy Node.js expone `GET /health`, mantiene vivo Render y reenvia el resto del trafico a `n8n`.

## Estructura

- `services/render-proxy.js`: proxy HTTP + keep-alive + arranque de `n8n`.
- `scripts/build-short.sh`: script reutilizable para el montaje del video en vertical.
- `scripts/generate-script.js`: genera guion estructurado con Gemini y lo guarda en JSON.
- `scripts/generate-voice.js`: sintetiza la narracion con Gemini TTS y la guarda en WAV.
- `scripts/fetch-pexels.js`: busca y descarga clips verticales desde Pexels.
- `scripts/upload-youtube.js`: subida a YouTube con OAuth usando `googleapis`.
- `workflows/shorts-automation.template.json`: workflow base para importar y adaptar en `n8n`.
- `render.yaml`: blueprint listo para desplegar en Render.
- `.env.example`: variables necesarias.

## Flujo previsto

1. `Schedule Trigger` dispara la automatizacion.
2. `Set` define el tema, CTA y duracion objetivo.
3. `Execute Command` usa `scripts/generate-script.js` para generar un JSON con guion, titulo y keywords.
4. `Execute Command` usa `scripts/generate-voice.js` para sintetizar el audio.
5. `Execute Command` usa `scripts/fetch-pexels.js` para descargar clips.
6. `Execute Command` usa `scripts/build-short.sh`.
7. `Execute Command` usa `scripts/upload-youtube.js` para subir el resultado a YouTube.
8. `TikTok` queda como siguiente integracion.

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
2. Usa el `Dockerfile` incluido.
3. Configura las variables de entorno de `.env.example`.
4. Ajusta `WEBHOOK_URL` al dominio real de Render.
5. Importa el workflow plantilla en `n8n` y completa credenciales/OAuth.

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
- `PEXELS_API_KEY`
- `PEXELS_CLIPS_COUNT`

`OpenAI` y `ElevenLabs` siguen contemplados como fallback de pago, pero la configuracion por defecto del proyecto queda en `Gemini`.

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
node scripts/fetch-pexels.js ./tmp-output/script.json ./tmp-output/clips
bash scripts/build-short.sh ./tmp-output/final.mp4 ./tmp-output/narration.wav ./tmp-output/clips
node scripts/upload-youtube.js ./tmp-output/final.mp4
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
- La subida a YouTube usa la libreria oficial de Google y falla con errores claros si faltan credenciales o el fichero final no existe.

## Notas

- Las subidas a YouTube y TikTok requieren credenciales reales y posiblemente aprobacion de scopes en cada plataforma.
- El workflow incluido es una plantilla operativa; debes ajustar IDs de credenciales, prompts y rutas segun tu cuenta y tu estrategia de contenido.
- La subida a YouTube queda en `private` por defecto mientras pruebas el flujo completo.
