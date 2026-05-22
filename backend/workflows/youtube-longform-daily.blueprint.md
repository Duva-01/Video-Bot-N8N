# Blueprint: YouTube Longform Daily

## Objetivo del workflow

Publicar un video diario largo con una pipeline controlada, profesional y monetizable, donde:

- haya un nicho definido
- no se repitan temas o angulos
- el guion tenga retencion real
- la voz suene humana
- los subtitulos tengan timing por palabra
- el render final tenga calidad visual suficiente para YouTube longform

## Workflow canvas

```text
[Manual Trigger] ----\
[Schedule Trigger] --\
[Webhook Trigger] ----> [Build Channel Strategy]
                              |
                              v
                 [Editorial Guard And Uniqueness]
                              |
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
                     [Build Visual Storyboard]
                              |
                              v
                     [Generate Voiceover Pack]
                              |
                              v
                    [Subtitle Timing Alignment]
                              |
                              v
                         [Render Request]
                              |
                              v
                    [Final QA And Monetization]
                          /               \
                         /                 \
                        v                   v
             [Upload To YouTube]      [Needs Review]
```

## Nodos que debes crear en n8n

### Triggers

- `Manual Trigger`
- `Schedule Trigger`
- `Webhook Trigger`

Configuracion recomendada:

- 1 ejecucion al dia
- timezone del workflow: `Europe/Madrid`
- hora fija de arranque: por ejemplo `06:00`
- webhook para disparo externo desde GitHub Actions o fallback manual

Path sugerido del webhook:

- `youtube-longform-daily-trigger`

### Estrategia de canal

- `Build Channel Strategy`
- `Editorial Guard And Uniqueness`

Datos base:

- fecha
- idioma
- duracion
- nicho activo del dia
- politica editorial
- ventana de repeticion prohibida
- score minimo de originalidad

La regla correcta no es “sacar cualquier tema”.

La regla correcta es:

- elegir un nicho estrecho
- rotar subtemas dentro del nicho
- impedir repetir tema o angulo durante meses
- registrar cada idea y cada video generado

### Research y guion

- `Load Topic`
- `Research Pack`
- `Generate Outline`
- `Generate Script`

Entradas:

- backlog editorial
- historial de videos anteriores
- nicho del canal
- prompt maestro del canal
- reglas anti-repeticion

Salidas:

- dossier
- canonical topic
- angle
- originality notes
- outline
- guion largo

### Visuales

- `Build Visual Storyboard`

Estrategia:

- `stock premium` para el cuerpo del video
- `motion graphics` para contexto, cifras y mapas
- `hero AI video` solo en escenas clave
- `ai image` para apoyar conceptos complejos
- `archive still` cuando sea historicamente relevante

No se considera profesional:

- montar 38 minutos enteros con clips AI genericos
- depender de stock gratuito como base principal
- usar escenas visualmente intercambiables sin relacion con el guion

### Audio

- `Generate Voiceover Pack`

Recomendacion:

- generar audio por capitulo
- expresividad por bloque
- marcar pausas y enfasis

### Subtitulos

- `Subtitle Timing Alignment`

Recomendacion:

- retranscribir el audio final
- obtener `word-level timestamps`
- renderizar captions cortos y cinematicos
- enfatizar palabras clave

### Render

- `Render Request`

MVP:

- usar `Creatomate` o `Shotstack`
- quemar subtitulos, lower thirds y chapter cards en el render final
- usar templates coherentes con el nicho

### QA

- `Final QA And Monetization`

Validaciones:

- duracion final
- audio disponible
- subtitulos presentes
- render final disponible
- titulo y descripcion generados
- score de originalidad
- historial del canal consultado
- revision de copyright/licencias
- seguridad para monetizacion

### Publicacion

- `Upload To YouTube`
- `Persist Results`
- `Notify`

## Fallos que debes contemplar

- no hay tema disponible sin repetir
- el research devuelve poco material
- el tema ya existe en backlog o historico
- el LLM genera outline flojo
- el guion se parece demasiado a uno previo
- faltan visuales premium suficientes
- el render tarda demasiado
- YouTube devuelve error de subida
- el QA considera el contenido no monetizable

## Politica de retries

- `research/script`: 2 retries
- `assets`: 3 retries con fallback
- `render`: polling + timeout
- `upload`: 2 retries

## Regla importante

Si el sistema no puede completar un video con una calidad minima, debe terminar en `needs_review`, no inventarse un video mediocre solo por cumplir la frecuencia.

## Evaluacion honesta del flujo anterior

El flujo anterior no bastaba para un canal monetizable serio porque:

- elegia topics por lista fija
- no consultaba historial real
- no tenia control anti-repeticion
- no tenia subtitulos profesionales
- no tenia stock premium ni estrategia visual de nivel canal
- no hacia QA de monetizacion antes de publicar

Como demo de orquestacion, servia.

Como sistema de produccion para YouTube, no era suficiente.
