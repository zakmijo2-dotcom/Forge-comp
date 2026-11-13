import {
  AudioFormat,
  AudioSettings,
  VideoFormat,
  VideoResolution,
  VideoSettings,
} from '../types/media';
import { parseTimestampToSeconds } from './mediaUtils';

export function getVideoMimeAndExt(format: VideoFormat): { mime: string; ext: string } {
  switch (format) {
    case 'mp4':
      return { mime: 'video/mp4', ext: 'mp4' };
    case 'webm':
      return { mime: 'video/webm', ext: 'webm' };
    case 'mkv':
      return { mime: 'video/x-matroska', ext: 'mkv' };
    case 'mov':
      return { mime: 'video/quicktime', ext: 'mov' };
    case 'avi':
      return { mime: 'video/x-msvideo', ext: 'avi' };
    case 'gif':
      return { mime: 'image/gif', ext: 'gif' };
  }
}

export function getAudioMimeAndExt(format: AudioFormat): { mime: string; ext: string } {
  switch (format) {
    case 'mp3':
      return { mime: 'audio/mpeg', ext: 'mp3' };
    case 'm4a':
      return { mime: 'audio/mp4', ext: 'm4a' };
    case 'wav':
      return { mime: 'audio/wav', ext: 'wav' };
    case 'ogg':
      return { mime: 'audio/ogg', ext: 'ogg' };
    case 'flac':
      return { mime: 'audio/flac', ext: 'flac' };
  }
}

function getResolutionMaxHeight(resolution: VideoResolution): number | null {
  switch (resolution) {
    case '1080p':
      return 1080;
    case '720p':
      return 720;
    case '480p':
      return 480;
    case '360p':
      return 360;
    case 'original':
      return null;
  }
}

export function buildVideoFfmpegArgs(
  inputName: string,
  outputName: string,
  settings: VideoSettings
): string[] {
  if (settings.mode === 'extract-audio') {
    return buildAudioFfmpegArgs(inputName, outputName, settings.audioExtractSettings, true);
  }

  if (settings.format === 'gif') {
    const fps = settings.fps === 'original' ? 15 : settings.fps;
    const width = Math.max(120, Math.min(1280, settings.gifWidth || 480));
    const filter = `fps=${fps},scale=${width}:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse`;
    return ['-y', '-i', inputName, '-vf', filter, '-loop', '0', outputName];
  }

  const args: string[] = ['-y', '-i', inputName];
  const filters: string[] = [];

  const maxHeight = getResolutionMaxHeight(settings.resolution);
  if (maxHeight !== null) {
    // Ensure width and height remain divisible by 2 for H.264/VP9 compatibility
    filters.push(`scale=-2:'min(${maxHeight},ih)'`);
  }

  if (settings.fps !== 'original') {
    filters.push(`fps=${settings.fps}`);
  }

  if (filters.length > 0) {
    args.push('-vf', filters.join(','));
  }

  if (settings.format === 'webm') {
    const codec = settings.codec === 'vp8' ? 'libvpx' : 'libvpx-vp9';
    args.push('-c:v', codec, '-crf', String(settings.crf), '-b:v', '0');
    if (codec === 'libvpx-vp9') {
      args.push('-deadline', 'realtime', '-cpu-used', '4');
    }
    if (settings.muteAudio) {
      args.push('-an');
    } else {
      args.push('-c:a', 'libopus', '-b:a', '128k');
    }
  } else if (settings.format === 'avi') {
    args.push('-c:v', 'mpeg4', '-q:v', String(Math.max(2, Math.round(settings.crf / 3))));
    if (settings.muteAudio) {
      args.push('-an');
    } else {
      args.push('-c:a', 'libmp3lame', '-b:a', '128k');
    }
  } else {
    // MP4, MKV, MOV
    const vCodec = settings.codec === 'h265' ? 'libx265' : 'libx264';
    args.push(
      '-c:v',
      vCodec,
      '-crf',
      String(settings.crf),
      '-preset',
      'veryfast',
      '-pix_fmt',
      'yuv420p'
    );
    if (settings.format === 'mp4' || settings.format === 'mov') {
      args.push('-movflags', '+faststart');
    }
    if (settings.muteAudio) {
      args.push('-an');
    } else {
      args.push('-c:a', 'aac', '-b:a', '128k');
    }
  }

  args.push(outputName);
  return args;
}

export function buildAudioFfmpegArgs(
  inputName: string,
  outputName: string,
  settings: AudioSettings,
  fromVideo = false
): string[] {
  const args: string[] = ['-y'];

  const startSec = parseTimestampToSeconds(settings.trimStart);
  const endSec = parseTimestampToSeconds(settings.trimEnd);

  if (startSec !== null && startSec > 0) {
    args.push('-ss', String(startSec));
  }
  if (endSec !== null && (startSec === null || endSec > startSec)) {
    args.push('-to', String(endSec));
  }

  args.push('-i', inputName);

  if (fromVideo) {
    args.push('-vn');
  }

  args.push('-ar', String(settings.sampleRate));
  args.push('-ac', settings.channels === 'mono' ? '1' : '2');

  switch (settings.format) {
    case 'mp3':
      args.push('-c:a', 'libmp3lame', '-b:a', `${settings.bitrate}k`);
      break;
    case 'm4a':
      args.push('-c:a', 'aac', '-b:a', `${settings.bitrate}k`);
      break;
    case 'ogg':
      args.push('-c:a', 'libopus', '-b:a', `${settings.bitrate}k`);
      break;
    case 'wav':
      args.push('-c:a', 'pcm_s16le');
      break;
    case 'flac':
      args.push('-c:a', 'flac');
      break;
  }

  args.push(outputName);
  return args;
}
