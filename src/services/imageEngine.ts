import { ImageSettings } from '../types/media';
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

async function decodeImageSource(file: File): Promise<{
  source: ImageBitmap | HTMLImageElement;
  width: number;
  height: number;
  cleanup: () => void;
}> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file);
      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        cleanup: () => bitmap.close(),
      };
    } catch {
      // Fall back to HTMLImageElement for formats createImageBitmap rejects
    }
  }

  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error(`Unable to decode image "${file.name}".`));
      el.src = url;
    });
    return {
      source: img,
      width: img.naturalWidth || img.width,
      height: img.naturalHeight || img.height,
      cleanup: () => URL.revokeObjectURL(url),
    };
  } catch (err) {
    URL.revokeObjectURL(url);
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

  onProgress?.(10);
  const decoded = await decodeImageSource(file);

  try {
    if (signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }

    const { width, height } = calculateTargetDimensions(
      decoded.width,
      decoded.height,
      settings.resize
    );

    onProgress?.(35);
    onLog?.(
      `[Canvas2D] Rendering ${decoded.width}x${decoded.height} -> ${width}x${height} (${settings.format.toUpperCase()}, q=${settings.quality}%)`
    );

    // Prefer OffscreenCanvas when available, fall back to HTMLCanvasElement
    const useOffscreen = typeof OffscreenCanvas !== 'undefined';
    const canvas = useOffscreen
      ? new OffscreenCanvas(width, height)
      : document.createElement('canvas');

    if (!useOffscreen) {
      (canvas as HTMLCanvasElement).width = width;
      (canvas as HTMLCanvasElement).height = height;
    }

    const ctx = canvas.getContext('2d', { willReadFrequently: settings.grayscale }) as
      | OffscreenCanvasRenderingContext2D
      | CanvasRenderingContext2D
      | null;

    if (!ctx) {
      throw new Error('2D Canvas context unavailable in this browser.');
    }

    const mustFlatten =
      settings.flattenAlpha || settings.format === 'jpg' || settings.format === 'bmp';

    if (mustFlatten) {
      ctx.fillStyle = settings.flattenColor || '#ffffff';
      ctx.fillRect(0, 0, width, height);
    }

    ctx.drawImage(decoded.source as CanvasImageSource, 0, 0, width, height);

    if (settings.grayscale) {
      const imgData = ctx.getImageData(0, 0, width, height);
      const data = imgData.data;
      for (let i = 0; i < data.length; i += 4) {
        const lum = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
        data[i] = lum;
        data[i + 1] = lum;
        data[i + 2] = lum;
      }
      ctx.putImageData(imgData, 0, 0);
    }

    onProgress?.(70);

    if (signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }

    if (settings.format === 'bmp') {
      const imgData = ctx.getImageData(0, 0, width, height);
      const bmpBytes = encodeRgbaToBmp(imgData.data, width, height);
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
    const qualityFloat = Math.max(0.01, Math.min(1, settings.quality / 100));

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

    let actualFormat: string = settings.format;
    let notice: string | undefined;

    // Some browsers silently fall back to PNG if AVIF encoding isn't supported
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
  }
}
