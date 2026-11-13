import React from 'react';
import {
  AlertCircle,
  Archive,
  CheckCircle2,
  Download,
  FileAudio,
  FileImage,
  FileVideo,
  Loader2,
  Play,
  Square,
  Trash2,
  X,
} from 'lucide-react';
import { MediaQueueItem } from '../types/media';
import { calculateSavings, formatBytes, secondsToTimestamp } from '../utils/mediaUtils';

interface FileQueueProps {
  items: MediaQueueItem[];
  selectedId: string | null;
  isBatchRunning: boolean;
  isZipping: boolean;
  onSelect: (id: string) => void;
  onRemove: (id: string) => void;
  onDownloadOne: (item: MediaQueueItem) => void;
  onStartBatch: () => void;
  onCancelBatch: () => void;
  onDownloadAllZip: () => void;
  onClearAll: () => void;
}

export const FileQueue: React.FC<FileQueueProps> = ({
  items,
  selectedId,
  isBatchRunning,
  isZipping,
  onSelect,
  onRemove,
  onDownloadOne,
  onStartBatch,
  onCancelBatch,
  onDownloadAllZip,
  onClearAll,
}) => {
  const completedCount = items.filter((i) => i.status === 'completed').length;
  const pendingCount = items.filter(
    (i) => i.status === 'queued' || i.status === 'error' || i.status === 'cancelled'
  ).length;
  const globalProgress =
    items.length === 0
      ? 0
      : Math.round(items.reduce((acc, i) => acc + (i.status === 'completed' ? 100 : i.progress), 0) / items.length);

  const renderKindIcon = (item: MediaQueueItem) => {
    if (item.thumbnailUrl && item.kind !== 'audio') {
      return (
        <img
          src={item.thumbnailUrl}
          alt={item.name}
          referrerPolicy="no-referrer"
          className="w-11 h-11 rounded-lg object-cover border border-zinc-200 dark:border-white/10 shrink-0 bg-zinc-100 dark:bg-zinc-900"
        />
      );
    }
    const Icon =
      item.kind === 'video' ? FileVideo : item.kind === 'image' ? FileImage : FileAudio;
    return (
      <div className="w-11 h-11 rounded-lg border border-zinc-200 dark:border-white/10 bg-zinc-50 dark:bg-white/[0.04] flex items-center justify-center text-zinc-500 dark:text-zinc-400 shrink-0">
        <Icon className="w-5 h-5" />
      </div>
    );
  };

  return (
    <section
      aria-label="Batch media queue"
      className="flex flex-col rounded-xl border border-zinc-200 dark:border-white/[0.08] bg-white dark:bg-[#121216] overflow-hidden flex-1 min-h-0"
    >
      {/* Queue Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-zinc-200 dark:border-white/[0.08]">
        <div className="flex items-center gap-2 text-xs text-zinc-700 dark:text-zinc-300 font-medium">
          <span>Batch Queue</span>
          <span aria-hidden="true" className="text-zinc-400 dark:text-zinc-600">·</span>
          <span className="font-mono text-zinc-500 dark:text-zinc-400 tabular-nums">
            {items.length} {items.length === 1 ? 'file' : 'files'}
          </span>
          {completedCount > 0 && (
            <>
              <span aria-hidden="true" className="text-zinc-400 dark:text-zinc-600">·</span>
              <span className="font-mono text-emerald-600 dark:text-emerald-400 tabular-nums">
                {completedCount} ready
              </span>
            </>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {items.length > 0 && (
            <button
              type="button"
              onClick={onClearAll}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-md text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-white/[0.05] transition-colors cursor-pointer whitespace-nowrap shrink-0"
              aria-label="Clear entire queue"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Clear
            </button>
          )}

          {completedCount > 0 && (
            <button
              type="button"
              onClick={onDownloadAllZip}
              disabled={isZipping}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md border border-emerald-600/30 dark:border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/20 disabled:opacity-50 transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              <Archive className="w-3.5 h-3.5" />
              {isZipping ? 'Packing ZIP...' : 'Download All as ZIP'}
            </button>
          )}

          {isBatchRunning ? (
            <button
              type="button"
              onClick={onCancelBatch}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md bg-rose-500/15 border border-rose-500/40 text-rose-700 dark:text-rose-300 hover:bg-rose-500/25 transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              <Square className="w-3 h-3 fill-current" />
              Cancel Batch
            </button>
          ) : (
            <button
              type="button"
              onClick={onStartBatch}
              disabled={items.length === 0 || (pendingCount === 0 && completedCount === items.length)}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold rounded-md bg-cyan-600 dark:bg-cyan-500 text-white dark:text-zinc-950 hover:bg-cyan-500 dark:hover:bg-cyan-400 disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              <Play className="w-3 h-3 fill-current" />
              {pendingCount > 0 ? `Process Queue (${pendingCount})` : 'Process Queue'}
            </button>
          )}
        </div>
      </div>

      {/* Global Batch Progress Bar */}
      {(isBatchRunning || (items.length > 0 && globalProgress > 0 && globalProgress < 100)) && (
        <div className="px-4 py-2 border-b border-zinc-200 dark:border-white/[0.06] bg-zinc-50 dark:bg-white/[0.02]">
          <div className="flex items-center justify-between text-[11px] text-zinc-600 dark:text-zinc-400 mb-1.5">
            <span>{isBatchRunning ? 'Processing batch sequentially...' : 'Batch progress'}</span>
            <span className="font-mono tabular-nums text-cyan-700 dark:text-cyan-300">{globalProgress}%</span>
          </div>
          <div className="h-1.5 w-full rounded-full bg-zinc-200 dark:bg-white/[0.08] overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-cyan-500 to-emerald-500 transition-all duration-200"
              style={{ width: `${globalProgress}%` }}
            />
          </div>
        </div>
      )}

      {/* Queue List */}
      <div className="flex-1 overflow-y-auto divide-y divide-zinc-200 dark:divide-white/[0.06]" data-testid="queue-list">
        {items.length === 0 ? (
          <div className="p-8 text-center text-xs text-zinc-500">
            No files queued yet. Drop media above or load local sample media to start.
          </div>
        ) : (
          items.map((item) => {
            const isSelected = item.id === selectedId;
            const savings =
              item.status === 'completed' && item.outputSize !== undefined
                ? calculateSavings(item.originalSize, item.outputSize)
                : null;

            const metaParts: string[] = [item.kind.toUpperCase()];
            if (item.metadata.width && item.metadata.height) {
              metaParts.push(`${item.metadata.width}×${item.metadata.height}`);
            }
            if (item.metadata.duration !== undefined) {
              metaParts.push(secondsToTimestamp(item.metadata.duration));
            }
            metaParts.push(formatBytes(item.originalSize));

            return (
              <div
                key={item.id}
                data-testid={`queue-item-${item.id}`}
                className={`group flex items-start gap-3 px-4 py-3 transition-colors ${
                  isSelected
                    ? 'bg-cyan-500/[0.08]'
                    : 'hover:bg-zinc-50 dark:hover:bg-white/[0.03]'
                }`}
              >
                <button
                  type="button"
                  onClick={() => onSelect(item.id)}
                  className="flex flex-1 min-w-0 items-start gap-3 text-left cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 rounded-md"
                >
                  {renderKindIcon(item)}

                  <div className="flex-1 min-w-0 space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <span
                        className={`text-sm font-medium truncate ${
                          isSelected
                            ? 'text-cyan-900 dark:text-cyan-100'
                            : 'text-zinc-900 dark:text-zinc-100'
                        }`}
                      >
                        {item.name}
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-mono text-zinc-500 dark:text-zinc-400 tabular-nums">
                      {metaParts.map((part, idx) => (
                        <React.Fragment key={`${part}-${idx}`}>
                          {idx > 0 && <span aria-hidden="true" className="text-zinc-400 dark:text-zinc-600">·</span>}
                          <span>{part}</span>
                        </React.Fragment>
                      ))}
                    </div>

                    {/* Status / Progress / Savings row */}
                    {item.status === 'processing' && (
                      <div className="pt-1 space-y-1">
                        <div className="flex items-center justify-between text-[11px] text-cyan-700 dark:text-cyan-300 font-mono">
                          <span className="inline-flex items-center gap-1">
                            <Loader2 className="w-3 h-3 animate-spin" />
                            Encoding
                          </span>
                          <span className="tabular-nums">{item.progress}%</span>
                        </div>
                        <div className="h-1 w-full rounded-full bg-zinc-200 dark:bg-white/[0.08] overflow-hidden">
                          <div
                            className="h-full bg-cyan-500 dark:bg-cyan-400 transition-all duration-150"
                            style={{ width: `${item.progress}%` }}
                          />
                        </div>
                      </div>
                    )}

                    {item.status === 'completed' && item.outputSize !== undefined && savings && (
                      <div className="flex flex-wrap items-center gap-2 pt-0.5 text-[11px] font-mono tabular-nums">
                        <span className="inline-flex items-center gap-1 text-zinc-700 dark:text-zinc-300">
                          <CheckCircle2 className="w-3 h-3 text-emerald-600 dark:text-emerald-400 shrink-0" />
                          {formatBytes(item.originalSize)} → {formatBytes(item.outputSize)}
                        </span>
                        <span
                          className={`px-1.5 py-0.5 rounded font-semibold ${
                            savings.isLarger
                              ? 'bg-amber-500/15 text-amber-800 dark:text-amber-300 border border-amber-500/30'
                              : 'bg-emerald-500/15 text-emerald-800 dark:text-emerald-300 border border-emerald-500/30'
                          }`}
                        >
                          {savings.label}
                        </span>
                      </div>
                    )}

                    {item.status === 'error' && (
                      <div className="flex items-center gap-1.5 text-[11px] text-rose-600 dark:text-rose-400 pt-0.5">
                        <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                        <span className="truncate">{item.errorMessage || 'Processing failed'}</span>
                      </div>
                    )}

                    {item.status === 'cancelled' && (
                      <div className="text-[11px] text-zinc-500 pt-0.5">Cancelled</div>
                    )}
                  </div>
                </button>

                {/* Row Actions */}
                <div className="flex items-center gap-1 shrink-0 pt-0.5">
                  {item.status === 'completed' && item.outputUrl && (
                    <button
                      type="button"
                      onClick={() => onDownloadOne(item)}
                      aria-label={`Download ${item.outputFilename || item.name}`}
                      title="Download converted file"
                      className="p-2 rounded-md text-emerald-700 dark:text-emerald-300 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-600/25 dark:border-emerald-500/25 transition-colors cursor-pointer"
                    >
                      <Download className="w-3.5 h-3.5" />
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => onRemove(item.id)}
                    aria-label={`Remove ${item.name} from queue`}
                    title="Remove file"
                    className="p-2 rounded-md text-zinc-400 dark:text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-white/[0.06] transition-colors cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </section>
  );
};
