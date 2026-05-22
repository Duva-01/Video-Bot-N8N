# YouTube Longform Automation

Base nueva para montar un canal de YouTube automatizado que publique `1 video diario` de aproximadamente `38 minutos`, orquestado con `n8n`, persistencia en `PostgreSQL/Neon` y despliegue simple sobre `Render` + `Cloudflare Pages`.

## Objetivo

Construir un sistema que haga esto de extremo a extremo:

1. elegir una idea o tema del dia
2. investigar y estructurar el contenido
3. generar guion largo con buena retencion
4. partirlo en bloques y escenas
5. generar narracion
6. conseguir visuales
7. renderizar el video final
8. subirlo a YouTube
9. guardar estado, errores y metricas en base de datos

## Realidad tecnica

`Backend + base de datos` si bastan para la orquestacion.

`Backend + base de datos` no bastan si quieres renderizar localmente un video diario de 38 minutos con calidad alta dentro de un runtime pequeno. Para eso hay dos caminos:

- usar servicios externos de generacion/render de video y dejar `n8n` como orquestador
- montar un worker separado de render con mas CPU, RAM y almacenamiento temporal

Este repo arranca con la primera opcion como `MVP recomendado`.

## Arquitectura recomendada

```text
Cloudflare Pages
  -> landing / panel basico

Render
  -> n8n self-hosted
  -> webhooks
  -> scheduler
  -> llamadas a APIs externas

Neon PostgreSQL
  -> workflows de n8n
  -> historial de ejecuciones
  -> tablas de negocio del canal

YouTube Data API
  -> subida y programacion

APIs externas
  -> LLM para research + guion
  -> TTS para narracion
  -> stock / imagen / video
  -> render externo o ensamblado final
```

## Stack inicial

- `n8n` self-hosted con imagen oficial `stable`
- `PostgreSQL` en `Neon`
- `Render` para la instancia principal
- `Cloudflare Pages` para frontend opcional
- `YouTube Data API` para publicar

## Estructura inicial

```text
backend/
  .env.example
  README.md
  db/
    schema.sql
  workflows/
    youtube-longform-daily.blueprint.md

docs/
  workflow-youtube-longform.md

frontend/
  README.md
  index.html

.github/workflows/
  keep-render-awake.yml

.dockerignore
Dockerfile
render.yaml
README.md
```

## Decisiones de esta fase

- no rehacer el proyecto antiguo
- usar `n8n` desde cero
- dejar un `blueprint` claro del workflow antes de meternos a nodos finales
- separar orquestacion de render pesado
- dejar el frontend como opcional
- dejar `.env` solo para secretos
- mover la configuracion funcional al propio workflow

## Variables de entorno

En esta base nueva, `.env` debe contener solo:

- claves API
- tokens
- secretos
- credenciales

La configuracion funcional como:

- duracion objetivo
- idioma
- nicho
- hora de publicacion
- modelo por defecto
- estrategia visual

debe vivir dentro del workflow de `n8n`, no en `.env`.

## Siguientes pasos practicos

1. levantar `n8n` con Neon y validar login
2. crear las tablas de negocio del canal
3. implementar el workflow diario en `n8n`
4. decidir proveedor de narracion y de render
5. probar con videos de `8-12 minutos` antes de saltar a `38`
6. escalar a `38 minutos` cuando el coste, los tiempos y la calidad esten medidos

## Workflow base

Workflow importable inicial:

- [youtube-longform-daily.n8n.json](C:/Users/Usuario/Desktop/Personal/Proyectos/Automatizaciones/Bot%20de%20Videos/backend/workflows/youtube-longform-daily.n8n.json)

Blueprint funcional:

- [youtube-longform-daily.blueprint.md](C:/Users/Usuario/Desktop/Personal/Proyectos/Automatizaciones/Bot%20de%20Videos/backend/workflows/youtube-longform-daily.blueprint.md)

## Nota importante

El objetivo de `38 minutos diarios` es viable como sistema, pero no es un flujo trivial si de verdad quieres calidad. Lo correcto es tratarlo como una `content factory` por escenas, no como un simple script que junta clips al final.
