import { BridgeConfig, MediaKind, MediaSettings } from '../types/media';
import { buildOutputFilename } from '../utils/mediaUtils';

export interface BridgeHealthResult {
  ok: boolean;
  message: string;
  latencyMs?: number;
}

export async function testLocalBridgeConnection(config: BridgeConfig): Promise<BridgeHealthResult> {
  const baseUrl = config.url.replace(/\/+$/, '');
  const started = performance.now();
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.min(5000, config.timeoutMs || 5000));
    const res = await fetch(`${baseUrl}/health`, {
      method: 'GET',
      headers: config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : undefined,
      signal: controller.signal,
    });
    clearTimeout(timer);
    const latencyMs = Math.round(performance.now() - started);
    if (!res.ok) {
      return {
        ok: false,
        message: `Bridge responded with HTTP ${res.status} (${res.statusText}).`,
        latencyMs,
      };
    }
    return {
      ok: true,
      message: `Connected to Local FFmpeg Bridge (${latencyMs}ms).`,
      latencyMs,
    };
  } catch (err) {
    return {
      ok: false,
      message:
        err instanceof Error
          ? `Unreachable: ${err.message}. Ensure your local Termux/Desktop bridge server is running with CORS enabled.`
          : 'Unable to reach local bridge endpoint.',
    };
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
  const baseUrl = bridgeConfig.url.replace(/\/+$/, '');
  const endpoint = `${baseUrl}/api/convert`;
  const payload = buildBridgeParamsPayload(kind, settings, bridgeConfig.presetName);

  onLog?.(`[Local Bridge] POST ${endpoint}`);
  onLog?.(`[Local Bridge] Params: ${JSON.stringify(payload)}`);
  onProgress?.(10);

  const formData = new FormData();
  formData.append('file', file);
  formData.append('params', JSON.stringify(payload));

  const res = await fetch(endpoint, {
    method: 'POST',
    body: formData,
    headers: bridgeConfig.apiKey
      ? { Authorization: `Bearer ${bridgeConfig.apiKey}` }
      : undefined,
    signal,
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => res.statusText);
    throw new Error(`Local Bridge HTTP ${res.status}: ${errText || 'Conversion failed'}`);
  }

  onProgress?.(65);
  const contentType = res.headers.get('Content-Type') || 'application/octet-stream';

  // Support optional streaming NDJSON progress headers if bridge provides them, otherwise read blob
  const blob = await res.blob();
  const targetExt = String(payload.format || 'bin');
  const disposition = res.headers.get('Content-Disposition') || '';
  const match = disposition.match(/filename="?([^"]+)"?/i);
  const filename = match?.[1] || buildOutputFilename(file.name, targetExt);

  onLog?.(`[Local Bridge] Received ${blob.size} bytes (${contentType}).`);
  onProgress?.(100);
  return { blob, filename };
}
