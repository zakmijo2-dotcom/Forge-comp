import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import JSZip from 'jszip';
import {
  Cpu,
  HardDriveDownload,
  Layers,
  Lock,
  Server,
  Settings,
  ShieldCheck,
} from 'lucide-react';
import { BeforeAfterViewer } from './components/BeforeAfterViewer';
import { DropZone } from './components/DropZone';
import { FileQueue } from './components/FileQueue';
import { InspectorPanel } from './components/InspectorPanel';
import { SettingsModal } from './components/SettingsModal';
import { TerminalLogs } from './components/TerminalLogs';
import { extractMediaMetadata, processMediaItem } from './services/mediaEngine';
import { generateSampleMediaFiles } from './services/sampleMedia';
import {
  BridgeConfig,
  EngineMode,
  MediaQueueItem,
  MediaSettings,
  PresetId,
  TerminalLogEntry,
} from './types/media';
import {
  cloneMediaSettings,
  createDefaultSettingsForKind,
  detectMediaKind,
  formatBytes,
} from './utils/mediaUtils';
import { applyPresetToMediaSettings } from './utils/presets';
import {
  loadThemeConfig,
  resolveEffectiveTheme,
  saveThemeConfig,
  ThemeConfig,
} from './utils/themeUtils';

function nowTimestamp(): string {
  const d = new Date();
  return d.toTimeString().slice(0, 8);
}

function readSystemPrefersDark(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return true;
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export default function App() {
  const [queue, setQueue] = useState<MediaQueueItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [engineMode, setEngineMode] = useState<EngineMode>('browser-wasm');
  const [bridgeConfig, setBridgeConfig] = useState<BridgeConfig>({
    url: 'http://127.0.0.1:8000',
    timeoutMs: 120000,
    presetName: 'veryfast',
  });
  const [themeConfig, setThemeConfig] = useState<ThemeConfig>(() => loadThemeConfig());
  const [systemPrefersDark, setSystemPrefersDark] = useState<boolean>(() => readSystemPrefersDark());
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isBatchRunning, setIsBatchRunning] = useState(false);
  const [isZipping, setIsZipping] = useState(false);
  const [isGeneratingSamples, setIsGeneratingSamples] = useState(false);
  const [fallbackNotice, setFallbackNotice] = useState<string | null>(null);
  const [logs, setLogs] = useState<TerminalLogEntry[]>([]);
  const [isLogsExpanded, setIsLogsExpanded] = useState(true);

  const abortControllerRef = useRef<AbortController | null>(null);
  const queueRef = useRef<MediaQueueItem[]>(queue);
  queueRef.current = queue;

  const objectUrlsRef = useRef<Set<string>>(new Set());

  // Listen for OS dark/light preference changes
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    setSystemPrefersDark(mediaQuery.matches);

    const handleChange = (e: MediaQueryListEvent) => {
      setSystemPrefersDark(e.matches);
    };

    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', handleChange);
      return () => mediaQuery.removeEventListener('change', handleChange);
    }
    mediaQuery.addListener(handleChange);
    return () => mediaQuery.removeListener(handleChange);
  }, []);

  // Apply resolved dark/light class to <html> and persist config
  const effectiveTheme = resolveEffectiveTheme(themeConfig, systemPrefersDark);
  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('dark', effectiveTheme === 'dark');
    root.style.colorScheme = effectiveTheme;
    saveThemeConfig(themeConfig);
  }, [effectiveTheme, themeConfig]);

  const registerUrl = (url: string) => {
    objectUrlsRef.current.add(url);
    return url;
  };

  const revokeUrl = (url?: string) => {
    if (!url) return;
    if (objectUrlsRef.current.has(url)) {
      objectUrlsRef.current.delete(url);
    }
    try {
      URL.revokeObjectURL(url);
    } catch {
      // ignore invalid URL revocation
    }
  };

  useEffect(() => {
    return () => {
      objectUrlsRef.current.forEach((url) => {
        try {
          URL.revokeObjectURL(url);
        } catch {
          // ignore
        }
      });
      objectUrlsRef.current.clear();
    };
  }, []);

  const appendLog = useCallback(
    (level: TerminalLogEntry['level'], message: string, fileId?: string) => {
      const entry: TerminalLogEntry = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        timestamp: nowTimestamp(),
        level,
        message,
        fileId,
      };
      setLogs((prev) => [...prev.slice(-249), entry]);
    },
    []
  );

  const handleThemeConfigChange = useCallback(
    (next: ThemeConfig) => {
      setThemeConfig(next);
      const nextResolved = resolveEffectiveTheme(next, systemPrefersDark);
      appendLog(
        'info',
        next.syncToSystem
          ? `Theme synced to system preference (${nextResolved} mode).`
          : `Theme set to ${nextResolved} mode.`
      );
    },
    [appendLog, systemPrefersDark]
  );

  const handleFilesAdded = useCallback(
    async (files: File[]) => {
      const newItems: MediaQueueItem[] = [];
      let skipped = 0;

      for (const file of files) {
        const kind = detectMediaKind(file);
        if (!kind) {
          skipped++;
          continue;
        }
        const id = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
        const originalUrl = registerUrl(URL.createObjectURL(file));

        newItems.push({
          id,
          file,
          name: file.name,
          kind,
          originalSize: file.size,
          originalUrl,
          metadata: {},
          settings: createDefaultSettingsForKind(kind),
          status: 'queued',
          progress: 0,
        });
      }

      if (skipped > 0) {
        appendLog('warn', `Skipped ${skipped} unsupported file(s).`);
      }

      if (newItems.length === 0) return;

      setQueue((prev) => [...prev, ...newItems]);
      setSelectedId((prevSelected) => prevSelected ?? newItems[0].id);
      appendLog('info', `Queued ${newItems.length} local media file(s).`);

      for (const item of newItems) {
        extractMediaMetadata(item.file, item.kind, item.originalUrl).then(
          ({ metadata, thumbnailUrl }) => {
            setQueue((prev) =>
              prev.map((q) => (q.id === item.id ? { ...q, metadata, thumbnailUrl } : q))
            );
          }
        );
      }
    },
    [appendLog]
  );

  const handleLoadSamples = useCallback(async () => {
    setIsGeneratingSamples(true);
    try {
      const sampleFiles = await generateSampleMediaFiles();
      await handleFilesAdded(sampleFiles);
      appendLog('success', `Generated ${sampleFiles.length} local calibration media files.`);
    } catch (err) {
      appendLog(
        'error',
        `Failed to create sample media: ${err instanceof Error ? err.message : String(err)}`
      );
    } finally {
      setIsGeneratingSamples(false);
    }
  }, [appendLog, handleFilesAdded]);

  const handleRemoveItem = useCallback((id: string) => {
    setQueue((prev) => {
      const target = prev.find((i) => i.id === id);
      if (target) {
        revokeUrl(target.originalUrl);
        revokeUrl(target.outputUrl);
      }
      const remaining = prev.filter((i) => i.id !== id);
      setSelectedId((cur) => (cur === id ? remaining[0]?.id ?? null : cur));
      return remaining;
    });
  }, []);

  const handleClearAll = useCallback(() => {
    setQueue((prev) => {
      prev.forEach((item) => {
        revokeUrl(item.originalUrl);
        revokeUrl(item.outputUrl);
      });
      return [];
    });
    setSelectedId(null);
    setFallbackNotice(null);
    appendLog('info', 'Cleared media queue.');
  }, [appendLog]);

  const handleUpdateSettings = useCallback((id: string, next: MediaSettings) => {
    setQueue((prev) =>
      prev.map((item) =>
        item.id === id
          ? {
              ...item,
              settings: next,
              status: item.status === 'completed' ? 'queued' : item.status,
              progress: item.status === 'completed' ? 0 : item.progress,
            }
          : item
      )
    );
  }, []);

  const handleApplyPreset = useCallback(
    (id: string, presetId: PresetId) => {
      setQueue((prev) =>
        prev.map((item) => {
          if (item.id !== id) return item;
          const updated = applyPresetToMediaSettings(presetId, item.settings);
          return {
            ...item,
            settings: updated,
            status: item.status === 'completed' ? 'queued' : item.status,
            progress: item.status === 'completed' ? 0 : item.progress,
          };
        })
      );
      appendLog('info', `Applied preset "${presetId}" to selected file.`, id);
    },
    [appendLog]
  );

  const handleApplyToAllSimilar = useCallback(
    (sourceItem: MediaQueueItem) => {
      setQueue((prev) =>
        prev.map((item) => {
          if (item.kind !== sourceItem.kind || item.id === sourceItem.id) return item;
          return {
            ...item,
            settings: cloneMediaSettings(sourceItem.settings),
            status: item.status === 'completed' ? 'queued' : item.status,
            progress: item.status === 'completed' ? 0 : item.progress,
          };
        })
      );
      appendLog(
        'info',
        `Synced ${sourceItem.kind} settings to all ${sourceItem.kind} items in queue.`
      );
    },
    [appendLog]
  );

  const runItemsSequentially = useCallback(
    async (targetIds: string[]) => {
      if (targetIds.length === 0) return;
      setIsBatchRunning(true);
      setIsLogsExpanded(true);
      const controller = new AbortController();
      abortControllerRef.current = controller;

      for (const id of targetIds) {
        if (controller.signal.aborted) break;

        const currentItem = queueRef.current.find((i) => i.id === id);
        if (!currentItem) continue;

        setQueue((prev) =>
          prev.map((q) =>
            q.id === id
              ? { ...q, status: 'processing', progress: 1, errorMessage: undefined }
              : q
          )
        );

        appendLog('info', `Starting ${currentItem.name} (${formatBytes(currentItem.originalSize)})`, id);

        try {
          const outcome = await processMediaItem(
            currentItem,
            engineMode,
            bridgeConfig,
            {
              onProgress: (pct) => {
                setQueue((prev) =>
                  prev.map((q) => (q.id === id ? { ...q, progress: pct } : q))
                );
              },
              onLog: (level, msg) => appendLog(level, msg, id),
              onFallbackNotice: (notice) => setFallbackNotice(notice),
            },
            controller.signal
          );

          const outputUrl = registerUrl(URL.createObjectURL(outcome.blob));
          setQueue((prev) =>
            prev.map((q) => {
              if (q.id !== id) return q;
              if (q.outputUrl) revokeUrl(q.outputUrl);
              return {
                ...q,
                status: 'completed',
                progress: 100,
                outputBlob: outcome.blob,
                outputUrl,
                outputSize: outcome.blob.size,
                outputFilename: outcome.filename,
                engineUsed: outcome.engineUsed,
                processingTimeMs: outcome.durationMs,
              };
            })
          );

          appendLog(
            'success',
            `Completed ${outcome.filename}: ${formatBytes(currentItem.originalSize)} → ${formatBytes(
              outcome.blob.size
            )} in ${outcome.durationMs}ms [${outcome.engineUsed}]`,
            id
          );
        } catch (err) {
          if (err instanceof DOMException && err.name === 'AbortError') {
            setQueue((prev) =>
              prev.map((q) => (q.id === id ? { ...q, status: 'cancelled', progress: 0 } : q))
            );
            appendLog('warn', `Cancelled processing "${currentItem.name}".`, id);
            break;
          }

          const message = err instanceof Error ? err.message : String(err);
          setQueue((prev) =>
            prev.map((q) =>
              q.id === id ? { ...q, status: 'error', progress: 0, errorMessage: message } : q
            )
          );
          appendLog('error', `Failed "${currentItem.name}": ${message}`, id);
        }
      }

      abortControllerRef.current = null;
      setIsBatchRunning(false);
    },
    [appendLog, bridgeConfig, engineMode]
  );

  const handleStartBatch = useCallback(() => {
    const targetIds = queueRef.current
      .filter((i) => i.status === 'queued' || i.status === 'error' || i.status === 'cancelled')
      .map((i) => i.id);
    if (targetIds.length > 0) {
      runItemsSequentially(targetIds);
    }
  }, [runItemsSequentially]);

  const handleCompressSingle = useCallback(
    (id: string) => {
      if (isBatchRunning) return;
      runItemsSequentially([id]);
    },
    [isBatchRunning, runItemsSequentially]
  );

  const handleCancelBatch = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      appendLog('warn', 'Abort signal sent to active encoder.');
    }
  }, [appendLog]);

  const handleDownloadOne = useCallback((item: MediaQueueItem) => {
    if (!item.outputUrl) return;
    const a = document.createElement('a');
    a.href = item.outputUrl;
    a.download = item.outputFilename || `${item.name}_compressed`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }, []);

  const handleDownloadAllZip = useCallback(async () => {
    const completed = queueRef.current.filter((i) => i.status === 'completed' && i.outputBlob);
    if (completed.length === 0) return;

    setIsZipping(true);
    try {
      const zip = new JSZip();
      const usedNames = new Map<string, number>();

      for (const item of completed) {
        if (!item.outputBlob) continue;
        let name = item.outputFilename || `${item.name}_compressed`;
        const count = usedNames.get(name) || 0;
        usedNames.set(name, count + 1);
        if (count > 0) {
          const dot = name.lastIndexOf('.');
          name =
            dot > 0
              ? `${name.slice(0, dot)}_${count + 1}${name.slice(dot)}`
              : `${name}_${count + 1}`;
        }
        zip.file(name, item.outputBlob);
      }

      const zipBlob = await zip.generateAsync({ type: 'blob' });
      const zipUrl = URL.createObjectURL(zipBlob);
      const a = document.createElement('a');
      a.href = zipUrl;
      a.download = `MediaForge_Batch_${completed.length}_files.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(zipUrl), 2500);
      appendLog('success', `Exported ${completed.length} files as ZIP (${formatBytes(zipBlob.size)}).`);
    } catch (err) {
      appendLog(
        'error',
        `ZIP export failed: ${err instanceof Error ? err.message : String(err)}`
      );
    } finally {
      setIsZipping(false);
    }
  }, [appendLog]);

  const selectedItem = useMemo(
    () => queue.find((i) => i.id === selectedId) ?? queue[0] ?? null,
    [queue, selectedId]
  );

  const similarCount = useMemo(() => {
    if (!selectedItem) return 0;
    return queue.filter((i) => i.kind === selectedItem.kind).length;
  }, [queue, selectedItem]);

  const totalSavedBytes = useMemo(() => {
    return queue.reduce((acc, item) => {
      if (item.status === 'completed' && item.outputSize !== undefined) {
        const diff = item.originalSize - item.outputSize;
        return acc + Math.max(0, diff);
      }
      return acc;
    }, 0);
  }, [queue]);

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-[#09090b] text-zinc-900 dark:text-zinc-100 flex flex-col transition-colors duration-200">
      {/* Top Header */}
      <header className="border-b border-zinc-200 dark:border-white/[0.08] bg-zinc-50/95 dark:bg-[#09090b]/95 backdrop-blur-sm lg:sticky lg:top-0 z-30">
        <div className="max-w-[1600px] mx-auto px-4 sm:px-6 py-3 flex flex-wrap items-center justify-between gap-4">
          {/* Brand + Offline Privacy Marker */}
          <div className="flex items-center gap-4 min-w-0">
            <div className="flex items-center gap-2.5 shrink-0">
              <div className="w-8 h-8 rounded-lg bg-cyan-500/15 border border-cyan-500/30 flex items-center justify-center text-cyan-600 dark:text-cyan-400">
                <Layers className="w-4 h-4" />
              </div>
              <span className="text-base font-bold tracking-tight text-zinc-900 dark:text-zinc-100 whitespace-nowrap">
                MediaForge Local
              </span>
            </div>

            <div className="hidden lg:flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400 whitespace-nowrap">
              <Lock className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
              <span>100% Offline</span>
              <span aria-hidden="true" className="text-zinc-300 dark:text-zinc-600">·</span>
              <span>Zero Server Upload</span>
            </div>
          </div>

          {/* Engine Mode Switcher + Total Saved + Settings */}
          <div className="flex items-center gap-3 flex-wrap">
            <div
              role="group"
              aria-label="Processing engine mode"
              className="flex items-center p-1 rounded-lg border border-zinc-200 dark:border-white/[0.08] bg-white dark:bg-[#121216]"
            >
              <button
                type="button"
                onClick={() => setEngineMode('browser-wasm')}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                  engineMode === 'browser-wasm'
                    ? 'bg-cyan-500/15 text-cyan-800 dark:text-cyan-200 border border-cyan-500/30'
                    : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200 border border-transparent'
                }`}
              >
                <Cpu className="w-3.5 h-3.5" />
                Browser WASM
              </button>

              <button
                type="button"
                onClick={() => setEngineMode('local-bridge')}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                  engineMode === 'local-bridge'
                    ? 'bg-emerald-500/15 text-emerald-800 dark:text-emerald-200 border border-emerald-500/30'
                    : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200 border border-transparent'
                }`}
              >
                <Server className="w-3.5 h-3.5" />
                Local API Bridge
              </button>
            </div>

            {/* Global Stats Counter */}
            <div
              data-testid="total-saved-stat"
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-zinc-200 dark:border-white/[0.08] bg-white dark:bg-[#121216] text-xs whitespace-nowrap"
            >
              <HardDriveDownload className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
              <span className="text-zinc-500 dark:text-zinc-400">Total Saved:</span>
              <span className="font-mono font-semibold text-emerald-700 dark:text-emerald-300 tabular-nums">
                {formatBytes(totalSavedBytes)}
              </span>
            </div>

            <button
              type="button"
              onClick={() => setIsSettingsOpen(true)}
              aria-label="Open Studio & Local FFmpeg API Bridge settings"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-zinc-200 dark:border-white/10 bg-white dark:bg-[#121216] text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-white/[0.06] transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              <Settings className="w-3.5 h-3.5 text-zinc-500 dark:text-zinc-400" />
              Bridge Settings
            </button>
          </div>
        </div>
      </header>

      {/* Main 3-Zone Workspace */}
      <main className="flex-1 max-w-[1600px] w-full mx-auto px-4 sm:px-6 py-5 grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* Zone 2: Left/Top Dropzone & Batch Queue Panel */}
        <div className="lg:col-span-5 xl:col-span-4 flex flex-col gap-4 lg:h-[calc(100vh-6.25rem)] lg:sticky lg:top-20">
          <DropZone
            onFilesAdded={handleFilesAdded}
            onLoadSamples={handleLoadSamples}
            isGeneratingSamples={isGeneratingSamples}
            compact={queue.length > 0}
          />

          <FileQueue
            items={queue}
            selectedId={selectedItem?.id ?? null}
            isBatchRunning={isBatchRunning}
            isZipping={isZipping}
            onSelect={setSelectedId}
            onRemove={handleRemoveItem}
            onDownloadOne={handleDownloadOne}
            onStartBatch={handleStartBatch}
            onCancelBatch={handleCancelBatch}
            onDownloadAllZip={handleDownloadAllZip}
            onClearAll={handleClearAll}
          />
        </div>

        {/* Zone 3: Right/Bottom Inspector, Before/After Preview & Terminal Logs */}
        <div className="lg:col-span-7 xl:col-span-8 flex flex-col gap-4 min-w-0">
          {fallbackNotice && (
            <div className="flex items-center justify-between gap-3 px-4 py-2.5 rounded-xl border border-amber-500/30 bg-amber-500/10 text-xs text-amber-800 dark:text-amber-200">
              <span>{fallbackNotice}</span>
              <button
                type="button"
                onClick={() => setFallbackNotice(null)}
                className="text-amber-700 dark:text-amber-300 hover:text-amber-900 dark:hover:text-amber-100 font-medium cursor-pointer shrink-0"
              >
                Dismiss
              </button>
            </div>
          )}

          {selectedItem ? (
            <>
              <BeforeAfterViewer item={selectedItem} onDownload={handleDownloadOne} />

              <InspectorPanel
                item={selectedItem}
                similarCount={similarCount}
                isBatchRunning={isBatchRunning}
                onUpdateSettings={handleUpdateSettings}
                onApplyPreset={handleApplyPreset}
                onApplyToAllSimilar={handleApplyToAllSimilar}
                onCompressSingle={handleCompressSingle}
              />
            </>
          ) : (
            <div className="rounded-xl border border-zinc-200 dark:border-white/[0.08] bg-white dark:bg-[#121216] p-8 sm:p-10 flex flex-col items-center text-center gap-5">
              <div className="w-12 h-12 rounded-xl border border-zinc-200 dark:border-white/10 bg-zinc-50 dark:bg-white/[0.03] flex items-center justify-center text-cyan-600 dark:text-cyan-400">
                <ShieldCheck className="w-6 h-6" />
              </div>

              <div className="max-w-lg space-y-2">
                <h1 className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100 text-balance">
                  Local Media Compression & Format Studio
                </h1>
                <p className="text-sm text-zinc-600 dark:text-zinc-400 leading-relaxed">
                  Compress videos with H.264/H.265/VP9, optimize images with live before-and-after
                  artifact inspection, or extract and trim audio tracks — all inside your browser
                  with zero cloud uploads.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 w-full max-w-2xl text-left pt-2">
                <div className="p-3.5 rounded-lg border border-zinc-200 dark:border-white/[0.06] bg-zinc-50 dark:bg-[#09090b] space-y-1">
                  <div className="text-xs font-semibold text-cyan-700 dark:text-cyan-300">
                    Image Engine
                  </div>
                  <p className="text-[11px] text-zinc-600 dark:text-zinc-400 leading-relaxed">
                    JPG, PNG, WebP, AVIF & BMP with EXIF stripping, alpha flattening & split slider.
                  </p>
                </div>
                <div className="p-3.5 rounded-lg border border-zinc-200 dark:border-white/[0.06] bg-zinc-50 dark:bg-[#09090b] space-y-1">
                  <div className="text-xs font-semibold text-emerald-700 dark:text-emerald-300">
                    Video & GIF Engine
                  </div>
                  <p className="text-[11px] text-zinc-600 dark:text-zinc-400 leading-relaxed">
                    Single-threaded FFmpeg WASM + automatic native MediaRecorder fallback.
                  </p>
                </div>
                <div className="p-3.5 rounded-lg border border-zinc-200 dark:border-white/[0.06] bg-zinc-50 dark:bg-[#09090b] space-y-1">
                  <div className="text-xs font-semibold text-zinc-800 dark:text-zinc-200">
                    Audio & Batch ZIP
                  </div>
                  <p className="text-[11px] text-zinc-600 dark:text-zinc-400 leading-relaxed">
                    MP3, M4A, WAV, OGG & FLAC conversion, trimming & instant ZIP export.
                  </p>
                </div>
              </div>
            </div>
          )}

          <TerminalLogs
            logs={logs}
            isExpanded={isLogsExpanded}
            onToggleExpand={() => setIsLogsExpanded((e) => !e)}
            onClear={() => setLogs([])}
          />
        </div>
      </main>

      <SettingsModal
        isOpen={isSettingsOpen}
        engineMode={engineMode}
        bridgeConfig={bridgeConfig}
        themeConfig={themeConfig}
        systemPrefersDark={systemPrefersDark}
        onThemeConfigChange={handleThemeConfigChange}
        onClose={() => setIsSettingsOpen(false)}
        onSave={(mode, config) => {
          setEngineMode(mode);
          setBridgeConfig(config);
          appendLog(
            'info',
            `Engine set to ${mode === 'browser-wasm' ? 'Browser WASM' : `Local API Bridge (${config.url})`}.`
          );
        }}
      />
    </div>
  );
}
