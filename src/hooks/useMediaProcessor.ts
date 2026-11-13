import { useCallback, useEffect, useRef, useState } from 'react';
import JSZip from 'jszip';
import { processMediaItem } from '../services/mediaEngine';
import {
  BridgeConfig,
  EngineMode,
  FileStatus,
  MediaQueueItem,
  TerminalLogEntry,
} from '../types/media';
import { formatBytes } from '../utils/mediaUtils';

export interface UseMediaProcessorOptions {
  queueRef: React.MutableRefObject<MediaQueueItem[]>;
  engineMode: EngineMode;
  bridgeConfig: BridgeConfig;
  isItemActive: (id: string) => boolean;
  getRevision: (id: string) => number;
  updateStatus: (
    id: string,
    status: FileStatus,
    options?: { progress?: number; errorMessage?: string }
  ) => void;
  updateProgress: (id: string, progress: number) => void;
  storeCompletedOutput: (
    id: string,
    outcome: { blob: Blob; filename: string; engineUsed: string; durationMs: number },
    expectedRevision?: number
  ) => boolean;
  appendLog: (level: TerminalLogEntry['level'], message: string, fileId?: string) => void;
  onExpandLogs?: () => void;
}

export function useMediaProcessor({
  queueRef,
  engineMode,
  bridgeConfig,
  isItemActive,
  getRevision,
  updateStatus,
  updateProgress,
  storeCompletedOutput,
  appendLog,
  onExpandLogs,
}: UseMediaProcessorOptions) {
  const [isBatchRunning, setIsBatchRunning] = useState(false);
  const [isZipping, setIsZipping] = useState(false);
  const [fallbackNotice, setFallbackNotice] = useState<string | null>(null);

  const isRunningRef = useRef(false);
  const isMountedRef = useRef(true);
  const batchAbortControllerRef = useRef<AbortController | null>(null);
  const activeItemIdRef = useRef<string | null>(null);
  const activeItemAbortControllerRef = useRef<AbortController | null>(null);

  const engineModeRef = useRef(engineMode);
  engineModeRef.current = engineMode;
  const bridgeConfigRef = useRef(bridgeConfig);
  bridgeConfigRef.current = bridgeConfig;

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      batchAbortControllerRef.current?.abort();
      activeItemAbortControllerRef.current?.abort();
    };
  }, []);

  /**
   * Cancels a specific item if it is currently being processed without aborting
   * the rest of a multi-file batch.
   */
  const cancelItemIfActive = useCallback((id: string) => {
    if (activeItemIdRef.current === id && activeItemAbortControllerRef.current) {
      activeItemAbortControllerRef.current.abort();
    }
  }, []);

  const cancelBatch = useCallback(() => {
    if (batchAbortControllerRef.current) {
      batchAbortControllerRef.current.abort();
    }
    if (activeItemAbortControllerRef.current) {
      activeItemAbortControllerRef.current.abort();
    }
    if (isRunningRef.current) {
      appendLog('warn', 'Abort signal sent to active encoder.');
    }
  }, [appendLog]);

  const runItemsSequentially = useCallback(
    async (targetIds: string[]) => {
      if (targetIds.length === 0 || isRunningRef.current) return;

      isRunningRef.current = true;
      setIsBatchRunning(true);
      onExpandLogs?.();

      const batchController = new AbortController();
      batchAbortControllerRef.current = batchController;

      try {
        for (const id of targetIds) {
          if (!isMountedRef.current || batchController.signal.aborted) break;
          if (!isItemActive(id)) continue;

          const currentItem = queueRef.current.find((i) => i.id === id);
          if (!currentItem || currentItem.status === 'processing') continue;

          const itemRevision = getRevision(id);
          const itemController = new AbortController();
          activeItemIdRef.current = id;
          activeItemAbortControllerRef.current = itemController;

          const onBatchAbort = () => itemController.abort();
          batchController.signal.addEventListener('abort', onBatchAbort, { once: true });

          // Capture current engine configuration at job start so mid-item mode switches do not corrupt state
          const jobEngineMode = engineModeRef.current;
          const jobBridgeConfig = { ...bridgeConfigRef.current };

          updateStatus(id, 'processing', { progress: 1, errorMessage: undefined });
          appendLog(
            'info',
            `Starting ${currentItem.name} (${formatBytes(currentItem.originalSize)})`,
            id
          );

          try {
            const outcome = await processMediaItem(
              currentItem,
              jobEngineMode,
              jobBridgeConfig,
              {
                onProgress: (pct) => {
                  if (
                    !isMountedRef.current ||
                    itemController.signal.aborted ||
                    !isItemActive(id) ||
                    getRevision(id) !== itemRevision
                  ) {
                    return;
                  }
                  updateProgress(id, pct);
                },
                onLog: (level, msg) => {
                  if (!isMountedRef.current) return;
                  appendLog(level, msg, id);
                },
                onFallbackNotice: (notice) => {
                  if (!isMountedRef.current) return;
                  setFallbackNotice(notice);
                },
              },
              itemController.signal
            );

            if (!isMountedRef.current) break;

            const saved = storeCompletedOutput(id, outcome, itemRevision);
            if (saved) {
              appendLog(
                'success',
                `Completed ${outcome.filename}: ${formatBytes(currentItem.originalSize)} → ${formatBytes(
                  outcome.blob.size
                )} in ${outcome.durationMs}ms [${outcome.engineUsed}]`,
                id
              );
            }
          } catch (err) {
            if (!isMountedRef.current) break;

            if (err instanceof DOMException && err.name === 'AbortError') {
              if (isItemActive(id) && getRevision(id) === itemRevision) {
                updateStatus(id, 'cancelled', { progress: 0 });
                appendLog('warn', `Cancelled processing "${currentItem.name}".`, id);
              }
              if (batchController.signal.aborted) {
                break;
              }
              continue;
            }

            if (isItemActive(id) && getRevision(id) === itemRevision) {
              const message = err instanceof Error ? err.message : String(err);
              updateStatus(id, 'error', { progress: 0, errorMessage: message });
              appendLog('error', `Failed "${currentItem.name}": ${message}`, id);
            }
          } finally {
            batchController.signal.removeEventListener('abort', onBatchAbort);
            if (activeItemIdRef.current === id) {
              activeItemIdRef.current = null;
              activeItemAbortControllerRef.current = null;
            }
          }
        }
      } finally {
        batchAbortControllerRef.current = null;
        activeItemIdRef.current = null;
        activeItemAbortControllerRef.current = null;
        isRunningRef.current = false;
        if (isMountedRef.current) {
          setIsBatchRunning(false);
        }
      }
    },
    [
      appendLog,
      getRevision,
      isItemActive,
      onExpandLogs,
      queueRef,
      storeCompletedOutput,
      updateProgress,
      updateStatus,
    ]
  );

  const startBatch = useCallback(() => {
    if (isRunningRef.current) return;
    const targetIds = queueRef.current
      .filter((i) => i.status === 'queued' || i.status === 'error' || i.status === 'cancelled')
      .map((i) => i.id);
    if (targetIds.length > 0) {
      void runItemsSequentially(targetIds);
    }
  }, [queueRef, runItemsSequentially]);

  const compressSingle = useCallback(
    (id: string) => {
      if (isRunningRef.current) return;
      void runItemsSequentially([id]);
    },
    [runItemsSequentially]
  );

  const downloadOne = useCallback((item: MediaQueueItem) => {
    if (item.status !== 'completed' || !item.outputUrl) return;
    const a = document.createElement('a');
    a.href = item.outputUrl;
    a.download = item.outputFilename || `${item.name}_compressed`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }, []);

  const downloadAllZip = useCallback(async () => {
    if (isZipping) return;
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
      if (!isMountedRef.current) return;

      const zipUrl = URL.createObjectURL(zipBlob);
      const a = document.createElement('a');
      a.href = zipUrl;
      a.download = `MediaForge_Batch_${completed.length}_files.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => {
        try {
          URL.revokeObjectURL(zipUrl);
        } catch {
          // ignore
        }
      }, 2500);
      appendLog(
        'success',
        `Exported ${completed.length} files as ZIP (${formatBytes(zipBlob.size)}).`
      );
    } catch (err) {
      if (isMountedRef.current) {
        appendLog(
          'error',
          `ZIP export failed: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    } finally {
      if (isMountedRef.current) {
        setIsZipping(false);
      }
    }
  }, [appendLog, isZipping, queueRef]);

  return {
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
  };
}
