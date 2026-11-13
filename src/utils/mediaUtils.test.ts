import test from 'node:test';
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {
  buildOutputFilename,
  calculateSavings,
  calculateTargetDimensions,
  cloneMediaSettings,
  createDefaultSettingsForKind,
  detectMediaKind,
  formatBytes,
  parseTimestampToSeconds,
  secondsToTimestamp,
} from './mediaUtils';
import { buildAudioFfmpegArgs, buildVideoFfmpegArgs } from './ffmpegArgs';
import { applyPresetToMediaSettings } from './presets';
import { encodeFloatChannelsToWav, encodeFramesToGif, encodeRgbaToBmp } from './binaryEncoders';
import { resolveEffectiveTheme } from './themeUtils';
import {
  applyCompletedOutputToItem,
  createStableItemId,
  invalidateQueueItemOutput,
  ObjectUrlManager,
} from '../hooks/useMediaQueue';
import {
  selectPrimaryEngine,
  validateMediaItemSettings,
  processMediaItem,
} from '../services/mediaEngine';
import { clampCanvasDimensions, clampImageQuality } from '../services/imageEngine';
import { buildBridgeFfmpegPlan, createBridgeApp } from '../../server';
import { MediaQueueItem } from '../types/media';

function createMockQueueItem(overrides: Partial<MediaQueueItem> = {}): MediaQueueItem {
  const kind = overrides.kind ?? 'image';
  const file =
    overrides.file ??
    new File([new Uint8Array([1, 2, 3, 4])], 'sample.png', { type: 'image/png' });
  return {
    id: overrides.id ?? createStableItemId(),
    file,
    name: overrides.name ?? file.name,
    kind,
    originalSize: overrides.originalSize ?? file.size,
    originalUrl: overrides.originalUrl ?? 'blob:owned-orig-1',
    metadata: overrides.metadata ?? { width: 1280, height: 720 },
    settings: overrides.settings ?? createDefaultSettingsForKind(kind),
    status: overrides.status ?? 'queued',
    progress: overrides.progress ?? 0,
    ...overrides,
  };
}

test('detectMediaKind classifies images, videos, and audio accurately', () => {
  assert.equal(detectMediaKind({ name: 'photo.JPG', type: 'image/jpeg' }), 'image');
  assert.equal(detectMediaKind({ name: 'clip.mkv', type: '' }), 'video');
  assert.equal(detectMediaKind({ name: 'track.flac', type: 'audio/flac' }), 'audio');
  assert.equal(detectMediaKind({ name: 'document.pdf', type: 'application/pdf' }), null);
});

test('formatBytes and calculateSavings compute accurate metrics', () => {
  assert.equal(formatBytes(0), '0 B');
  assert.equal(formatBytes(1536), '1.50 KB');
  assert.equal(formatBytes(5 * 1024 * 1024), '5.00 MB');

  const saved = calculateSavings(1000, 258);
  assert.equal(saved.isLarger, false);
  assert.equal(saved.savedBytes, 742);
  assert.equal(saved.savedPercent, 74.2);
  assert.equal(saved.label, '-74.2% saved');

  const larger = calculateSavings(1000, 1200);
  assert.equal(larger.isLarger, true);
  assert.equal(larger.label, '+20.0% larger');
});

test('parseTimestampToSeconds and secondsToTimestamp round-trip cleanly', () => {
  assert.equal(parseTimestampToSeconds('01:30'), 90);
  assert.equal(parseTimestampToSeconds('01:02:03'), 3723);
  assert.equal(parseTimestampToSeconds('45'), 45);
  assert.equal(parseTimestampToSeconds(''), null);
  assert.equal(secondsToTimestamp(90), '01:30');
  assert.equal(secondsToTimestamp(3723), '01:02:03');
  assert.equal(secondsToTimestamp(0.4), '00:01');
});

test('calculateTargetDimensions and clampCanvasDimensions preserve aspect ratio and bounds', () => {
  assert.deepEqual(calculateTargetDimensions(3840, 2160, '1080p'), { width: 1920, height: 1080 });
  assert.deepEqual(calculateTargetDimensions(1000, 500, '1080p'), { width: 1000, height: 500 });
  assert.deepEqual(calculateTargetDimensions(2000, 1000, '50%'), { width: 1000, height: 500 });
  assert.deepEqual(calculateTargetDimensions(1001, 501, 'original', true), { width: 1000, height: 500 });

  const clamped = clampCanvasDimensions(16384, 8192);
  assert.equal(clamped.scaledDown, true);
  assert.ok(clamped.width <= 8192 && clamped.height <= 8192);
  assert.equal(clampImageQuality(NaN), 82);
  assert.equal(clampImageQuality(150), 100);
  assert.equal(clampImageQuality(-5), 1);
});

test('buildOutputFilename sanitizes name and adds _compressed suffix', () => {
  assert.equal(buildOutputFilename('Vacation Photo (1).PNG', 'webp'), 'Vacation_Photo_1_compressed.webp');
  assert.equal(buildOutputFilename('clip.mov', '.mp4'), 'clip_compressed.mp4');
});

test('buildVideoFfmpegArgs and buildAudioFfmpegArgs construct expected CLI flags', () => {
  const defaults = createDefaultSettingsForKind('video');
  const mp4Args = buildVideoFfmpegArgs('input.mov', 'output.mp4', {
    ...defaults.video,
    format: 'mp4',
    codec: 'h264',
    crf: 26,
    resolution: '720p',
    fps: 30,
    muteAudio: true,
  });
  assert.ok(mp4Args.includes('-crf'));
  assert.ok(mp4Args.includes('26'));
  assert.ok(mp4Args.includes('-an'));
  assert.ok(mp4Args.includes("scale=-2:'min(720,ih)',fps=30"));

  const gifPreset = applyPresetToMediaSettings('smooth-gif', defaults);
  const gifArgs = buildVideoFfmpegArgs('input.mp4', 'output.gif', gifPreset.video);
  assert.ok(gifArgs.some((arg) => arg.includes('palettegen')));
  assert.ok(gifArgs.some((arg) => arg.includes('fps=15,scale=480:-1')));

  const mp3Preset = applyPresetToMediaSettings('extract-mp3', defaults);
  const mp3Args = buildVideoFfmpegArgs('input.mp4', 'output.mp3', mp3Preset.video);
  assert.ok(mp3Args.includes('-vn'));
  assert.ok(mp3Args.includes('libmp3lame'));
  assert.ok(mp3Args.includes('192k'));

  const audioArgs = buildAudioFfmpegArgs('song.wav', 'out.ogg', {
    ...defaults.audio,
    format: 'ogg',
    bitrate: 128,
    sampleRate: 48000,
    channels: 'mono',
    trimStart: '00:10',
    trimEnd: '01:00',
  });
  assert.ok(audioArgs.includes('-ss'));
  assert.ok(audioArgs.includes('10'));
  assert.ok(audioArgs.includes('-to'));
  assert.ok(audioArgs.includes('60'));
  assert.ok(audioArgs.includes('-ac'));
  assert.ok(audioArgs.includes('1'));
  assert.ok(audioArgs.includes('libopus'));
});

test('binaryEncoders produce valid BMP, WAV, and GIF89a headers and reject invalid inputs', () => {
  const rgba = new Uint8ClampedArray(4 * 4 * 4).fill(255);
  const bmp = encodeRgbaToBmp(rgba, 4, 4);
  assert.equal(String.fromCharCode(bmp[0], bmp[1]), 'BM');
  assert.equal(bmp.length, 54 + 4 * 12);

  const wav = encodeFloatChannelsToWav([new Float32Array(100), new Float32Array(100)], 44100);
  assert.equal(String.fromCharCode(wav[0], wav[1], wav[2], wav[3]), 'RIFF');
  assert.equal(String.fromCharCode(wav[8], wav[9], wav[10], wav[11]), 'WAVE');
  assert.equal(wav.length, 44 + 400);

  const gif = encodeFramesToGif([rgba, rgba], 4, 4, 100);
  assert.equal(String.fromCharCode(gif[0], gif[1], gif[2], gif[3], gif[4], gif[5]), 'GIF89a');
  assert.equal(gif[gif.length - 1], 0x3b);

  // Input validation checks
  assert.throws(() => encodeRgbaToBmp(rgba, 0, 4), RangeError);
  assert.throws(() => encodeRgbaToBmp(new Uint8ClampedArray(10), 4, 4), RangeError);
  assert.throws(() => encodeFloatChannelsToWav([], 44100), RangeError);
  assert.throws(
    () => encodeFloatChannelsToWav([new Float32Array(10), new Float32Array(5)], 44100),
    RangeError
  );
  assert.throws(() => encodeFloatChannelsToWav([new Float32Array(10)], 100), RangeError);
  assert.throws(() => encodeFramesToGif([], 4, 4, 100), RangeError);
  assert.throws(() => encodeFramesToGif([new Uint8ClampedArray(8)], 4, 4, 100), RangeError);
});

test('resolveEffectiveTheme follows system preference when syncToSystem is enabled', () => {
  assert.equal(resolveEffectiveTheme({ syncToSystem: true, manualTheme: 'dark' }, false), 'light');
  assert.equal(resolveEffectiveTheme({ syncToSystem: true, manualTheme: 'light' }, true), 'dark');
  assert.equal(resolveEffectiveTheme({ syncToSystem: false, manualTheme: 'dark' }, false), 'dark');
  assert.equal(resolveEffectiveTheme({ syncToSystem: false, manualTheme: 'light' }, true), 'light');
});

test('Resource lifecycle: ObjectUrlManager tracks owned URLs, prevents double cleanup, and protects external URLs', () => {
  const created: string[] = [];
  const revoked: string[] = [];
  let seq = 0;

  const manager = new ObjectUrlManager(
    () => {
      const u = `blob:mock-${++seq}`;
      created.push(u);
      return u;
    },
    (u) => {
      revoked.push(u);
    }
  );

  const url1 = manager.create(new Blob(['a']));
  const url2 = manager.create(new Blob(['b']));
  assert.equal(manager.size, 2);
  assert.equal(manager.has(url1), true);

  // External URL must never be revoked
  assert.equal(manager.revoke('blob:external-unowned'), false);
  assert.equal(revoked.length, 0);

  // Owned URL revoked once; second call is a no-op
  assert.equal(manager.revoke(url1), true);
  assert.equal(manager.revoke(url1), false);
  assert.deepEqual(revoked, [url1]);
  assert.equal(manager.size, 1);

  // Unmount / clear cleanup revokes all remaining owned URLs
  const remainingRevoked = manager.revokeAll();
  assert.equal(remainingRevoked, 1);
  assert.deepEqual(revoked, [url1, url2]);
  assert.equal(manager.size, 0);
});

test('Queue management: output replacement and settings modification invalidate stale output and release previous URLs', () => {
  const item = createMockQueueItem({ id: 'item-1', originalUrl: 'blob:orig-1' });
  const outBlob1 = new Blob([new Uint8Array(64)], { type: 'image/webp' });

  // 1. Complete first conversion
  const completed1 = applyCompletedOutputToItem(item, {
    blob: outBlob1,
    url: 'blob:out-1',
    filename: 'sample_compressed.webp',
    engineUsed: 'Canvas2D / OffscreenCanvas',
    durationMs: 42,
  });
  assert.equal(completed1.urlToRevoke, undefined);
  assert.equal(completed1.nextItem.status, 'completed');
  assert.equal(completed1.nextItem.outputUrl, 'blob:out-1');
  assert.equal(completed1.nextItem.outputSize, 64);

  // 2. Replace output on re-compression -> returns old outputUrl for revocation
  const outBlob2 = new Blob([new Uint8Array(32)], { type: 'image/webp' });
  const completed2 = applyCompletedOutputToItem(completed1.nextItem, {
    blob: outBlob2,
    url: 'blob:out-2',
    filename: 'sample_compressed.webp',
    engineUsed: 'Canvas2D / OffscreenCanvas',
    durationMs: 35,
  });
  assert.equal(completed2.urlToRevoke, 'blob:out-1');
  assert.equal(completed2.nextItem.outputUrl, 'blob:out-2');
  assert.equal(completed2.nextItem.outputSize, 32);

  // 3. Modify settings -> invalidates stale output metadata while preserving original input file & URL
  const updatedSettings = cloneMediaSettings(completed2.nextItem.settings);
  updatedSettings.image.quality = 50;
  const invalidated = invalidateQueueItemOutput(completed2.nextItem, updatedSettings);

  assert.equal(invalidated.urlToRevoke, 'blob:out-2');
  assert.equal(invalidated.nextItem.status, 'queued');
  assert.equal(invalidated.nextItem.progress, 0);
  assert.equal(invalidated.nextItem.outputBlob, undefined);
  assert.equal(invalidated.nextItem.outputUrl, undefined);
  assert.equal(invalidated.nextItem.outputSize, undefined);
  assert.equal(invalidated.nextItem.outputFilename, undefined);
  assert.equal(invalidated.nextItem.engineUsed, undefined);
  // Original file and URL remain untouched
  assert.equal(invalidated.nextItem.originalUrl, 'blob:orig-1');
  assert.equal(invalidated.nextItem.file, item.file);
});

test('Media processing: engine selection, parameter validation, and cancellation handling', async () => {
  const imgSettings = createDefaultSettingsForKind('image');
  assert.equal(selectPrimaryEngine('image', imgSettings, 'browser-wasm'), 'canvas-image');

  const bmpSettings = cloneMediaSettings(imgSettings);
  bmpSettings.image.format = 'bmp';
  assert.equal(selectPrimaryEngine('image', bmpSettings, 'browser-wasm'), 'ts-bmp-encoder');

  const vidSettings = createDefaultSettingsForKind('video');
  assert.equal(selectPrimaryEngine('video', vidSettings, 'browser-wasm'), 'ffmpeg-wasm');
  assert.equal(selectPrimaryEngine('video', vidSettings, 'local-bridge'), 'local-bridge');

  // Invalid quality or trim range throws descriptive error
  const badQuality = cloneMediaSettings(imgSettings);
  badQuality.image.quality = 0;
  assert.throws(() => validateMediaItemSettings('image', badQuality), /Invalid image quality/);

  const badTrim = createDefaultSettingsForKind('audio');
  badTrim.audio.trimStart = '01:00';
  badTrim.audio.trimEnd = '00:30';
  assert.throws(() => validateMediaItemSettings('audio', badTrim), /Invalid trim range/);

  // Pre-aborted signal rejects with AbortError immediately
  const controller = new AbortController();
  controller.abort();
  const item = createMockQueueItem();
  await assert.rejects(
    () =>
      processMediaItem(
        item,
        'browser-wasm',
        { url: 'http://localhost:3001', timeoutMs: 5000, presetName: 'veryfast' },
        {
          onProgress: () => {},
          onLog: () => {},
        },
        controller.signal
      ),
    (err: unknown) => err instanceof DOMException && err.name === 'AbortError'
  );
});

test('Local Bridge: health endpoint, auth, parameter validation, real FFmpeg conversion, failure handling, and temp cleanup', async () => {
  const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'mf-bridge-test-'));

  // 1. Test bridge with missing FFmpeg binary
  const appMissingFfmpeg = createBridgeApp({
    ffmpegPath: '/nonexistent/ffmpeg-binary-xyz',
    tempRootDir: tempRoot,
  });
  const serverMissing = http.createServer(appMissingFfmpeg);
  await new Promise<void>((resolve) => serverMissing.listen(0, '127.0.0.1', resolve));
  const addrMissing = serverMissing.address() as { port: number };
  const baseMissing = `http://127.0.0.1:${addrMissing.port}`;

  try {
    const healthRes = await fetch(`${baseMissing}/health`);
    assert.equal(healthRes.status, 200);
    const healthJson = (await healthRes.json()) as { status: string; ffmpegAvailable: boolean };
    assert.equal(healthJson.status, 'ok');
    assert.equal(healthJson.ffmpegAvailable, false);
  } finally {
    await new Promise<void>((resolve) => serverMissing.close(() => resolve()));
  }

  // 2. Test bridge with system FFmpeg + Bearer key + real conversion + error cleanup
  const appReal = createBridgeApp({
    ffmpegPath: 'ffmpeg',
    apiKey: 'secret-test-token',
    maxUploadSize: 1024 * 1024,
    tempRootDir: tempRoot,
  });
  const serverReal = http.createServer(appReal);
  await new Promise<void>((resolve) => serverReal.listen(0, '127.0.0.1', resolve));
  const addrReal = serverReal.address() as { port: number };
  const baseReal = `http://127.0.0.1:${addrReal.port}`;

  try {
    // Unauthorized request without Bearer token -> 401
    const unauthRes = await fetch(`${baseReal}/health`);
    assert.equal(unauthRes.status, 401);

    // Authorized health check -> 200
    const authHeaders = { Authorization: 'Bearer secret-test-token' };
    const healthRes = await fetch(`${baseReal}/health`, { headers: authHeaders });
    assert.equal(healthRes.status, 200);
    const healthJson = (await healthRes.json()) as { status: string; ffmpegAvailable: boolean };
    assert.equal(healthJson.status, 'ok');

    // Invalid upload (non-multipart) -> 400
    const badUploadRes = await fetch(`${baseReal}/api/convert`, {
      method: 'POST',
      headers: { ...authHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.equal(badUploadRes.status, 400);

    // Unsupported format -> 400
    const badFmtForm = new FormData();
    badFmtForm.append('file', new Blob([new Uint8Array([1, 2, 3, 4])]), 'test.wav');
    badFmtForm.append('params', JSON.stringify({ kind: 'audio', format: 'exe' }));
    const badFmtRes = await fetch(`${baseReal}/api/convert`, {
      method: 'POST',
      headers: authHeaders,
      body: badFmtForm,
    });
    assert.equal(badFmtRes.status, 400);

    // Invalid numeric parameter -> 400
    assert.throws(
      () => buildBridgeFfmpegPlan('/tmp/in.mp4', '/tmp/out.mp4', { kind: 'video', format: 'mp4', crf: 99 }),
      /Invalid video CRF/
    );

    if (healthJson.ffmpegAvailable) {
      // Valid WAV audio conversion via system FFmpeg
      const validWav = encodeFloatChannelsToWav([new Float32Array(4410)], 44100);
      const validForm = new FormData();
      validForm.append('file', new Blob([validWav.buffer as ArrayBuffer], { type: 'audio/wav' }), 'tone.wav');
      validForm.append(
        'params',
        JSON.stringify({
          kind: 'audio',
          format: 'wav',
          bitrate: '192k',
          sampleRate: 22050,
          channels: 'mono',
          trimStart: '',
          trimEnd: '',
          preset: 'veryfast',
        })
      );
      const convRes = await fetch(`${baseReal}/api/convert`, {
        method: 'POST',
        headers: authHeaders,
        body: validForm,
      });
      assert.equal(convRes.status, 200);
      assert.equal(convRes.headers.get('Content-Type'), 'audio/wav');
      assert.match(convRes.headers.get('Content-Disposition') || '', /tone_compressed\.wav/);
      const outBytes = new Uint8Array(await convRes.arrayBuffer());
      assert.ok(outBytes.byteLength > 44);

      // Corrupt media payload -> FFmpeg fails with 422 and still cleans up temp files
      const corruptForm = new FormData();
      corruptForm.append('file', new Blob([new Uint8Array([0, 1, 2, 3, 4, 5])]), 'corrupt.mp4');
      corruptForm.append(
        'params',
        JSON.stringify({
          kind: 'video',
          format: 'mp4',
          codec: 'h264',
          crf: 23,
          resolution: 'original',
          fps: 'original',
        })
      );
      const corruptRes = await fetch(`${baseReal}/api/convert`, {
        method: 'POST',
        headers: authHeaders,
        body: corruptForm,
      });
      assert.equal(corruptRes.status, 422);
    }

    // Verify all temporary directories inside tempRoot were cleaned up
    const leftoverEntries = await fsp.readdir(tempRoot);
    assert.deepEqual(leftoverEntries, []);
  } finally {
    await new Promise<void>((resolve) => serverReal.close(() => resolve()));
    await fsp.rm(tempRoot, { recursive: true, force: true }).catch(() => {});
  }
});
