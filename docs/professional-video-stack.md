# Professional Video Stack

## Objetivo

Definir el stack recomendado para que este workflow pase de `dry-run` a una pipeline capaz de producir un video diario con acabado profesional.

## Recomendacion corta

Si quieres el mejor equilibrio entre calidad, control y tiempo de implementacion:

- `Research + guion`: `OpenAI` + buscador web
- `Voz expresiva`: `ElevenLabs`
- `Subtitulos word-level`: `OpenAI Speech to Text` o `Deepgram`
- `Stock`: `Pexels` para MVP, `Storyblocks` o `Artgrid` para calidad real
- `Hero shots AI`: `Runway` o `Kling`
- `Montaje/render`: `Creatomate` o `Shotstack`
- `Publicacion`: `YouTube Data API`

## Capa por capa

### 1. Research y guion

Necesitas dos cosas distintas:

- un `LLM` bueno para escribir
- una capa de `research` con fuentes

Stack recomendado:

- `OpenAI Responses API` para research estructurado, outline y script final
- un buscador/API de research como `Tavily`, `Exa` o `SerpAPI`

Por que:

- el guion de 38 minutos necesita coherencia larga
- no basta con un modelo rapido; necesitas estructura, continuidad y revision

### 2. Voz con expresividad

Recomendacion principal:

- `ElevenLabs`

Por que:

- su TTS oficial destaca por entonacion, pausas y carga emocional
- para narracion documental es claramente mejor que un TTS plano

Uso recomendado:

- generar voz por capitulo
- no por video completo
- introducir indicaciones de emocion y pausas en el texto

### 3. Subtitulos profesionales

Para subtitulos bonitos no basta con un `.srt`.

Necesitas:

- `word-level timestamps`
- bloques cortos
- estilo cinetico
- enfasis por palabras

Recomendacion:

- generar la voz
- retranscribir el audio final con `OpenAI Speech to Text` o `Deepgram`
- usar ese resultado para renderizar subtitulos palabra por palabra

Esto es mejor que alinear solo desde el guion, porque la voz real siempre introduce pequeñas variaciones.

### 4. Visuales

No intentes hacer `38 minutos` enteros con video generativo puro. Es carisimo y poco estable.

Mezcla recomendada:

- `60%` stock video
- `20%` imagen AI
- `10%` motion graphics / slides
- `10%` hero shots AI

Para stock:

- `Pexels` vale para MVP
- `Storyblocks`, `Artgrid` o `Envato` son mas profesionales

Para hero shots AI:

- `Runway`
- `Kling`

Usalos solo en escenas clave.

### 5. Render y montaje

Si quieres subtitulos potentes, overlays, lower thirds y timeline serio:

- `Creatomate`
- `Shotstack`

Ambos te dejan definir un timeline en JSON y lanzar renders por API.

Recomendacion:

- `Creatomate` si quieres velocidad y facilidad con plantillas
- `Shotstack` si quieres una capa de edicion API-first muy clara

### 6. Publicacion

Para YouTube:

- `YouTube Data API`

Sube:

- video
- titulo
- descripcion
- tags
- thumbnail

## Stack recomendado final

### Opcion A: maxima calidad pragmatica

- `OpenAI` para research + outline + script
- `ElevenLabs` para narracion
- `OpenAI Speech to Text` para timestamps
- `Storyblocks/Artgrid` para stock
- `Runway/Kling` para hero shots
- `Creatomate` para render
- `YouTube Data API` para publicar

### Opcion B: calidad alta con implementacion mas simple

- `OpenAI` para guion
- `ElevenLabs` para narracion
- `OpenAI Speech to Text` para subtitulos
- `Pexels` para stock
- `Creatomate` para render
- `YouTube Data API`

## Que necesito de tu lado para conectarlo bien

### Imprescindible

- `OPENAI_API_KEY`
- `ELEVENLABS_API_KEY`
- `PEXELS_API_KEY` o proveedor premium alternativo
- `YOUTUBE_CLIENT_ID`
- `YOUTUBE_CLIENT_SECRET`
- `YOUTUBE_REFRESH_TOKEN`

### Si quieres acabado profesional de verdad

- cuenta en `Creatomate` o `Shotstack`
- cuenta en `Storyblocks`, `Artgrid` o libreria equivalente
- cuenta en `Runway` o `Kling`

## Implementacion recomendada por orden

1. conectar `OpenAI` para research, outline y script
2. conectar `ElevenLabs` para voz
3. conectar `OpenAI Speech to Text` para subtitulos con timestamps
4. conectar stock
5. conectar render
6. conectar upload a YouTube
7. despues mejorar hero shots AI
