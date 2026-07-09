# SETUP — Windows 11 + RTX 5060 Ti (una sola vez)

## 1. Base

```powershell
winget install Python.Python.3.12 Gyan.FFmpeg Ollama.Ollama
# reabre la terminal despues de instalar
```

Comprueba NVENC: `ffmpeg -encoders | findstr nvenc` debe mostrar `h264_nvenc`.

## 2. Entorno Python

```powershell
cd "C:\Users\Usuario\Desktop\Personal\Proyectos\Automatizaciones\Bot de Videos"
python -m venv .venv
.venv\Scripts\activate

# PyTorch con CUDA para Blackwell (RTX 50xx) — antes que el resto
pip install torch torchaudio --index-url https://download.pytorch.org/whl/cu128

pip install -r requirements.txt
```

Si `chatterbox-tts` da conflicto de dependencias, instala en este orden:
`pip install chatterbox-tts --no-deps` y luego `pip install s3tokenizer conformer diffusers transformers librosa`.

## 3. Modelos LLM

```powershell
ollama pull qwen3:14b      # guiones (calidad)
ollama pull llama3.1:8b    # tareas rapidas (puntuar hooks)
```

## 4. ComfyUI + FLUX (imagenes por escena)

1. Instala ComfyUI Desktop (o portable) desde comfy.org.
2. Descarga `flux1-schnell-fp8.safetensors` (checkpoint "all-in-one" de Comfy-Org
   en HuggingFace) y ponlo en `ComfyUI/models/checkpoints/`.
3. Arranca ComfyUI (queda en `http://127.0.0.1:8188`).

Opcional (hero shots de video IA): instala los nodos de LTX-Video desde el
ComfyUI Manager. La pipeline funciona sin esto.

## 5. Musica

Descarga 5-10 pistas instrumentales de **YouTube Studio → Audio Library**
(sin copyright) y dejalas en `assets/music/`.

## 6. Credenciales (.env)

Ya tienes `YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET` y `YOUTUBE_REFRESH_TOKEN`.
Falta (opcional pero recomendado) `PEXELS_API_KEY`: gratis en pexels.com/api.

El refresh token debe tener el scope `https://www.googleapis.com/auth/youtube`
(subida + publicar). Si el actual solo tiene `youtube.upload`, regenera el token.

## 7. Auditoria de YouTube API (para publicacion 100% automatica)

En Google Cloud Console → tu proyecto → "YouTube Data API" → solicita la
**compliance audit** (formulario "YouTube API Services - Audit and Quota
Extension"). Describe el caso de uso: "subida de videos originales a mi propio
canal". Hasta que la aprueben, los videos suben en private y se publican con
`python -m factory review`.

## 8. Verificar

```powershell
python -m factory check                      # todo OK?
python -m factory run --simulate --no-upload # e2e sin GPU (~1 min)
python -m factory run --no-upload            # primer short real
```

## 9. Automatizar (Task Scheduler de Windows)

Programador de tareas → Crear tarea basica:
- Accion: iniciar `powershell.exe`
- Argumentos: `-Command "cd 'C:\...\Bot de Videos'; .venv\Scripts\python -m factory run --count 2"`
- Desencadenador: diario a la hora que prefieras (ideal de madrugada)
- Marca "Reactivar el equipo para ejecutar esta tarea" si quieres que despierte el PC.

Y una segunda tarea semanal con `python -m factory stats` para el loop de mejora.
