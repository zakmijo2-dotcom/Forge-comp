export type MediaKind = 'image' | 'video' | 'audio';

export type EngineMode = 'browser-wasm' | 'local-bridge';

export type FileStatus = 'queued' | 'processing' | 'completed' | 'error' | 'cancelled';

export type ImageFormat = 'jpg' | 'png' | 'webp' | 'avif' | 'bmp';

export type ImageResizeMode =
  | 'original'
  | '4k'
  | '1080p'
  | '720p'
  | '480p'
  | '75%'
  | '50%'
  | '25%';

export type VideoFormat = 'mp4' | 'webm' | 'mkv' | 'mov' | 'avi' | 'gif';

export type VideoCodec = 'h264' | 'h265' | 'vp9' | 'vp8';

export type VideoResolution = 'original' | '1080p' | '720p' | '480p' | '360p';

export type VideoFps = 'original' | 60 | 30 | 24 | 15;

export type VideoCrfPreset = 18 | 23 | 28 | 34;

export type AudioFormat = 'mp3' | 'm4a' | 'wav' | 'ogg' | 'flac';

export type AudioBitrate = 320 | 256 | 192 | 128 | 64;

export type AudioSampleRate = 48000 | 44100 | 22050;

export type AudioChannels = 'stereo' | 'mono';

export type PresetId =
  | 'social-share'
  | 'web-ultra-light'
  | 'extract-mp3'
  | 'archive-max'
  | 'smooth-gif';

export interface ImageSettings {
  format: ImageFormat;
  quality: number; // 1 to 100
  resize: ImageResizeMode;
  stripExif: boolean;
  flattenAlpha: boolean;
  flattenColor: string;
  grayscale: boolean;
}

export interface VideoSettings {
  mode: 'video' | 'extract-audio';
  format: VideoFormat;
  codec: VideoCodec;
  crf: number; // 18, 23, 26, 28, 34 etc.
  resolution: VideoResolution;
  fps: VideoFps;
  muteAudio: boolean;
  gifWidth: number; // e.g. 480
  audioExtractSettings: AudioSettings;
}

export interface AudioSettings {
  format: AudioFormat;
  bitrate: AudioBitrate;
  sampleRate: AudioSampleRate;
  channels: AudioChannels;
  trimStart: string; // MM:SS
  trimEnd: string;   // MM:SS or empty for full length
}

export interface MediaSettings {
  image: ImageSettings;
  video: VideoSettings;
  audio: AudioSettings;
}

export interface MediaMetadata {
  width?: number;
  height?: number;
  duration?: number; // seconds
  codec?: string;
}

export interface MediaQueueItem {
  id: string;
  file: File;
  name: string;
  kind: MediaKind;
  originalSize: number;
  originalUrl: string;
  thumbnailUrl?: string;
  metadata: MediaMetadata;
  settings: MediaSettings;
  status: FileStatus;
  progress: number; // 0 - 100
  outputBlob?: Blob;
  outputUrl?: string;
  outputSize?: number;
  outputFilename?: string;
  engineUsed?: string;
  errorMessage?: string;
  processingTimeMs?: number;
}

export interface TerminalLogEntry {
  id: string;
  timestamp: string;
  level: 'info' | 'warn' | 'error' | 'success' | 'cmd';
  message: string;
  fileId?: string;
}

export interface BridgeConfig {
  url: string;
  timeoutMs: number;
  presetName: string;
  apiKey?: string;
}
