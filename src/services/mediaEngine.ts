import {
  AudioFormat,
  BridgeConfig,
  EngineMode,
  ImageFormat,
  MediaKind,
  MediaMetadata,
  MediaQueueItem,
  MediaSettings,
  VideoFormat,
} from '../types/media';
import {
  buildAudioFfmpegArgs,
  buildVideoFfmpegArgs,
  getAudioMimeAndExt,
  getVideoMimeAndExt,
} from '../utils/ffmpegArgs';
import { buildOutputFilename, parseTimestampToSeconds } from '../utils/mediaUtils';
import { processViaLocalBridge } from './bridgeEngine';
import { runFfmpegCommand } from './ffmpegEngine';
import { processImageFile } from './imageEngine';
import {
  transcodeAudioNativeFallback,
  transcodeVideoNativeFallback,
} from './nativeFallbackEngine';

export interface ProcessCallbacks {
  onProgress: (pct: number) => void;
  onLog: (level: 'info' | 'warn' | 'error' | 'success' | 'cmd', msg: string) => void;
  onFallbackNotice?: (notice: string) => void;
}

export interface ProcessOutcome {
  blob: Blob;
  filename: string;
  engineUsed: string;
  durationMs: number;
  actualFormat?: string;
}

const SUPPORTED_IMAGE_FORMATS = new Set<ImageFormat>(['jpg', 'png', 'webp', 'avif', 'bmp']);
const SUPPORTED_VIDEO_FORMATS = new Set<VideoFormat>(['mp4', 'webm', 'mkv', 'mov', 'avi', 'gif']);
const SUPPORTED_AUDIO_FORMATS = new Set<AudioFormat>(['mp3', 'm4a', 'wav', 'ogg', 'flac']);

export function validateMediaItemSettings(kind: MediaKind, settings: MediaSettings): void {
  if (kind === 'image') {
    if (!SUPPORTED_IMAGE_FORMATS.has(settings.image.format)) {
      throw new Error(`Unsupported image output format: "${String(settings.image.format)}".`);
    }
    if (!Number.isFinite(settings.image.quality) || settings.image.quality < 1 || settings.image.quality > 100) {
      throw new Error(`Invalid image quality (${settings.image.quality}). Must be between 1 and 100.`);
    }
    return;
  }

  if (kind === 'video') {
    if (settings.video.mode === 'extract-audio') {
      validateAudioSettingsObject(settings.video.audioExtractSettings);
      return;
    }
    if (!SUPPORTED_VIDEO_FORMATS.has(settings.video.format)) {
      throw new Error(`Unsupported video output format: "${String(settings.video.format)}".`);
    }
    if (!Number.isFinite(settings.video.crf) || settings.video.crf < 0 || settings.video.crf > 51) {
      throw new Error(`Invalid video CRF value (${settings.video.crf}). Must be between 0 and 51.`);
    }
    if (
      settings.video.format === 'gif' &&
      (!Number.isFinite(settings.video.gifWidth) || settings.video.gifWidth < 64 || settings.video.gifWidth > 2560)
    ) {
      throw new Error(`Invalid GIF width (${settings.video.gifWidth}px). Must be between 64 and 2560.`);
    }
    return;
  }

  if (kind === 'audio') {
    validateAudioSettingsObject(settings.audio);
    return;
  }

  throw new Error(`Unsupported media kind: "${String(kind)}".`);
}

function validateAudioSettingsObject(audio: MediaSettings['audio']): void {
  if (!SUPPORTED_AUDIO_FORMATS.has(audio.format)) {
    throw new Error(`Unsupported audio output format: "${String(audio.format)}".`);
  }
  const startRaw = (audio.trimStart || '').trim();
  const endRaw = (audio.trimEnd || '').trim();
  const startSec = parseTimestampToSeconds(startRaw);
  const endSec = parseTimestampToSeconds(endRaw);

  if (startRaw && startSec === null) {
    throw new Error(`Invalid Trim Start timestamp "${startRaw}". Expected MM:SS or seconds.`);
  }
  if (endRaw && endSec === null) {
    throw new Error(`Invalid Trim End timestamp "${endRaw}". Expected MM:SS or seconds.`);
  }
  if (startSec !== null && endSec !== null && endSec <= startSec) {
    throw new Error(
      `Invalid trim range: Trim End (${endRaw}) must be greater than Trim Start (${startRaw}).`
    );
  }
}

export type PlannedEngineType =
  | 'local-bridge'
  | 'ts-bmp-encoder'
  | 'canvas-image'
  | 'ffmpeg-wasm';

export function selectPrimaryEngine(
  kind: MediaKind,
  settings: MediaSettings,
  engineMode: EngineMode
): PlannedEngineType {
  validateMediaItemSettings(kind, settings);
  if (engineMode === 'local-bridge') {
    return 'local-bridge';
  }
  if (kind === 'image') {
    return settings.image.format === 'bmp' ? 'ts-bmp-encoder' : 'canvas-image';
  }
  return 'ffmpeg-wasm';
}

export async function extractMediaMetadata(
  file: File,
  kind: MediaKind,
  objectUrl: string
): Promise<{ metadata: MediaMetadata; thumbnailUrl?: string }> {
  if (typeof document === 'undefined') {
    return { metadata: {} };
  }

  if (kind === 'image') {
    return new Promise((resolve) => {
      const img = new Image();
      const timer = setTimeout(() => {
        img.onload = null;
        img.onerror = null;
        resolve({ metadata: {} });
      }, 3000);

      img.onload = () => {
        clearTimeout(timer);
        resolve({
          metadata: {
            width: img.naturalWidth || img.width,
            height: img.naturalHeight || img.height,
          },
          thumbnailUrl: objectUrl,
        });
      };
      img.onerror = () => {
        clearTimeout(timer);
        resolve({ metadata: {} });
      };
      img.src = objectUrl;
    });
  }

  if (kind === 'video') {
    return new Promise((resolve) => {
      const video = document.createElement('video');
      video.preload = 'metadata';
      video.muted = true;
      video.playsInline = true;
      let resolved = false;
      let timer: ReturnType<typeof setTimeout> | null = null;

      const finish = (thumb?: string) => {
        if (resolved) return;
        resolved = true;
        if (timer !== null) {
          clearTimeout(timer);
          timer = null;
        }
        const width = video.videoWidth || undefined;
        const height = video.videoHeight || undefined;
        const duration =
          Number.isFinite(video.duration) && video.duration > 0 ? video.duration : undefined;

        video.onloadeddata = null;
        video.onseeked = null;
        video.onerror = null;
        try {
          video.pause();
          video.removeAttribute('src');
          video.load();
        } catch {
          // ignore
        }

        resolve({
          metadata: { width, height, duration },
          thumbnailUrl: thumb,
        });
      };

      video.onloadeddata = () => {
        try {
          video.currentTime = Math.min(0.2, (video.duration || 1) * 0.1);
        } catch {
          finish();
        }
      };

      video.onseeked = () => {
        let thumbUrl: string | undefined;
        const c = document.createElement('canvas');
        try {
          c.width = 160;
          c.height = 90;
          const ctx = c.getContext('2d');
          if (ctx && video.videoWidth > 0) {
            ctx.drawImage(video, 0, 0, 160, 90);
            thumbUrl = c.toDataURL('image/jpeg', 0.7);
          }
        } catch {
          // ignore frame draw errors
        } finally {
          c.width = 0;
          c.height = 0;
        }
        finish(thumbUrl);
      };

      video.onerror = () => finish();
      timer = setTimeout(() => finish(), 1800);
      video.src = objectUrl;
    });
  }

  // Audio
  return new Promise((resolve) => {
    const audio = document.createElement('audio');
    audio.preload = 'metadata';
    let resolved = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const finish = () => {
      if (resolved) return;
      resolved = true;
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      const duration =
        Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : undefined;
      audio.onloadedmetadata = null;
      audio.onerror = null;
      try {
        audio.removeAttribute('src');
        audio.load();
      } catch {
        // ignore
      }
      resolve({
        metadata: { duration },
      });
    };

    audio.onloadedmetadata = finish;
    audio.onerror = finish;
    timer = setTimeout(finish, 1500);
    audio.src = objectUrl;
  });
}

export async function processMediaItem(
  item: MediaQueueItem,
  engineMode: EngineMode,
  bridgeConfig: BridgeConfig,
  callbacks: ProcessCallbacks,
  signal?: AbortSignal
): Promise<ProcessOutcome> {
  if (signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError');
  }
  if (!item.file || item.file.size <= 0) {
    throw new Error(`File "${item.name}" is empty or unreadable.`);
  }

  const primaryEngine = selectPrimaryEngine(item.kind, item.settings, engineMode);
  const startedAt = performance.now();
  const { onProgress, onLog, onFallbackNotice } = callbacks;

  if (primaryEngine === 'local-bridge') {
    onLog('info', `Routing "${item.name}" to Local FFmpeg API Bridge (${bridgeConfig.url})`);
    const result = await processViaLocalBridge({
      file: item.file,
      kind: item.kind,
      settings: item.settings,
      bridgeConfig,
      onProgress,
      onLog: (msg) => onLog('info', msg),
      signal,
    });
    return {
      blob: result.blob,
      filename: result.filename,
      engineUsed: 'Local API Bridge',
      durationMs: Math.round(performance.now() - startedAt),
    };
  }

  // Browser Image Engine (Canvas2D / OffscreenCanvas / Pure-TS BMP Encoder)
  if (item.kind === 'image') {
    const result = await processImageFile(
      item.file,
      item.settings.image,
      onProgress,
      (msg) => onLog('info', msg),
      signal
    );
    if (result.usedFallbackNotice) {
      onLog('warn', result.usedFallbackNotice);
      onFallbackNotice?.(result.usedFallbackNotice);
    }
    return {
      blob: result.blob,
      filename: result.filename,
      engineUsed:
        primaryEngine === 'ts-bmp-encoder'
          ? 'Canvas2D + Pure-TS BMP Encoder'
          : 'Canvas2D / OffscreenCanvas',
      durationMs: Math.round(performance.now() - startedAt),
      actualFormat: result.actualFormat,
    };
  }

  const rawExt = item.file.name.split('.').pop()?.toLowerCase() || '';
  const inputExt =
    /^[a-z0-9]{1,8}$/.test(rawExt) ? rawExt : item.kind === 'video' ? 'mp4' : 'wav';
  const safeId = item.id.replace(/[^a-zA-Z0-9_-]/g, '_');
  const safeInputName = `input_${safeId}.${inputExt}`;

  if (item.kind === 'video') {
    const vs = item.settings.video;
    const isExtract = vs.mode === 'extract-audio';
    const { mime, ext } = isExtract
      ? getAudioMimeAndExt(vs.audioExtractSettings.format)
      : getVideoMimeAndExt(vs.format);
    const safeOutputName = `output_${safeId}.${ext}`;
    const args = buildVideoFfmpegArgs(safeInputName, safeOutputName, vs);

    try {
      onLog('cmd', `ffmpeg ${args.join(' ')}`);
      const blob = await runFfmpegCommand({
        file: item.file,
        args,
        inputName: safeInputName,
        outputName: safeOutputName,
        outputMime: mime,
        onProgress,
        onLog: (msg) => onLog('info', msg),
        signal,
      });
      return {
        blob,
        filename: buildOutputFilename(item.name, ext),
        engineUsed: 'FFmpeg WASM',
        durationMs: Math.round(performance.now() - startedAt),
        actualFormat: ext,
      };
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        throw err;
      }
      const errMsg = err instanceof Error ? err.message : String(err);
      onLog('warn', `FFmpeg WASM unavailable (${errMsg}). Engaging browser-native fallback.`);
      const fallback = await transcodeVideoNativeFallback(
        item.file,
        vs,
        onProgress,
        (msg) => onLog('info', msg),
        signal
      );
      onFallbackNotice?.(fallback.notice);
      return {
        blob: fallback.blob,
        filename: fallback.filename,
        engineUsed:
          fallback.actualFormat === 'gif'
            ? 'Canvas + Pure-TS GIF89a Encoder'
            : fallback.actualFormat === 'wav'
            ? 'Web Audio + Pure-TS WAV Encoder'
            : 'Native MediaRecorder Fallback',
        durationMs: Math.round(performance.now() - startedAt),
        actualFormat: fallback.actualFormat,
      };
    }
  }

  // Audio item
  const as = item.settings.audio;
  const { mime, ext } = getAudioMimeAndExt(as.format);
  const safeOutputName = `output_${safeId}.${ext}`;
  const args = buildAudioFfmpegArgs(safeInputName, safeOutputName, as, false);

  try {
    onLog('cmd', `ffmpeg ${args.join(' ')}`);
    const blob = await runFfmpegCommand({
      file: item.file,
      args,
      inputName: safeInputName,
      outputName: safeOutputName,
      outputMime: mime,
      onProgress,
      onLog: (msg) => onLog('info', msg),
      signal,
    });
    return {
      blob,
      filename: buildOutputFilename(item.name, ext),
      engineUsed: 'FFmpeg WASM',
      durationMs: Math.round(performance.now() - startedAt),
      actualFormat: ext,
    };
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw err;
    }
    const errMsg = err instanceof Error ? err.message : String(err);
    onLog('warn', `FFmpeg WASM unavailable (${errMsg}). Engaging Web Audio API fallback.`);
    const fallback = await transcodeAudioNativeFallback(
      item.file,
      as,
      onProgress,
      (msg) => onLog('info', msg),
      signal
    );
    onFallbackNotice?.(fallback.notice);
    return {
      blob: fallback.blob,
      filename: fallback.filename,
      engineUsed: 'Web Audio + Pure-TS WAV Encoder',
      durationMs: Math.round(performance.now() - startedAt),
      actualFormat: fallback.actualFormat,
    };
  }
}
