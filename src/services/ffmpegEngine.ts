import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';

const CORE_VERSION = '0.12.6';
const CDN_MIRRORS = [
  `https://unpkg.com/@ffmpeg/core@${CORE_VERSION}/dist/esm`,
  `https://cdn.jsdelivr.net/npm/@ffmpeg/core@${CORE_VERSION}/dist/esm`,
];

let ffmpegInstance: FFmpeg | null = null;
let ffmpegLoadPromise: Promise<FFmpeg> | null = null;
let ffmpegUnavailableReason: string | null = null;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${ms}ms`));
    }, ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

export async function getLoadedFfmpeg(
  onLog?: (msg: string) => void
): Promise<FFmpeg> {
  if (ffmpegUnavailableReason) {
    throw new Error(ffmpegUnavailableReason);
  }
  if (ffmpegInstance && ffmpegInstance.loaded) {
    return ffmpegInstance;
  }
  if (ffmpegLoadPromise) {
    return ffmpegLoadPromise;
  }

  ffmpegLoadPromise = (async () => {
    let lastError: unknown = null;

    for (const baseURL of CDN_MIRRORS) {
      try {
        onLog?.(`[FFmpeg WASM] Loading single-threaded core from ${baseURL}...`);
        const ffmpeg = new FFmpeg();

        const coreURL = await withTimeout(
          toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
          9000,
          'Fetch ffmpeg-core.js'
        );
        const wasmURL = await withTimeout(
          toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
          14000,
          'Fetch ffmpeg-core.wasm'
        );

        await withTimeout(
          ffmpeg.load({ coreURL, wasmURL }),
          12000,
          'FFmpeg WASM initialization'
        );

        ffmpegInstance = ffmpeg;
        onLog?.('[FFmpeg WASM] Core initialized (single-threaded mode).');
        return ffmpeg;
      } catch (err) {
        lastError = err;
        onLog?.(
          `[FFmpeg WASM] Mirror failed (${baseURL}): ${
            err instanceof Error ? err.message : String(err)
          }`
        );
      }
    }

    const reason =
      lastError instanceof Error
        ? lastError.message
        : 'Unable to load @ffmpeg/core WASM from CDN.';
    ffmpegUnavailableReason = reason;
    ffmpegLoadPromise = null;
    throw new Error(reason);
  })();

  return ffmpegLoadPromise;
}

export function terminateFfmpegInstance(): void {
  if (ffmpegInstance) {
    try {
      ffmpegInstance.terminate();
    } catch {
      // ignore termination errors
    }
    ffmpegInstance = null;
    ffmpegLoadPromise = null;
  }
}

export function resetFfmpegAvailability(): void {
  ffmpegUnavailableReason = null;
}

export async function runFfmpegCommand(params: {
  file: File;
  args: string[];
  inputName: string;
  outputName: string;
  outputMime: string;
  onProgress?: (pct: number) => void;
  onLog?: (msg: string) => void;
  signal?: AbortSignal;
}): Promise<Blob> {
  const { file, args, inputName, outputName, outputMime, onProgress, onLog, signal } = params;

  if (signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError');
  }

  const ffmpeg = await getLoadedFfmpeg(onLog);

  const handleLog = ({ message }: { message: string }) => {
    if (message && !message.startsWith('frame=')) {
      onLog?.(`[ffmpeg] ${message}`);
    }
  };

  const handleProgress = ({ progress }: { progress: number }) => {
    if (Number.isFinite(progress)) {
      const pct = Math.max(5, Math.min(99, Math.round(progress * 100)));
      onProgress?.(pct);
    }
  };

  const onAbort = () => {
    terminateFfmpegInstance();
  };

  signal?.addEventListener('abort', onAbort, { once: true });
  ffmpeg.on('log', handleLog);
  ffmpeg.on('progress', handleProgress);

  try {
    onProgress?.(5);
    onLog?.(`$ ffmpeg ${args.join(' ')}`);

    await ffmpeg.writeFile(inputName, await fetchFile(file));

    if (signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }

    const exitCode = await ffmpeg.exec(args);
    if (signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }
    if (exitCode !== 0) {
      throw new Error(`FFmpeg exited with code ${exitCode}`);
    }

    const data = await ffmpeg.readFile(outputName);
    const bytes = data instanceof Uint8Array ? data : new TextEncoder().encode(String(data));
    const bufferCopy = new Uint8Array(bytes.byteLength);
    bufferCopy.set(bytes);

    onProgress?.(100);
    return new Blob([bufferCopy.buffer], { type: outputMime });
  } finally {
    signal?.removeEventListener('abort', onAbort);
    try {
      ffmpeg.off('log', handleLog);
      ffmpeg.off('progress', handleProgress);
      await ffmpeg.deleteFile(inputName).catch(() => {});
      await ffmpeg.deleteFile(outputName).catch(() => {});
    } catch {
      // ignore cleanup errors if instance was terminated
    }
  }
}
