import React, { useRef, useState } from 'react';
import { FolderPlus, Sparkles, UploadCloud } from 'lucide-react';

interface DropZoneProps {
  onFilesAdded: (files: File[]) => void;
  onLoadSamples: () => void;
  isGeneratingSamples: boolean;
  compact?: boolean;
}

export const DropZone: React.FC<DropZoneProps> = ({
  onFilesAdded,
  onLoadSamples,
  isGeneratingSamples,
  compact = false,
}) => {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    const dropped = Array.from(e.dataTransfer.files || []);
    if (dropped.length > 0) {
      onFilesAdded(dropped);
    }
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isDragOver) setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(e.target.files || []);
    if (selected.length > 0) {
      onFilesAdded(selected);
    }
    e.target.value = '';
  };

  return (
    <div
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      data-testid="media-dropzone"
      className={`relative rounded-xl border border-dashed transition-colors ${
        isDragOver
          ? 'border-cyan-500 bg-cyan-500/10'
          : 'border-zinc-300 dark:border-white/15 bg-white dark:bg-[#121216] hover:border-zinc-400 dark:hover:border-white/25'
      } ${compact ? 'p-4' : 'p-6'}`}
    >
      <input
        ref={inputRef}
        type="file"
        multiple
        accept="image/*,video/*,audio/*,.mkv,.avi,.flv,.flac,.avif,.webp"
        onChange={handleFileChange}
        className="sr-only"
        aria-label="Upload media files"
      />

      <div className="flex flex-col items-center text-center gap-3">
        <div
          className={`flex items-center justify-center rounded-lg border border-zinc-200 dark:border-white/10 bg-zinc-50 dark:bg-white/[0.03] text-cyan-600 dark:text-cyan-400 ${
            compact ? 'w-9 h-9' : 'w-11 h-11'
          }`}
        >
          <UploadCloud className={compact ? 'w-4 h-4' : 'w-5 h-5'} />
        </div>

        <div className="space-y-1">
          <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
            Drop videos, images, or audio files here
          </p>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            MP4 · WebM · MKV · MOV · JPG · PNG · WebP · AVIF · MP3 · WAV · FLAC
          </p>
        </div>

        <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-lg bg-cyan-600 dark:bg-cyan-500 text-white dark:text-zinc-950 hover:bg-cyan-500 dark:hover:bg-cyan-400 transition-colors cursor-pointer whitespace-nowrap shrink-0"
          >
            <FolderPlus className="w-3.5 h-3.5" />
            Select Files
          </button>

          <button
            type="button"
            onClick={onLoadSamples}
            disabled={isGeneratingSamples}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-lg border border-zinc-200 dark:border-white/10 bg-zinc-50 dark:bg-white/[0.04] text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-white/[0.08] disabled:opacity-50 transition-colors cursor-pointer whitespace-nowrap shrink-0"
          >
            <Sparkles className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
            {isGeneratingSamples ? 'Generating Samples...' : 'Load Sample Media'}
          </button>
        </div>
      </div>
    </div>
  );
};
