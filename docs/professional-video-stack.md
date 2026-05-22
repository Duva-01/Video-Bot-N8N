# Professional Video Stack

## Objetivo

Definir el stack real para que el workflow produzca un documental faceless que se vea serio, consistente y monetizable.

## Recomendacion corta

- `Research + outline + script`: `OpenAI`
- `Voiceover`: `ElevenLabs`
- `Background music`: `Eleven Music`
- `Word-level subtitles`: `OpenAI Speech to Text`
- `Hero shots`: `Runway` solo en escenas clave
- `Render`: `Creatomate`
- `Delivery`: `Backblaze B2`
- `Upload`: manual a `YouTube`

## Capa por capa

### 1. Research y guion

Provider recomendado:

- `OpenAI`

Uso:

- research pack
- outline
- script largo
- revision de tono y claridad

Por que:

- necesitas coherencia larga
- necesitas ingles limpio
- necesitas control de estilo

### 2. Voz

Provider recomendado:

- `ElevenLabs`

Uso:

- una sola voz principal al principio
- generacion por capitulo
- pausas y enfasis controlados

No conviene:

- cambiar de voz todo el rato
- usar una voz demasiado teatral

### 3. Musica

Provider recomendado:

- `Eleven Music`

Uso:

- instrumental solamente
- textura documental
- mezcla suave

No conviene:

- usar temas con vocales
- usar musica hiper epica todo el tiempo
- usar un track que pelee con la narracion

### 4. Subtitulos

Provider recomendado:

- `OpenAI Speech to Text`

Uso:

- retranscribir el audio real
- obtener timestamps por palabra
- renderizar captions dinamicos

Esto es mejor que alinear subtitulos solo desde el guion.

### 5. Render

Provider recomendado:

- `Creatomate`

Uso:

- timeline por JSON
- chapter cards
- lower thirds
- captions
- mezcla final de voz y musica
- transiciones discretas

La calidad final no depende solo de tener `Creatomate`.

Depende de:

- la plantilla
- el ritmo visual
- la jerarquia tipografica
- la mezcla de audio

### 6. Hero shots

Provider recomendado:

- `Runway`

Uso:

- escenas clave
- momentos de apertura
- transiciones de cambio de bloque

No conviene:

- intentar hacer 38 minutos enteros con video generativo

### 7. Delivery

Provider recomendado:

- `Backblaze B2`

Uso:

- carpeta por episodio
- entrega del `.mp4` final
- entrega de miniatura y metadata
- revision manual antes de YouTube

## Stack final recomendado

- `OpenAI`
- `ElevenLabs`
- `Eleven Music`
- `OpenAI Speech to Text`
- `Creatomate`
- `Backblaze B2`
- `Runway` como opcional

## Lo que hace falta para que se vea premium

- nombre y tono de canal fijos
- tipografias editoriales
- captions consistentes
- miniaturas sobrias
- musica que no moleste
- movement visual sutil

## Lo que no hace falta

- festival de transiciones
- clips random gratuitos
- estetica AI exagerada
- subida automatica a YouTube si no te aporta nada
