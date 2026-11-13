import { BridgeConfig, MediaKind, MediaSettings } from '../types/media';
import { buildOutputFilename } from '../utils/mediaUtils';

export interface BridgeHealthResult {
  ok: boolean;
  ffmpegAvailable?: boolean;
  message: string;
  latencyMs?: number;
}

export async function testLocalBridgeConnection(config: BridgeConfig): Promise<BridgeHealthResult> {
  const baseUrl = (config.url || 'http://localhost:3001').trim().replace(/\/+$/, '');
  const started = performance.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.min(5000, config.timeoutMs || 5000));

  try {
    const res = await fetch(`${baseUrl}/health`, {
      method: 'GET',
      headers: config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : undefined,
      signal: controller.signal,
    });
    const latencyMs = Math.round(performance.now() - started);

    if (!res.ok) {
      return {
        ok: false,
        message: `Bridge responded with HTTP ${res.status} (${res.statusText}).`,
        latencyMs,
      };
    }

    let payload: { status?: string; ffmpegAvailable?: boolean } = {};
    try {
      payload = (await res.json()) as { status?: string; ffmpegAvailable?: boolean };
    } catch {
      // Allow plain-text 200 OK health responses from custom bridges
    }

    if (payload.ffmpegAvailable === false) {
      return {
        ok: false,
        ffmpegAvailable: false,
        message: `Bridge server is reachable (${latencyMs}ms), but system FFmpeg is not installed or not in PATH.`,
        latencyMs,
      };
    }

    return {
      ok: true,
      ffmpegAvailable: payload.ffmpegAvailable ?? true,
      message: `Connected to Local FFmpeg Bridge (${latencyMs}ms · FFmpeg ready).`,
      latencyMs,
    };
  } catch (err) {
    return {
      ok: false,
      message:
        err instanceof Error
          ? `Unreachable: ${err.message}. Start the local bridge with "npm run server" (port 3001).`
          : 'Unable to reach local bridge endpoint.',
    };
  } finally {
    clearTimeout(timer);
  }
}

export function buildBridgeParamsPayload(
  kind: MediaKind,
  settings: MediaSettings,
  presetName: string
): Record<string, unknown> {
  if (kind === 'image') {
    return {
      kind,
      format: settings.image.format,
      quality: settings.image.quality,
      resize: settings.image.resize,
      stripExif: settings.image.stripExif,
      flattenAlpha: settings.image.flattenAlpha,
      flattenColor: settings.image.flattenColor,
      grayscale: settings.image.grayscale,
      preset: presetName,
    };
  }
  if (kind === 'video') {
    if (settings.video.mode === 'extract-audio') {
      return {
        kind: 'audio-extract',
        format: settings.video.audioExtractSettings.format,
        bitrate: `${settings.video.audioExtractSettings.bitrate}k`,
        sampleRate: settings.video.audioExtractSettings.sampleRate,
        channels: settings.video.audioExtractSettings.channels,
        trimStart: settings.video.audioExtractSettings.trimStart,
        trimEnd: settings.video.audioExtractSettings.trimEnd,
        preset: presetName,
      };
    }
    return {
      kind,
      format: settings.video.format,
      codec: settings.video.codec,
      crf: settings.video.crf,
      resolution: settings.video.resolution,
      fps: settings.video.fps,
      muteAudio: settings.video.muteAudio,
      gifWidth: settings.video.gifWidth,
      preset: presetName,
    };
  }
  return {
    kind,
    format: settings.audio.format,
    bitrate: `${settings.audio.bitrate}k`,
    sampleRate: settings.audio.sampleRate,
    channels: settings.audio.channels,
    trimStart: settings.audio.trimStart,
    trimEnd: settings.audio.trimEnd,
    preset: presetName,
  };
}

export async function processViaLocalBridge(params: {
  file: File;
  kind: MediaKind;
  settings: MediaSettings;
  bridgeConfig: BridgeConfig;
  onProgress?: (pct: number) => void;
  onLog?: (msg: string) => void;
  signal?: AbortSignal;
}): Promise<{ blob: Blob; filename: string }> {
  const { file, kind, settings, bridgeConfig, onProgress, onLog, signal } = params;
  if (signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError');
  }
  if (!file || file.size <= 0) {
    throw new Error(`Input file "${file?.name || 'unknown'}" is empty or invalid.`);
  }

  const baseUrl = (bridgeConfig.url || 'http://localhost:3001').trim().replace(/\/+$/, '');
  const endpoint = `${baseUrl}/api/convert`;
  const payload = buildBridgeParamsPayload(kind, settings, bridgeConfig.presetName);

  onLog?.(`[Local Bridge] POST ${endpoint}`);
  onLog?.(`[Local Bridge] Params: ${JSON.stringify(payload)}`);
  onProgress?.(10);

  const formData = new FormData();
  formData.append('file', file);
  formData.append('params', JSON.stringify(payload));

  const controller = new AbortController();
  let timedOut = false;
  const timeoutMs = Math.max(5000, bridgeConfig.timeoutMs || 120000);
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  const onCallerAbort = () => controller.abort();
  signal?.addEventListener('abort', onCallerAbort, { once: true });

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      body: formData,
      headers: bridgeConfig.apiKey
        ? { Authorization: `Bearer ${bridgeConfig.apiKey}` }
        : undefined,
      signal: controller.signal,
    });

    if (!res.ok) {
      let errMessage = res.statusText;
      try {
        const errBody = await res.text();
        if (errBody) {
          try {
            const parsed = JSON.parse(errBody) as { error?: string; message?: string };
            errMessage = parsed.error || parsed.message || errBody;
          } catch {
            errMessage = errBody;
          }
        }
      } catch {
        // ignore body read error
      }
      throw new Error(`Local Bridge HTTP ${res.status}: ${errMessage || 'Conversion failed'}`);
    }

    onProgress?.(65);
    const contentType = res.headers.get('Content-Type') || 'application/octet-stream';
    const rawBlob = await res.blob();
    if (signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }
    if (rawBlob.size === 0) {
      throw new Error('Local Bridge returned an empty (0-byte) output file.');
    }

    const blob =
      rawBlob.type && rawBlob.type !== 'application/octet-stream'
        ? rawBlob
        : new Blob([rawBlob], { type: contentType });

    const targetExt = String(payload.format || 'bin');
    const disposition = res.headers.get('Content-Disposition') || '';
    const match = disposition.match(/filename="?([^";]+)"?/i);
    const filename = match?.[1] || buildOutputFilename(file.name, targetExt);

    onLog?.(`[Local Bridge] Received ${blob.size} bytes (${contentType}).`);
    onProgress?.(100);
    return { blob, filename };
  } catch (err) {
    if (signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }
    if (timedOut) {
      throw new Error(`Local Bridge request timed out after ${timeoutMs}ms.`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onCallerAbort);
  }
}
