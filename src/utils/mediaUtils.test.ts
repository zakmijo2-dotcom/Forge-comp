import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildOutputFilename,
  calculateSavings,
  calculateTargetDimensions,
  createDefaultSettingsForKind,
  detectMediaKind,
  formatBytes,
  parseTimestampToSeconds,
  secondsToTimestamp,
} from './mediaUtils';
import { buildAudioFfmpegArgs, buildVideoFfmpegArgs } from './ffmpegArgs';
import { applyPresetToMediaSettings } from './presets';
import { encodeFloatChannelsToWav, encodeFramesToGif, encodeRgbaToBmp } from './binaryEncoders';

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
});

test('calculateTargetDimensions preserves aspect ratio without upscaling', () => {
  assert.deepEqual(calculateTargetDimensions(3840, 2160, '1080p'), { width: 1920, height: 1080 });
  assert.deepEqual(calculateTargetDimensions(1000, 500, '1080p'), { width: 1000, height: 500 });
  assert.deepEqual(calculateTargetDimensions(2000, 1000, '50%'), { width: 1000, height: 500 });
  assert.deepEqual(calculateTargetDimensions(1001, 501, 'original', true), { width: 1000, height: 500 });
});

test('buildOutputFilename sanitizes name and adds _compressed suffix', () => {
  assert.equal(buildOutputFilename('Vacation Photo (1).PNG', 'webp'), 'Vacation_Photo_1_compressed.webp');
  assert.equal(buildOutputFilename('clip.mov', '.mp4'), 'clip_compressed.mp4');
});

test('buildVideoFfmpegArgs builds H.264 MP4, GIF palette, and audio extraction commands', () => {
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
});

test('buildAudioFfmpegArgs includes trim timestamps, sample rate, and channels', () => {
  const defaults = createDefaultSettingsForKind('audio');
  const args = buildAudioFfmpegArgs('song.wav', 'out.ogg', {
    ...defaults.audio,
    format: 'ogg',
    bitrate: 128,
    sampleRate: 48000,
    channels: 'mono',
    trimStart: '00:10',
    trimEnd: '01:00',
  });
  assert.ok(args.includes('-ss'));
  assert.ok(args.includes('10'));
  assert.ok(args.includes('-to'));
  assert.ok(args.includes('60'));
  assert.ok(args.includes('-ac'));
  assert.ok(args.includes('1'));
  assert.ok(args.includes('libopus'));
});

test('binaryEncoders produce valid BMP, WAV, and GIF89a headers', () => {
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
});
