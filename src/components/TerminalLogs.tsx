import React, { useEffect, useRef } from 'react';
import { ChevronDown, ChevronUp, Terminal, Trash2 } from 'lucide-react';
import { TerminalLogEntry } from '../types/media';

interface TerminalLogsProps {
  logs: TerminalLogEntry[];
  isExpanded: boolean;
  onToggleExpand: () => void;
  onClear: () => void;
}

export const TerminalLogs: React.FC<TerminalLogsProps> = ({
  logs,
  isExpanded,
  onToggleExpand,
  onClear,
}) => {
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (isExpanded && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs, isExpanded]);

  const getLevelColor = (level: TerminalLogEntry['level']) => {
    switch (level) {
      case 'cmd':
        return 'text-cyan-700 dark:text-cyan-300';
      case 'success':
        return 'text-emerald-700 dark:text-emerald-400';
      case 'warn':
        return 'text-amber-700 dark:text-amber-300';
      case 'error':
        return 'text-rose-600 dark:text-rose-400';
      default:
        return 'text-zinc-600 dark:text-zinc-400';
    }
  };

  return (
    <section
      aria-label="Encoder terminal logs"
      className="rounded-xl border border-zinc-200 dark:border-white/[0.08] bg-white dark:bg-[#121216] overflow-hidden"
    >
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-zinc-200 dark:border-white/[0.06]">
        <button
          type="button"
          onClick={onToggleExpand}
          aria-expanded={isExpanded}
          className="flex items-center gap-2 text-xs font-medium text-zinc-700 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors cursor-pointer"
        >
          <Terminal className="w-3.5 h-3.5 text-cyan-600 dark:text-cyan-400" />
          <span>Encoder Console Output</span>
          <span className="font-mono text-[11px] text-zinc-500 tabular-nums">
            ({logs.length})
          </span>
          {isExpanded ? (
            <ChevronUp className="w-3.5 h-3.5 text-zinc-500" />
          ) : (
            <ChevronDown className="w-3.5 h-3.5 text-zinc-500" />
          )}
        </button>

        {logs.length > 0 && (
          <button
            type="button"
            onClick={onClear}
            className="inline-flex items-center gap-1 px-2 py-1 text-[11px] text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200 rounded hover:bg-zinc-100 dark:hover:bg-white/[0.05] transition-colors cursor-pointer"
          >
            <Trash2 className="w-3 h-3" />
            Clear Logs
          </button>
        )}
      </div>

      {isExpanded && (
        <div
          ref={scrollRef}
          data-testid="terminal-log-body"
          className="h-44 overflow-y-auto bg-zinc-50 dark:bg-[#09090b] p-3 font-mono text-[11px] leading-relaxed space-y-1"
        >
          {logs.length === 0 ? (
            <div className="text-zinc-500 dark:text-zinc-600">
              Ready. Encoder commands, codec parameters, and progress metrics will stream here.
            </div>
          ) : (
            logs.map((entry) => (
              <div key={entry.id} className="flex items-start gap-2.5 break-all">
                <span className="text-zinc-400 dark:text-zinc-600 shrink-0 select-none">
                  {entry.timestamp}
                </span>
                <span className={getLevelColor(entry.level)}>{entry.message}</span>
              </div>
            ))
          )}
        </div>
      )}
    </section>
  );
};
