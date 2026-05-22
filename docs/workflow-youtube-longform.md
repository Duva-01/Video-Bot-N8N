# Workflow Diario Para YouTube Longform

## Objetivo

Diseñar un workflow de `n8n` que publique `1 video diario` de `38 minutos` con una calidad suficiente para un canal faceless educativo, documental o de curiosidades.

## Principio de diseño

Para esta longitud, el sistema no debe pensar en `un video`, sino en:

- un `tema`
- un `outline`
- un conjunto de `capitulos`
- un conjunto de `escenas`
- una `narracion`
- una `capa visual`
- un `render final`

## Recomendacion de producto

Para un primer canal automatizado, el formato mas razonable es:

- voz en off
- apoyo visual mixto
- stock video
- imagenes generadas
- graficos simples
- subtitulos ligeros
- capitulos internos

No recomiendo que el MVP intente generar `38 minutos` enteros de video AI cinematografico clip a clip. Sale caro, lento y fragil.

## Workflow propuesto

```text
Schedule Trigger
  -> Select Topic
  -> Research Pack
  -> Generate Outline
  -> Generate Script
  -> Split Into Chapters
  -> Split Into Scenes
  -> Generate Voiceover
  -> Generate Visual Plan
  -> Fetch / Generate Assets
  -> Build Chapter Packages
  -> Render Video
  -> Quality Checks
  -> Upload To YouTube
  -> Persist Results
  -> Notify
```

## Fases del workflow

### 1. Intake

Entrada del dia:

- topic principal
- tipo de video
- idioma
- duracion objetivo
- tono
- canal

Salidas:

- `run_id`
- `topic_id`
- estado `queued`

### 2. Research

El workflow consulta:

- fuentes web o RSS
- notas propias
- base de temas pendientes
- prompt de contexto del canal

Salida:

- dossier JSON con hechos, fuentes, angulos y palabras clave

### 3. Outline

El LLM genera:

- hook inicial
- promesa del video
- 6 a 10 capitulos
- CTA final

Reglas:

- cada capitulo debe tener objetivo de retencion
- evitar repeticiones
- incluir ritmo narrativo

### 4. Script largo

El guion se genera por bloques:

- intro
- capitulos
- cierre

Salida:

- guion completo
- titulo provisional
- descripcion provisional
- timestamps sugeridos

### 5. Segmentacion

El guion se divide en escenas de `8` a `20` segundos.

Cada escena lleva:

- `scene_id`
- narracion
- keywords
- visual type
- fuente visual esperada
- prompt si hay generacion AI

### 6. Audio

Generar narracion:

- por capitulo o por escenas
- no generar un unico archivo inmenso desde el principio

Esto permite:

- reintentos mas baratos
- corregir bloques concretos
- versionado por escena

### 7. Plan visual

Cada escena se clasifica como una de estas:

- `stock_video`
- `stock_image`
- `ai_image`
- `ai_video`
- `text_slide`
- `data_card`

Regla clave:

- reservar `ai_video` solo para escenas importantes
- usar `stock` y `slides` para abaratar y acelerar

### 8. Asset generation

Por cada escena:

- buscar stock
- si falla, generar imagen
- si la escena lo merece, generar clip AI corto
- guardar URLs y metadatos

### 9. Render

MVP recomendado:

- render externo por API
- ensamblado basado en timeline

Alternativa:

- worker propio con `ffmpeg`

No recomiendo renderizar localmente un video de `38 minutos` en un servicio pequeno de `Render` si quieres estabilidad diaria.

### 10. Quality gate

Checks minimos:

- duracion dentro de rango
- audio presente
- no faltan assets
- titulo y descripcion no vacios
- thumbnail generada

Si falla:

- marcar run como `needs_review`
- avisar por email, Telegram o Discord

### 11. Publicacion

Subida a YouTube:

- video
- titulo
- descripcion
- tags
- miniatura
- programacion

### 12. Persistencia

Guardar:

- run
- escenas
- assets
- prompts
- costes
- tiempos
- URL final
- errores

## Nodos de n8n recomendados

- `Schedule Trigger`
- `Manual Trigger`
- `Webhook`
- `Set`
- `HTTP Request`
- `Code`
- `Split Out`
- `Loop Over Items`
- `If`
- `Wait`
- `Merge`
- `Respond to Webhook`

## Estado de negocio sugerido

```text
draft
research_ready
outline_ready
script_ready
audio_ready
assets_ready
rendering
rendered
uploading
published
failed
needs_review
```

## Tablas sugeridas

- `channels`
- `content_runs`
- `content_chapters`
- `content_scenes`
- `content_assets`
- `publish_jobs`
- `workflow_events`

## MVP realista

Fase 1:

- 1 canal
- 1 video diario
- 1 idioma
- tema semi-controlado
- revision manual opcional antes de publicar

Fase 2:

- autopublicacion completa
- thumbnails dinamicas
- A/B de titulos
- reutilizacion de assets
- varios canales

## Inspiracion tomada del workflow de referencia

La idea util del workflow publico que pasaste no es copiarlo tal cual, sino quedarnos con su patron:

- trigger diario
- varias etapas AI
- ensamblado por bloques
- publicacion automatica
- tracking final

Para longform, la diferencia principal es que aqui hace falta una capa intermedia fuerte de `outline -> chapters -> scenes`, que en shorts suele ser mucho menos exigente.
