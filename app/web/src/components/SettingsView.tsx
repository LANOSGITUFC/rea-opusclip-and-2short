import React, { useEffect, useState } from "react";
import { api, Settings } from "../api";
import { KeyRound, Save, CheckCircle2, ShieldCheck } from "lucide-react";

export const SettingsView: React.FC = () => {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api.getSettings().then(setSettings);
  }, []);

  if (!settings) return null;

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await api.saveSettings({
      llmProvider: settings.llmProvider,
      llmModel: settings.llmModel,
      llmApiKey: apiKeyInput.trim() || undefined,
      whisperModel: settings.whisperModel,
      defaultLanguage: settings.defaultLanguage,
      socialCopyPrompt: settings.socialCopyPrompt
    });
    setSettings(res.settings);
    setApiKeyInput("");
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  };

  return (
    <form onSubmit={handleSave} className="max-w-2xl mx-auto space-y-5 pb-20">
      <div className="bg-[#111827] border border-slate-800 rounded-2xl p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <KeyRound className="w-5 h-5 text-purple-400" />
            <div>
              <h2 className="text-base font-extrabold text-white">Chaves de IA & Motor de Transcrição</h2>
              <p className="text-xs text-slate-400">Salvo somente no SQLite local desta VM (nunca sobe para o GitHub).</p>
            </div>
          </div>
          {settings.hasApiKey && (
            <span className="text-[11px] bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 px-2.5 py-1 rounded-full font-bold flex items-center gap-1">
              <ShieldCheck className="w-3.5 h-3.5" /> Chave ativa ({settings.llmApiKeyMasked})
            </span>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
          <label className="space-y-1">
            <span className="font-bold text-slate-300">Provedor de LLM (Virality Score + Chat + Copy)</span>
            <select
              value={settings.llmProvider}
              onChange={e => setSettings({ ...settings, llmProvider: e.target.value as any })}
              className="w-full px-3 py-2.5 rounded-xl bg-[#090d16] border border-slate-700 text-white"
            >
              <option value="openai">OpenAI (GPT-4o / GPT-4o-mini)</option>
              <option value="gemini">Google Gemini (gemini-2.0-flash)</option>
              <option value="groq">Groq (Llama 3.3 70B — ultra rápido)</option>
              <option value="openrouter">OpenRouter (qualquer modelo)</option>
            </select>
          </label>

          <label className="space-y-1">
            <span className="font-bold text-slate-300">Modelo (opcional — deixe vazio p/ padrão)</span>
            <input
              value={settings.llmModel}
              onChange={e => setSettings({ ...settings, llmModel: e.target.value })}
              placeholder="ex: gpt-4o-mini ou gemini-2.0-flash"
              className="w-full px-3 py-2.5 rounded-xl bg-[#090d16] border border-slate-700 text-white"
            />
          </label>
        </div>

        <label className="block space-y-1 text-xs">
          <span className="font-bold text-slate-300">Sua API Key</span>
          <input
            type="password"
            value={apiKeyInput}
            onChange={e => setApiKeyInput(e.target.value)}
            placeholder={settings.hasApiKey ? "Cole uma nova chave para substituir a atual..." : "sk-... / AIza... / gsk_..."}
            className="w-full px-3.5 py-2.5 rounded-xl bg-[#090d16] border border-slate-700 text-white font-mono"
          />
        </label>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs pt-2 border-t border-slate-800">
          <label className="space-y-1">
            <span className="font-bold text-slate-300">Modelo Whisper Local (CPU)</span>
            <select
              value={settings.whisperModel}
              onChange={e => setSettings({ ...settings, whisperModel: e.target.value as any })}
              className="w-full px-3 py-2.5 rounded-xl bg-[#090d16] border border-slate-700 text-white"
            >
              <option value="tiny">tiny (Mais rápido em CPU)</option>
              <option value="base">base (Equilíbrio velocidade/precisão)</option>
              <option value="small">small (Alta precisão, mais lento)</option>
            </select>
          </label>

          <label className="space-y-1">
            <span className="font-bold text-slate-300">Idioma Padrão da Transcrição</span>
            <select
              value={settings.defaultLanguage}
              onChange={e => setSettings({ ...settings, defaultLanguage: e.target.value })}
              className="w-full px-3 py-2.5 rounded-xl bg-[#090d16] border border-slate-700 text-white"
            >
              <option value="pt">Português (pt)</option>
              <option value="en">English (en)</option>
              <option value="es">Español (es)</option>
              <option value="">Detecção Automática</option>
            </select>
          </label>
        </div>

        <label className="block space-y-1 text-xs">
          <span className="font-bold text-slate-300">Prompt Padrão do PlanSocial (Copy das Redes Sociais)</span>
          <textarea
            rows={2}
            value={settings.socialCopyPrompt}
            onChange={e => setSettings({ ...settings, socialCopyPrompt: e.target.value })}
            className="w-full px-3 py-2 rounded-xl bg-[#090d16] border border-slate-700 text-white"
          />
        </label>

        <div className="flex items-center justify-between pt-2">
          {saved ? (
            <span className="text-xs text-emerald-400 font-bold flex items-center gap-1.5">
              <CheckCircle2 className="w-4 h-4" /> Configurações salvas com sucesso!
            </span>
          ) : <span />}
          <button
            type="submit"
            className="px-5 py-2.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold flex items-center gap-2"
          >
            <Save className="w-4 h-4" /> Salvar Configurações
          </button>
        </div>
      </div>
    </form>
  );
};
