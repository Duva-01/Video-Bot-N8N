# The Hidden Thread — Video Factory (100% local)

Pipeline en Python que genera y sube videos documentales a YouTube (Shorts y longform)
usando solo herramientas gratuitas corriendo en tu PC (RTX 5060 Ti).

Guion (Ollama) → voz (Chatterbox/Kokoro) → subtitulos karaoke (faster-whisper) →
visuales (FLUX via ComfyUI + Pexels + Ken Burns) → montaje (FFmpeg NVENC) →
subida (YouTube Data API).

## Uso

```bash
# diagnostico del entorno
python -m factory check

# probar el pipeline sin GPU ni APIs (assets sinteticos)
python -m factory run --simulate --no-upload

# un short real, sin subir
python -m factory run --format short --no-upload

# short completo con subida (queda private hasta pasar la auditoria de la API)
python -m factory run --format short

# video largo con miniatura y capitulos
python -m factory run --format long

# lote nocturno de 2 shorts programados
python -m factory run --count 2 --schedule

# revisar y publicar con un clic los videos en private
python -m factory review    # -> http://127.0.0.1:8099

# analytics -> insights que mejoran los hooks automaticamente
python -m factory stats
```

## Estructura

```text
config/
  channel.yaml        identidad, series, voz, estilo visual, publicacion
  profiles/short.yaml 1080x1920, 45s, captions karaoke, loop
  profiles/long.yaml  1920x1080, ~10min, capitulos, miniaturas A/B
factory/              pipeline Python (ver factory/cli.py)
assets/music/         pon aqui mp3 de YouTube Audio Library
output/<slug>/        artefactos de cada video (guion, voz, escenas, final.mp4)
factory.db            SQLite: runs, anti-repeticion, cola, analytics
legacy/               proyecto anterior (Node + n8n + Render), solo referencia
PLAN.md               plan maestro del proyecto
SETUP.md              instalacion en Windows paso a paso
```

## Estado del run

`created → topic → scripted → voiced → visuals → rendered → uploaded → published`

Si un run falla queda como `failed` con el error en `factory.db` y sus artefactos
en `output/<slug>/` para depurar.

## Importante: subida automatica

Hasta que Google apruebe la auditoria del proyecto API, todo video subido por API
queda **private**. Flujo actual: `run` sube en private → `review` publica con un clic.
Solicita la auditoria en Google Cloud Console (gratis) para desbloquear
`--schedule` y la publicacion 100% automatica. Detalles en PLAN.md §3.2.
