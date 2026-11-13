import React from 'react';
import {
  CopyCheck,
  Film,
  Image as ImageIcon,
  Music,
  Play,
  SlidersHorizontal,
  VolumeX,
  Zap,
} from 'lucide-react';
import {
  AudioBitrate,
  AudioFormat,
  AudioSampleRate,
  AudioSettings,
  ImageFormat,
  ImageResizeMode,
  MediaQueueItem,
  MediaSettings,
  PresetId,
  VideoCodec,
  VideoFormat,
  VideoFps,
  VideoResolution,
} from '../types/media';
import {
  calculateTargetDimensions,
  estimateImageOutputSize,
  formatBytes,
} from '../utils/mediaUtils';
import { SMART_PRESETS } from '../utils/presets';

interface InspectorPanelProps {
  item: MediaQueueItem;
  similarCount: number;
  isBatchRunning: boolean;
  onUpdateSettings: (id: string, next: MediaSettings) => void;
  onApplyPreset: (id: string, presetId: PresetId) => void;
  onApplyToAllSimilar: (sourceItem: MediaQueueItem) => void;
  onCompressSingle: (id: string) => void;
}

const IMAGE_FORMATS: { value: ImageFormat; label: string }[] = [
  { value: 'webp', label: 'WebP' },
  { value: 'jpg', label: 'JPG' },
  { value: 'png', label: 'PNG' },
  { value: 'avif', label: 'AVIF' },
  { value: 'bmp', label: 'BMP' },
];

const IMAGE_RESIZES: { value: ImageResizeMode; label: string }[] = [
  { value: 'original', label: 'Original' },
  { value: '4k', label: '4K (3840px)' },
  { value: '1080p', label: '1080p (1920px)' },
  { value: '720p', label: '720p (1280px)' },
  { value: '480p', label: '480p (854px)' },
  { value: '75%', label: '75% Scale' },
  { value: '50%', label: '50% Scale' },
  { value: '25%', label: '25% Scale' },
];

const VIDEO_FORMATS: { value: VideoFormat; label: string }[] = [
  { value: 'mp4', label: 'MP4' },
  { value: 'webm', label: 'WebM' },
  { value: 'mkv', label: 'MKV' },
  { value: 'mov', label: 'MOV' },
  { value: 'avi', label: 'AVI' },
  { value: 'gif', label: 'GIF' },
];

const VIDEO_CRF_PRESETS = [
  { value: 18, label: 'Lossless-ish (CRF 18)' },
  { value: 23, label: 'Balanced (CRF 23)' },
  { value: 28, label: 'High Compression (CRF 28)' },
  { value: 34, label: 'Ultra Light (CRF 34)' },
];

const VIDEO_RESOLUTIONS: { value: VideoResolution; label: string }[] = [
  { value: 'original', label: 'Original' },
  { value: '1080p', label: '1080p' },
  { value: '720p', label: '720p' },
  { value: '480p', label: '480p' },
  { value: '360p', label: '360p' },
];

const VIDEO_FPS_OPTIONS: { value: VideoFps; label: string }[] = [
  { value: 'original', label: 'Original FPS' },
  { value: 60, label: '60 fps' },
  { value: 30, label: '30 fps' },
  { value: 24, label: '24 fps' },
  { value: 15, label: '15 fps' },
];

const AUDIO_FORMATS: { value: AudioFormat; label: string }[] = [
  { value: 'mp3', label: 'MP3' },
  { value: 'm4a', label: 'AAC (M4A)' },
  { value: 'wav', label: 'WAV' },
  { value: 'ogg', label: 'OGG (Opus)' },
  { value: 'flac', label: 'FLAC' },
];

const AUDIO_BITRATES: AudioBitrate[] = [320, 256, 192, 128, 64];

const AUDIO_SAMPLE_RATES: { value: AudioSampleRate; label: string }[] = [
  { value: 48000, label: '48 kHz' },
  { value: 44100, label: '44.1 kHz' },
  { value: 22050, label: '22.05 kHz' },
];

export const InspectorPanel: React.FC<InspectorPanelProps> = ({
  item,
  similarCount,
  isBatchRunning,
  onUpdateSettings,
  onApplyPreset,
  onApplyToAllSimilar,
  onCompressSingle,
}) => {
  const { settings, kind } = item;

  const updateImage = (patch: Partial<MediaSettings['image']>) => {
    onUpdateSettings(item.id, {
      ...settings,
      image: { ...settings.image, ...patch },
    });
  };

  const updateVideo = (patch: Partial<MediaSettings['video']>) => {
    const updatedVideo = { ...settings.video, ...patch };
    if (patch.format === 'webm' && (updatedVideo.codec === 'h264' || updatedVideo.codec === 'h265')) {
      updatedVideo.codec = 'vp9';
    } else if (
      (patch.format === 'mp4' || patch.format === 'mkv' || patch.format === 'mov') &&
      (updatedVideo.codec === 'vp9' || updatedVideo.codec === 'vp8')
    ) {
      updatedVideo.codec = 'h264';
    }
    onUpdateSettings(item.id, {
      ...settings,
      video: updatedVideo,
    });
  };

  const updateAudioSettings = (patch: Partial<AudioSettings>, isExtractFromVideo = false) => {
    if (isExtractFromVideo) {
      onUpdateSettings(item.id, {
        ...settings,
        video: {
          ...settings.video,
          audioExtractSettings: { ...settings.video.audioExtractSettings, ...patch },
        },
      });
    } else {
      onUpdateSettings(item.id, {
        ...settings,
        audio: { ...settings.audio, ...patch },
      });
    }
  };

  const selectClass =
    'w-full px-3 py-2 text-xs rounded-lg border border-zinc-300 dark:border-white/10 bg-zinc-50 dark:bg-[#09090b] text-zinc-900 dark:text-zinc-100 disabled:opacity-45 focus:outline-none focus:border-cyan-500';
  const inputClass =
    'w-full px-3 py-2 text-xs font-mono rounded-lg border border-zinc-300 dark:border-white/10 bg-zinc-50 dark:bg-[#09090b] text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 dark:placeholder:text-zinc-600 focus:outline-none focus:border-cyan-500';

  const renderAudioControls = (audioCfg: AudioSettings, isExtractFromVideo: boolean) => {
    const isLosslessCodec = audioCfg.format === 'wav' || audioCfg.format === 'flac';
    return (
      <div className="space-y-4">
        <div>
          <span className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-2">
            Output Audio Format
          </span>
          <div className="grid grid-cols-3 sm:grid-cols-5 gap-1.5">
            {AUDIO_FORMATS.map((fmt) => (
              <button
                key={fmt.value}
                type="button"
                onClick={() => updateAudioSettings({ format: fmt.value }, isExtractFromVideo)}
                className={`px-2.5 py-2 text-xs font-medium rounded-lg border transition-colors cursor-pointer whitespace-nowrap ${
                  audioCfg.format === fmt.value
                    ? 'border-cyan-500 bg-cyan-500/15 text-cyan-800 dark:text-cyan-200'
                    : 'border-zinc-200 dark:border-white/[0.08] bg-zinc-50 dark:bg-white/[0.03] text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200'
                }`}
              >
                {fmt.label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label
              htmlFor={`audio-bitrate-${item.id}`}
              className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1.5"
            >
              Bitrate
            </label>
            <select
              id={`audio-bitrate-${item.id}`}
              value={audioCfg.bitrate}
              disabled={isLosslessCodec}
              onChange={(e) =>
                updateAudioSettings({ bitrate: Number(e.target.value) as AudioBitrate }, isExtractFromVideo)
              }
              className={selectClass}
            >
              {AUDIO_BITRATES.map((br) => (
                <option key={br} value={br}>
                  {br} kbps
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              htmlFor={`audio-rate-${item.id}`}
              className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1.5"
            >
              Sample Rate
            </label>
            <select
              id={`audio-rate-${item.id}`}
              value={audioCfg.sampleRate}
              onChange={(e) =>
                updateAudioSettings(
                  { sampleRate: Number(e.target.value) as AudioSampleRate },
                  isExtractFromVideo
                )
              }
              className={selectClass}
            >
              {AUDIO_SAMPLE_RATES.map((sr) => (
                <option key={sr.value} value={sr.value}>
                  {sr.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <span className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">
              Channels
            </span>
            <div className="grid grid-cols-2 gap-1.5">
              {(['stereo', 'mono'] as const).map((ch) => (
                <button
                  key={ch}
                  type="button"
                  onClick={() => updateAudioSettings({ channels: ch }, isExtractFromVideo)}
                  className={`px-2.5 py-2 text-xs font-medium rounded-lg border capitalize transition-colors cursor-pointer ${
                    audioCfg.channels === ch
                      ? 'border-cyan-500 bg-cyan-500/15 text-cyan-800 dark:text-cyan-200'
                      : 'border-zinc-200 dark:border-white/[0.08] bg-zinc-50 dark:bg-white/[0.03] text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200'
                  }`}
                >
                  {ch}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label
              htmlFor={`trim-start-${item.id}`}
              className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1.5"
            >
              Trim Start (MM:SS)
            </label>
            <input
              id={`trim-start-${item.id}`}
              type="text"
              placeholder="00:00"
              value={audioCfg.trimStart}
              onChange={(e) => updateAudioSettings({ trimStart: e.target.value }, isExtractFromVideo)}
              className={inputClass}
            />
          </div>

          <div>
            <label
              htmlFor={`trim-end-${item.id}`}
              className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1.5"
            >
              Trim End (MM:SS)
            </label>
            <input
              id={`trim-end-${item.id}`}
              type="text"
              placeholder="Full duration"
              value={audioCfg.trimEnd}
              onChange={(e) => updateAudioSettings({ trimEnd: e.target.value }, isExtractFromVideo)}
              className={inputClass}
            />
          </div>
        </div>
      </div>
    );
  };

  const estimatedImgBytes =
    kind === 'image'
      ? estimateImageOutputSize(
          item.originalSize,
          item.metadata.width || 1280,
          item.metadata.height || 720,
          settings.image
        )
      : null;

  const targetImgDims =
    kind === 'image' && item.metadata.width && item.metadata.height
      ? calculateTargetDimensions(item.metadata.width, item.metadata.height, settings.image.resize)
      : null;

  const availableVideoCodecs: { value: VideoCodec; label: string }[] =
    settings.video.format === 'webm'
      ? [
          { value: 'vp9', label: 'VP9 (Best Compression)' },
          { value: 'vp8', label: 'VP8 (Legacy Fast)' },
        ]
      : [
          { value: 'h264', label: 'H.264 (Universal)' },
          { value: 'h265', label: 'H.265 / HEVC' },
        ];

  return (
    <div className="rounded-xl border border-zinc-200 dark:border-white/[0.08] bg-white dark:bg-[#121216] overflow-hidden">
      {/* Smart One-Click Preset Bar */}
      <div className="px-4 py-3 border-b border-zinc-200 dark:border-white/[0.08] bg-zinc-50 dark:bg-white/[0.02]">
        <div className="flex items-center gap-1.5 text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-2">
          <Zap className="w-3.5 h-3.5 text-cyan-600 dark:text-cyan-400" />
          <span>Smart One-Click Presets</span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {SMART_PRESETS.filter((p) => p.appliesTo.includes(kind)).map((preset) => (
            <button
              key={preset.id}
              type="button"
              title={preset.shortDesc}
              onClick={() => onApplyPreset(item.id, preset.id)}
              className="px-2.5 py-1.5 text-xs font-medium rounded-lg border border-zinc-200 dark:border-white/10 bg-white dark:bg-white/[0.04] text-zinc-700 dark:text-zinc-200 hover:border-cyan-500/60 hover:bg-cyan-500/10 hover:text-cyan-800 dark:hover:text-cyan-100 transition-colors cursor-pointer whitespace-nowrap"
            >
              {preset.label}
            </button>
          ))}
        </div>
      </div>

      {/* Inspector Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-zinc-200 dark:border-white/[0.08]">
        <div className="flex items-center gap-2 min-w-0">
          {kind === 'image' ? (
            <ImageIcon className="w-4 h-4 text-cyan-600 dark:text-cyan-400 shrink-0" />
          ) : kind === 'video' ? (
            <Film className="w-4 h-4 text-cyan-600 dark:text-cyan-400 shrink-0" />
          ) : (
            <Music className="w-4 h-4 text-cyan-600 dark:text-cyan-400 shrink-0" />
          )}
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 truncate">
            {item.name}
          </h2>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {similarCount > 1 && (
            <button
              type="button"
              onClick={() => onApplyToAllSimilar(item)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-zinc-200 dark:border-white/10 bg-zinc-50 dark:bg-white/[0.04] text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-white/[0.08] transition-colors cursor-pointer whitespace-nowrap"
            >
              <CopyCheck className="w-3.5 h-3.5 text-cyan-600 dark:text-cyan-400" />
              Apply to All {kind === 'image' ? 'Images' : kind === 'video' ? 'Videos' : 'Audio'} ({similarCount})
            </button>
          )}

          <button
            type="button"
            disabled={isBatchRunning || item.status === 'processing'}
            onClick={() => onCompressSingle(item.id)}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold rounded-lg bg-cyan-600 dark:bg-cyan-500 text-white dark:text-zinc-950 hover:bg-cyan-500 dark:hover:bg-cyan-400 disabled:opacity-40 transition-colors cursor-pointer whitespace-nowrap"
          >
            <Play className="w-3 h-3 fill-current" />
            Compress Selected
          </button>
        </div>
      </div>

      {/* Dynamic Controls by Media Type */}
      <div className="p-4 space-y-5">
        {kind === 'image' && (
          <>
            <div>
              <span className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-2">
                Output Format
              </span>
              <div className="grid grid-cols-5 gap-1.5">
                {IMAGE_FORMATS.map((fmt) => (
                  <button
                    key={fmt.value}
                    type="button"
                    onClick={() => updateImage({ format: fmt.value })}
                    className={`px-2.5 py-2 text-xs font-medium rounded-lg border transition-colors cursor-pointer ${
                      settings.image.format === fmt.value
                        ? 'border-cyan-500 bg-cyan-500/15 text-cyan-800 dark:text-cyan-200'
                        : 'border-zinc-200 dark:border-white/[0.08] bg-zinc-50 dark:bg-white/[0.03] text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200'
                    }`}
                  >
                    {fmt.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between gap-2 mb-2">
                <label htmlFor={`img-quality-${item.id}`} className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
                  Quality / Compression
                </label>
                <div className="flex items-center gap-2 text-xs font-mono tabular-nums">
                  <span className="text-cyan-700 dark:text-cyan-300 font-semibold">{settings.image.quality}%</span>
                  {estimatedImgBytes !== null && (
                    <>
                      <span aria-hidden="true" className="text-zinc-400 dark:text-zinc-600">·</span>
                      <span className="text-zinc-500 dark:text-zinc-400">
                        Est. ~{formatBytes(estimatedImgBytes)}
                      </span>
                    </>
                  )}
                </div>
              </div>
              <input
                id={`img-quality-${item.id}`}
                type="range"
                min={1}
                max={100}
                value={settings.image.quality}
                disabled={settings.image.format === 'png' || settings.image.format === 'bmp'}
                onChange={(e) => updateImage({ quality: Number(e.target.value) })}
                className="studio-slider w-full disabled:opacity-40"
              />
              {(settings.image.format === 'png' || settings.image.format === 'bmp') && (
                <p className="mt-1 text-[11px] text-zinc-500">
                  {settings.image.format.toUpperCase()} is lossless; adjust Resize & Scaling below to reduce dimensions.
                </p>
              )}
            </div>

            <div>
              <div className="flex items-center justify-between gap-2 mb-1.5">
                <label htmlFor={`img-resize-${item.id}`} className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
                  Resize & Scaling (Aspect Ratio Locked)
                </label>
                {targetImgDims && (
                  <span className="text-[11px] font-mono text-zinc-500 dark:text-zinc-400 tabular-nums">
                    {targetImgDims.width} × {targetImgDims.height}px
                  </span>
                )}
              </div>
              <select
                id={`img-resize-${item.id}`}
                value={settings.image.resize}
                onChange={(e) => updateImage({ resize: e.target.value as ImageResizeMode })}
                className={selectClass}
              >
                {IMAGE_RESIZES.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2.5 pt-1 border-t border-zinc-200 dark:border-white/[0.06]">
              <span className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">
                Privacy & Pixel Optimization
              </span>

              <label className="flex items-center justify-between gap-3 py-1 cursor-pointer">
                <span className="text-xs text-zinc-700 dark:text-zinc-300">Strip EXIF / GPS Location Metadata</span>
                <input
                  type="checkbox"
                  checked={settings.image.stripExif}
                  onChange={(e) => updateImage({ stripExif: e.target.checked })}
                  className="w-4 h-4 accent-cyan-600 dark:accent-cyan-400 rounded cursor-pointer"
                />
              </label>

              <label className="flex items-center justify-between gap-3 py-1 cursor-pointer">
                <span className="text-xs text-zinc-700 dark:text-zinc-300">Grayscale Luminance Filter</span>
                <input
                  type="checkbox"
                  checked={settings.image.grayscale}
                  onChange={(e) => updateImage({ grayscale: e.target.checked })}
                  className="w-4 h-4 accent-cyan-600 dark:accent-cyan-400 rounded cursor-pointer"
                />
              </label>

              <div className="flex items-center justify-between gap-3 py-1">
                <label className="flex items-center gap-2.5 cursor-pointer flex-1">
                  <input
                    type="checkbox"
                    checked={settings.image.flattenAlpha || settings.image.format === 'jpg' || settings.image.format === 'bmp'}
                    disabled={settings.image.format === 'jpg' || settings.image.format === 'bmp'}
                    onChange={(e) => updateImage({ flattenAlpha: e.target.checked })}
                    className="w-4 h-4 accent-cyan-600 dark:accent-cyan-400 rounded cursor-pointer"
                  />
                  <span className="text-xs text-zinc-700 dark:text-zinc-300">Remove Alpha / Flatten Background</span>
                </label>

                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    aria-label="Alpha flatten background color"
                    value={settings.image.flattenColor}
                    onChange={(e) => updateImage({ flattenColor: e.target.value })}
                    className="w-7 h-7 rounded border border-zinc-300 dark:border-white/15 bg-transparent cursor-pointer"
                  />
                  <span className="text-[11px] font-mono text-zinc-500 dark:text-zinc-400 uppercase">
                    {settings.image.flattenColor}
                  </span>
                </div>
              </div>
            </div>
          </>
        )}

        {kind === 'video' && (
          <>
            {/* Mode Switch */}
            <div className="grid grid-cols-2 gap-1.5 p-1 rounded-lg bg-zinc-100 dark:bg-[#09090b] border border-zinc-200 dark:border-white/[0.08]">
              <button
                type="button"
                onClick={() => updateVideo({ mode: 'video' })}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer ${
                  settings.video.mode === 'video'
                    ? 'bg-white dark:bg-white/10 text-zinc-900 dark:text-zinc-100 shadow-xs'
                    : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200'
                }`}
              >
                Compress / Convert Video
              </button>
              <button
                type="button"
                onClick={() => updateVideo({ mode: 'extract-audio' })}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer ${
                  settings.video.mode === 'extract-audio'
                    ? 'bg-cyan-500/15 text-cyan-800 dark:text-cyan-200'
                    : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200'
                }`}
              >
                Extract Audio Track
              </button>
            </div>

            {settings.video.mode === 'extract-audio' ? (
              renderAudioControls(settings.video.audioExtractSettings, true)
            ) : (
              <div className="space-y-4">
                <div>
                  <span className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-2">
                    Output Container
                  </span>
                  <div className="grid grid-cols-3 sm:grid-cols-6 gap-1.5">
                    {VIDEO_FORMATS.map((fmt) => (
                      <button
                        key={fmt.value}
                        type="button"
                        onClick={() => updateVideo({ format: fmt.value })}
                        className={`px-2 py-2 text-xs font-medium rounded-lg border transition-colors cursor-pointer ${
                          settings.video.format === fmt.value
                            ? 'border-cyan-500 bg-cyan-500/15 text-cyan-800 dark:text-cyan-200'
                            : 'border-zinc-200 dark:border-white/[0.08] bg-zinc-50 dark:bg-white/[0.03] text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200'
                        }`}
                      >
                        {fmt.label}
                      </button>
                    ))}
                  </div>
                </div>

                {settings.video.format === 'gif' ? (
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label
                        htmlFor={`gif-width-${item.id}`}
                        className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1.5"
                      >
                        GIF Width (px)
                      </label>
                      <input
                        id={`gif-width-${item.id}`}
                        type="number"
                        min={120}
                        max={1280}
                        step={20}
                        value={settings.video.gifWidth}
                        onChange={(e) =>
                          updateVideo({ gifWidth: Math.max(120, Number(e.target.value) || 480) })
                        }
                        className={inputClass}
                      />
                    </div>

                    <div>
                      <label
                        htmlFor={`gif-fps-${item.id}`}
                        className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1.5"
                      >
                        GIF Frame Rate
                      </label>
                      <select
                        id={`gif-fps-${item.id}`}
                        value={settings.video.fps}
                        onChange={(e) => {
                          const v = e.target.value;
                          updateVideo({ fps: v === 'original' ? 'original' : (Number(v) as VideoFps) });
                        }}
                        className={selectClass}
                      >
                        {VIDEO_FPS_OPTIONS.map((f) => (
                          <option key={String(f.value)} value={f.value}>
                            {f.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {(settings.video.format === 'mp4' ||
                        settings.video.format === 'webm' ||
                        settings.video.format === 'mkv' ||
                        settings.video.format === 'mov') && (
                        <div>
                          <label
                            htmlFor={`video-codec-${item.id}`}
                            className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1.5"
                          >
                            Video Codec
                          </label>
                          <select
                            id={`video-codec-${item.id}`}
                            value={settings.video.codec}
                            onChange={(e) => updateVideo({ codec: e.target.value as VideoCodec })}
                            className={selectClass}
                          >
                            {availableVideoCodecs.map((c) => (
                              <option key={c.value} value={c.value}>
                                {c.label}
                              </option>
                            ))}
                          </select>
                        </div>
                      )}

                      <div>
                        <label
                          htmlFor={`video-crf-${item.id}`}
                          className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1.5"
                        >
                          CRF Quality Preset
                        </label>
                        <select
                          id={`video-crf-${item.id}`}
                          value={settings.video.crf}
                          onChange={(e) => updateVideo({ crf: Number(e.target.value) })}
                          className={selectClass}
                        >
                          {VIDEO_CRF_PRESETS.map((p) => (
                            <option key={p.value} value={p.value}>
                              {p.label}
                            </option>
                          ))}
                          {!VIDEO_CRF_PRESETS.some((p) => p.value === settings.video.crf) && (
                            <option value={settings.video.crf}>
                              Custom (CRF {settings.video.crf})
                            </option>
                          )}
                        </select>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label
                          htmlFor={`video-res-${item.id}`}
                          className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1.5"
                        >
                          Resolution Scaler
                        </label>
                        <select
                          id={`video-res-${item.id}`}
                          value={settings.video.resolution}
                          onChange={(e) =>
                            updateVideo({ resolution: e.target.value as VideoResolution })
                          }
                          className={selectClass}
                        >
                          {VIDEO_RESOLUTIONS.map((r) => (
                            <option key={r.value} value={r.value}>
                              {r.label}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label
                          htmlFor={`video-fps-${item.id}`}
                          className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1.5"
                        >
                          Frame Rate
                        </label>
                        <select
                          id={`video-fps-${item.id}`}
                          value={settings.video.fps}
                          onChange={(e) => {
                            const v = e.target.value;
                            updateVideo({
                              fps: v === 'original' ? 'original' : (Number(v) as VideoFps),
                            });
                          }}
                          className={selectClass}
                        >
                          {VIDEO_FPS_OPTIONS.map((f) => (
                            <option key={String(f.value)} value={f.value}>
                              {f.label}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    <label className="flex items-center justify-between gap-3 pt-2 border-t border-zinc-200 dark:border-white/[0.06] cursor-pointer">
                      <span className="inline-flex items-center gap-2 text-xs text-zinc-700 dark:text-zinc-300">
                        <VolumeX className="w-3.5 h-3.5 text-zinc-500 dark:text-zinc-400" />
                        Mute / Strip Audio Track
                      </span>
                      <input
                        type="checkbox"
                        checked={settings.video.muteAudio}
                        onChange={(e) => updateVideo({ muteAudio: e.target.checked })}
                        className="w-4 h-4 accent-cyan-600 dark:accent-cyan-400 rounded cursor-pointer"
                      />
                    </label>
                  </>
                )}
              </div>
            )}
          </>
        )}

        {kind === 'audio' && renderAudioControls(settings.audio, false)}
      </div>

      {/* Footer note */}
      <div className="px-4 py-2.5 border-t border-zinc-200 dark:border-white/[0.06] bg-zinc-50 dark:bg-white/[0.015] flex items-center justify-between text-[11px] text-zinc-500">
        <span className="inline-flex items-center gap-1.5">
          <SlidersHorizontal className="w-3 h-3" />
          Settings apply per-file until synced
        </span>
        {item.engineUsed && (
          <span className="font-mono text-zinc-600 dark:text-zinc-400">
            Last engine: {item.engineUsed}
          </span>
        )}
      </div>
    </div>
  );
};
