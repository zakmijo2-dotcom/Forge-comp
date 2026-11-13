import { ImageFormat, ImageSettings } from '../types/media';
import { encodeRgbaToBmp } from '../utils/binaryEncoders';
import {
  buildOutputFilename,
  calculateTargetDimensions,
  getImageMimeType,
} from '../utils/mediaUtils';

export interface ImageProcessResult {
  blob: Blob;
  width: number;
  height: number;
  filename: string;
  actualFormat: string;
  usedFallbackNotice?: string;
}

const VALID_IMAGE_FORMATS = new Set<ImageFormat>(['jpg', 'png', 'webp', 'avif', 'bmp']);
const MAX_CANVAS_DIMENSION = 8192;
const MAX_CANVAS_PIXELS = 33_554_432; // ~33.5 MP ceiling to prevent browser canvas allocation failure

export function clampImageQuality(quality: number): number {
  if (!Number.isFinite(quality)) return 82;
  return Math.max(1, Math.min(100, Math.round(quality)));
}

export function clampCanvasDimensions(
  width: number,
  height: number
): { width: number; height: number; scaledDown: boolean } {
  let w = Math.max(1, Math.round(width));
  let h = Math.max(1, Math.round(height));
  let scaledDown = false;

  if (w > MAX_CANVAS_DIMENSION || h > MAX_CANVAS_DIMENSION) {
    const ratio = Math.min(MAX_CANVAS_DIMENSION / w, MAX_CANVAS_DIMENSION / h);
    w = Math.max(1, Math.round(w * ratio));
    h = Math.max(1, Math.round(h * ratio));
    scaledDown = true;
  }

  if (w * h > MAX_CANVAS_PIXELS) {
    const ratio = Math.sqrt(MAX_CANVAS_PIXELS / (w * h));
    w = Math.max(1, Math.floor(w * ratio));
    h = Math.max(1, Math.floor(h * ratio));
    scaledDown = true;
  }

  return { width: w, height: h, scaledDown };
}

async function decodeImageSource(
  file: File,
  signal?: AbortSignal
): Promise<{
  source: ImageBitmap | HTMLImageElement;
  width: number;
  height: number;
  cleanup: () => void;
}> {
  if (signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError');
  }

  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file);
      if (signal?.aborted) {
        bitmap.close();
        throw new DOMException('Aborted', 'AbortError');
      }
      if (bitmap.width <= 0 || bitmap.height <= 0) {
        bitmap.close();
        throw new Error(`Decoded image "${file.name}" has invalid zero dimensions.`);
      }
      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        cleanup: () => {
          try {
            bitmap.close();
          } catch {
            // ignore double close
          }
        },
      };
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        throw err;
      }
      // Fall back to HTMLImageElement for formats createImageBitmap rejects
    }
  }

  if (typeof URL === 'undefined' || typeof Image === 'undefined') {
    throw new Error('Browser Image decoding APIs are unavailable in this environment.');
  }

  const url = URL.createObjectURL(file);
  let revoked = false;
  const revokeOnce = () => {
    if (revoked) return;
    revoked = true;
    try {
      URL.revokeObjectURL(url);
    } catch {
      // ignore
    }
  };

  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      const onAbort = () => {
        el.onload = null;
        el.onerror = null;
        el.src = '';
        reject(new DOMException('Aborted', 'AbortError'));
      };
      signal?.addEventListener('abort', onAbort, { once: true });

      el.onload = () => {
        signal?.removeEventListener('abort', onAbort);
        resolve(el);
      };
      el.onerror = () => {
        signal?.removeEventListener('abort', onAbort);
        reject(new Error(`Unable to decode image "${file.name}".`));
      };
      el.src = url;
    });

    const width = img.naturalWidth || img.width;
    const height = img.naturalHeight || img.height;
    if (width <= 0 || height <= 0) {
      revokeOnce();
      throw new Error(`Decoded image "${file.name}" has invalid dimensions.`);
    }

    return {
      source: img,
      width,
      height,
      cleanup: () => {
        img.src = '';
        revokeOnce();
      },
    };
  } catch (err) {
    revokeOnce();
    throw err;
  }
}

export async function processImageFile(
  file: File,
  settings: ImageSettings,
  onProgress?: (pct: number) => void,
  onLog?: (msg: string) => void,
  signal?: AbortSignal
): Promise<ImageProcessResult> {
  if (signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError');
  }
  if (!file || file.size <= 0) {
    throw new Error(`Image file "${file?.name || 'unknown'}" is empty or invalid.`);
  }
  if (!VALID_IMAGE_FORMATS.has(settings.format)) {
    throw new Error(`Unsupported target image format: "${String(settings.format)}".`);
  }

  const safeQuality = clampImageQuality(settings.quality);

  onProgress?.(10);
  const decoded = await decodeImageSource(file, signal);

  let htmlCanvasToRelease: HTMLCanvasElement | null = null;

  try {
    if (signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }

    const requestedDims = calculateTargetDimensions(
      decoded.width,
      decoded.height,
      settings.resize
    );
    const { width, height, scaledDown } = clampCanvasDimensions(
      requestedDims.width,
      requestedDims.height
    );

    if (scaledDown) {
      onLog?.(
        `[Canvas2D] Clamped oversized dimensions ${requestedDims.width}x${requestedDims.height} -> ${width}x${height} to stay within safe GPU/Canvas memory limits.`
      );
    }

    onProgress?.(35);
    onLog?.(
      `[Canvas2D] Rendering ${decoded.width}x${decoded.height} -> ${width}x${height} (${settings.format.toUpperCase()}, q=${safeQuality}%)`
    );

    const useOffscreen = typeof OffscreenCanvas !== 'undefined';
    const canvas = useOffscreen
      ? new OffscreenCanvas(width, height)
      : document.createElement('canvas');

    if (!useOffscreen) {
      htmlCanvasToRelease = canvas as HTMLCanvasElement;
      htmlCanvasToRelease.width = width;
      htmlCanvasToRelease.height = height;
    }

    const needsPixelRead = Boolean(settings.grayscale || settings.format === 'bmp');
    const ctx = canvas.getContext('2d', { willReadFrequently: needsPixelRead }) as
      | OffscreenCanvasRenderingContext2D
      | CanvasRenderingContext2D
      | null;

    if (!ctx) {
      throw new Error('2D Canvas context unavailable in this browser.');
    }

    const mustFlatten =
      settings.flattenAlpha || settings.format === 'jpg' || settings.format === 'bmp';

    if (mustFlatten) {
      ctx.fillStyle = /^#[0-9a-fA-F]{3,8}$/.test(settings.flattenColor || '')
        ? settings.flattenColor
        : '#ffffff';
      ctx.fillRect(0, 0, width, height);
    }

    ctx.drawImage(decoded.source as CanvasImageSource, 0, 0, width, height);
    // Release decoded source bitmap early to minimize peak memory footprint for large images
    decoded.cleanup();

    let pixelDataForBmp: Uint8ClampedArray | null = null;

    if (needsPixelRead) {
      const imgData = ctx.getImageData(0, 0, width, height);
      const data = imgData.data;

      if (settings.grayscale) {
        for (let i = 0; i < data.length; i += 4) {
          const lum = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
          data[i] = lum;
          data[i + 1] = lum;
          data[i + 2] = lum;
        }
        if (settings.format !== 'bmp') {
          ctx.putImageData(imgData, 0, 0);
        }
      }

      if (settings.format === 'bmp') {
        pixelDataForBmp = data;
      }
    }

    onProgress?.(70);

    if (signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }

    if (settings.format === 'bmp' && pixelDataForBmp) {
      const bmpBytes = encodeRgbaToBmp(pixelDataForBmp, width, height);
      const blob = new Blob([bmpBytes.buffer as ArrayBuffer], { type: 'image/bmp' });
      onProgress?.(100);
      return {
        blob,
        width,
        height,
        filename: buildOutputFilename(file.name, 'bmp'),
        actualFormat: 'bmp',
      };
    }

    const targetMime = getImageMimeType(settings.format);
    const qualityFloat = Math.max(0.01, Math.min(1, safeQuality / 100));

    let blob: Blob;
    if (useOffscreen && 'convertToBlob' in canvas) {
      blob = await (canvas as OffscreenCanvas).convertToBlob({
        type: targetMime,
        quality: settings.format === 'png' ? undefined : qualityFloat,
      });
    } else {
      blob = await new Promise<Blob>((resolve, reject) => {
        (canvas as HTMLCanvasElement).toBlob(
          (result) => {
            if (result) resolve(result);
            else reject(new Error(`Failed to encode image as ${settings.format.toUpperCase()}.`));
          },
          targetMime,
          settings.format === 'png' ? undefined : qualityFloat
        );
      });
    }

    if (signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }

    let actualFormat: string = settings.format;
    let notice: string | undefined;

    // Browsers silently fall back to image/png if AVIF or WebP encoding is unsupported
    if (settings.format === 'avif' && blob.type !== 'image/avif') {
      onLog?.('[Canvas2D] Browser lacks native AVIF encoder; falling back to WebP.');
      const fallbackMime = 'image/webp';
      if (useOffscreen && 'convertToBlob' in canvas) {
        blob = await (canvas as OffscreenCanvas).convertToBlob({
          type: fallbackMime,
          quality: qualityFloat,
        });
      } else {
        blob = await new Promise<Blob>((resolve, reject) => {
          (canvas as HTMLCanvasElement).toBlob(
            (r) => (r ? resolve(r) : reject(new Error('WebP fallback encoding failed.'))),
            fallbackMime,
            qualityFloat
          );
        });
      }
      actualFormat = 'webp';
      notice = 'Browser AVIF encoding unsupported; encoded as WebP.';
    }

    if (settings.stripExif) {
      onLog?.('[Privacy] EXIF, GPS, and camera metadata stripped via clean Canvas re-encode.');
    }

    onProgress?.(100);
    return {
      blob,
      width,
      height,
      filename: buildOutputFilename(file.name, actualFormat),
      actualFormat,
      usedFallbackNotice: notice,
    };
  } finally {
    decoded.cleanup();
    if (htmlCanvasToRelease) {
      htmlCanvasToRelease.width = 0;
      htmlCanvasToRelease.height = 0;
    }
  }
}
