# Workflow Diario Para The Hidden Thread

## Objetivo

Diseñar un workflow de `n8n` que produzca `1 documental largo diario` de `38 minutos` para un canal en ingles con identidad editorial, y que deje el paquete final en `Backblaze B2`.

## Principio de diseño

Para esta longitud, el sistema no debe pensar en `un video`.

Debe pensar en:

- un `topic`
- un `angle`
- un `outline`
- un conjunto de `chapters`
- un conjunto de `scenes`
- una `voiceover layer`
- una `music layer`
- una `caption layer`
- un `render final`
- un `delivery package`

## Workflow propuesto

```text
Schedule Trigger
  -> Build Channel Brand And Run Context
  -> Editorial Guard And Uniqueness
  -> Research
  -> Outline
  -> Script
  -> Build Visual Storyboard
  -> Generate Voiceover
  -> Generate Background Music
  -> Align Subtitles
  -> Build Thumbnail Brief
  -> Render Video
  -> Build Drive Delivery Package
  -> Upload To Backblaze B2
  -> Final QA
```

## Criterio de producto

El workflow no esta pensado para parecer un canal de IA.

Esta pensado para parecer:

- documental
- editorial
- premium
- sobrio

## Fases del workflow

### 1. Contexto de canal

Debe fijar:

- nombre del canal
- idioma
- nicho
- tono
- paleta y estilo

### 2. Anti-repeticion

Debe consultar:

- historial de videos
- backlog editorial
- angulos usados

### 3. Research

Debe devolver:

- fresh angle
- source plan
- retention hooks
- monetization risks

### 4. Outline

Debe devolver:

- hook
- promise
- 8 chapters
- CTA final

### 5. Script

Debe devolver:

- titulo
- descripcion
- tags
- narracion por capitulo

### 6. Storyboard

Debe convertir el guion en:

- escenas
- tipo visual
- timing estimado
- movimiento
- transicion

### 7. Audio

Dos capas:

- `ElevenLabs` para voz
- `Eleven Music` para musica de fondo

### 8. Subtitulos

Debe usar:

- retranscripcion del audio final
- timestamps por palabra

### 9. Render

Debe usar:

- `Creatomate`

Debe incluir:

- captions
- chapter cards
- lower thirds
- motion sutil
- mezcla de voz y musica

### 10. Delivery

Debe dejar en `Backblaze B2`:

- video
- miniatura
- metadata
- subtitulos
- checklist de publicacion

## Regla operativa importante

No hace falta automatizar la subida final a `YouTube`.

Lo correcto aqui es:

1. producir
2. revisar
3. subir manualmente

## Estado de negocio sugerido

```text
draft
research_ready
outline_ready
script_ready
audio_ready
subtitles_ready
rendering
rendered
delivered_to_b2
needs_review
published
failed
```
