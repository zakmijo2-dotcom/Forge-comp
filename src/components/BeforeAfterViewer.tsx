import React, { useEffect, useRef, useState } from 'react';
import { Columns2, Download, ZoomIn, ZoomOut } from 'lucide-react';
import { MediaQueueItem } from '../types/media';
import { processImageFile } from '../services/imageEngine';
import { calculateSavings, formatBytes } from '../utils/mediaUtils';

interface BeforeAfterViewerProps {
  item: MediaQueueItem;
  onDownload: (item: MediaQueueItem) => void;
}

export const BeforeAfterViewer: React.FC<BeforeAfterViewerProps> = ({ item, onDownload }) => {
  const [sliderPos, setSliderPos] = useState(50);
  const [isZoomed, setIsZoomed] = useState(false);
  const [livePreviewUrl, setLivePreviewUrl] = useState<string | null>(null);
  const [livePreviewSize, setLivePreviewSize] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const isDraggingRef = useRef(false);

  useEffect(() => {
    if (item.kind !== 'image') {
      setLivePreviewUrl(null);
      setLivePreviewSize(null);
      return;
    }

    if (item.status === 'completed' && item.outputUrl) {
      setLivePreviewUrl(item.outputUrl);
      setLivePreviewSize(item.outputSize ?? null);
      return;
    }

    let cancelled = false;
    let createdUrl: string | null = null;
    const timer = setTimeout(async () => {
      try {
        const res = await processImageFile(item.file, item.settings.image);
        if (cancelled) return;
        createdUrl = URL.createObjectURL(res.blob);
        setLivePreviewUrl(createdUrl);
        setLivePreviewSize(res.blob.size);
      } catch {
        // ignore live preview error
      }
    }, 180);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      if (createdUrl) {
        URL.revokeObjectURL(createdUrl);
      }
    };
  }, [item.id, item.kind, item.file, item.status, item.outputUrl, item.outputSize, item.settings.image]);

  const updateSliderFromClientX = (clientX: number) => {
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0) return;
    const pct = ((clientX - rect.left) / rect.width) * 100;
    setSliderPos(Math.max(0, Math.min(100, pct)));
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    isDraggingRef.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    updateSliderFromClientX(e.clientX);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDraggingRef.current) return;
    updateSliderFromClientX(e.clientX);
  };

  const handlePointerUp = () => {
    isDraggingRef.current = false;
  };

  const activeAfterSize = item.outputSize ?? livePreviewSize;
  const savings =
    activeAfterSize !== null ? calculateSavings(item.originalSize, activeAfterSize) : null;

  return (
    <div className="rounded-xl border border-zinc-200 dark:border-white/[0.08] bg-white dark:bg-[#121216] overflow-hidden">
      {/* Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 border-b border-zinc-200 dark:border-white/[0.08]">
        <div className="flex items-center gap-2 text-xs">
          <Columns2 className="w-3.5 h-3.5 text-cyan-600 dark:text-cyan-400" />
          <span className="font-medium text-zinc-800 dark:text-zinc-200">
            {item.kind === 'image' ? 'Before / After Comparison' : 'Media Preview & Comparison'}
          </span>
          {activeAfterSize !== null && savings && (
            <>
              <span aria-hidden="true" className="text-zinc-400 dark:text-zinc-600">·</span>
              <span className="font-mono text-zinc-600 dark:text-zinc-400 tabular-nums">
                {formatBytes(item.originalSize)} → {formatBytes(activeAfterSize)}
              </span>
              <span
                className={`px-1.5 py-0.5 rounded font-mono text-[11px] font-semibold tabular-nums ${
                  savings.isLarger
                    ? 'bg-amber-500/15 text-amber-800 dark:text-amber-300 border border-amber-500/30'
                    : 'bg-emerald-500/15 text-emerald-800 dark:text-emerald-300 border border-emerald-500/30'
                }`}
              >
                {savings.label}
              </span>
            </>
          )}
        </div>

        <div className="flex items-center gap-2">
          {item.kind === 'image' && (
            <button
              type="button"
              onClick={() => setIsZoomed((z) => !z)}
              aria-pressed={isZoomed}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md border border-zinc-200 dark:border-white/10 bg-zinc-50 dark:bg-white/[0.04] text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-white/[0.08] transition-colors cursor-pointer"
            >
              {isZoomed ? <ZoomOut className="w-3.5 h-3.5" /> : <ZoomIn className="w-3.5 h-3.5" />}
              {isZoomed ? '1x Fit' : '2x Zoom'}
            </button>
          )}

          {item.status === 'completed' && item.outputUrl && (
            <button
              type="button"
              onClick={() => onDownload(item)}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded-md bg-emerald-600 dark:bg-emerald-500 text-white dark:text-zinc-950 hover:bg-emerald-500 dark:hover:bg-emerald-400 transition-colors cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              Save Output
            </button>
          )}
        </div>
      </div>

      {/* Preview Surface */}
      {item.kind === 'image' ? (
        <div className="p-3">
          <div
            ref={containerRef}
            data-testid="before-after-slider"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            className="relative w-full h-64 sm:h-72 rounded-lg overflow-hidden checkerboard-bg border border-zinc-200 dark:border-white/[0.08] select-none touch-none cursor-ew-resize"
          >
            {/* After Image */}
            <img
              src={livePreviewUrl || item.originalUrl}
              alt={`${item.name} compressed preview`}
              referrerPolicy="no-referrer"
              draggable={false}
              className={`absolute inset-0 w-full h-full object-contain transition-transform duration-150 ${
                isZoomed ? 'scale-200' : 'scale-100'
              }`}
            />

            {/* Before Image */}
            <div
              className="absolute inset-0 overflow-hidden"
              style={{ clipPath: `inset(0 ${100 - sliderPos}% 0 0)` }}
            >
              <img
                src={item.originalUrl}
                alt={`${item.name} original`}
                referrerPolicy="no-referrer"
                draggable={false}
                className={`w-full h-full object-contain transition-transform duration-150 ${
                  isZoomed ? 'scale-200' : 'scale-100'
                }`}
              />
            </div>

            {/* Vertical Divider Handle */}
            <div
              className="absolute top-0 bottom-0 w-0.5 bg-cyan-500 dark:bg-cyan-400 shadow-[0_0_8px_rgba(34,211,238,0.6)] pointer-events-none"
              style={{ left: `${sliderPos}%` }}
            >
              <div className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-7 h-7 rounded-full bg-white dark:bg-[#09090b] border-2 border-cyan-500 dark:border-cyan-400 flex items-center justify-center text-[10px] font-mono text-cyan-700 dark:text-cyan-300">
                ↔
              </div>
            </div>

            {/* Corner Labels */}
            <span className="absolute top-2.5 left-2.5 px-2 py-0.5 rounded bg-black/75 border border-white/10 text-[11px] font-mono text-zinc-100 pointer-events-none">
              Original · {formatBytes(item.originalSize)}
            </span>
            <span className="absolute top-2.5 right-2.5 px-2 py-0.5 rounded bg-black/75 border border-cyan-500/30 text-[11px] font-mono text-cyan-200 pointer-events-none">
              {item.status === 'completed' ? 'Output' : 'Live Preview'} ·{' '}
              {activeAfterSize !== null ? formatBytes(activeAfterSize) : '...'}
            </span>
          </div>

          <div className="mt-2 flex items-center justify-between gap-3 px-1">
            <label htmlFor="compare-range" className="text-[11px] text-zinc-500 dark:text-zinc-400 whitespace-nowrap">
              Split Position
            </label>
            <input
              id="compare-range"
              type="range"
              min={0}
              max={100}
              value={Math.round(sliderPos)}
              onChange={(e) => setSliderPos(Number(e.target.value))}
              className="studio-slider flex-1"
              aria-label="Before and after comparison split slider"
            />
            <span className="text-[11px] font-mono text-zinc-500 dark:text-zinc-400 tabular-nums w-9 text-right">
              {Math.round(sliderPos)}%
            </span>
          </div>
        </div>
      ) : item.kind === 'video' ? (
        <div className="p-3 grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-[11px] font-mono text-zinc-500 dark:text-zinc-400">
              <span>Original Source</span>
              <span>{formatBytes(item.originalSize)}</span>
            </div>
            <video
              src={item.originalUrl}
              controls
              playsInline
              className="w-full h-44 rounded-lg bg-black border border-zinc-200 dark:border-white/[0.08] object-contain"
            />
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-[11px] font-mono text-zinc-500 dark:text-zinc-400">
              <span>Processed Output</span>
              <span className={item.outputSize ? 'text-emerald-600 dark:text-emerald-400' : ''}>
                {item.outputSize ? formatBytes(item.outputSize) : 'Pending run'}
              </span>
            </div>
            {item.status === 'completed' && item.outputUrl ? (
              item.outputFilename?.endsWith('.gif') ? (
                <img
                  src={item.outputUrl}
                  alt={item.outputFilename}
                  referrerPolicy="no-referrer"
                  className="w-full h-44 rounded-lg bg-black border border-emerald-500/30 object-contain"
                />
              ) : item.settings.video.mode === 'extract-audio' ? (
                <div className="w-full h-44 rounded-lg bg-zinc-100 dark:bg-zinc-950 border border-emerald-500/30 flex flex-col items-center justify-center p-4 gap-3">
                  <span className="text-xs font-mono text-emerald-700 dark:text-emerald-300">
                    Extracted Audio Track
                  </span>
                  <audio src={item.outputUrl} controls className="w-full" />
                </div>
              ) : (
                <video
                  src={item.outputUrl}
                  controls
                  playsInline
                  className="w-full h-44 rounded-lg bg-black border border-emerald-500/30 object-contain"
                />
              )
            ) : (
              <div className="w-full h-44 rounded-lg bg-zinc-100 dark:bg-zinc-950/60 border border-zinc-200 dark:border-white/[0.06] flex items-center justify-center text-xs text-zinc-500 px-4 text-center">
                Run compression to preview processed output side-by-side.
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="p-3 grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="p-3 rounded-lg bg-zinc-50 dark:bg-zinc-950/70 border border-zinc-200 dark:border-white/[0.06] space-y-2">
            <div className="flex items-center justify-between text-[11px] font-mono text-zinc-500 dark:text-zinc-400">
              <span>Original Audio</span>
              <span>{formatBytes(item.originalSize)}</span>
            </div>
            <audio src={item.originalUrl} controls className="w-full" />
          </div>

          <div className="p-3 rounded-lg bg-zinc-50 dark:bg-zinc-950/70 border border-zinc-200 dark:border-white/[0.06] space-y-2">
            <div className="flex items-center justify-between text-[11px] font-mono text-zinc-500 dark:text-zinc-400">
              <span>Converted Output</span>
              <span className={item.outputSize ? 'text-emerald-600 dark:text-emerald-400' : ''}>
                {item.outputSize ? formatBytes(item.outputSize) : 'Pending run'}
              </span>
            </div>
            {item.status === 'completed' && item.outputUrl ? (
              <audio src={item.outputUrl} controls className="w-full" />
            ) : (
              <div className="h-12 flex items-center justify-center text-xs text-zinc-500">
                Process file to audition converted audio.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
