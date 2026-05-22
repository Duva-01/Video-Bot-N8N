# The Hidden Thread Automation

Base nueva para operar un canal faceless en ingles centrado en `history, science and technology documentary essays`, con `n8n` como orquestador, `Neon` como persistencia y entrega final a `Backblaze B2` para revision manual antes de subir a `YouTube`.

## Objetivo

Construir un sistema que haga esto:

1. elegir un tema dentro de un nicho fijo
2. evitar repeticiones de topic y angulo
3. investigar y estructurar el episodio
4. generar guion largo en ingles
5. generar voz principal
6. generar musica de fondo instrumental
7. montar storyboard, captions y thumbnail brief
8. renderizar el video final
9. entregar el paquete completo en `Backblaze B2`
10. dejarte el upload manual a `YouTube`

## Por que el upload es manual

La subida final a `YouTube` se deja manual por tres motivos:

- control editorial final
- menos friccion con OAuth
- misma calidad de video si subes el `.mp4` original generado

Si el workflow deja el archivo final en `Drive` y tu subes ese mismo archivo a `YouTube`, no pierdes calidad.

## Arquitectura recomendada

```text
Render
  -> n8n self-hosted
  -> scheduler
  -> webhooks
  -> llamadas a APIs externas

Neon PostgreSQL
  -> workflows de n8n
  -> historial editorial
  -> runs, escenas, assets y subtitulos

APIs externas
  -> OpenAI para research, outline, script y STT
  -> ElevenLabs para voz
  -> Eleven Music para fondo instrumental
  -> Creatomate para render final
  -> Backblaze B2 para entrega final

YouTube
  -> subida manual del archivo final
```

## Stack actual recomendado

- `OpenAI` para research, outline, script y subtitulos con timestamps
- `ElevenLabs` para la voz principal
- `Eleven Music` para la musica instrumental
- `Creatomate` para el render
- `Backblaze B2` para la entrega final
- `Runway` como opcional para hero shots concretos

## Identidad del canal

Canal recomendado:

- `The Hidden Thread`

Promesa editorial:

- documentales largos que explican como decisiones, sistemas y consecuencias ocultas moldean la historia, la ciencia y la tecnologia

La identidad visual no debe parecer generada por IA. Debe parecer editorial.

## Estructura del repo

```text
backend/
  .env.example
  db/
    schema.sql
  workflows/
    youtube-longform-daily.blueprint.md
    youtube-longform-daily.n8n.json

docs/
  channel-identity.md
  channel-strategy-and-monetization.md
  professional-video-stack.md
  workflow-youtube-longform.md

frontend/
  index.html

.github/workflows/
  keep-render-awake.yml
  trigger-daily-video.yml

Dockerfile
render.yaml
README.md
```

## Variables de entorno

`.env` debe contener solo secretos:

- claves API
- tokens OAuth
- contraseñas
- secretos de n8n

La configuracion funcional del canal debe vivir dentro del workflow:

- duracion
- nicho
- idioma
- estilo visual
- estilo de subtitulos
- estrategia editorial

Plantilla:

- [`.env`](</c:/Users/Usuario/Desktop/Personal/Proyectos/Automatizaciones/Bot de Videos/.env:1>)

## Workflow base

Workflow importable:

- [backend/workflows/youtube-longform-daily.n8n.json](C:/Users/Usuario/Desktop/Personal/Proyectos/Automatizaciones/Bot%20de%20Videos/backend/workflows/youtube-longform-daily.n8n.json:1)

Blueprint funcional:

- [backend/workflows/youtube-longform-daily.blueprint.md](C:/Users/Usuario/Desktop/Personal/Proyectos/Automatizaciones/Bot%20de%20Videos/backend/workflows/youtube-longform-daily.blueprint.md:1)

Documentacion de estrategia:

- [docs/channel-identity.md](C:/Users/Usuario/Desktop/Personal/Proyectos/Automatizaciones/Bot%20de%20Videos/docs/channel-identity.md:1)
- [docs/channel-strategy-and-monetization.md](C:/Users/Usuario/Desktop/Personal/Proyectos/Automatizaciones/Bot%20de%20Videos/docs/channel-strategy-and-monetization.md:1)
- [docs/professional-video-stack.md](C:/Users/Usuario/Desktop/Personal/Proyectos/Automatizaciones/Bot%20de%20Videos/docs/professional-video-stack.md:1)

## Primer arranque en n8n

1. crea el owner user
2. entra en `Workflows`
3. importa el JSON:
   - `backend/workflows/youtube-longform-daily.n8n.json`
4. ejecuta el workflow una vez con `Manual Trigger`
5. revisa la salida final del nodo `Finalize Delivery Package`
6. luego conecta integraciones reales una a una

## Trigger diario por GitHub Actions

Workflow:

- [.github/workflows/trigger-daily-video.yml](C:/Users/Usuario/Desktop/Personal/Proyectos/Automatizaciones/Bot%20de%20Videos/.github/workflows/trigger-daily-video.yml:1)

Secret requerido en GitHub:

- `N8N_DAILY_TRIGGER_URL`

Valor esperado:

- `https://your-service.onrender.com/webhook/youtube-longform-daily-trigger`

## Orden correcto de conexion

1. `Research LLM Placeholder`
2. `Outline LLM Placeholder`
3. `Script LLM Placeholder`
4. `Voiceover Placeholder`
5. `Background Music Placeholder`
6. `Subtitle Timing Placeholder`
7. `Render Placeholder`
8. `Backblaze B2 Delivery Placeholder`

No conectes todo a la vez en la primera prueba.

## Lo que este repo ya contempla

- nicho fijo
- canal en ingles
- identidad editorial
- anti-repeticion por topic y angulo
- musica de fondo
- captions con timing por palabra
- render para video largo
- entrega manual en `Drive`

## Lo que sigue faltando aunque la base ya sea correcta

- credenciales reales dentro de `n8n`
- plantilla real de `Creatomate`
- bucket destino en `Backblaze B2`
- backlog editorial real en base de datos
- miniatura final automatizada o semiautomatizada
- revision manual antes de subir a `YouTube`
