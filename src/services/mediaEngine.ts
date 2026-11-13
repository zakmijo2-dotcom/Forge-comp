import {
  BridgeConfig,
  EngineMode,
  MediaKind,
  MediaMetadata,
  MediaQueueItem,
} from '../types/media';
import {
  buildAudioFfmpegArgs,
  buildVideoFfmpegArgs,
  getAudioMimeAndExt,
  getVideoMimeAndExt,
} from '../utils/ffmpegArgs';
import { buildOutputFilename } from '../utils/mediaUtils';
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
}

export async function extractMediaMetadata(
  file: File,
  kind: MediaKind,
  objectUrl: string
): Promise<{ metadata: MediaMetadata; thumbnailUrl?: string }> {
  if (kind === 'image') {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        resolve({
          metadata: {
            width: img.naturalWidth || img.width,
            height: img.naturalHeight || img.height,
          },
          thumbnailUrl: objectUrl,
        });
      };
      img.onerror = () => resolve({ metadata: {} });
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

      const finish = (thumb?: string) => {
        if (resolved) return;
        resolved = true;
        resolve({
          metadata: {
            width: video.videoWidth || undefined,
            height: video.videoHeight || undefined,
            duration: Number.isFinite(video.duration) ? video.duration : undefined,
          },
          thumbnailUrl: thumb,
        });
      };

      video.onloadeddata = () => {
        // Attempt quick frame grab for thumbnail
        try {
          video.currentTime = Math.min(0.2, (video.duration || 1) * 0.1);
        } catch {
          finish();
        }
      };

      video.onseeked = () => {
        try {
          const c = document.createElement('canvas');
          c.width = 160;
          c.height = 90;
          const ctx = c.getContext('2d');
          if (ctx && video.videoWidth > 0) {
            ctx.drawImage(video, 0, 0, 160, 90);
            finish(c.toDataURL('image/jpeg', 0.7));
            return;
          }
        } catch {
          // ignore frame draw errors
        }
        finish();
      };

      video.onerror = () => finish();
      setTimeout(() => finish(), 1800);
      video.src = objectUrl;
    });
  }

  // Audio
  return new Promise((resolve) => {
    const audio = document.createElement('audio');
    audio.preload = 'metadata';
    const finish = () => {
      resolve({
        metadata: {
          duration: Number.isFinite(audio.duration) ? audio.duration : undefined,
        },
      });
    };
    audio.onloadedmetadata = finish;
    audio.onerror = finish;
    setTimeout(finish, 1500);
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
  const startedAt = performance.now();
  const { onProgress, onLog, onFallbackNotice } = callbacks;

  if (engineMode === 'local-bridge') {
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

  // Browser WASM / Canvas mode
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
      engineUsed: 'Canvas2D / OffscreenCanvas',
      durationMs: Math.round(performance.now() - startedAt),
    };
  }

  const inputExt = item.file.name.split('.').pop()?.toLowerCase() || (item.kind === 'video' ? 'mp4' : 'wav');
  const safeInputName = `input_${item.id}.${inputExt}`;

  if (item.kind === 'video') {
    const vs = item.settings.video;
    const isExtract = vs.mode === 'extract-audio';
    const { mime, ext } = isExtract
      ? getAudioMimeAndExt(vs.audioExtractSettings.format)
      : getVideoMimeAndExt(vs.format);
    const safeOutputName = `output_${item.id}.${ext}`;
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
        engineUsed: 'Native MediaRecorder / AudioContext Fallback',
        durationMs: Math.round(performance.now() - startedAt),
      };
    }
  }

  // Audio item
  const as = item.settings.audio;
  const { mime, ext } = getAudioMimeAndExt(as.format);
  const safeOutputName = `output_${item.id}.${ext}`;
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
      engineUsed: 'Web Audio API Fallback',
      durationMs: Math.round(performance.now() - startedAt),
    };
  }
}
