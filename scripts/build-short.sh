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
WIDTH="${SHORTS_WIDTH:-1080}"
HEIGHT="${SHORTS_HEIGHT:-1920}"
FPS="${SHORTS_FPS:-30}"

[[ -f "$AUDIO_FILE" ]] || fail "No existe el audio: $AUDIO_FILE"
[[ -d "$CLIPS_DIR" ]] || fail "No existe el directorio de clips: $CLIPS_DIR"

TMP_DIR="$(mktemp -d)"
CONCAT_FILE="$TMP_DIR/clips.txt"

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

if [[ -n "$SUBTITLE_FILE" ]]; then
  [[ -f "$SUBTITLE_FILE" ]] || fail "No existe el archivo de subtitulos: $SUBTITLE_FILE"
  FILTER="${FILTER},subtitles=${SUBTITLE_FILE}"
fi

mkdir -p "$(dirname "$OUTPUT_FILE")"

log "Montando video vertical"
log "Audio: $AUDIO_FILE"
log "Clips: $CLIPS_DIR"
log "Salida: $OUTPUT_FILE"

ffmpeg -y \
  -f concat \
  -safe 0 \
  -i "$CONCAT_FILE" \
  -i "$AUDIO_FILE" \
  -vf "$FILTER" \
  -map 0:v:0 \
  -map 1:a:0 \
  -c:v libx264 \
  -preset veryfast \
  -crf 23 \
  -c:a aac \
  -b:a 192k \
  -ar 44100 \
  -shortest \
  "$OUTPUT_FILE"

log "Video generado correctamente"

