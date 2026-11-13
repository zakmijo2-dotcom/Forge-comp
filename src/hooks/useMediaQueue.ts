import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { extractMediaMetadata } from '../services/mediaEngine';
import {
  FileStatus,
  MediaMetadata,
  MediaQueueItem,
  MediaSettings,
  PresetId,
  TerminalLogEntry,
} from '../types/media';
import {
  cloneMediaSettings,
  createDefaultSettingsForKind,
  detectMediaKind,
} from '../utils/mediaUtils';
import { applyPresetToMediaSettings } from '../utils/presets';

/**
 * Tracks ownership of Object URLs created by the queue/processor so that:
 * 1. Only owned URLs are ever revoked (protecting external URLs).
 * 2. Every URL is revoked at most once (preventing double-revocation).
 * 3. All remaining URLs can be deterministically cleaned up on queue clear or unmount.
 */
export class ObjectUrlManager {
  private ownedUrls = new Set<string>();
  private createFn: (blob: Blob | MediaSource) => string;
  private revokeFn: (url: string) => void;

  constructor(
    createFn: (blob: Blob | MediaSource) => string = (b) => URL.createObjectURL(b),
    revokeFn: (url: string) => void = (u) => URL.revokeObjectURL(u)
  ) {
    this.createFn = createFn;
    this.revokeFn = revokeFn;
  }

  create(blob: Blob): string {
    const url = this.createFn(blob);
    this.ownedUrls.add(url);
    return url;
  }

  register(url: string): string {
    if (url) {
      this.ownedUrls.add(url);
    }
    return url;
  }

  has(url?: string): boolean {
    return Boolean(url && this.ownedUrls.has(url));
  }

  get size(): number {
    return this.ownedUrls.size;
  }

  revoke(url?: string): boolean {
    if (!url || !this.ownedUrls.has(url)) {
      return false;
    }
    this.ownedUrls.delete(url);
    try {
      this.revokeFn(url);
    } catch {
      // Ignore browser errors on revocation
    }
    return true;
  }

  revokeMany(urls: Iterable<string | undefined>): number {
    let count = 0;
    for (const u of urls) {
      if (this.revoke(u)) count++;
    }
    return count;
  }

  revokeAll(): number {
    const all = Array.from(this.ownedUrls);
    this.ownedUrls.clear();
    for (const url of all) {
      try {
        this.revokeFn(url);
      } catch {
        // Ignore browser errors on revocation
      }
    }
    return all.length;
  }
}

export interface CompletedOutputPayload {
  blob: Blob;
  url: string;
  filename: string;
  engineUsed: string;
  durationMs: number;
}

/**
 * Pure helper that strips stale output metadata when conversion settings or presets change.
 * Returns the updated item and any previous outputUrl that should be revoked by the caller.
 */
export function invalidateQueueItemOutput(
  item: MediaQueueItem,
  nextSettings: MediaSettings
): { nextItem: MediaQueueItem; urlToRevoke?: string } {
  const urlToRevoke = item.outputUrl;
  const nextItem: MediaQueueItem = {
    ...item,
    settings: nextSettings,
    status: 'queued',
    progress: 0,
    outputBlob: undefined,
    outputUrl: undefined,
    outputSize: undefined,
    outputFilename: undefined,
    engineUsed: undefined,
    processingTimeMs: undefined,
    errorMessage: undefined,
  };
  return { nextItem, urlToRevoke };
}

/**
 * Pure helper that attaches a newly processed output to a queue item and returns
 * any superseded outputUrl so the caller can revoke it outside React state updaters.
 */
export function applyCompletedOutputToItem(
  item: MediaQueueItem,
  payload: CompletedOutputPayload
): { nextItem: MediaQueueItem; urlToRevoke?: string } {
  const urlToRevoke =
    item.outputUrl && item.outputUrl !== payload.url ? item.outputUrl : undefined;

  const nextItem: MediaQueueItem = {
    ...item,
    status: 'completed',
    progress: 100,
    outputBlob: payload.blob,
    outputUrl: payload.url,
    outputSize: payload.blob.size,
    outputFilename: payload.filename,
    engineUsed: payload.engineUsed,
    processingTimeMs: payload.durationMs,
    errorMessage: undefined,
  };
  return { nextItem, urlToRevoke };
}

let stableItemCounter = 0;

export function createStableItemId(): string {
  stableItemCounter += 1;
  return `mf-${Date.now()}-${stableItemCounter}-${Math.random().toString(36).slice(2, 7)}`;
}

export interface UseMediaQueueOptions {
  appendLog: (level: TerminalLogEntry['level'], message: string, fileId?: string) => void;
}

export function useMediaQueue({ appendLog }: UseMediaQueueOptions) {
  const [queue, setQueue] = useState<MediaQueueItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const queueRef = useRef<MediaQueueItem[]>(queue);
  queueRef.current = queue;

  const activeIdsRef = useRef<Set<string>>(new Set());
  const itemSettingsRevisionRef = useRef<Map<string, number>>(new Map());
  const urlManagerRef = useRef<ObjectUrlManager | null>(null);
  if (!urlManagerRef.current) {
    urlManagerRef.current = new ObjectUrlManager();
  }
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    const manager = urlManagerRef.current;
    return () => {
      isMountedRef.current = false;
      activeIdsRef.current.clear();
      manager?.revokeAll();
    };
  }, []);

  const bumpRevision = useCallback((id: string): number => {
    const next = (itemSettingsRevisionRef.current.get(id) ?? 0) + 1;
    itemSettingsRevisionRef.current.set(id, next);
    return next;
  }, []);

  const getRevision = useCallback((id: string): number => {
    return itemSettingsRevisionRef.current.get(id) ?? 0;
  }, []);

  const isItemActive = useCallback((id: string): boolean => {
    return isMountedRef.current && activeIdsRef.current.has(id);
  }, []);

  const applySynchronizedQueue = useCallback((nextQueue: MediaQueueItem[]) => {
    queueRef.current = nextQueue;
    setQueue(nextQueue);
  }, []);

  const addFiles = useCallback(
    async (files: File[]): Promise<MediaQueueItem[]> => {
      const urlManager = urlManagerRef.current!;
      const newItems: MediaQueueItem[] = [];
      let skipped = 0;

      for (const file of files) {
        const kind = detectMediaKind(file);
        if (!kind) {
          skipped++;
          continue;
        }
        const id = createStableItemId();
        const originalUrl = urlManager.create(file);
        activeIdsRef.current.add(id);
        itemSettingsRevisionRef.current.set(id, 1);

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

      if (newItems.length === 0) return [];

      const nextQueue = [...queueRef.current, ...newItems];
      applySynchronizedQueue(nextQueue);
      setSelectedId((prevSelected) => prevSelected ?? newItems[0].id);
      appendLog('info', `Queued ${newItems.length} local media file(s).`);

      for (const item of newItems) {
        extractMediaMetadata(item.file, item.kind, item.originalUrl)
          .then(({ metadata, thumbnailUrl }: { metadata: MediaMetadata; thumbnailUrl?: string }) => {
            if (!isItemActive(item.id)) return;
            const updated = queueRef.current.map((q) =>
              q.id === item.id ? { ...q, metadata, thumbnailUrl } : q
            );
            applySynchronizedQueue(updated);
          })
          .catch(() => {
            // Ignore metadata extraction failure; item remains usable with default metadata
          });
      }

      return newItems;
    },
    [appendLog, applySynchronizedQueue, isItemActive]
  );

  const removeItem = useCallback(
    (id: string, onBeforeRemove?: (id: string) => void) => {
      onBeforeRemove?.(id);
      activeIdsRef.current.delete(id);
      itemSettingsRevisionRef.current.delete(id);

      const current = queueRef.current;
      const target = current.find((i) => i.id === id);
      const remaining = current.filter((i) => i.id !== id);
      applySynchronizedQueue(remaining);

      if (target) {
        urlManagerRef.current?.revokeMany([target.originalUrl, target.outputUrl]);
      }

      setSelectedId((cur) => (cur === id ? remaining[0]?.id ?? null : cur));
    },
    [applySynchronizedQueue]
  );

  const clearQueue = useCallback(
    (onBeforeClear?: () => void) => {
      onBeforeClear?.();
      activeIdsRef.current.clear();
      itemSettingsRevisionRef.current.clear();

      const current = queueRef.current;
      const urlsToRevoke: (string | undefined)[] = [];
      for (const item of current) {
        urlsToRevoke.push(item.originalUrl, item.outputUrl);
      }

      applySynchronizedQueue([]);
      urlManagerRef.current?.revokeMany(urlsToRevoke);
      setSelectedId(null);
      appendLog('info', 'Cleared media queue.');
    },
    [appendLog, applySynchronizedQueue]
  );

  const updateStatus = useCallback(
    (id: string, status: FileStatus, options?: { progress?: number; errorMessage?: string }) => {
      if (!isItemActive(id)) return;
      const updated = queueRef.current.map((item) => {
        if (item.id !== id) return item;
        return {
          ...item,
          status,
          progress: options?.progress !== undefined ? options.progress : item.progress,
          errorMessage: options?.errorMessage,
        };
      });
      applySynchronizedQueue(updated);
    },
    [applySynchronizedQueue, isItemActive]
  );

  const updateProgress = useCallback(
    (id: string, progress: number) => {
      if (!isItemActive(id)) return;
      const target = queueRef.current.find((i) => i.id === id);
      if (!target || target.status !== 'processing') return;

      const clamped = Math.max(0, Math.min(100, Math.round(progress)));
      const updated = queueRef.current.map((item) =>
        item.id === id ? { ...item, progress: clamped } : item
      );
      applySynchronizedQueue(updated);
    },
    [applySynchronizedQueue, isItemActive]
  );

  const storeCompletedOutput = useCallback(
    (
      id: string,
      outcome: { blob: Blob; filename: string; engineUsed: string; durationMs: number },
      expectedRevision?: number
    ): boolean => {
      if (!isItemActive(id)) {
        return false;
      }
      if (
        expectedRevision !== undefined &&
        getRevision(id) !== expectedRevision
      ) {
        return false;
      }

      const current = queueRef.current;
      const target = current.find((i) => i.id === id);
      if (!target) {
        return false;
      }

      const outputUrl = urlManagerRef.current!.create(outcome.blob);
      const { nextItem, urlToRevoke } = applyCompletedOutputToItem(target, {
        blob: outcome.blob,
        url: outputUrl,
        filename: outcome.filename,
        engineUsed: outcome.engineUsed,
        durationMs: outcome.durationMs,
      });

      const updated = current.map((item) => (item.id === id ? nextItem : item));
      applySynchronizedQueue(updated);

      if (urlToRevoke) {
        urlManagerRef.current?.revoke(urlToRevoke);
      }
      return true;
    },
    [applySynchronizedQueue, getRevision, isItemActive]
  );

  const updateSettings = useCallback(
    (id: string, nextSettings: MediaSettings, onInvalidateActiveItem?: (id: string) => void) => {
      if (!isItemActive(id)) return;
      bumpRevision(id);
      onInvalidateActiveItem?.(id);

      const urlsToRevoke: (string | undefined)[] = [];
      const updated = queueRef.current.map((item) => {
        if (item.id !== id) return item;
        const { nextItem, urlToRevoke } = invalidateQueueItemOutput(item, nextSettings);
        if (urlToRevoke) urlsToRevoke.push(urlToRevoke);
        return nextItem;
      });

      applySynchronizedQueue(updated);
      urlManagerRef.current?.revokeMany(urlsToRevoke);
    },
    [applySynchronizedQueue, bumpRevision, isItemActive]
  );

  const applyPreset = useCallback(
    (id: string, presetId: PresetId, onInvalidateActiveItem?: (id: string) => void) => {
      if (!isItemActive(id)) return;
      bumpRevision(id);
      onInvalidateActiveItem?.(id);

      const urlsToRevoke: (string | undefined)[] = [];
      const updated = queueRef.current.map((item) => {
        if (item.id !== id) return item;
        const presetSettings = applyPresetToMediaSettings(presetId, item.settings);
        const { nextItem, urlToRevoke } = invalidateQueueItemOutput(item, presetSettings);
        if (urlToRevoke) urlsToRevoke.push(urlToRevoke);
        return nextItem;
      });

      applySynchronizedQueue(updated);
      urlManagerRef.current?.revokeMany(urlsToRevoke);
      appendLog('info', `Applied preset "${presetId}" to selected file.`, id);
    },
    [appendLog, applySynchronizedQueue, bumpRevision, isItemActive]
  );

  const applyToAllSimilar = useCallback(
    (sourceItem: MediaQueueItem, onInvalidateActiveItem?: (id: string) => void) => {
      const urlsToRevoke: (string | undefined)[] = [];
      const updated = queueRef.current.map((item) => {
        if (item.kind !== sourceItem.kind || item.id === sourceItem.id) return item;
        bumpRevision(item.id);
        onInvalidateActiveItem?.(item.id);
        const cloned = cloneMediaSettings(sourceItem.settings);
        const { nextItem, urlToRevoke } = invalidateQueueItemOutput(item, cloned);
        if (urlToRevoke) urlsToRevoke.push(urlToRevoke);
        return nextItem;
      });

      applySynchronizedQueue(updated);
      urlManagerRef.current?.revokeMany(urlsToRevoke);
      appendLog(
        'info',
        `Synced ${sourceItem.kind} settings to all ${sourceItem.kind} items in queue.`
      );
    },
    [appendLog, applySynchronizedQueue, bumpRevision]
  );

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

  return {
    queue,
    queueRef,
    selectedId,
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
  };
}
