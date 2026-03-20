# Bot de Videos

Sistema automatizado para generar y publicar videos cortos con `n8n`, `OpenAI`, `ElevenLabs`, `Pexels`, `FFmpeg` y despliegue en `Render`.

## Arquitectura

- `n8n` orquesta el workflow completo.
- `OpenAI` genera ideas y guiones.
- `ElevenLabs` genera la narracion.
- `Pexels` aporta clips o imagenes de apoyo.
- `FFmpeg` monta el video vertical final.
- `YouTube` y `TikTok` reciben la publicacion automatica.
- Un proxy Node.js expone `GET /health`, mantiene vivo Render y reenvia el resto del trafico a `n8n`.

## Estructura

- `services/render-proxy.js`: proxy HTTP + keep-alive + arranque de `n8n`.
- `scripts/build-short.sh`: script reutilizable para el montaje del video en vertical.
- `workflows/shorts-automation.template.json`: workflow base para importar y adaptar en `n8n`.
- `render.yaml`: blueprint listo para desplegar en Render.
- `.env.example`: variables necesarias.

## Flujo previsto

1. `Schedule Trigger` dispara la automatizacion.
2. `Set` define el tema, CTA y duracion objetivo.
3. `HTTP Request` llama a OpenAI para generar el guion.
4. `HTTP Request` llama a ElevenLabs para sintetizar el audio.
5. `HTTP Request` consulta Pexels y descarga clips.
6. `Execute Command` usa `scripts/build-short.sh`.
7. `HTTP Request` o credenciales OAuth suben el resultado a YouTube.
8. `HTTP Request` o integracion equivalente publican en TikTok.

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

## Notas

- Las subidas a YouTube y TikTok requieren credenciales reales y posiblemente aprobacion de scopes en cada plataforma.
- El workflow incluido es una plantilla operativa; debes ajustar IDs de credenciales, prompts y rutas segun tu cuenta y tu estrategia de contenido.

