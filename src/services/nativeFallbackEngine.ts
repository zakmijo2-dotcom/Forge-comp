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
  onLog?.('[Native Fallback] Decoding media with Web Audio API (AudioContext)...');
  onProgress?.(15);

  const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtx) {
    throw new Error('Web Audio API is unavailable in this browser.');
  }

  const arrayBuffer = await file.arrayBuffer();
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
  const startSec = Math.max(0, parseTimestampToSeconds(settings.trimStart) ?? 0);
  const rawEnd = parseTimestampToSeconds(settings.trimEnd);
  const endSec = rawEnd !== null && rawEnd > startSec ? Math.min(duration, rawEnd) : duration;
  const clipDuration = Math.max(0.05, endSec - startSec);

  const targetChannels = settings.channels === 'mono' ? 1 : Math.min(2, decoded.numberOfChannels || 2);
  const targetSampleRate = settings.sampleRate || 44100;
  const frameCount = Math.max(1, Math.round(clipDuration * targetSampleRate));

  onLog?.(
    `[Native Fallback] Rendering ${clipDuration.toFixed(2)}s @ ${targetSampleRate}Hz (${targetChannels === 1 ? 'Mono' : 'Stereo'})...`
  );

  const offline = new OfflineAudioContext(targetChannels, frameCount, targetSampleRate);
  const source = offline.createBufferSource();
  source.buffer = decoded;
  source.connect(offline.destination);
  source.start(0, startSec, clipDuration);

  const rendered = await offline.startRendering();
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  onProgress?.(80);

  const channelsData: Float32Array[] = [];
  for (let ch = 0; ch < rendered.numberOfChannels; ch++) {
    channelsData.push(rendered.getChannelData(ch));
  }

  const wavBytes = encodeFloatChannelsToWav(channelsData, targetSampleRate);
  const blob = new Blob([wavBytes.buffer as ArrayBuffer], { type: 'audio/wav' });
  const actualFormat = settings.format === 'wav' ? 'wav' : 'wav';
  onProgress?.(100);

  return {
    blob,
    filename: buildOutputFilename(file.name, actualFormat),
    actualFormat,
    notice:
      settings.format === 'wav'
        ? 'Encoded natively via Web Audio PCM.'
        : `FFmpeg WASM unavailable; encoded cleanly as WAV PCM via Web Audio API fallback.`,
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
  onLog?.('[Native Fallback] Using Canvas + MediaRecorder browser pipeline...');

  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.src = url;

  try {
    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(new Error(`Unable to decode video "${file.name}".`));
    });

    const origW = video.videoWidth || 640;
    const origH = video.videoHeight || 360;
    const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 3;

    if (settings.format === 'gif') {
      const targetW = Math.min(origW, Math.max(120, settings.gifWidth || 480));
      const targetH = Math.max(2, Math.round((origH / origW) * targetW));
      const fps = settings.fps === 'original' ? 12 : Math.min(20, settings.fps);
      const maxDuration = Math.min(duration, 10);
      const totalFrames = Math.max(2, Math.min(90, Math.floor(maxDuration * fps)));

      const canvas = document.createElement('canvas');
      canvas.width = targetW;
      canvas.height = targetH;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) throw new Error('Canvas 2D unavailable.');

      const frames: Uint8ClampedArray[] = [];
      for (let i = 0; i < totalFrames; i++) {
        if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
        const t = (i / totalFrames) * maxDuration;
        video.currentTime = t;
        await new Promise<void>((resolve) => {
          const onSeeked = () => {
            video.removeEventListener('seeked', onSeeked);
            resolve();
          };
          video.addEventListener('seeked', onSeeked, { once: true });
          setTimeout(resolve, 250);
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
    const maxH = getTargetVideoMaxHeight(settings.resolution);
    let targetW = origW;
    let targetH = origH;
    if (maxH && origH > maxH) {
      const ratio = maxH / origH;
      targetW = Math.max(2, Math.round((origW * ratio) / 2) * 2);
      targetH = Math.max(2, Math.round((origH * ratio) / 2) * 2);
    }

    const fps = settings.fps === 'original' ? 30 : settings.fps;
    const canvas = document.createElement('canvas');
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D unavailable.');

    const mimeCandidates =
      settings.format === 'mp4'
        ? ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm']
        : ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];

    const chosenMime =
      mimeCandidates.find((m) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(m)) ||
      'video/webm';
    const outExt = chosenMime.includes('mp4') ? 'mp4' : 'webm';

    const stream = canvas.captureStream(fps);
    const crfBitrateMap =
      settings.crf <= 18
        ? 4_000_000
        : settings.crf <= 23
        ? 2_200_000
        : settings.crf <= 28
        ? 1_200_000
        : 650_000;

    const recorder = new MediaRecorder(stream, {
      mimeType: chosenMime,
      videoBitsPerSecond: crfBitrateMap,
    });

    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunks.push(e.data);
    };

    const donePromise = new Promise<Blob>((resolve, reject) => {
      recorder.onstop = () => resolve(new Blob(chunks, { type: chosenMime.split(';')[0] }));
      recorder.onerror = () => reject(new Error('MediaRecorder transcoding failed.'));
    });

    onLog?.(`[Native Fallback] Recording ${targetW}x${targetH} @ ${fps}fps (${chosenMime})...`);
    recorder.start(200);
    video.currentTime = 0;

    let rafId = 0;
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

    const onAbort = () => {
      stopped = true;
      cancelAnimationFrame(rafId);
      video.pause();
      if (recorder.state !== 'inactive') recorder.stop();
    };
    signal?.addEventListener('abort', onAbort, { once: true });

    await video.play();
    drawLoop();

    await new Promise<void>((resolve) => {
      video.onended = () => resolve();
      // Safety cap if duration metadata is odd
      setTimeout(resolve, Math.min(120_000, (duration + 2) * 1000));
    });

    stopped = true;
    cancelAnimationFrame(rafId);
    if (recorder.state !== 'inactive') {
      recorder.stop();
    }
    signal?.removeEventListener('abort', onAbort);

    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const blob = await donePromise;
    onProgress?.(100);

    return {
      blob,
      filename: buildOutputFilename(file.name, outExt),
      actualFormat: outExt,
      notice: `FFmpeg WASM unavailable; transcoded natively via MediaRecorder (${outExt.toUpperCase()}).`,
    };
  } finally {
    video.pause();
    video.removeAttribute('src');
    URL.revokeObjectURL(url);
  }
}
