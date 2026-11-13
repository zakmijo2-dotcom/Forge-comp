import React, { useCallback, useEffect, useState } from 'react';
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
import { useMediaProcessor } from './hooks/useMediaProcessor';
import { useMediaQueue } from './hooks/useMediaQueue';
import { generateSampleMediaFiles } from './services/sampleMedia';
import {
  BridgeConfig,
  EngineMode,
  MediaQueueItem,
  MediaSettings,
  PresetId,
  TerminalLogEntry,
} from './types/media';
import { formatBytes } from './utils/mediaUtils';
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
  const [engineMode, setEngineMode] = useState<EngineMode>('browser-wasm');
  const [bridgeConfig, setBridgeConfig] = useState<BridgeConfig>({
    url: 'http://localhost:3001',
    timeoutMs: 120000,
    presetName: 'veryfast',
  });
  const [themeConfig, setThemeConfig] = useState<ThemeConfig>(() => loadThemeConfig());
  const [systemPrefersDark, setSystemPrefersDark] = useState<boolean>(() => readSystemPrefersDark());
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isGeneratingSamples, setIsGeneratingSamples] = useState(false);
  const [logs, setLogs] = useState<TerminalLogEntry[]>([]);
  const [isLogsExpanded, setIsLogsExpanded] = useState(true);

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

  const {
    queue,
    queueRef,
    selectedItem,
    similarCount,
    totalSavedBytes,
    setSelectedId,
    isItemActive,
    getRevision,
    addFiles,
    removeItem,
    clearQueue,
    updateStatus,
    updateProgress,
    storeCompletedOutput,
    updateSettings,
    applyPreset,
    applyToAllSimilar,
  } = useMediaQueue({ appendLog });

  const {
    isBatchRunning,
    isZipping,
    fallbackNotice,
    setFallbackNotice,
    startBatch,
    compressSingle,
    cancelBatch,
    cancelItemIfActive,
    downloadOne,
    downloadAllZip,
  } = useMediaProcessor({
    queueRef,
    engineMode,
    bridgeConfig,
    isItemActive,
    getRevision,
    updateStatus,
    updateProgress,
    storeCompletedOutput,
    appendLog,
    onExpandLogs: () => setIsLogsExpanded(true),
  });

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

  const handleLoadSamples = useCallback(async () => {
    setIsGeneratingSamples(true);
    try {
      const sampleFiles = await generateSampleMediaFiles();
      await addFiles(sampleFiles);
      appendLog('success', `Generated ${sampleFiles.length} local calibration media files.`);
    } catch (err) {
      appendLog(
        'error',
        `Failed to create sample media: ${err instanceof Error ? err.message : String(err)}`
      );
    } finally {
      setIsGeneratingSamples(false);
    }
  }, [addFiles, appendLog]);

  const handleRemoveItem = useCallback(
    (id: string) => {
      removeItem(id, cancelItemIfActive);
    },
    [cancelItemIfActive, removeItem]
  );

  const handleClearAll = useCallback(() => {
    clearQueue(cancelBatch);
    setFallbackNotice(null);
  }, [cancelBatch, clearQueue, setFallbackNotice]);

  const handleUpdateSettings = useCallback(
    (id: string, next: MediaSettings) => {
      updateSettings(id, next, cancelItemIfActive);
    },
    [cancelItemIfActive, updateSettings]
  );

  const handleApplyPreset = useCallback(
    (id: string, presetId: PresetId) => {
      applyPreset(id, presetId, cancelItemIfActive);
    },
    [applyPreset, cancelItemIfActive]
  );

  const handleApplyToAllSimilar = useCallback(
    (sourceItem: MediaQueueItem) => {
      applyToAllSimilar(sourceItem, cancelItemIfActive);
    },
    [applyToAllSimilar, cancelItemIfActive]
  );

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
            onFilesAdded={addFiles}
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
            onDownloadOne={downloadOne}
            onStartBatch={startBatch}
            onCancelBatch={cancelBatch}
            onDownloadAllZip={downloadAllZip}
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
              <BeforeAfterViewer item={selectedItem} onDownload={downloadOne} />

              <InspectorPanel
                item={selectedItem}
                similarCount={similarCount}
                isBatchRunning={isBatchRunning}
                onUpdateSettings={handleUpdateSettings}
                onApplyPreset={handleApplyPreset}
                onApplyToAllSimilar={handleApplyToAllSimilar}
                onCompressSingle={compressSingle}
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
