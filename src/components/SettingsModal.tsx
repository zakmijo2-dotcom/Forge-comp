import React, { useEffect, useState } from 'react';
import { Activity, CheckCircle2, Monitor, Moon, Server, Sun, X, XCircle } from 'lucide-react';
import { BridgeConfig, EngineMode } from '../types/media';
import { testLocalBridgeConnection } from '../services/bridgeEngine';
import { ThemeConfig, ThemeMode } from '../utils/themeUtils';

interface SettingsModalProps {
  isOpen: boolean;
  engineMode: EngineMode;
  bridgeConfig: BridgeConfig;
  themeConfig: ThemeConfig;
  systemPrefersDark: boolean;
  onThemeConfigChange: (next: ThemeConfig) => void;
  onClose: () => void;
  onSave: (mode: EngineMode, config: BridgeConfig) => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  engineMode,
  bridgeConfig,
  themeConfig,
  systemPrefersDark,
  onThemeConfigChange,
  onClose,
  onSave,
}) => {
  const [draftMode, setDraftMode] = useState<EngineMode>(engineMode);
  const [draftUrl, setDraftUrl] = useState(bridgeConfig.url);
  const [draftPreset, setDraftPreset] = useState(bridgeConfig.presetName);
  const [draftApiKey, setDraftApiKey] = useState(bridgeConfig.apiKey || '');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  useEffect(() => {
    if (isOpen) {
      setDraftMode(engineMode);
      setDraftUrl(bridgeConfig.url);
      setDraftPreset(bridgeConfig.presetName);
      setDraftApiKey(bridgeConfig.apiKey || '');
      setTestResult(null);
    }
  }, [isOpen, engineMode, bridgeConfig]);

  if (!isOpen) return null;

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    const result = await testLocalBridgeConnection({
      url: draftUrl.trim() || 'http://localhost:3001',
      timeoutMs: 5000,
      presetName: draftPreset,
      apiKey: draftApiKey.trim() || undefined,
    });
    setTestResult(result);
    setTesting(false);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(draftMode, {
      url: draftUrl.trim() || 'http://localhost:3001',
      timeoutMs: 120000,
      presetName: draftPreset.trim() || 'medium',
      apiKey: draftApiKey.trim() || undefined,
    });
    onClose();
  };

  const handleToggleSync = (checked: boolean) => {
    onThemeConfigChange({
      ...themeConfig,
      syncToSystem: checked,
    });
  };

  const handleManualTheme = (mode: ThemeMode) => {
    onThemeConfigChange({
      syncToSystem: false,
      manualTheme: mode,
    });
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="bridge-settings-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 dark:bg-black/75 backdrop-blur-xs"
    >
      <div className="w-full max-w-lg rounded-xl border border-zinc-200 dark:border-white/15 bg-white dark:bg-[#121216] text-zinc-900 dark:text-zinc-100 shadow-2xl overflow-hidden max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-200 dark:border-white/[0.08]">
          <div className="flex items-center gap-2.5">
            <Server className="w-4 h-4 text-cyan-600 dark:text-cyan-400" />
            <h2 id="bridge-settings-title" className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              Studio & Local Bridge Settings
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close settings modal"
            className="p-1.5 rounded-lg text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-white/[0.06] cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-5">
          {/* Appearance & System Theme Sync */}
          <div className="p-3.5 rounded-lg border border-zinc-200 dark:border-white/[0.08] bg-zinc-50 dark:bg-[#09090b] space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div className="space-y-0.5">
                <label
                  htmlFor="sync-system-theme-toggle"
                  className="flex items-center gap-2 text-xs font-semibold text-zinc-900 dark:text-zinc-100 cursor-pointer"
                >
                  <Monitor className="w-3.5 h-3.5 text-cyan-600 dark:text-cyan-400" />
                  Sync to System Theme
                </label>
                <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                  Automatically switch dark/light mode using OS preference (currently{' '}
                  <span className="font-mono font-medium text-zinc-700 dark:text-zinc-300">
                    {systemPrefersDark ? 'Dark' : 'Light'}
                  </span>
                  )
                </p>
              </div>

              <button
                id="sync-system-theme-toggle"
                type="button"
                role="switch"
                aria-checked={themeConfig.syncToSystem}
                aria-label="Sync to System Theme"
                onClick={() => handleToggleSync(!themeConfig.syncToSystem)}
                className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 ${
                  themeConfig.syncToSystem
                    ? 'bg-cyan-600 dark:bg-cyan-500'
                    : 'bg-zinc-300 dark:bg-zinc-700'
                }`}
              >
                <span
                  aria-hidden="true"
                  className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow transition duration-200 ${
                    themeConfig.syncToSystem ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>

            {!themeConfig.syncToSystem && (
              <div className="grid grid-cols-2 gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => handleManualTheme('dark')}
                  className={`inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border transition-colors cursor-pointer ${
                    themeConfig.manualTheme === 'dark'
                      ? 'border-cyan-500 bg-cyan-500/15 text-cyan-700 dark:text-cyan-200'
                      : 'border-zinc-200 dark:border-white/10 bg-white dark:bg-[#121216] text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200'
                  }`}
                >
                  <Moon className="w-3.5 h-3.5" />
                  Dark Mode
                </button>
                <button
                  type="button"
                  onClick={() => handleManualTheme('light')}
                  className={`inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border transition-colors cursor-pointer ${
                    themeConfig.manualTheme === 'light'
                      ? 'border-cyan-500 bg-cyan-500/15 text-cyan-700 dark:text-cyan-200'
                      : 'border-zinc-200 dark:border-white/10 bg-white dark:bg-[#121216] text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200'
                  }`}
                >
                  <Sun className="w-3.5 h-3.5" />
                  Light Mode
                </button>
              </div>
            )}
          </div>

          {/* Active Engine Toggle */}
          <div>
            <span className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-2">
              Processing Engine Mode
            </span>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setDraftMode('browser-wasm')}
                className={`p-3 rounded-lg border text-left transition-colors cursor-pointer ${
                  draftMode === 'browser-wasm'
                    ? 'border-cyan-500 bg-cyan-500/10'
                    : 'border-zinc-200 dark:border-white/10 bg-zinc-50 dark:bg-white/[0.02] hover:bg-zinc-100 dark:hover:bg-white/[0.05]'
                }`}
              >
                <div className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">Browser WASM</div>
                <div className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-0.5">
                  100% client-side Canvas & FFmpeg WASM
                </div>
              </button>

              <button
                type="button"
                onClick={() => setDraftMode('local-bridge')}
                className={`p-3 rounded-lg border text-left transition-colors cursor-pointer ${
                  draftMode === 'local-bridge'
                    ? 'border-emerald-500 bg-emerald-500/10'
                    : 'border-zinc-200 dark:border-white/10 bg-zinc-50 dark:bg-white/[0.02] hover:bg-zinc-100 dark:hover:bg-white/[0.05]'
                }`}
              >
                <div className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">Local API Bridge</div>
                <div className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-0.5">
                  Hardware-accelerated Termux / Desktop
                </div>
              </button>
            </div>
          </div>

          {/* Bridge Endpoint URL */}
          <div>
            <label htmlFor="bridge-url-input" className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">
              Bridge Base URL
            </label>
            <div className="flex gap-2">
              <input
                id="bridge-url-input"
                type="url"
                value={draftUrl}
                onChange={(e) => setDraftUrl(e.target.value)}
                placeholder="http://localhost:3001"
                className="flex-1 px-3 py-2 text-xs font-mono rounded-lg border border-zinc-300 dark:border-white/10 bg-zinc-50 dark:bg-[#09090b] text-zinc-900 dark:text-zinc-100 focus:outline-none focus:border-cyan-500"
              />
              <button
                type="button"
                onClick={handleTest}
                disabled={testing}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border border-zinc-300 dark:border-white/10 bg-zinc-100 dark:bg-white/[0.04] text-zinc-800 dark:text-zinc-200 hover:bg-zinc-200 dark:hover:bg-white/[0.08] disabled:opacity-50 transition-colors cursor-pointer whitespace-nowrap"
              >
                <Activity className="w-3.5 h-3.5 text-cyan-600 dark:text-cyan-400" />
                {testing ? 'Testing...' : 'Test Bridge'}
              </button>
            </div>
          </div>

          {testResult && (
            <div
              className={`flex items-start gap-2 p-3 rounded-lg border text-xs ${
                testResult.ok
                  ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                  : 'border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-300'
              }`}
            >
              {testResult.ok ? (
                <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
              ) : (
                <XCircle className="w-4 h-4 shrink-0 mt-0.5" />
              )}
              <span>{testResult.message}</span>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="bridge-preset-input" className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">
                Native Encoder Preset
              </label>
              <select
                id="bridge-preset-input"
                value={draftPreset}
                onChange={(e) => setDraftPreset(e.target.value)}
                className="w-full px-3 py-2 text-xs rounded-lg border border-zinc-300 dark:border-white/10 bg-zinc-50 dark:bg-[#09090b] text-zinc-900 dark:text-zinc-100 focus:outline-none focus:border-cyan-500"
              >
                <option value="ultrafast">ultrafast</option>
                <option value="veryfast">veryfast</option>
                <option value="medium">medium</option>
                <option value="slow">slow</option>
              </select>
            </div>

            <div>
              <label htmlFor="bridge-key-input" className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">
                Optional Bearer Token
              </label>
              <input
                id="bridge-key-input"
                type="password"
                value={draftApiKey}
                onChange={(e) => setDraftApiKey(e.target.value)}
                placeholder="Optional local token"
                className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-zinc-300 dark:border-white/10 bg-zinc-50 dark:bg-[#09090b] text-zinc-900 dark:text-zinc-100 focus:outline-none focus:border-cyan-500"
              />
            </div>
          </div>

          <div className="p-3 rounded-lg border border-zinc-200 dark:border-white/[0.06] bg-zinc-50 dark:bg-[#09090b] text-[11px] font-mono text-zinc-600 dark:text-zinc-400 space-y-1">
            <div className="text-zinc-800 dark:text-zinc-300 font-semibold">Expected Bridge Endpoint Contract:</div>
            <div>POST /api/convert (multipart/form-data)</div>
            <div>fields: file (binary), params (JSON: format, crf, resolution, bitrate, preset)</div>
            <div>GET /health → 200 OK</div>
          </div>

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-zinc-200 dark:border-white/[0.08]">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-medium rounded-lg text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-white/[0.06] cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 text-xs font-semibold rounded-lg bg-cyan-600 dark:bg-cyan-500 text-white dark:text-zinc-950 hover:bg-cyan-500 dark:hover:bg-cyan-400 cursor-pointer"
            >
              Save Settings
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
