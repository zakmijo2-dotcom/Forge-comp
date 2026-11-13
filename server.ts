import { execFile, spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import dotenv from 'dotenv';
import express, { Request, Response, NextFunction } from 'express';
import { buildOutputFilename, parseTimestampToSeconds } from './src/utils/mediaUtils';

dotenv.config();

export interface BridgeServerOptions {
  ffmpegPath?: string;
  apiKey?: string;
  maxUploadSize?: number;
  processTimeoutMs?: number;
  tempRootDir?: string;
}

const ALLOWED_KINDS = new Set(['image', 'video', 'audio', 'audio-extract']);
const ALLOWED_IMAGE_FORMATS = new Set(['jpg', 'jpeg', 'png', 'webp', 'avif', 'bmp']);
const ALLOWED_VIDEO_FORMATS = new Set(['mp4', 'webm', 'mkv', 'mov', 'avi', 'gif']);
const ALLOWED_AUDIO_FORMATS = new Set(['mp3', 'm4a', 'wav', 'ogg', 'flac']);
const ALLOWED_VIDEO_CODECS = new Set(['h264', 'h265', 'vp9', 'vp8']);
const ALLOWED_PRESETS = new Set([
  'ultrafast',
  'superfast',
  'veryfast',
  'faster',
  'fast',
  'medium',
  'slow',
  'slower',
  'veryslow',
]);
const ALLOWED_IMAGE_RESIZE = new Set([
  'original',
  '4k',
  '1080p',
  '720p',
  '480p',
  '75%',
  '50%',
  '25%',
]);
const ALLOWED_VIDEO_RES = new Set(['original', '1080p', '720p', '480p', '360p']);
const ALLOWED_SAMPLE_RATES = new Set([48000, 44100, 22050]);
const ALLOWED_BITRATES = new Set(['320k', '256k', '192k', '128k', '64k']);

const MIME_BY_EXT: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  avif: 'image/avif',
  bmp: 'image/bmp',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mkv: 'video/x-matroska',
  mov: 'video/quicktime',
  avi: 'video/x-msvideo',
  gif: 'image/gif',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  flac: 'audio/flac',
};

export async function checkFfmpegAvailable(ffmpegPath: string): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    try {
      execFile(
        ffmpegPath,
        ['-version'],
        { timeout: 4000, windowsHide: true },
        (error, stdout) => {
          if (error) {
            resolve(false);
            return;
          }
          resolve(typeof stdout === 'string' && stdout.toLowerCase().includes('ffmpeg version'));
        }
      );
    } catch {
      resolve(false);
    }
  });
}

export interface ValidatedConversionPlan {
  args: string[];
  outputExt: string;
  outputMime: string;
}

export function buildBridgeFfmpegPlan(
  inputPath: string,
  outputPath: string,
  rawParams: Record<string, unknown>
): ValidatedConversionPlan {
  if (!rawParams || typeof rawParams !== 'object') {
    throw new Error('Invalid conversion parameters payload.');
  }

  const kind = String(rawParams.kind || '');
  if (!ALLOWED_KINDS.has(kind)) {
    throw new Error(`Unsupported conversion kind: "${kind}".`);
  }

  const rawPreset = String(rawParams.preset || 'veryfast').toLowerCase();
  const preset = ALLOWED_PRESETS.has(rawPreset) ? rawPreset : 'veryfast';

  if (kind === 'image') {
    const format = String(rawParams.format || '').toLowerCase();
    if (!ALLOWED_IMAGE_FORMATS.has(format)) {
      throw new Error(`Unsupported image format: "${format}".`);
    }

    const quality = Number(rawParams.quality ?? 82);
    if (!Number.isFinite(quality) || quality < 1 || quality > 100) {
      throw new Error('Invalid image quality parameter (must be 1..100).');
    }

    const resize = String(rawParams.resize || 'original');
    if (!ALLOWED_IMAGE_RESIZE.has(resize)) {
      throw new Error(`Unsupported image resize mode: "${resize}".`);
    }

    const filters: string[] = [];
    if (resize === '4k') filters.push("scale='min(3840,iw)':'min(2160,ih)':force_original_aspect_ratio=decrease");
    else if (resize === '1080p') filters.push("scale='min(1920,iw)':'min(1080,ih)':force_original_aspect_ratio=decrease");
    else if (resize === '720p') filters.push("scale='min(1280,iw)':'min(720,ih)':force_original_aspect_ratio=decrease");
    else if (resize === '480p') filters.push("scale='min(854,iw)':'min(480,ih)':force_original_aspect_ratio=decrease");
    else if (resize === '75%') filters.push('scale=iw*0.75:ih*0.75');
    else if (resize === '50%') filters.push('scale=iw*0.5:ih*0.5');
    else if (resize === '25%') filters.push('scale=iw*0.25:ih*0.25');

    if (Boolean(rawParams.grayscale)) {
      filters.push('format=gray');
    }

    const args: string[] = ['-y', '-i', inputPath];
    if (filters.length > 0) {
      args.push('-vf', filters.join(','));
    }
    if (Boolean(rawParams.stripExif)) {
      args.push('-map_metadata', '-1');
    }

    const outExt = format === 'jpeg' ? 'jpg' : format;
    if (outExt === 'jpg') {
      const qscale = Math.max(2, Math.min(31, Math.round(31 - (quality / 100) * 29)));
      args.push('-frames:v', '1', '-q:v', String(qscale));
    } else if (outExt === 'webp') {
      args.push('-frames:v', '1', '-quality', String(Math.round(quality)));
    } else if (outExt === 'avif') {
      const crf = Math.max(10, Math.min(50, Math.round(55 - (quality / 100) * 42)));
      args.push('-frames:v', '1', '-c:v', 'libaom-av1', '-still-picture', '1', '-crf', String(crf));
    } else {
      args.push('-frames:v', '1');
    }

    args.push(outputPath);
    return {
      args,
      outputExt: outExt,
      outputMime: MIME_BY_EXT[outExt] || 'application/octet-stream',
    };
  }

  if (kind === 'video') {
    const format = String(rawParams.format || '').toLowerCase();
    if (!ALLOWED_VIDEO_FORMATS.has(format)) {
      throw new Error(`Unsupported video format: "${format}".`);
    }

    const rawFps = rawParams.fps;
    let fpsNum: number | null = null;
    if (rawFps !== undefined && rawFps !== 'original') {
      fpsNum = Number(rawFps);
      if (!Number.isInteger(fpsNum) || fpsNum < 1 || fpsNum > 120) {
        throw new Error('Invalid video frame rate parameter.');
      }
    }

    if (format === 'gif') {
      const gifWidth = Number(rawParams.gifWidth ?? 480);
      if (!Number.isInteger(gifWidth) || gifWidth < 64 || gifWidth > 2560) {
        throw new Error('Invalid gifWidth parameter (must be 64..2560).');
      }
      const fps = fpsNum ?? 15;
      const filter = `fps=${fps},scale=${gifWidth}:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse`;
      return {
        args: ['-y', '-i', inputPath, '-vf', filter, '-loop', '0', outputPath],
        outputExt: 'gif',
        outputMime: MIME_BY_EXT.gif,
      };
    }

    const codec = String(rawParams.codec || 'h264').toLowerCase();
    if (!ALLOWED_VIDEO_CODECS.has(codec)) {
      throw new Error(`Unsupported video codec: "${codec}".`);
    }

    const crf = Number(rawParams.crf ?? 23);
    if (!Number.isFinite(crf) || crf < 0 || crf > 51) {
      throw new Error('Invalid video CRF parameter (must be 0..51).');
    }

    const resolution = String(rawParams.resolution || 'original');
    if (!ALLOWED_VIDEO_RES.has(resolution)) {
      throw new Error(`Unsupported video resolution preset: "${resolution}".`);
    }

    const args: string[] = ['-y', '-i', inputPath];
    const filters: string[] = [];

    if (resolution !== 'original') {
      const maxH =
        resolution === '1080p'
          ? 1080
          : resolution === '720p'
          ? 720
          : resolution === '480p'
          ? 480
          : 360;
      filters.push(`scale=-2:'min(${maxH},ih)'`);
    }
    if (fpsNum !== null) {
      filters.push(`fps=${fpsNum}`);
    }
    if (filters.length > 0) {
      args.push('-vf', filters.join(','));
    }

    const muteAudio = Boolean(rawParams.muteAudio);

    if (format === 'webm') {
      const vCodec = codec === 'vp8' ? 'libvpx' : 'libvpx-vp9';
      args.push('-c:v', vCodec, '-crf', String(Math.round(crf)), '-b:v', '0');
      if (vCodec === 'libvpx-vp9') {
        args.push('-deadline', 'realtime', '-cpu-used', '4');
      }
      if (muteAudio) args.push('-an');
      else args.push('-c:a', 'libopus', '-b:a', '128k');
    } else if (format === 'avi') {
      args.push('-c:v', 'mpeg4', '-q:v', String(Math.max(2, Math.round(crf / 3))));
      if (muteAudio) args.push('-an');
      else args.push('-c:a', 'libmp3lame', '-b:a', '128k');
    } else {
      const vCodec = codec === 'h265' ? 'libx265' : 'libx264';
      args.push(
        '-c:v',
        vCodec,
        '-crf',
        String(Math.round(crf)),
        '-preset',
        preset,
        '-pix_fmt',
        'yuv420p'
      );
      if (format === 'mp4' || format === 'mov') {
        args.push('-movflags', '+faststart');
      }
      if (muteAudio) args.push('-an');
      else args.push('-c:a', 'aac', '-b:a', '128k');
    }

    args.push(outputPath);
    return {
      args,
      outputExt: format,
      outputMime: MIME_BY_EXT[format] || 'application/octet-stream',
    };
  }

  // Audio or audio-extract
  const format = String(rawParams.format || '').toLowerCase();
  if (!ALLOWED_AUDIO_FORMATS.has(format)) {
    throw new Error(`Unsupported audio format: "${format}".`);
  }

  const sampleRate = Number(rawParams.sampleRate ?? 44100);
  if (!ALLOWED_SAMPLE_RATES.has(sampleRate)) {
    throw new Error(`Invalid audio sampleRate: "${sampleRate}".`);
  }

  const channels = String(rawParams.channels || 'stereo').toLowerCase();
  if (channels !== 'stereo' && channels !== 'mono') {
    throw new Error(`Invalid audio channels setting: "${channels}".`);
  }

  const rawBitrate = String(rawParams.bitrate || '192k').toLowerCase();
  const normalizedBitrate = /^\d+$/.test(rawBitrate) ? `${rawBitrate}k` : rawBitrate;
  if (!ALLOWED_BITRATES.has(normalizedBitrate)) {
    throw new Error(`Invalid audio bitrate: "${rawBitrate}".`);
  }

  const trimStartStr = String(rawParams.trimStart || '').trim();
  const trimEndStr = String(rawParams.trimEnd || '').trim();
  const startSec = parseTimestampToSeconds(trimStartStr);
  const endSec = parseTimestampToSeconds(trimEndStr);

  if (trimStartStr && startSec === null) {
    throw new Error('Invalid trimStart timestamp.');
  }
  if (trimEndStr && endSec === null) {
    throw new Error('Invalid trimEnd timestamp.');
  }
  if (startSec !== null && endSec !== null && endSec <= startSec) {
    throw new Error('trimEnd must be greater than trimStart.');
  }

  const args: string[] = ['-y'];
  if (startSec !== null && startSec > 0) {
    args.push('-ss', String(startSec));
  }
  if (endSec !== null && (startSec === null || endSec > startSec)) {
    args.push('-to', String(endSec));
  }

  args.push('-i', inputPath);
  if (kind === 'audio-extract') {
    args.push('-vn');
  }
  args.push('-ar', String(sampleRate));
  args.push('-ac', channels === 'mono' ? '1' : '2');

  switch (format) {
    case 'mp3':
      args.push('-c:a', 'libmp3lame', '-b:a', normalizedBitrate);
      break;
    case 'm4a':
      args.push('-c:a', 'aac', '-b:a', normalizedBitrate);
      break;
    case 'ogg':
      args.push('-c:a', 'libopus', '-b:a', normalizedBitrate);
      break;
    case 'wav':
      args.push('-c:a', 'pcm_s16le');
      break;
    case 'flac':
      args.push('-c:a', 'flac');
      break;
  }

  args.push(outputPath);
  return {
    args,
    outputExt: format,
    outputMime: MIME_BY_EXT[format] || 'application/octet-stream',
  };
}

interface ParsedMultipartUpload {
  filename: string;
  fileBuffer: Buffer;
  paramsJson: string;
}

function findSubbufferIndex(haystack: Buffer, needle: Buffer, fromOffset = 0): number {
  return haystack.indexOf(needle, fromOffset);
}

/**
 * Dependency-free RFC 7578 multipart/form-data parser with strict size limits
 * and path-traversal protection.
 */
async function parseMultipartConvertRequest(
  req: Request,
  maxBytes: number
): Promise<ParsedMultipartUpload> {
  const contentType = String(req.headers['content-type'] || '');
  const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  const boundary = (boundaryMatch?.[1] || boundaryMatch?.[2] || '').trim();
  if (!contentType.toLowerCase().includes('multipart/form-data') || !boundary) {
    throw Object.assign(new Error('Content-Type must be multipart/form-data with boundary.'), {
      statusCode: 400,
    });
  }

  const chunks: Buffer[] = [];
  let totalBytes = 0;

  await new Promise<void>((resolve, reject) => {
    const onData = (chunk: Buffer) => {
      totalBytes += chunk.length;
      if (totalBytes > maxBytes) {
        cleanup();
        reject(
          Object.assign(
            new Error(`Upload exceeds maximum allowed size (${maxBytes} bytes).`),
            { statusCode: 413 }
          )
        );
        return;
      }
      chunks.push(chunk);
    };
    const onEnd = () => {
      cleanup();
      resolve();
    };
    const onError = (err: Error) => {
      cleanup();
      reject(err);
    };
    const cleanup = () => {
      req.off('data', onData);
      req.off('end', onEnd);
      req.off('error', onError);
    };

    req.on('data', onData);
    req.on('end', onEnd);
    req.on('error', onError);
  });

  const rawBody = Buffer.concat(chunks);
  const boundaryBuf = Buffer.from(`--${boundary}`);
  const headerSep = Buffer.from('\r\n\r\n');

  let filename = '';
  let fileBuffer: Buffer | null = null;
  let paramsJson = '';

  let pos = findSubbufferIndex(rawBody, boundaryBuf, 0);
  while (pos !== -1) {
    const partStart = pos + boundaryBuf.length;
    if (rawBody.subarray(partStart, partStart + 2).equals(Buffer.from('--'))) {
      break; // closing boundary --boundary--
    }
    const contentStart =
      rawBody.subarray(partStart, partStart + 2).equals(Buffer.from('\r\n'))
        ? partStart + 2
        : partStart;

    const nextBoundary = findSubbufferIndex(rawBody, boundaryBuf, contentStart);
    if (nextBoundary === -1) break;

    const headerEnd = findSubbufferIndex(rawBody, headerSep, contentStart);
    if (headerEnd !== -1 && headerEnd < nextBoundary) {
      const rawHeaders = rawBody.subarray(contentStart, headerEnd).toString('utf8');
      const bodyStart = headerEnd + 4;
      // Strip trailing \r\n before next boundary
      const bodyEnd =
        rawBody[nextBoundary - 2] === 0x0d && rawBody[nextBoundary - 1] === 0x0a
          ? nextBoundary - 2
          : nextBoundary;

      const partData = rawBody.subarray(bodyStart, bodyEnd);
      const nameMatch = rawHeaders.match(/name="([^"]+)"/i);
      const fieldName = nameMatch?.[1] || '';

      if (fieldName === 'file') {
        const fnMatch = rawHeaders.match(/filename="([^"]*)"/i);
        const rawFn = fnMatch?.[1] || 'upload.bin';
        if (rawFn.includes('..') || rawFn.includes('/') || rawFn.includes('\\') || rawFn.includes('\0')) {
          throw Object.assign(new Error('Invalid filename: path traversal characters rejected.'), {
            statusCode: 400,
          });
        }
        filename = path.basename(rawFn);
        fileBuffer = partData;
      } else if (fieldName === 'params') {
        paramsJson = partData.toString('utf8');
      }
    }

    pos = nextBoundary;
  }

  if (!fileBuffer || fileBuffer.length === 0) {
    throw Object.assign(new Error('Missing or empty "file" field in multipart upload.'), {
      statusCode: 400,
    });
  }
  if (!paramsJson) {
    throw Object.assign(new Error('Missing "params" JSON field in multipart upload.'), {
      statusCode: 400,
    });
  }

  return { filename, fileBuffer, paramsJson };
}

export function createBridgeApp(options: BridgeServerOptions = {}) {
  const app = express();
  const ffmpegPath = options.ffmpegPath || process.env.FFMPEG_PATH || 'ffmpeg';
  const expectedApiKey =
    options.apiKey !== undefined ? options.apiKey : process.env.BRIDGE_API_KEY || '';
  const maxUploadSize =
    options.maxUploadSize ||
    Number(process.env.MAX_UPLOAD_SIZE) ||
    500 * 1024 * 1024; // 500 MB default
  const processTimeoutMs = options.processTimeoutMs || 120_000;
  const tempRootDir = options.tempRootDir || os.tmpdir();

  // CORS middleware for local studio clients
  app.use((req: Request, res: Response, next: NextFunction) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition, Content-Type');
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    next();
  });

  // Optional Bearer token authorization middleware
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (!expectedApiKey) {
      next();
      return;
    }
    const authHeader = String(req.headers.authorization || '');
    const expectedHeader = `Bearer ${expectedApiKey}`;
    if (authHeader !== expectedHeader) {
      res.status(401).json({ error: 'Unauthorized: invalid or missing Bearer token.' });
      return;
    }
    next();
  });

  app.get('/health', async (_req: Request, res: Response) => {
    const ffmpegAvailable = await checkFfmpegAvailable(ffmpegPath);
    res.status(200).json({
      status: 'ok',
      ffmpegAvailable,
    });
  });

  app.post('/api/convert', async (req: Request, res: Response) => {
    let jobDir: string | null = null;
    let activeChild: ReturnType<typeof spawn> | null = null;
    let clientDisconnected = false;

    const cleanupTempDir = async () => {
      if (!jobDir) return;
      const dirToRemove = jobDir;
      jobDir = null;
      await fsp.rm(dirToRemove, { recursive: true, force: true }).catch(() => {});
    };

    const onDisconnect = () => {
      if (!res.writableEnded) {
        clientDisconnected = true;
        if (activeChild && !activeChild.killed) {
          try {
            activeChild.kill('SIGKILL');
          } catch {
            // ignore
          }
        }
      }
    };

    req.on('aborted', onDisconnect);
    res.on('close', onDisconnect);

    try {
      const { filename, fileBuffer, paramsJson } = await parseMultipartConvertRequest(
        req,
        maxUploadSize
      );

      let parsedParams: Record<string, unknown>;
      try {
        parsedParams = JSON.parse(paramsJson) as Record<string, unknown>;
      } catch {
        res.status(400).json({ error: 'Malformed JSON in "params" field.' });
        return;
      }

      const ffmpegOk = await checkFfmpegAvailable(ffmpegPath);
      if (!ffmpegOk) {
        res.status(503).json({
          error: 'System FFmpeg binary is not installed or unavailable on the bridge host.',
        });
        return;
      }

      const jobId = crypto.randomUUID();
      jobDir = await fsp.mkdtemp(path.join(tempRootDir, `mediaforge-${jobId}-`));

      const inExt = extractSafeInputExtension(filename);
      const inputPath = path.join(jobDir, `input.${inExt}`);

      // First validate parameters with a placeholder output path to determine outputExt
      let plan: ValidatedConversionPlan;
      try {
        const tempPreviewOut = path.join(jobDir, 'output.tmp');
        plan = buildBridgeFfmpegPlan(inputPath, tempPreviewOut, parsedParams);
      } catch (validationErr) {
        await cleanupTempDir();
        res.status(400).json({
          error:
            validationErr instanceof Error
              ? validationErr.message
              : 'Invalid conversion parameters.',
        });
        return;
      }

      const outputPath = path.join(jobDir, `output.${plan.outputExt}`);
      plan = buildBridgeFfmpegPlan(inputPath, outputPath, parsedParams);

      await fsp.writeFile(inputPath, fileBuffer);

      await new Promise<void>((resolve, reject) => {
        const child = spawn(ffmpegPath, plan.args, {
          shell: false,
          stdio: ['ignore', 'ignore', 'pipe'],
          windowsHide: true,
        });
        activeChild = child;

        let stderrTail = '';
        child.stderr?.on('data', (chunk: Buffer) => {
          stderrTail = (stderrTail + chunk.toString('utf8')).slice(-1200);
        });

        const timer = setTimeout(() => {
          try {
            child.kill('SIGKILL');
          } catch {
            // ignore
          }
          reject(
            Object.assign(new Error('FFmpeg conversion timed out.'), { statusCode: 504 })
          );
        }, processTimeoutMs);

        child.on('error', (err) => {
          clearTimeout(timer);
          reject(
            Object.assign(new Error(`Failed to execute FFmpeg process: ${err.message}`), {
              statusCode: 500,
            })
          );
        });

        child.on('close', (code) => {
          clearTimeout(timer);
          if (clientDisconnected) {
            reject(new Error('Client disconnected during conversion.'));
            return;
          }
          if (code !== 0) {
            // Scrub any local filesystem paths from FFmpeg stderr summary
            const sanitizedDetail = stderrTail
              .replace(/\/[^\s:"']+/g, '[temp]')
              .split('\n')
              .map((l) => l.trim())
              .filter(Boolean)
              .slice(-2)
              .join(' | ');
            reject(
              Object.assign(
                new Error(
                  `FFmpeg conversion failed (exit code ${code})${
                    sanitizedDetail ? `: ${sanitizedDetail}` : ''
                  }`
                ),
                { statusCode: 422 }
              )
            );
            return;
          }
          resolve();
        });
      });

      const stat = await fsp.stat(outputPath).catch(() => null);
      if (!stat || stat.size === 0) {
        await cleanupTempDir();
        res.status(500).json({ error: 'FFmpeg produced an empty output file.' });
        return;
      }

      const outDownloadName = buildOutputFilename(filename, plan.outputExt);
      res.status(200);
      res.setHeader('Content-Type', plan.outputMime);
      res.setHeader('Content-Length', String(stat.size));
      res.setHeader('Content-Disposition', `attachment; filename="${outDownloadName}"`);

      await new Promise<void>((resolve, reject) => {
        const readStream = fs.createReadStream(outputPath);
        readStream.on('error', reject);
        res.on('finish', resolve);
        res.on('close', resolve);
        readStream.pipe(res);
      });
      await cleanupTempDir();
    } catch (err) {
      await cleanupTempDir();
      if (!res.headersSent && !clientDisconnected) {
        const statusCode =
          err && typeof err === 'object' && 'statusCode' in err && typeof err.statusCode === 'number'
            ? err.statusCode
            : 500;
        const message = err instanceof Error ? err.message : 'Internal bridge server error.';
        res.status(statusCode).json({ error: message });
      }
    } finally {
      req.off('aborted', onDisconnect);
      res.off('close', onDisconnect);
      await cleanupTempDir();
    }
  });

  return app;
}

function extractSafeInputExtension(originalFilename: string): string {
  const base = path.basename(originalFilename || '');
  const ext = path.extname(base).replace(/^\./, '').toLowerCase();
  if (/^[a-z0-9]{1,8}$/.test(ext)) {
    return ext;
  }
  return 'bin';
}

const isMainModule =
  typeof process !== 'undefined' &&
  Array.isArray(process.argv) &&
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isMainModule) {
  const port = Number(process.env.PORT) || 3001;
  const app = createBridgeApp();
  app.listen(port, '0.0.0.0', () => {
    console.log(`[MediaForge Local Bridge] Listening on http://localhost:${port}`);
  });
}
