#!/bin/bash

# PowerMates YouTube Thumbnail Downloader
# Downloads YouTube thumbnails locally to avoid external dependencies

set -e

# Directory for downloaded thumbnails
DOWNLOAD_DIR="./images/yt"

# Create directory if it doesn't exist
mkdir -p "$DOWNLOAD_DIR"

echo "Downloading YouTube thumbnails..."

# Array of video IDs
declare -a VIDEO_IDS=(
  "Txa81pUOcyA"
  "GORCiDj9YNA"
  "O890phQYvEs"
  "CCZOkXn8tI4"
  "ibVjASN_e-c"
  "CL39q4ea7t4"
)

# Download function with fallback
download_thumbnail() {
  local video_id=$1
  local output_file="$DOWNLOAD_DIR/yt-${video_id}.jpg"

  # Skip if already downloaded
  if [ -f "$output_file" ]; then
    echo "✓ $output_file already exists, skipping..."
    return 0
  fi

  echo "Downloading thumbnail for video: $video_id"

  # Try maxresdefault first (highest quality)
  if curl -f -L -s -o "$output_file" \
    "https://img.youtube.com/vi/${video_id}/maxresdefault.jpg" 2>/dev/null; then
    echo "  ✓ Downloaded maxresdefault quality to $output_file"
    return 0
  fi

  # Fallback to hqdefault if maxresdefault not available
  if curl -f -L -s -o "$output_file" \
    "https://img.youtube.com/vi/${video_id}/hqdefault.jpg" 2>/dev/null; then
    echo "  ✓ Downloaded hqdefault quality to $output_file"
    return 0
  fi

  # If both fail, try default
  if curl -f -L -s -o "$output_file" \
    "https://img.youtube.com/vi/${video_id}/default.jpg" 2>/dev/null; then
    echo "  ✓ Downloaded default quality to $output_file"
    return 0
  fi

  echo "  ✗ Failed to download thumbnail for $video_id"
  return 1
}

# Download all thumbnails
failed_count=0
for video_id in "${VIDEO_IDS[@]}"; do
  if ! download_thumbnail "$video_id"; then
    ((failed_count++))
  fi
done

echo ""
if [ $failed_count -eq 0 ]; then
  echo "All thumbnails downloaded successfully!"
else
  echo "Warning: Failed to download $failed_count thumbnail(s)"
  exit 1
fi
