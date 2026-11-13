import { MediaKind, MediaSettings, PresetId } from '../types/media';
import { cloneMediaSettings } from './mediaUtils';

export interface SmartPreset {
  id: PresetId;
  label: string;
  shortDesc: string;
  appliesTo: MediaKind[];
}

export const SMART_PRESETS: SmartPreset[] = [
  {
    id: 'social-share',
    label: 'Social Share',
    shortDesc: 'MP4 H.264 720p 30fps CRF 26 · JPG 82%',
    appliesTo: ['video', 'image', 'audio'],
  },
  {
    id: 'web-ultra-light',
    label: 'Web Ultra-Light',
    shortDesc: 'WebP 80% · WebM VP9 · Opus 96k',
    appliesTo: ['image', 'video', 'audio'],
  },
  {
    id: 'extract-mp3',
    label: 'Extract Clean MP3',
    shortDesc: 'Strip video → 192 kbps Stereo MP3',
    appliesTo: ['video', 'audio'],
  },
  {
    id: 'archive-max',
    label: 'Archive / Max Quality',
    shortDesc: 'CRF 18 Original · PNG / FLAC 320k',
    appliesTo: ['video', 'image', 'audio'],
  },
  {
    id: 'smooth-gif',
    label: 'Video to Smooth GIF',
    shortDesc: '480px wide · 15fps · Palette-optimized',
    appliesTo: ['video'],
  },
];

export function applyPresetToMediaSettings(
  presetId: PresetId,
  current: MediaSettings
): MediaSettings {
  const next = cloneMediaSettings(current);

  switch (presetId) {
    case 'social-share':
      next.video = {
        ...next.video,
        mode: 'video',
        format: 'mp4',
        codec: 'h264',
        crf: 26,
        resolution: '720p',
        fps: 30,
        muteAudio: false,
      };
      next.image = {
        ...next.image,
        format: 'jpg',
        quality: 82,
        resize: '1080p',
        stripExif: true,
        flattenAlpha: true,
      };
      next.audio = {
        ...next.audio,
        format: 'm4a',
        bitrate: 128,
        sampleRate: 44100,
        channels: 'stereo',
      };
      break;

    case 'web-ultra-light':
      next.image = {
        ...next.image,
        format: 'webp',
        quality: 80,
        resize: 'original',
        stripExif: true,
      };
      next.video = {
        ...next.video,
        mode: 'video',
        format: 'webm',
        codec: 'vp9',
        crf: 28,
        resolution: '720p',
        fps: 30,
      };
      next.audio = {
        ...next.audio,
        format: 'ogg',
        bitrate: 128,
        sampleRate: 44100,
        channels: 'stereo',
      };
      break;

    case 'extract-mp3':
      next.video = {
        ...next.video,
        mode: 'extract-audio',
        audioExtractSettings: {
          ...next.video.audioExtractSettings,
          format: 'mp3',
          bitrate: 192,
          sampleRate: 44100,
          channels: 'stereo',
        },
      };
      next.audio = {
        ...next.audio,
        format: 'mp3',
        bitrate: 192,
        sampleRate: 44100,
        channels: 'stereo',
      };
      break;

    case 'archive-max':
      next.image = {
        ...next.image,
        format: 'png',
        quality: 100,
        resize: 'original',
        stripExif: false,
        grayscale: false,
      };
      next.video = {
        ...next.video,
        mode: 'video',
        format: 'mp4',
        codec: 'h264',
        crf: 18,
        resolution: 'original',
        fps: 'original',
        muteAudio: false,
      };
      next.audio = {
        ...next.audio,
        format: 'flac',
        bitrate: 320,
        sampleRate: 48000,
        channels: 'stereo',
      };
      break;

    case 'smooth-gif':
      next.video = {
        ...next.video,
        mode: 'video',
        format: 'gif',
        fps: 15,
        gifWidth: 480,
        resolution: '480p',
        muteAudio: true,
      };
      break;
  }

  return next;
}
