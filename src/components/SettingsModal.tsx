import React, { useEffect, useState } from 'react';
import { Activity, CheckCircle2, Server, X, XCircle } from 'lucide-react';
import { BridgeConfig, EngineMode } from '../types/media';
import { testLocalBridgeConnection } from '../services/bridgeEngine';

interface SettingsModalProps {
  isOpen: boolean;
  engineMode: EngineMode;
  bridgeConfig: BridgeConfig;
  onClose: () => void;
  onSave: (mode: EngineMode, config: BridgeConfig) => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  engineMode,
  bridgeConfig,
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
      url: draftUrl.trim() || 'http://127.0.0.1:8000',
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
      url: draftUrl.trim() || 'http://127.0.0.1:8000',
      timeoutMs: 120000,
      presetName: draftPreset.trim() || 'medium',
      apiKey: draftApiKey.trim() || undefined,
    });
    onClose();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="bridge-settings-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-xs"
    >
      <div className="w-full max-w-lg rounded-xl border border-white/15 bg-[#121216] shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.08]">
          <div className="flex items-center gap-2.5">
            <Server className="w-4 h-4 text-cyan-400" />
            <h2 id="bridge-settings-title" className="text-sm font-semibold text-zinc-100">
              Local FFmpeg API Bridge & Engine Settings
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close settings modal"
            className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-white/[0.06] cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {/* Active Engine Toggle */}
          <div>
            <span className="block text-xs font-medium text-zinc-300 mb-2">
              Processing Engine Mode
            </span>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setDraftMode('browser-wasm')}
                className={`p-3 rounded-lg border text-left transition-colors cursor-pointer ${
                  draftMode === 'browser-wasm'
                    ? 'border-cyan-400 bg-cyan-500/10'
                    : 'border-white/10 bg-white/[0.02] hover:bg-white/[0.05]'
                }`}
              >
                <div className="text-xs font-semibold text-zinc-100">Browser WASM</div>
                <div className="text-[11px] text-zinc-400 mt-0.5">
                  100% client-side Canvas & FFmpeg WASM
                </div>
              </button>

              <button
                type="button"
                onClick={() => setDraftMode('local-bridge')}
                className={`p-3 rounded-lg border text-left transition-colors cursor-pointer ${
                  draftMode === 'local-bridge'
                    ? 'border-emerald-400 bg-emerald-500/10'
                    : 'border-white/10 bg-white/[0.02] hover:bg-white/[0.05]'
                }`}
              >
                <div className="text-xs font-semibold text-zinc-100">Local API Bridge</div>
                <div className="text-[11px] text-zinc-400 mt-0.5">
                  Hardware-accelerated Termux / Desktop
                </div>
              </button>
            </div>
          </div>

          {/* Bridge Endpoint URL */}
          <div>
            <label htmlFor="bridge-url-input" className="block text-xs font-medium text-zinc-300 mb-1.5">
              Bridge Base URL
            </label>
            <div className="flex gap-2">
              <input
                id="bridge-url-input"
                type="url"
                value={draftUrl}
                onChange={(e) => setDraftUrl(e.target.value)}
                placeholder="http://127.0.0.1:8000"
                className="flex-1 px-3 py-2 text-xs font-mono rounded-lg border border-white/10 bg-[#09090b] text-zinc-100 focus:outline-none focus:border-cyan-400"
              />
              <button
                type="button"
                onClick={handleTest}
                disabled={testing}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border border-white/10 bg-white/[0.04] text-zinc-200 hover:bg-white/[0.08] disabled:opacity-50 transition-colors cursor-pointer whitespace-nowrap"
              >
                <Activity className="w-3.5 h-3.5 text-cyan-400" />
                {testing ? 'Testing...' : 'Test Bridge'}
              </button>
            </div>
          </div>

          {testResult && (
            <div
              className={`flex items-start gap-2 p-3 rounded-lg border text-xs ${
                testResult.ok
                  ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                  : 'border-amber-500/30 bg-amber-500/10 text-amber-300'
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
              <label htmlFor="bridge-preset-input" className="block text-xs font-medium text-zinc-300 mb-1.5">
                Native Encoder Preset
              </label>
              <select
                id="bridge-preset-input"
                value={draftPreset}
                onChange={(e) => setDraftPreset(e.target.value)}
                className="w-full px-3 py-2 text-xs rounded-lg border border-white/10 bg-[#09090b] text-zinc-100 focus:outline-none focus:border-cyan-400"
              >
                <option value="ultrafast">ultrafast</option>
                <option value="veryfast">veryfast</option>
                <option value="medium">medium</option>
                <option value="slow">slow</option>
              </select>
            </div>

            <div>
              <label htmlFor="bridge-key-input" className="block text-xs font-medium text-zinc-300 mb-1.5">
                Optional Bearer Token
              </label>
              <input
                id="bridge-key-input"
                type="password"
                value={draftApiKey}
                onChange={(e) => setDraftApiKey(e.target.value)}
                placeholder="Optional local token"
                className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-white/10 bg-[#09090b] text-zinc-100 focus:outline-none focus:border-cyan-400"
              />
            </div>
          </div>

          <div className="p-3 rounded-lg border border-white/[0.06] bg-[#09090b] text-[11px] font-mono text-zinc-400 space-y-1">
            <div className="text-zinc-300 font-semibold">Expected Bridge Endpoint Contract:</div>
            <div>POST /api/convert (multipart/form-data)</div>
            <div>fields: file (binary), params (JSON: format, crf, resolution, bitrate, preset)</div>
            <div>GET /health → 200 OK</div>
          </div>

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-white/[0.08]">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-medium rounded-lg text-zinc-300 hover:bg-white/[0.06] cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 text-xs font-semibold rounded-lg bg-cyan-500 text-zinc-950 hover:bg-cyan-400 cursor-pointer"
            >
              Save Engine Settings
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
