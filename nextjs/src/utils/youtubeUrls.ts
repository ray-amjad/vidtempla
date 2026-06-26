/**
 * Shared YouTube URL builders. Keep the watch-link and thumbnail formats in one
 * place so a format change (e.g. switching to hqdefault) updates every caller.
 */

/** Public watch page for a YouTube video id. */
export function youtubeWatchUrl(videoId: string): string {
  return `https://youtube.com/watch?v=${videoId}`;
}

/** Default (120x90) thumbnail for a YouTube video id. */
export function youtubeThumbnailUrl(videoId: string): string {
  return `https://img.youtube.com/vi/${videoId}/default.jpg`;
}
