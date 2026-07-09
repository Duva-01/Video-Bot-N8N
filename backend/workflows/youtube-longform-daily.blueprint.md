# Blueprint: The Hidden Thread Daily Delivery

## Objetivo del workflow

Generar un episodio diario largo en ingles para `The Hidden Thread`, con tono documental premium y entrega final a `Backblaze B2` para revision manual antes de subir a `YouTube`.

## Principios del sistema

- un solo nicho fuerte
- un solo tono de canal
- nada de contenido random
- nada de visuales de stock cutres como base
- nada de subida automatica a YouTube sin revision

## Workflow canvas

```text
[Manual Trigger] ----\
[Schedule Trigger] --\
[Webhook Trigger] ----> [Build Channel Brand And Run Context]
                              |
                              v
                 [Editorial Guard And Uniqueness]
                              |
                              v
                      [Research LLM Placeholder]
                              |
                              v
                     [Parse Or Mock Research]
                              |
                              v
                       [Outline LLM Placeholder]
                              |
                              v
                      [Parse Or Mock Outline]
                              |
                              v
                        [Script LLM Placeholder]
                              |
                              v
                      [Parse Or Mock Script]
                              |
                              v
                      [Build Visual Storyboard]
                              |
                              v
                        [Voiceover Placeholder]
                              |
                              v
                   [Background Music Placeholder]
                              |
                              v
                    [Subtitle Timing Placeholder]
                              |
                              v
                     [Parse Or Mock Subtitles]
                              |
                              v
                      [Build Thumbnail Brief]
                              |
                              v
                         [Render Placeholder]
                              |
                              v
                  [Build Drive Delivery Package]
                              |
                              v
                 [Backblaze B2 Delivery Placeholder]
                              |
                              v
                    [Finalize Delivery Package]
```

## Salida esperada

Cada run debe producir un paquete entregable:

- `video.mp4`
- `thumbnail.png`
- `title.txt`
- `description.txt`
- `tags.json`
- `chapters.txt`
- `subtitles.srt`
- `publication-checklist.md`

## Capa editorial

### Build Channel Brand And Run Context

Debe fijar:

- canal: `The Hidden Thread`
- idioma: `en`
- duracion objetivo: `38 minutos`
- nicho: `history, science and technology documentary essays`
- tono: `calm premium documentary`

### Editorial Guard And Uniqueness

Debe impedir:

- repetir `canonical_topic` en 180 dias
- repetir el mismo `angle`
- usar hooks sensacionalistas baratos
- sacar un video fuera del nicho

## Capa de contenido

### Research

Provider:

- `OpenAI`

Debe devolver:

- angulo fresco
- plan de fuentes
- checkpoints factuales
- riesgos de monetizacion
- hooks de retencion

### Outline

Debe devolver:

- `workingTitle`
- `hook`
- `promise`
- `cta`
- `8 chapters`

### Script

Debe devolver:

- titulo final
- descripcion
- tags
- guion por capitulos
- notas de seguridad para monetizacion

## Capa audiovisual

### Voiceover

Provider:

- `ElevenLabs`

Regla:

- generar por capitulo
- no generar el episodio entero en una sola llamada

### Background music

Provider:

- `Eleven Music`

Regla:

- solo instrumental
- mezcla suave
- sin vocals
- sin estilo trailer exagerado

### Subtitles

Provider:

- `OpenAI Speech-to-Text`

Regla:

- `word-level timestamps`
- captions legibles
- enfasis en palabras clave

### Render

Provider:

- `Creatomate`

Debe incluir:

- chapter cards
- lower thirds
- captions animados
- musica con ducking
- zooms y paneos suaves
- transiciones discretas

No hace falta llenar el video de transiciones llamativas.

Si hace falta movimiento visual controlado.

## Delivery

Provider:

- `Backblaze B2`

Regla:

- el sistema entrega
- tu revisas
- tu subes manualmente a YouTube

## Regla de calidad

Si el flujo no puede producir un episodio con nivel minimo, debe terminar en `needs_review`.

No debe inventarse una salida mediocre solo para cumplir la frecuencia.
