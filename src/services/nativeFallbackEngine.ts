import { AudioSettings, VideoSettings } from '../types/media';
import { encodeFloatChannelsToWav, encodeFramesToGif } from '../utils/binaryEncoders';
import { buildOutputFilename, parseTimestampToSeconds } from '../utils/mediaUtils';

export interface NativeTranscodeResult {
  blob: Blob;
  filename: string;
  actualFormat: string;
  notice: string;
}

function getTargetVideoMaxHeight(res: VideoSettings['resolution']): number | null {
  switch (res) {
    case '1080p':
      return 1080;
    case '720p':
      return 720;
    case '480p':
      return 480;
    case '360p':
      return 360;
    default:
      return null;
  }
}

export async function transcodeAudioNativeFallback(
  file: File,
  settings: AudioSettings,
  onProgress?: (pct: number) => void,
  onLog?: (msg: string) => void,
  signal?: AbortSignal
): Promise<NativeTranscodeResult> {
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  if (!file || file.size <= 0) {
    throw new Error(`Audio file "${file?.name || 'unknown'}" is empty or invalid.`);
  }

  onLog?.('[Native Fallback] Decoding media with Web Audio API (AudioContext)...');
  onProgress?.(15);

  const AudioCtx =
    typeof window !== 'undefined'
      ? window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      : undefined;
  if (!AudioCtx || typeof OfflineAudioContext === 'undefined') {
    throw new Error('Web Audio API is unavailable in this browser.');
  }

  const arrayBuffer = await file.arrayBuffer();
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  if (arrayBuffer.byteLength === 0) {
    throw new Error(`Audio file "${file.name}" contains 0 bytes.`);
  }

  const ctx = new AudioCtx();
  let decoded: AudioBuffer;
  try {
    decoded = await ctx.decodeAudioData(arrayBuffer.slice(0));
  } finally {
    await ctx.close().catch(() => {});
  }

  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  onProgress?.(45);

  const duration = decoded.duration;
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error(`Audio track in "${file.name}" has zero or invalid duration.`);
  }

  const startSec = Math.max(0, Math.min(duration, parseTimestampToSeconds(settings.trimStart) ?? 0));
  const rawEnd = parseTimestampToSeconds(settings.trimEnd);
  const endSec = rawEnd !== null && rawEnd > startSec ? Math.min(duration, rawEnd) : duration;
  const clipDuration = Math.max(0.05, endSec - startSec);

  const targetChannels =
    settings.channels === 'mono' ? 1 : Math.max(1, Math.min(2, decoded.numberOfChannels || 2));
  const targetSampleRate =
    Number.isInteger(settings.sampleRate) && settings.sampleRate >= 8000
      ? settings.sampleRate
      : 44100;
  const frameCount = Math.max(1, Math.round(clipDuration * targetSampleRate));

  onLog?.(
    `[Native Fallback] Rendering ${clipDuration.toFixed(2)}s @ ${targetSampleRate}Hz (${
      targetChannels === 1 ? 'Mono' : 'Stereo'
    })...`
  );

  const offline = new OfflineAudioContext(targetChannels, frameCount, targetSampleRate);
  const source = offline.createBufferSource();
  source.buffer = decoded;
  source.connect(offline.destination);
  source.start(0, startSec, clipDuration);

  let rendered: AudioBuffer;
  try {
    rendered = await offline.startRendering();
  } finally {
    try {
      source.disconnect();
    } catch {
      // ignore disconnect errors
    }
  }

  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  onProgress?.(80);

  const channelsData: Float32Array[] = [];
  for (let ch = 0; ch < rendered.numberOfChannels; ch++) {
    channelsData.push(rendered.getChannelData(ch));
  }

  const wavBytes = encodeFloatChannelsToWav(channelsData, targetSampleRate);
  const blob = new Blob([wavBytes.buffer as ArrayBuffer], { type: 'audio/wav' });
  const actualFormat = 'wav';
  const requestedFormat = settings.format.toLowerCase();
  onProgress?.(100);

  const formatChanged = requestedFormat !== 'wav';
  const notice = formatChanged
    ? `FFmpeg WASM unavailable; output was encoded as 16-bit PCM WAV (.wav) instead of requested ${requestedFormat.toUpperCase()} via Web Audio API fallback.`
    : 'Encoded natively as 16-bit PCM WAV (.wav) via Web Audio API.';

  if (formatChanged) {
    onLog?.(`[Native Fallback] Notice: ${notice}`);
  }

  return {
    blob,
    filename: buildOutputFilename(file.name, actualFormat),
    actualFormat,
    notice,
  };
}

export async function transcodeVideoNativeFallback(
  file: File,
  settings: VideoSettings,
  onProgress?: (pct: number) => void,
  onLog?: (msg: string) => void,
  signal?: AbortSignal
): Promise<NativeTranscodeResult> {
  if (settings.mode === 'extract-audio') {
    return transcodeAudioNativeFallback(
      file,
      settings.audioExtractSettings,
      onProgress,
      onLog,
      signal
    );
  }

  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  if (!file || file.size <= 0) {
    throw new Error(`Video file "${file?.name || 'unknown'}" is empty or invalid.`);
  }
  onLog?.('[Native Fallback] Using Canvas + MediaRecorder browser pipeline...');

  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';

  let canvas: HTMLCanvasElement | null = null;
  let stream: MediaStream | null = null;
  let recorder: MediaRecorder | null = null;
  let rafId = 0;
  let metadataTimer: ReturnType<typeof setTimeout> | null = null;
  let seekTimer: ReturnType<typeof setTimeout> | null = null;
  let endSafetyTimer: ReturnType<typeof setTimeout> | null = null;
  let onAbortHandler: (() => void) | null = null;

  try {
    await new Promise<void>((resolve, reject) => {
      const cleanupMetaListeners = () => {
        if (metadataTimer !== null) {
          clearTimeout(metadataTimer);
          metadataTimer = null;
        }
        video.removeEventListener('loadedmetadata', onLoadedMeta);
        video.removeEventListener('error', onErrorMeta);
        signal?.removeEventListener('abort', onMetaAbort);
      };
      const onLoadedMeta = () => {
        cleanupMetaListeners();
        resolve();
      };
      const onErrorMeta = () => {
        cleanupMetaListeners();
        reject(new Error(`Unable to decode video "${file.name}".`));
      };
      const onMetaAbort = () => {
        cleanupMetaListeners();
        reject(new DOMException('Aborted', 'AbortError'));
      };

      metadataTimer = setTimeout(() => {
        cleanupMetaListeners();
        reject(new Error(`Timed out reading video metadata for "${file.name}".`));
      }, 15000);

      video.addEventListener('loadedmetadata', onLoadedMeta, { once: true });
      video.addEventListener('error', onErrorMeta, { once: true });
      signal?.addEventListener('abort', onMetaAbort, { once: true });
      video.src = url;
    });

    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

    const origW = video.videoWidth || 640;
    const origH = video.videoHeight || 360;
    const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 3;

    if (settings.format === 'gif') {
      const targetW = Math.min(origW, Math.max(120, Math.min(1280, settings.gifWidth || 480)));
      const targetH = Math.max(2, Math.round((origH / origW) * targetW));
      const fps = settings.fps === 'original' ? 12 : Math.max(1, Math.min(20, Number(settings.fps) || 12));
      const maxDuration = Math.min(duration, 10);
      const totalFrames = Math.max(2, Math.min(90, Math.floor(maxDuration * fps)));

      canvas = document.createElement('canvas');
      canvas.width = targetW;
      canvas.height = targetH;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) throw new Error('Canvas 2D unavailable.');

      const frames: Uint8ClampedArray[] = [];
      for (let i = 0; i < totalFrames; i++) {
        if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
        const t = (i / totalFrames) * maxDuration;
        await new Promise<void>((resolve, reject) => {
          const cleanupSeek = () => {
            if (seekTimer !== null) {
              clearTimeout(seekTimer);
              seekTimer = null;
            }
            video.removeEventListener('seeked', onSeeked);
            signal?.removeEventListener('abort', onSeekAbort);
          };
          const onSeeked = () => {
            cleanupSeek();
            resolve();
          };
          const onSeekAbort = () => {
            cleanupSeek();
            reject(new DOMException('Aborted', 'AbortError'));
          };
          seekTimer = setTimeout(() => {
            cleanupSeek();
            resolve();
          }, 300);
          video.addEventListener('seeked', onSeeked, { once: true });
          signal?.addEventListener('abort', onSeekAbort, { once: true });
          video.currentTime = t;
        });

        ctx.drawImage(video, 0, 0, targetW, targetH);
        frames.push(ctx.getImageData(0, 0, targetW, targetH).data);
        onProgress?.(Math.min(85, Math.round(((i + 1) / totalFrames) * 85)));
      }

      onLog?.(`[Native Fallback] Quantizing ${frames.length} frames into GIF89a...`);
      const gifBytes = encodeFramesToGif(frames, targetW, targetH, Math.round(1000 / fps));
      const blob = new Blob([gifBytes.buffer as ArrayBuffer], { type: 'image/gif' });
      onProgress?.(100);

      return {
        blob,
        filename: buildOutputFilename(file.name, 'gif'),
        actualFormat: 'gif',
        notice: 'FFmpeg WASM unavailable; generated animated GIF via native Canvas GIF89a encoder.',
      };
    }

    // Video MediaRecorder fallback
    if (typeof MediaRecorder === 'undefined') {
      throw new Error('MediaRecorder API is unavailable in this browser.');
    }

    const maxH = getTargetVideoMaxHeight(settings.resolution);
    let targetW = origW;
    let targetH = origH;
    if (maxH && origH > maxH) {
      const ratio = maxH / origH;
      targetW = Math.max(2, Math.round((origW * ratio) / 2) * 2);
      targetH = Math.max(2, Math.round((origH * ratio) / 2) * 2);
    }

    const fps = settings.fps === 'original' ? 30 : Math.max(1, Math.min(60, Number(settings.fps) || 30));
    canvas = document.createElement('canvas');
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D unavailable.');

    const mimeCandidates =
      settings.format === 'mp4' || settings.format === 'mov' || settings.format === 'mkv'
        ? ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm']
        : ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];

    const chosenMime =
      mimeCandidates.find((m) => MediaRecorder.isTypeSupported(m)) || 'video/webm';
    const outExt = chosenMime.includes('mp4') ? 'mp4' : 'webm';
    const cleanMime = chosenMime.split(';')[0] || 'video/webm';

    stream = canvas.captureStream(fps);
    const crfBitrateMap =
      settings.crf <= 18
        ? 4_000_000
        : settings.crf <= 23
        ? 2_200_000
        : settings.crf <= 28
        ? 1_200_000
        : 650_000;

    recorder = new MediaRecorder(stream, {
      mimeType: chosenMime,
      videoBitsPerSecond: crfBitrateMap,
    });

    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunks.push(e.data);
    };

    const activeRecorder = recorder;
    const donePromise = new Promise<Blob>((resolve, reject) => {
      activeRecorder.onstop = () => resolve(new Blob(chunks, { type: cleanMime }));
      activeRecorder.onerror = () => reject(new Error('MediaRecorder transcoding failed.'));
    });

    onLog?.(`[Native Fallback] Recording ${targetW}x${targetH} @ ${fps}fps (${chosenMime})...`);
    recorder.start(200);
    video.currentTime = 0;

    let stopped = false;

    const drawLoop = () => {
      if (stopped || signal?.aborted) return;
      ctx.drawImage(video, 0, 0, targetW, targetH);
      const pct = Math.min(96, Math.max(5, Math.round((video.currentTime / duration) * 95)));
      onProgress?.(pct);
      if (!video.ended && !video.paused) {
        rafId = requestAnimationFrame(drawLoop);
      }
    };

    await new Promise<void>((resolve, reject) => {
      const cleanupPlay = () => {
        if (endSafetyTimer !== null) {
          clearTimeout(endSafetyTimer);
          endSafetyTimer = null;
        }
        video.removeEventListener('ended', onEnded);
        video.removeEventListener('error', onPlayError);
        if (onAbortHandler) {
          signal?.removeEventListener('abort', onAbortHandler);
          onAbortHandler = null;
        }
      };

      const onEnded = () => {
        cleanupPlay();
        resolve();
      };

      const onPlayError = () => {
        cleanupPlay();
        reject(new Error(`Playback error while transcoding "${file.name}".`));
      };

      onAbortHandler = () => {
        stopped = true;
        cancelAnimationFrame(rafId);
        video.pause();
        if (activeRecorder.state !== 'inactive') {
          try {
            activeRecorder.stop();
          } catch {
            // ignore
          }
        }
        cleanupPlay();
        reject(new DOMException('Aborted', 'AbortError'));
      };

      signal?.addEventListener('abort', onAbortHandler, { once: true });
      video.addEventListener('ended', onEnded, { once: true });
      video.addEventListener('error', onPlayError, { once: true });

      endSafetyTimer = setTimeout(() => {
        cleanupPlay();
        resolve();
      }, Math.min(120_000, Math.round((duration + 2) * 1000)));

      video
        .play()
        .then(() => {
          drawLoop();
        })
        .catch((err) => {
          cleanupPlay();
          reject(err instanceof Error ? err : new Error(String(err)));
        });
    });

    stopped = true;
    cancelAnimationFrame(rafId);
    if (recorder.state !== 'inactive') {
      recorder.stop();
    }

    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const blob = await donePromise;
    onProgress?.(100);

    const requestedContainer = settings.format.toLowerCase();
    const containerChanged = requestedContainer !== outExt;
    const notice = containerChanged
      ? `FFmpeg WASM unavailable; output was encoded as ${outExt.toUpperCase()} (.${outExt}) instead of requested ${requestedContainer.toUpperCase()} via browser MediaRecorder fallback.`
      : `FFmpeg WASM unavailable; transcoded natively as ${outExt.toUpperCase()} (.${outExt}) via browser MediaRecorder.`;

    if (containerChanged) {
      onLog?.(`[Native Fallback] Notice: ${notice}`);
    }

    return {
      blob,
      filename: buildOutputFilename(file.name, outExt),
      actualFormat: outExt,
      notice,
    };
  } finally {
    if (metadataTimer !== null) clearTimeout(metadataTimer);
    if (seekTimer !== null) clearTimeout(seekTimer);
    if (endSafetyTimer !== null) clearTimeout(endSafetyTimer);
    if (rafId) cancelAnimationFrame(rafId);
    if (onAbortHandler) {
      signal?.removeEventListener('abort', onAbortHandler);
    }
    if (recorder) {
      if (recorder.state !== 'inactive') {
        try {
          recorder.stop();
        } catch {
          // ignore
        }
      }
      recorder.ondataavailable = null;
      recorder.onstop = null;
      recorder.onerror = null;
    }
    if (stream) {
      stream.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch {
          // ignore
        }
      });
    }
    try {
      video.pause();
      video.removeAttribute('src');
      video.load();
    } catch {
      // ignore
    }
    if (canvas) {
      canvas.width = 0;
      canvas.height = 0;
    }
    try {
      URL.revokeObjectURL(url);
    } catch {
      // ignore
    }
  }
}
