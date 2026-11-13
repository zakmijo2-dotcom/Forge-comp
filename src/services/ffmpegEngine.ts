import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile } from '@ffmpeg/util';

const CORE_VERSION = '0.12.6';
const FFMPEG_CACHE_NAME = `mediaforge-ffmpeg-core-v${CORE_VERSION}`;

const LOCAL_CORE_BASE = '/ffmpeg';
const CDN_MIRRORS = [
  LOCAL_CORE_BASE,
  `https://unpkg.com/@ffmpeg/core@${CORE_VERSION}/dist/esm`,
  `https://cdn.jsdelivr.net/npm/@ffmpeg/core@${CORE_VERSION}/dist/esm`,
];

let ffmpegInstance: FFmpeg | null = null;
let ffmpegLoadPromise: Promise<FFmpeg> | null = null;
let ffmpegUnavailableReason: string | null = null;
let activeCoreBlobUrls: string[] = [];

// Mutex chain to serialize FFmpeg WASM commands and protect its single-threaded virtual filesystem
let ffmpegMutexChain: Promise<unknown> = Promise.resolve();
let jobSequence = 0;

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

function revokeCoreBlobUrls(): void {
  if (typeof URL === 'undefined') return;
  for (const url of activeCoreBlobUrls) {
    try {
      URL.revokeObjectURL(url);
    } catch {
      // ignore
    }
  }
  activeCoreBlobUrls = [];
}

/**
 * Fetches an asset with persistent CacheStorage backing so that after the first
 * online load, FFmpeg WASM core loads 100% offline from browser storage.
 */
async function fetchAssetBlobUrlWithCache(
  url: string,
  mimeType: string,
  timeoutMs: number,
  onLog?: (msg: string) => void
): Promise<{ blobUrl: string; fromCache: boolean }> {
  const canUseCache = typeof caches !== 'undefined' && typeof caches.open === 'function';

  if (canUseCache) {
    try {
      const cache = await caches.open(FFMPEG_CACHE_NAME);
      const cachedResp = await cache.match(url);
      if (cachedResp && cachedResp.ok) {
        const buf = await cachedResp.arrayBuffer();
        if (buf.byteLength > 1024) {
          const blob = new Blob([buf], { type: mimeType });
          const blobUrl = URL.createObjectURL(blob);
          activeCoreBlobUrls.push(blobUrl);
          return { blobUrl, fromCache: true };
        }
      }
    } catch {
      // Ignore CacheStorage read restrictions in sandboxed contexts
    }
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} for ${url}`);
    }
    const contentType = (response.headers.get('content-type') || '').toLowerCase();
    // Guard against SPA fallback returning index.html for missing /ffmpeg/* local files
    if (contentType.includes('text/html')) {
      throw new Error(`Asset ${url} returned HTML instead of ${mimeType}`);
    }

    const buf = await response.arrayBuffer();
    if (buf.byteLength < 1024) {
      throw new Error(`Asset ${url} is unexpectedly small (${buf.byteLength} bytes)`);
    }

    if (canUseCache) {
      try {
        const cache = await caches.open(FFMPEG_CACHE_NAME);
        await cache.put(
          url,
          new Response(buf.slice(0), {
            headers: { 'Content-Type': mimeType },
          })
        );
      } catch {
        // Ignore quota or storage restrictions
      }
    }

    const blob = new Blob([buf], { type: mimeType });
    const blobUrl = URL.createObjectURL(blob);
    activeCoreBlobUrls.push(blobUrl);
    return { blobUrl, fromCache: false };
  } catch (err) {
    onLog?.(
      `[FFmpeg WASM] Source unavailable (${url}): ${
        err instanceof Error ? err.message : String(err)
      }`
    );
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export async function isFfmpegCachedOffline(): Promise<boolean> {
  if (typeof caches === 'undefined' || typeof caches.open !== 'function') {
    return false;
  }
  try {
    const cache = await caches.open(FFMPEG_CACHE_NAME);
    const keys = await cache.keys();
    return keys.length >= 2;
  } catch {
    return false;
  }
}

export async function getLoadedFfmpeg(
  onLog?: (msg: string) => void
): Promise<FFmpeg> {
  if (ffmpegInstance && ffmpegInstance.loaded) {
    return ffmpegInstance;
  }
  if (ffmpegLoadPromise) {
    return ffmpegLoadPromise;
  }
  if (ffmpegUnavailableReason) {
    throw new Error(ffmpegUnavailableReason);
  }

  ffmpegLoadPromise = (async () => {
    let lastError: unknown = null;

    for (const baseURL of CDN_MIRRORS) {
      const isLocalPath = baseURL === LOCAL_CORE_BASE;
      try {
        if (!isLocalPath) {
          onLog?.(`[FFmpeg WASM] Resolving single-threaded core from ${baseURL}...`);
        }

        const coreAsset = await fetchAssetBlobUrlWithCache(
          `${baseURL}/ffmpeg-core.js`,
          'text/javascript',
          isLocalPath ? 2500 : 9000,
          isLocalPath ? undefined : onLog
        );
        const wasmAsset = await fetchAssetBlobUrlWithCache(
          `${baseURL}/ffmpeg-core.wasm`,
          'application/wasm',
          isLocalPath ? 4000 : 14000,
          isLocalPath ? undefined : onLog
        );

        const ffmpeg = new FFmpeg();
        await withTimeout(
          ffmpeg.load({ coreURL: coreAsset.blobUrl, wasmURL: wasmAsset.blobUrl }),
          12000,
          'FFmpeg WASM initialization'
        );

        ffmpegInstance = ffmpeg;
        const sourceLabel = isLocalPath
          ? 'local /ffmpeg bundle'
          : coreAsset.fromCache && wasmAsset.fromCache
          ? 'offline browser CacheStorage'
          : `${baseURL} (cached for offline reuse)`;
        onLog?.(`[FFmpeg WASM] Core initialized from ${sourceLabel}.`);
        return ffmpeg;
      } catch (err) {
        lastError = err;
        revokeCoreBlobUrls();
      }
    }

    const reason =
      lastError instanceof Error
        ? lastError.message
        : 'Unable to load @ffmpeg/core WASM from local assets, offline cache, or CDN.';
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
  }
  ffmpegLoadPromise = null;
  revokeCoreBlobUrls();
}

export function resetFfmpegAvailability(): void {
  ffmpegUnavailableReason = null;
}

function sanitizeVfsFilename(name: string, fallback: string): string {
  const clean = name.replace(/[^a-zA-Z0-9._-]/g, '_');
  return clean || fallback;
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
  if (!file || file.size <= 0) {
    throw new Error(`Input file "${file?.name || 'unknown'}" is empty or invalid.`);
  }

  // Serialize execution on the shared single-threaded FFmpeg WASM instance
  const executeJob = async (): Promise<Blob> => {
    if (signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }

    // If a previous job was aborted and terminated the instance, allow a fresh load
    resetFfmpegAvailability();
    const ffmpeg = await getLoadedFfmpeg(onLog);

    const jobId = ++jobSequence;
    const safeIn = sanitizeVfsFilename(inputName, `in_${jobId}.bin`);
    const safeOut = sanitizeVfsFilename(outputName, `out_${jobId}.bin`);
    const normalizedArgs = args.map((arg) => {
      if (arg === inputName) return safeIn;
      if (arg === outputName) return safeOut;
      return arg;
    });

    const handleLog = ({ message }: { message: string }) => {
      if (message && !message.startsWith('frame=')) {
        onLog?.(`[ffmpeg] ${message}`);
      }
    };

    const handleProgress = ({ progress }: { progress: number }) => {
      if (signal?.aborted) return;
      if (Number.isFinite(progress)) {
        const clamped = Math.max(0, Math.min(1, progress));
        const pct = Math.max(5, Math.min(99, Math.round(clamped * 100)));
        onProgress?.(pct);
      }
    };

    let wasTerminatedOnAbort = false;
    const onAbort = () => {
      wasTerminatedOnAbort = true;
      terminateFfmpegInstance();
    };

    signal?.addEventListener('abort', onAbort, { once: true });
    ffmpeg.on('log', handleLog);
    ffmpeg.on('progress', handleProgress);

    try {
      onProgress?.(5);
      onLog?.(`$ ffmpeg ${normalizedArgs.join(' ')}`);

      const inputBytes = await fetchFile(file);
      if (signal?.aborted || wasTerminatedOnAbort) {
        throw new DOMException('Aborted', 'AbortError');
      }

      await ffmpeg.writeFile(safeIn, inputBytes);

      if (signal?.aborted || wasTerminatedOnAbort) {
        throw new DOMException('Aborted', 'AbortError');
      }

      const exitCode = await ffmpeg.exec(normalizedArgs);
      if (signal?.aborted || wasTerminatedOnAbort) {
        throw new DOMException('Aborted', 'AbortError');
      }
      if (exitCode !== 0) {
        throw new Error(`FFmpeg exited with non-zero code ${exitCode}`);
      }

      const data = await ffmpeg.readFile(safeOut);
      const bytes = data instanceof Uint8Array ? data : new TextEncoder().encode(String(data));
      if (bytes.byteLength === 0) {
        throw new Error('FFmpeg produced an empty (0-byte) output file.');
      }

      const bufferCopy = new Uint8Array(bytes.byteLength);
      bufferCopy.set(bytes);

      onProgress?.(100);
      return new Blob([bufferCopy.buffer], { type: outputMime });
    } finally {
      signal?.removeEventListener('abort', onAbort);
      try {
        ffmpeg.off('log', handleLog);
        ffmpeg.off('progress', handleProgress);
      } catch {
        // ignore listener removal if instance terminated
      }
      if (!wasTerminatedOnAbort && ffmpegInstance === ffmpeg && ffmpeg.loaded) {
        await ffmpeg.deleteFile(safeIn).catch(() => {});
        await ffmpeg.deleteFile(safeOut).catch(() => {});
      }
    }
  };

  const nextJobPromise = ffmpegMutexChain.then(executeJob, executeJob);
  ffmpegMutexChain = nextJobPromise.then(
    () => undefined,
    () => undefined
  );
  return nextJobPromise;
}
