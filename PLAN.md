# PLAN — Facts Engine OS v2: Local, Gratuito y Orientado a Retención

> Migración del pipeline actual (Render Free + APIs cloud) a un pipeline 100% local en Python
> sobre tu hardware: **i7-14700KF + RTX 5060 Ti 16GB + Windows 11**.
> Objetivo: Shorts + longform con calidad muy superior, coste 0€, publicación automática.

---

## 1. Diagnóstico del proyecto actual (commit 5082cfa)

El pipeline funciona de extremo a extremo, pero toda su calidad está limitada por correr en Render Free (512MB RAM, sin GPU):

| Componente actual | Limitación |
|---|---|
| FFmpeg en Render | 720x1280 @ 24fps, CRF 28, preset `superfast`, modo low-memory a 432x768 → calidad visual pobre |
| TTS cloud (Gemini/Cloudflare/espeak) | Voz robótica o con cuotas; espeak es inaceptable para retención |
| Clips de Pexels | Stock genérico, poca relación con el guion, look "canal IA barato" |
| Subtítulos | Timing estimado, sin precisión por palabra |
| Groq/Cloudflare Workers AI | Cuotas gratuitas, guiones planos sin iteración |
| Neon + Cloudflare Pages + GitHub Actions | 5 servicios externos para orquestar algo que ahora cabe en un solo proceso local |
| YouTube API sin auditar | Los vídeos se suben como `private` |

**Conclusión:** la arquitectura era correcta para "gratis en la nube". En local, con GPU, casi todos esos compromisos desaparecen.

---

## 2. Objetivos de la v2

1. Pipeline **Python puro**, un comando: `python -m factory run --format short` (o `--format long`).
2. Todo **gratuito y local**: sin cuotas, sin claves de pago, sin servidores.
3. Calidad de salida: Shorts 1080x1920 @ 30-60fps, longform 1920x1080, encoding NVENC.
4. Voz indistinguible de humana (nivel ElevenLabs) con modelos open source.
5. Visuales generados por IA coherentes con el guion (no stock aleatorio).
6. Subtítulos por palabra estilo "karaoke" (formato que domina en Shorts).
7. Publicación automática en YouTube con programación de horarios.
8. Loop de mejora basado en analytics reales del canal.

---

## 3. Arquitectura v2

```text
Windows 11 (tu PC)
└── factory/  (pipeline Python)
    ├── Ollama (local)          → temas, guiones, títulos, metadata
    ├── Chatterbox / Kokoro     → voz (GPU)
    ├── faster-whisper          → subtítulos palabra a palabra (GPU)
    ├── ComfyUI (API local)     → imágenes FLUX + vídeo LTX/Wan (GPU)
    ├── FFmpeg + NVENC          → montaje y render final (GPU)
    ├── SQLite                  → historial, anti-repetición, cola, analytics
    └── YouTube Data API        → subida y programación automática
```

Sin Docker obligatorio, sin n8n, sin base de datos externa. Todo el estado en un archivo `factory.db` (SQLite) y una carpeta `output/` con cada run.

### 3.1 Stack elegido (todo gratuito, verificado julio 2026)

| Etapa | Herramienta | Licencia | VRAM | Por qué |
|---|---|---|---|---|
| Ideas + guion | **Ollama** + Qwen3 14B (o Llama 3.1 8B) | Apache 2.0 | ~9-10 GB (Q4) | Sin cuotas, iteración ilimitada del guion (borrador → crítica → reescritura) |
| Voz principal | **Chatterbox-Turbo** (Resemble AI) | MIT | ~4-6 GB | En pruebas ciegas supera a ElevenLabs (65% de preferencia). Clonación de voz → identidad de canal consistente. Multilingüe (EN/ES) |
| Voz rápida / fallback | **Kokoro-82M** | Apache 2.0 | ~2-3 GB | Más rápido que tiempo real, ideal para iterar y para volumen alto |
| Subtítulos | **faster-whisper** (large-v3) | MIT | ~4-5 GB | Timestamps por palabra → captions karaoke en ASS |
| Imágenes | **FLUX.1-schnell** vía ComfyUI | Apache 2.0 | ~12 GB (FP8) | Imágenes por escena coherentes con el guion + movimiento Ken Burns |
| Vídeo IA (hero shots) | **LTX-Video** (y Wan 2.2 14B para calidad máxima) | Open / Apache 2.0 | 12-16 GB | Clips de 3-5s para los momentos clave; LTX cabe cómodo en 16GB |
| B-roll real | **Pexels API** (se mantiene) | Gratis | — | Mezclar real + IA evita el look 100% generado |
| Upscale | **Real-ESRGAN** | BSD | ~4 GB | Generar a 720p y escalar a 1080p+ (estándar de la comunidad) |
| Música | **YouTube Audio Library** (+ ACE-Step local opcional) | Gratis / Apache 2.0 | 0 / ~8 GB | Sin problemas de copyright ni monetización |
| Render | **FFmpeg + NVENC (h264/hevc)** | Gratis | — | Encoding por GPU: un short renderiza en segundos, longform en minutos |
| Orquestación | **Python 3.12 + SQLite** | Gratis | — | Un solo proceso, fácil de depurar, sin servicios |
| Subida | **YouTube Data API v3** | Gratis (10k unidades/día) | — | 1 subida = 1600 unidades → hasta 6 vídeos/día |

**Presupuesto VRAM:** las etapas corren **secuencialmente** (guion → voz → visuales → render), cargando y descargando cada modelo. Ningún paso supera los 16GB. Ollama puede quedar residente solo si se usa el modelo 8B.

### 3.2 El problema real de la subida automática

YouTube fuerza a `private` todo vídeo subido por proyectos API **no auditados**. Plan:

1. **Fase 1:** subir vía API como `private` + revisión con un clic desde una mini-página local que lo publica (semiautomático temporal).
2. **En paralelo:** solicitar la **auditoría de compliance** del proyecto en Google Cloud (gratuita; requiere descripción del caso de uso y demo del flujo OAuth). Con auditoría aprobada → subida `public`/`scheduled` 100% automática.
3. TikTok e Instagram (el código ya existe en el repo) se reactivan después, como distribución secundaria del mismo vertical.

---

## 4. Playbook de retención para Shorts (lo que de verdad engancha)

La calidad técnica es condición necesaria, no suficiente. Reglas que aplicará el pipeline por diseño:

**Hook (0-1.5s).** El guion se genera con estructura obligatoria: primera frase = afirmación chocante o pregunta abierta, nunca introducción. El LLM genera 5 hooks candidatos y un segundo pase los puntúa (curiosity gap, especificidad, tensión) eligiendo el mejor.

**Ritmo visual.** Cambio de plano cada 2-3 segundos máximo (pattern interrupt). El montador corta automáticamente los visuales a los beats del guion, no a duración fija. Zooms/paneos constantes: ningún plano estático.

**Captions dinámicos.** 2-3 palabras en pantalla a la vez, palabra activa resaltada, fuente gruesa, posición centro-baja. Generados desde los timestamps de Whisper. Es el formato con mayor retención demostrada en Shorts.

**Loop.** La última frase conecta con la primera ("y por eso, lo que viste al principio...") para incentivar re-watch, la métrica que más pesa en el algoritmo de Shorts.

**Series, no vídeos sueltos.** 2-3 formatos fijos reconocibles (p. ej. "X que no sabías de...", "La decisión que cambió...") con plantilla visual propia. El algoritmo y la audiencia premian consistencia.

**Anti-repetición.** Se conserva la lógica de `canonical_topic` + `angle` + `uniqueness_hash` del proyecto actual, migrada a SQLite.

**Metadata.** Título ≤ 60 caracteres con curiosity gap, descripción con keywords, 3-5 hashtags. Todo generado y validado por el LLM contra una checklist.

**Cadencia.** 1-2 Shorts/día a horas fijas + 1 longform/semana. Los Shorts enlazan al longform relacionado (funnel de suscriptores).

**Loop de datos (Fase 4).** Lectura semanal de YouTube Analytics API (gratuita): retención por segundo, swipe-away del hook, CTR. Los datos alimentan el prompt de generación de hooks → el sistema aprende qué funciona en TU canal.

---

## 5. Longform (mismo motor, otro perfil)

El pipeline es el mismo con un perfil de configuración distinto:

- Guion 8-15 min generado por secciones (outline → sección a sección, evita degradación del LLM en textos largos).
- Chatterbox con voz clonada consistente; capítulos automáticos en la descripción.
- Visual: FLUX por escena + Ken Burns + b-roll Pexels + 2-3 hero shots LTX-Video.
- 1920x1080 @ 30fps NVENC, música de fondo con ducking automático bajo la voz.
- Miniatura: FLUX + plantilla de texto (Pillow) → 3 variantes por vídeo para test A/B.
- Los mejores Shorts se derivan del longform (cortar momentos pico) y viceversa.

---

## 6. Estructura del repo propuesta

```text
factory/
  config/
    channel.yaml          # nicho, idioma, voz, paleta, formatos de serie
    profiles/short.yaml   # 1080x1920, 30-60fps, captions karaoke
    profiles/long.yaml    # 1920x1080, capítulos, thumbnail
  pipeline/
    topics.py             # selección + anti-repetición (SQLite)
    script.py             # generación multi-paso con Ollama
    voice.py              # Chatterbox / Kokoro
    subtitles.py          # faster-whisper → ASS karaoke
    visuals.py            # plan de escenas → ComfyUI (FLUX/LTX) + Pexels
    assemble.py           # FFmpeg + NVENC
    publish.py            # YouTube API (+ TikTok/IG después)
    analytics.py          # YouTube Analytics → feedback al generador
  db/schema.sql           # SQLite
  cli.py                  # python -m factory run|queue|review|stats
output/                   # un directorio por run con todos los artefactos
legacy/                   # código actual de Node que se va retirando
```

Se migra de Node a Python porque todo el ecosistema GPU (Whisper, TTS, ComfyUI) es Python nativo. Los scripts de Node reutilizables (upload YouTube/TikTok/IG, anti-repetición) se portan, no se reescriben desde cero conceptualmente.

---

## 7. Fases de implementación

**Fase 0 — Entorno (1 día).**
Python 3.12 + venv, FFmpeg con NVENC, Ollama + Qwen3, ComfyUI + FLUX.1-schnell, Chatterbox, faster-whisper. Smoke test de cada pieza por separado en la 5060 Ti.

**Fase 1 — MVP local (3-5 días).** *Primer short completo generado en tu PC.*
Portar topics + guion multi-paso → Chatterbox → Whisper → captions karaoke → b-roll Pexels → FFmpeg NVENC 1080x1920. Subida API como private + página local de "aprobar y publicar". Solicitar auditoría de YouTube API.

**Fase 2 — Calidad visual (1 semana).**
Integrar ComfyUI vía API: imágenes FLUX por escena con estilo visual fijo del canal, Ken Burns, transiciones a beat, hero shots LTX-Video, upscale Real-ESRGAN. Mezcla música + ducking. Definir las 2-3 series/formatos del canal.

**Fase 3 — Longform + full auto (1 semana).**
Perfil longform, guion por secciones, capítulos, miniaturas con variantes. Programador de publicaciones (scheduler local). Con la auditoría aprobada: publicación automática real.

**Fase 4 — Optimización con datos (continuo).**
Analytics API → informe semanal de retención/CTR → ajuste automático de prompts de hooks y selección de temas. A/B de miniaturas en longform. Reactivar TikTok/IG como repost del vertical.

**Criterio de éxito por fase:** F1 = un short publicable sin tocar nada a mano; F2 = un espectador no lo identifica como "canal IA de stock"; F3 = 7 días de publicación sin intervención; F4 = retención media del hook > 70% a los 3s.

---

## 8. Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| Auditoría de YouTube API tarda o se rechaza | Modo semiautomático (1 clic) funciona desde Fase 1; se re-solicita con el caso de uso refinado |
| 16GB VRAM justos para Wan 2.2 14B | LTX-Video como estándar (cabe sobrado); Wan solo para hero shots puntuales con offload a RAM |
| Look "IA genérica" penalizado por audiencia | Mezcla IA + b-roll real, estilo visual fijo, series con identidad; regla: si parece IA a primera vista, se ajusta el estilo |
| Políticas de YouTube sobre contenido "inauthentic" | Guion original multi-paso (no plantilla), voz clonada propia, valor educativo real por vídeo; nunca reutilizar contenido de terceros |
| Español vs inglés del canal | `channel.yaml` lo hace configurable; Chatterbox multilingüe cubre ambos. Decisión pendiente contigo antes de Fase 1 |
| PC apagado = no publica | El scheduler encola; opcional: tarea programada de Windows que despierta el PC para el batch nocturno |

---

## 9. Coste

**0€/mes.** Todos los modelos son open source con licencia comercial (MIT/Apache), las APIs usadas (YouTube, Pexels) tienen tier gratuito suficiente, y el único coste real es electricidad (~0,15-0,30€ por sesión de generación nocturna).

---

## 10. Decisiones que quedan abiertas (para antes de Fase 1)

1. **Idioma del canal**: ¿español o inglés? (afecta a voz, nicho y monetización — el inglés paga CPM ~3-5x más).
2. **Nicho**: ¿seguir con facts curiosos o el enfoque documental de "The Hidden Thread" adaptado a Shorts?
3. **Voz**: ¿clonar una voz de referencia (30s de audio bastan para Chatterbox) o usar una voz de catálogo?
