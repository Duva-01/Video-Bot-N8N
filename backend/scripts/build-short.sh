#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

log() {
  printf '[build-short] %s\n' "$1"
}

fail() {
  printf '[build-short][error] %s\n' "$1" >&2
  exit 1
}

if [[ $# -lt 3 ]]; then
  fail "Uso: build-short.sh <output.mp4> <audio.mp3> <clips_dir> [subtitles.ass]"
fi

OUTPUT_FILE="$1"
AUDIO_FILE="$2"
CLIPS_DIR="$3"
SUBTITLE_FILE="${4:-}"
LOW_MEMORY_MODE="${RENDER_LOW_MEMORY_MODE:-false}"
WIDTH="${SHORTS_WIDTH:-720}"
HEIGHT="${SHORTS_HEIGHT:-1280}"
FPS="${SHORTS_FPS:-24}"
THREADS="${FFMPEG_THREADS:-1}"
PRESET="${FFMPEG_PRESET:-superfast}"
CRF="${FFMPEG_CRF:-28}"
VIDEO_BITRATE="${FFMPEG_VIDEO_BITRATE:-1800k}"
AUDIO_BITRATE="${FFMPEG_AUDIO_BITRATE:-96k}"
AUDIO_RATE="${FFMPEG_AUDIO_RATE:-24000}"
X264_PARAMS="${FFMPEG_X264_PARAMS:-rc-lookahead=0:sync-lookahead=0:ref=1:bframes=0}"
OUTRO_ENABLED="${OUTRO_ENABLED:-false}"
OUTRO_VIDEO_FILE="${OUTRO_VIDEO_FILE:-/app/assets/video/outro.mp4}"

if [[ "$LOW_MEMORY_MODE" == "true" ]]; then
  WIDTH="${SHORTS_WIDTH:-540}"
  HEIGHT="${SHORTS_HEIGHT:-960}"
  FPS="${SHORTS_FPS:-20}"
  THREADS="${FFMPEG_THREADS:-1}"
  PRESET="${FFMPEG_PRESET:-ultrafast}"
  CRF="${FFMPEG_CRF:-30}"
  VIDEO_BITRATE="${FFMPEG_VIDEO_BITRATE:-1200k}"
  AUDIO_BITRATE="${FFMPEG_AUDIO_BITRATE:-64k}"
  AUDIO_RATE="${FFMPEG_AUDIO_RATE:-22050}"
  X264_PARAMS="${FFMPEG_X264_PARAMS:-rc-lookahead=0:sync-lookahead=0:ref=1:bframes=0:me=dia:subme=0}"
fi

X264_PARAMS="${X264_PARAMS}:threads=${THREADS}"

[[ -f "$AUDIO_FILE" ]] || fail "No existe el audio: $AUDIO_FILE"
[[ -d "$CLIPS_DIR" ]] || fail "No existe el directorio de clips: $CLIPS_DIR"

TMP_DIR="$(mktemp -d)"
CONCAT_FILE="$TMP_DIR/clips.txt"
BASE_VIDEO="$TMP_DIR/base.mp4"
MAIN_OUTPUT_FILE="$TMP_DIR/main-output.mp4"
OUTRO_RENDER_FILE="$TMP_DIR/outro.mp4"
CONCAT_FILE_FINAL="$TMP_DIR/final.txt"
SFX_EVENTS_FILE=""
SFX_AUDIO_FILE=""
BASE_SEQUENCE_DURATION="0"
TRANSITION_TIMES=()
HOOK_TRANSITION_TIME=""

cleanup() {
  rm -rf "$TMP_DIR"
}

trap cleanup EXIT

find "$CLIPS_DIR" -maxdepth 1 -type f \( -iname '*.mp4' -o -iname '*.mov' -o -iname '*.webm' \) | sort > "$TMP_DIR/found.txt"

[[ -s "$TMP_DIR/found.txt" ]] || fail "No se encontraron clips compatibles en $CLIPS_DIR"

while IFS= read -r clip; do
  printf "file '%s'\n" "$clip" >> "$CONCAT_FILE"
  CLIP_DURATION="$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$clip" | tr -d '\r')"
  [[ -n "$CLIP_DURATION" ]] || fail "No se pudo obtener la duracion del clip: $clip"
  if [[ "$BASE_SEQUENCE_DURATION" != "0" ]]; then
    TRANSITION_TIMES+=("$BASE_SEQUENCE_DURATION")
  fi
  BASE_SEQUENCE_DURATION="$(awk "BEGIN {printf \"%.3f\", $BASE_SEQUENCE_DURATION + $CLIP_DURATION}")"
done < "$TMP_DIR/found.txt"

FILTER="scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=increase,crop=${WIDTH}:${HEIGHT},fps=${FPS},format=yuv420p"
VIDEO_FILTER="$FILTER"

if [[ -n "$SUBTITLE_FILE" ]]; then
  if [[ ! -f "$SUBTITLE_FILE" ]]; then
    if [[ "$SUBTITLE_FILE" == *.srt ]]; then
      ALT_ASS_FILE="${SUBTITLE_FILE%.srt}.ass"
      if [[ -f "$ALT_ASS_FILE" ]]; then
        log "Subtitulos SRT no encontrados; usando ASS compatible: $ALT_ASS_FILE"
        SUBTITLE_FILE="$ALT_ASS_FILE"
      elif [[ -f "/tmp/bot-videos/subtitles.ass" ]]; then
        log "Subtitulos SRT no encontrados; usando ASS por defecto: /tmp/bot-videos/subtitles.ass"
        SUBTITLE_FILE="/tmp/bot-videos/subtitles.ass"
      else
        fail "No existe el archivo de subtitulos: $SUBTITLE_FILE"
      fi
    else
      fail "No existe el archivo de subtitulos: $SUBTITLE_FILE"
    fi
  fi
  SFX_EVENTS_FILE="${SUBTITLE_FILE%.ass}.events.json"
  if [[ -f "$SFX_EVENTS_FILE" ]]; then
    SFX_AUDIO_FILE="$TMP_DIR/sfx.wav"
    HOOK_TRANSITION_TIME="$(node -e "const fs=require('fs'); const data=JSON.parse(fs.readFileSync(process.argv[1],'utf8')); const value=Number(data.hookDuration || 0); if (Number.isFinite(value) && value > 0) process.stdout.write(value.toFixed(3));" "$SFX_EVENTS_FILE")"
    log "Generando pista de efectos"
    node "$SCRIPT_DIR/generate-sfx-track.js" "$AUDIO_FILE" "$SFX_EVENTS_FILE" "$SFX_AUDIO_FILE"
  fi
fi

mkdir -p "$(dirname "$OUTPUT_FILE")"

log "Montando video vertical"
log "Audio: $AUDIO_FILE"
log "Clips: $CLIPS_DIR"
log "Salida: $OUTPUT_FILE"
log "Modo memoria reducida: $LOW_MEMORY_MODE"
log "Resolucion: ${WIDTH}x${HEIGHT} @ ${FPS}fps"

log "Normalizando clips base"
ffmpeg -y \
  -threads "$THREADS" \
  -filter_threads 1 \
  -f concat \
  -safe 0 \
  -i "$CONCAT_FILE" \
  -an \
  -vf "$VIDEO_FILTER" \
  -c:v libx264 \
  -preset "$PRESET" \
  -crf "$CRF" \
  -maxrate "$VIDEO_BITRATE" \
  -bufsize "$VIDEO_BITRATE" \
  -x264-params "$X264_PARAMS" \
  -movflags +faststart \
  "$BASE_VIDEO"

AUDIO_DURATION="$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$AUDIO_FILE")"
[[ -n "$AUDIO_DURATION" ]] || fail "No se pudo obtener la duracion del audio"

FINAL_FILTER="$FILTER"

if [[ -n "$SUBTITLE_FILE" ]]; then
  FINAL_FILTER="${FINAL_FILTER},subtitles=${SUBTITLE_FILE}"
fi

if [[ ( ${#TRANSITION_TIMES[@]} -gt 0 || -n "$HOOK_TRANSITION_TIME" ) ]] && [[ "${CLIP_TRANSITIONS_ENABLED:-true}" != "false" ]]; then
  FLASH_DURATION="${CLIP_TRANSITION_FLASH_DURATION:-0.14}"
  FLASH_LEAD="${CLIP_TRANSITION_FLASH_LEAD:-0.05}"
  FLASH_TRAIL="$(awk "BEGIN {printf \"%.3f\", $FLASH_DURATION - $FLASH_LEAD}")"
  CYCLE_OFFSET="0"
  TRANSITION_INDEX=0

  apply_transition() {
    local ABSOLUTE_CUT="$1"
    local FLASH_START FLASH_END TRANSITION_SEED VARIANT
    FLASH_START="$(awk "BEGIN {v=$ABSOLUTE_CUT - $FLASH_LEAD; if (v < 0) v = 0; printf \"%.3f\", v}")"
    FLASH_END="$(awk "BEGIN {v=$ABSOLUTE_CUT + $FLASH_TRAIL; if (v > $AUDIO_DURATION) v = $AUDIO_DURATION; printf \"%.3f\", v}")"
    TRANSITION_SEED="$(printf '%s' "$ABSOLUTE_CUT" | tr -cd '0-9')"
    VARIANT=$(( (TRANSITION_INDEX + TRANSITION_SEED) % 5 ))

    case "$VARIANT" in
      0)
        FINAL_FILTER="${FINAL_FILTER},drawbox=x=0:y=0:w=iw:h=ih:color=white@0.78:t=fill:enable='between(t,${FLASH_START},${FLASH_END})'"
        ;;
      1)
        FINAL_FILTER="${FINAL_FILTER},drawbox=x=0:y=0:w=iw:h=ih:color=black@0.42:t=fill:enable='between(t,${FLASH_START},${FLASH_END})'"
        ;;
      2)
        FINAL_FILTER="${FINAL_FILTER},drawbox=x=0:y=0:w=iw*0.42:h=ih:color=0xFFB26B@0.34:t=fill:enable='between(t,${FLASH_START},${FLASH_END})'"
        ;;
      3)
        FINAL_FILTER="${FINAL_FILTER},drawbox=x=iw*0.58:y=0:w=iw*0.42:h=ih:color=0x7BE1FF@0.32:t=fill:enable='between(t,${FLASH_START},${FLASH_END})'"
        ;;
      *)
        FINAL_FILTER="${FINAL_FILTER},eq=contrast=1.35:brightness=0.05:saturation=1.55:enable='between(t,${FLASH_START},${FLASH_END})',hue=h=18:s=1.25:enable='between(t,${FLASH_START},${FLASH_END})'"
        ;;
    esac

    TRANSITION_INDEX=$((TRANSITION_INDEX + 1))
  }

  if [[ -n "$HOOK_TRANSITION_TIME" ]] && awk "BEGIN {exit !($HOOK_TRANSITION_TIME > 0 && $HOOK_TRANSITION_TIME < $AUDIO_DURATION)}"; then
    apply_transition "$HOOK_TRANSITION_TIME"
  fi

  while awk "BEGIN {exit !($CYCLE_OFFSET < $AUDIO_DURATION)}"; do
    for CUT_TIME in "${TRANSITION_TIMES[@]}"; do
      ABSOLUTE_CUT="$(awk "BEGIN {printf \"%.3f\", $CYCLE_OFFSET + $CUT_TIME}")"
      if awk "BEGIN {exit !($ABSOLUTE_CUT >= $AUDIO_DURATION)}"; then
        continue
      fi

      apply_transition "$ABSOLUTE_CUT"
    done

    if [[ "$BASE_SEQUENCE_DURATION" == "0" ]]; then
      break
    fi

    CYCLE_OFFSET="$(awk "BEGIN {printf \"%.3f\", $CYCLE_OFFSET + $BASE_SEQUENCE_DURATION}")"
  done
fi

if [[ -n "$SFX_AUDIO_FILE" && -f "$SFX_AUDIO_FILE" ]]; then
  ffmpeg -y \
    -threads "$THREADS" \
    -filter_threads 1 \
    -stream_loop -1 \
    -i "$BASE_VIDEO" \
    -i "$AUDIO_FILE" \
    -i "$SFX_AUDIO_FILE" \
    -filter_complex "[0:v]${FINAL_FILTER}[v];[1:a]volume=1.0[voice];[2:a]volume=${SFX_MIX_VOLUME:-0.9}[fx];[voice][fx]amix=inputs=2:weights='1 0.55':dropout_transition=0[aout]" \
    -map "[v]" \
    -map "[aout]" \
    -c:v libx264 \
    -preset "$PRESET" \
    -crf "$CRF" \
    -maxrate "$VIDEO_BITRATE" \
    -bufsize "$VIDEO_BITRATE" \
    -x264-params "$X264_PARAMS" \
    -c:a aac \
    -b:a "$AUDIO_BITRATE" \
    -ar "$AUDIO_RATE" \
    -movflags +faststart \
    -t "$AUDIO_DURATION" \
    "$MAIN_OUTPUT_FILE"
else
  ffmpeg -y \
    -threads "$THREADS" \
    -filter_threads 1 \
    -stream_loop -1 \
    -i "$BASE_VIDEO" \
    -i "$AUDIO_FILE" \
    -vf "$FINAL_FILTER" \
    -map 0:v:0 \
    -map 1:a:0 \
    -c:v libx264 \
    -preset "$PRESET" \
    -crf "$CRF" \
    -maxrate "$VIDEO_BITRATE" \
    -bufsize "$VIDEO_BITRATE" \
    -x264-params "$X264_PARAMS" \
    -c:a aac \
    -b:a "$AUDIO_BITRATE" \
    -ar "$AUDIO_RATE" \
    -movflags +faststart \
    -t "$AUDIO_DURATION" \
    "$MAIN_OUTPUT_FILE"
fi

if [[ "$OUTRO_ENABLED" == "true" && -f "$OUTRO_VIDEO_FILE" ]]; then
  log "Anadiendo outro"
  OUTRO_DURATION="$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$OUTRO_VIDEO_FILE" | tr -d '\r')"
  [[ -n "$OUTRO_DURATION" ]] || fail "No se pudo obtener la duracion del outro"

  ffmpeg -y \
    -threads "$THREADS" \
    -filter_threads 1 \
    -i "$OUTRO_VIDEO_FILE" \
    -f lavfi \
    -t "$OUTRO_DURATION" \
    -i "anullsrc=r=${AUDIO_RATE}:cl=mono" \
    -map 0:v:0 \
    -map 1:a:0 \
    -vf "$FILTER" \
    -c:v libx264 \
    -preset "$PRESET" \
    -crf "$CRF" \
    -maxrate "$VIDEO_BITRATE" \
    -bufsize "$VIDEO_BITRATE" \
    -x264-params "$X264_PARAMS" \
    -c:a aac \
    -b:a "$AUDIO_BITRATE" \
    -ar "$AUDIO_RATE" \
    -movflags +faststart \
    "$OUTRO_RENDER_FILE"

  printf "file '%s'\n" "$MAIN_OUTPUT_FILE" > "$CONCAT_FILE_FINAL"
  printf "file '%s'\n" "$OUTRO_RENDER_FILE" >> "$CONCAT_FILE_FINAL"

  ffmpeg -y \
    -f concat \
    -safe 0 \
    -i "$CONCAT_FILE_FINAL" \
    -c copy \
    "$OUTPUT_FILE"
else
  mv "$MAIN_OUTPUT_FILE" "$OUTPUT_FILE"
fi

log "Video generado correctamente"
