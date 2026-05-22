# Blueprint: YouTube Longform Daily

## Objetivo del workflow

Publicar un video diario largo con una pipeline controlada, barata de iterar y facil de depurar.

## Workflow canvas

```text
[Manual Trigger] ----\
                      -> [Set Run Config] -> [Create Run Record] -> [Load Topic]
[Schedule Trigger] --/                                      |
                                                            v
                                                      [Research Pack]
                                                            |
                                                            v
                                                     [Generate Outline]
                                                            |
                                                            v
                                                      [Generate Script]
                                                            |
                                                            v
                                                    [Split Into Chapters]
                                                            |
                                                            v
                                                     [Split Into Scenes]
                                                            |
                                                            v
                                                [Loop Scenes: Visual Plan]
                                                            |
                                                            v
                                                [Loop Scenes: Fetch Assets]
                                                            |
                                                            v
                                                  [Generate Voiceover Pack]
                                                            |
                                                            v
                                                     [Render Request]
                                                            |
                                                            v
                                                      [Poll Render Job]
                                                            |
                                                            v
                                                     [Quality Checks]
                                                        /         \
                                                       /           \
                                                      v             v
                                              [Upload To YouTube] [Needs Review]
                                                      |
                                                      v
                                                [Persist Results]
                                                      |
                                                      v
                                                    [Notify]
```

## Nodos que debes crear en n8n

### Triggers

- `Manual Trigger`
- `Schedule Trigger`

Configuracion recomendada:

- 1 ejecucion al dia
- timezone del workflow: `Europe/Madrid`
- hora fija de arranque: por ejemplo `06:00`

### Preparacion

- `Set Run Config`
- `Create Run Record`

Datos base:

- fecha
- idioma
- duracion
- nicho
- tipo de video

### Research y guion

- `Load Topic`
- `Research Pack`
- `Generate Outline`
- `Generate Script`

Entradas:

- backlog de temas
- calendario editorial
- prompt maestro del canal

Salidas:

- dossier
- outline
- guion largo

### Estructuracion

- `Split Into Chapters`
- `Split Into Scenes`

Cada escena debe devolver:

- `scene_index`
- `chapter_index`
- `voice_text`
- `visual_type`
- `visual_prompt`
- `asset_query`
- `target_duration_sec`

### Visuales

- `Loop Scenes: Visual Plan`
- `Loop Scenes: Fetch Assets`

Estrategia:

- primero stock
- despues imagen AI
- por ultimo clip AI solo donde aporte

### Audio

- `Generate Voiceover Pack`

Recomendacion:

- generar audio por capitulo
- unirlo en el render final

### Render

- `Render Request`
- `Poll Render Job`

MVP:

- usar un servicio de render externo

Futuro:

- reemplazar estos dos nodos por un worker propio

### QA

- `Quality Checks`

Validaciones:

- duracion final
- audio disponible
- render final disponible
- titulo y descripcion generados

### Publicacion

- `Upload To YouTube`
- `Persist Results`
- `Notify`

## Fallos que debes contemplar

- no hay tema disponible
- el research devuelve poco material
- el LLM genera outline flojo
- falta stock para varias escenas
- el render tarda demasiado
- YouTube devuelve error de subida

## Politica de retries

- `research/script`: 2 retries
- `assets`: 3 retries con fallback
- `render`: polling + timeout
- `upload`: 2 retries

## Regla importante

Si el sistema no puede completar un video con una calidad minima, debe terminar en `needs_review`, no inventarse un video mediocre solo por cumplir la frecuencia.
