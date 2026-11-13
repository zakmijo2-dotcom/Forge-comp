import {
  AudioSettings,
  ImageFormat,
  ImageResizeMode,
  ImageSettings,
  MediaKind,
  MediaSettings,
  VideoSettings,
} from '../types/media';

export function detectMediaKind(file: { name: string; type?: string }): MediaKind | null {
  const mime = (file.type || '').toLowerCase();
  const ext = file.name.split('.').pop()?.toLowerCase() || '';

  if (
    mime.startsWith('image/') ||
    ['jpg', 'jpeg', 'png', 'webp', 'avif', 'bmp', 'gif', 'svg'].includes(ext)
  ) {
    return 'image';
  }
  if (
    mime.startsWith('video/') ||
    ['mp4', 'webm', 'mkv', 'mov', 'avi', 'm4v', 'flv'].includes(ext)
  ) {
    return 'video';
  }
  if (
    mime.startsWith('audio/') ||
    ['mp3', 'm4a', 'aac', 'wav', 'ogg', 'opus', 'flac', 'weba'].includes(ext)
  ) {
    return 'audio';
  }
  return null;
}

export function formatBytes(bytes: number, decimals = 2): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), sizes.length - 1);
  const value = bytes / Math.pow(k, i);
  return `${value.toFixed(i === 0 ? 0 : dm)} ${sizes[i]}`;
}

export interface SavingsResult {
  savedBytes: number;
  savedPercent: number;
  isLarger: boolean;
  label: string;
}

export function calculateSavings(originalBytes: number, outputBytes: number): SavingsResult {
  if (!Number.isFinite(originalBytes) || originalBytes <= 0) {
    return { savedBytes: 0, savedPercent: 0, isLarger: false, label: '0.0% saved' };
  }
  const diff = originalBytes - outputBytes;
  const pct = (Math.abs(diff) / originalBytes) * 100;
  if (diff >= 0) {
    return {
      savedBytes: diff,
      savedPercent: Number(pct.toFixed(1)),
      isLarger: false,
      label: `-${pct.toFixed(1)}% saved`,
    };
  }
  return {
    savedBytes: diff,
    savedPercent: Number(pct.toFixed(1)),
    isLarger: true,
    label: `+${pct.toFixed(1)}% larger`,
  };
}

export function parseTimestampToSeconds(ts: string): number | null {
  const trimmed = ts.trim();
  if (!trimmed) return null;
  if (/^\d+(\.\d+)?$/.test(trimmed)) {
    const val = Number(trimmed);
    return Number.isFinite(val) && val >= 0 ? val : null;
  }
  const parts = trimmed.split(':').map((p) => Number(p));
  if (parts.some((n) => !Number.isFinite(n) || n < 0)) return null;
  if (parts.length === 2) {
    const [m, s] = parts;
    return m * 60 + s;
  }
  if (parts.length === 3) {
    const [h, m, s] = parts;
    return h * 3600 + m * 60 + s;
  }
  return null;
}

export function secondsToTimestamp(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '00:00';
  const total = seconds > 0 && seconds < 1 ? 1 : Math.floor(seconds);
  const hrs = Math.floor(total / 3600);
  const mins = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  if (hrs > 0) return `${pad(hrs)}:${pad(mins)}:${pad(secs)}`;
  return `${pad(mins)}:${pad(secs)}`;
}

export function calculateTargetDimensions(
  origWidth: number,
  origHeight: number,
  resizeMode: ImageResizeMode,
  ensureEven = false
): { width: number; height: number } {
  const w = Math.max(1, Math.round(origWidth));
  const h = Math.max(1, Math.round(origHeight));

  let targetW = w;
  let targetH = h;

  const scaleToMaxBox = (maxW: number, maxH: number) => {
    const ratio = Math.min(maxW / w, maxH / h, 1);
    targetW = Math.max(1, Math.round(w * ratio));
    targetH = Math.max(1, Math.round(h * ratio));
  };

  switch (resizeMode) {
    case 'original':
      break;
    case '4k':
      scaleToMaxBox(3840, 2160);
      break;
    case '1080p':
      scaleToMaxBox(1920, 1080);
      break;
    case '720p':
      scaleToMaxBox(1280, 720);
      break;
    case '480p':
      scaleToMaxBox(854, 480);
      break;
    case '75%':
      targetW = Math.max(1, Math.round(w * 0.75));
      targetH = Math.max(1, Math.round(h * 0.75));
      break;
    case '50%':
      targetW = Math.max(1, Math.round(w * 0.5));
      targetH = Math.max(1, Math.round(h * 0.5));
      break;
    case '25%':
      targetW = Math.max(1, Math.round(w * 0.25));
      targetH = Math.max(1, Math.round(h * 0.25));
      break;
  }

  if (ensureEven) {
    targetW = Math.max(2, targetW % 2 === 0 ? targetW : targetW - 1);
    targetH = Math.max(2, targetH % 2 === 0 ? targetH : targetH - 1);
  }

  return { width: targetW, height: targetH };
}

export function buildOutputFilename(originalName: string, outputExt: string): string {
  const dotIndex = originalName.lastIndexOf('.');
  const rawBase = dotIndex > 0 ? originalName.slice(0, dotIndex) : originalName;
  const safeBase = rawBase.replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^_+|_+$/g, '') || 'media';
  const cleanExt = outputExt.replace(/^\./, '').toLowerCase();
  return `${safeBase}_compressed.${cleanExt}`;
}

export function getImageMimeType(format: ImageFormat): string {
  switch (format) {
    case 'jpg':
      return 'image/jpeg';
    case 'png':
      return 'image/png';
    case 'webp':
      return 'image/webp';
    case 'avif':
      return 'image/avif';
    case 'bmp':
      return 'image/bmp';
  }
}

export function estimateImageOutputSize(
  originalBytes: number,
  origWidth: number,
  origHeight: number,
  settings: ImageSettings
): number {
  const { width, height } = calculateTargetDimensions(origWidth || 1280, origHeight || 720, settings.resize);
  const pixels = width * height;
  const q = Math.max(0.01, Math.min(1, settings.quality / 100));

  switch (settings.format) {
    case 'bmp':
      return Math.round(pixels * 3 + 54);
    case 'png': {
      const grayFactor = settings.grayscale ? 0.55 : 1;
      const baseBytes = Math.min(originalBytes * 0.95, pixels * 0.85 * grayFactor);
      const pixelRatio = pixels / Math.max(1, (origWidth || 1280) * (origHeight || 720));
      return Math.max(1024, Math.round(baseBytes * Math.min(1, pixelRatio * 1.05)));
    }
    case 'avif': {
      const bpp = 0.06 + q * q * 0.42;
      return Math.max(800, Math.round(pixels * bpp));
    }
    case 'webp': {
      const bpp = 0.08 + q * q * 0.55;
      return Math.max(1024, Math.round(pixels * bpp));
    }
    case 'jpg': {
      const bpp = 0.12 + q * q * 0.85;
      return Math.max(1200, Math.round(pixels * bpp));
    }
  }
}

export function createDefaultImageSettings(): ImageSettings {
  return {
    format: 'webp',
    quality: 82,
    resize: 'original',
    stripExif: true,
    flattenAlpha: false,
    flattenColor: '#ffffff',
    grayscale: false,
  };
}

export function createDefaultAudioSettings(): AudioSettings {
  return {
    format: 'mp3',
    bitrate: 192,
    sampleRate: 44100,
    channels: 'stereo',
    trimStart: '',
    trimEnd: '',
  };
}

export function createDefaultVideoSettings(): VideoSettings {
  return {
    mode: 'video',
    format: 'mp4',
    codec: 'h264',
    crf: 23,
    resolution: 'original',
    fps: 'original',
    muteAudio: false,
    gifWidth: 480,
    audioExtractSettings: createDefaultAudioSettings(),
  };
}

export function createDefaultSettingsForKind(_kind: MediaKind): MediaSettings {
  return {
    image: createDefaultImageSettings(),
    video: createDefaultVideoSettings(),
    audio: createDefaultAudioSettings(),
  };
}

export function cloneMediaSettings(settings: MediaSettings): MediaSettings {
  return {
    image: { ...settings.image },
    video: {
      ...settings.video,
      audioExtractSettings: { ...settings.video.audioExtractSettings },
    },
    audio: { ...settings.audio },
  };
}
