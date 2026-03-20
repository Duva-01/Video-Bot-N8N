#!/usr/bin/env bash

set -euo pipefail

log() {
  printf '[build-short] %s\n' "$1"
}

fail() {
  printf '[build-short][error] %s\n' "$1" >&2
  exit 1
}

if [[ $# -lt 3 ]]; then
  fail "Uso: build-short.sh <output.mp4> <audio.mp3> <clips_dir> [subtitles.srt]"
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

cleanup() {
  rm -rf "$TMP_DIR"
}

trap cleanup EXIT

find "$CLIPS_DIR" -maxdepth 1 -type f \( -iname '*.mp4' -o -iname '*.mov' -o -iname '*.webm' \) | sort > "$TMP_DIR/found.txt"

[[ -s "$TMP_DIR/found.txt" ]] || fail "No se encontraron clips compatibles en $CLIPS_DIR"

while IFS= read -r clip; do
  printf "file '%s'\n" "$clip" >> "$CONCAT_FILE"
done < "$TMP_DIR/found.txt"

FILTER="scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=increase,crop=${WIDTH}:${HEIGHT},fps=${FPS},format=yuv420p"
VIDEO_FILTER="$FILTER"

if [[ -n "$SUBTITLE_FILE" ]]; then
  [[ -f "$SUBTITLE_FILE" ]] || fail "No existe el archivo de subtitulos: $SUBTITLE_FILE"
  FILTER="${FILTER},subtitles=${SUBTITLE_FILE}"
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

ffmpeg -y \
  -threads "$THREADS" \
  -filter_threads 1 \
  -stream_loop -1 \
  -i "$BASE_VIDEO" \
  -i "$AUDIO_FILE" \
  -vf "$FILTER" \
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
  "$OUTPUT_FILE"

log "Video generado correctamente"
