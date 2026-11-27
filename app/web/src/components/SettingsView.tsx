import React, { useEffect, useState } from "react";
import { api, ApiKeyItem, Settings } from "../api";
import { KeyRound, Save, CheckCircle2, ShieldCheck, Plus, Trash2, RefreshCw, Zap, AlertTriangle, AlertCircle, Loader2 } from "lucide-react";

const PROVIDER_BADGE: Record<string, string> = {
  groq: "bg-orange-500/20 text-orange-300 border-orange-500/40",
  gemini: "bg-sky-500/20 text-sky-300 border-sky-500/40",
  openai: "bg-emerald-500/20 text-emerald-300 border-emerald-500/40",
  openrouter: "bg-purple-500/20 text-purple-300 border-purple-500/40"
};

export const SettingsView: React.FC = () => {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [keys, setKeys] = useState<ApiKeyItem[]>([]);
  const [saved, setSaved] = useState(false);

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [actionErr, setActionErr] = useState<string | null>(null);
  const [savingPrefs, setSavingPrefs] = useState(false);
  const [addingKeys, setAddingKeys] = useState(false);

  // Add keys form (supports 1 or bulk paste — 1 per line)
  const [newProvider, setNewProvider] = useState("auto");
  const [newLabel, setNewLabel] = useState("");
  const [newModel, setNewModel] = useState("");
  const [newCaps, setNewCaps] = useState<"both" | "llm" | "whisper">("both");
  const [keysText, setKeysText] = useState("");
  const [addedMsg, setAddedMsg] = useState("");

  // YouTube Cookies state
  const [cookiesStatus, setCookiesStatus] = useState<{ hasCookies: boolean; sizeBytes: number; modifiedAt: string | null } | null>(null);
  const [cookiesMsg, setCookiesMsg] = useState("");

  const loadAll = async () => {
    setLoading(true);
    setErr(null);
    try {
      const [s, k, cs] = await Promise.all([
        api.getSettings(),
        api.getApiKeys(),
        api.getCookiesStatus().catch(() => ({ hasCookies: false, sizeBytes: 0, modifiedAt: null }))
      ]);
      setSettings(s);
      setKeys(k.keys);
      setCookiesStatus(cs);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Erro ao carregar configurações.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAll();
  }, []);

  if (loading && !settings) {
    return (
      <div className="py-16 flex justify-center">
        <Loader2 className="w-6 h-6 text-purple-400 animate-spin" />
      </div>
    );
  }

  if (err && !settings) {
    return (
      <div className="max-w-md mx-auto my-12 bg-[#111827] border border-red-500/30 rounded-2xl p-6 text-center space-y-4">
        <AlertCircle className="w-8 h-8 text-red-400 mx-auto" />
        <div className="space-y-1">
          <h3 className="text-sm font-bold text-white">Não foi possível carregar as configurações</h3>
          <p className="text-xs text-red-300">{err}</p>
        </div>
        <button
          onClick={loadAll}
          className="px-4 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold inline-flex items-center gap-1.5"
        >
          <RefreshCw className="w-3.5 h-3.5" /> Tentar novamente
        </button>
      </div>
    );
  }

  if (!settings) return null;

  const handleAddKeys = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!keysText.trim() || addingKeys) return;
    setAddingKeys(true);
    setActionErr(null);
    try {
      const r = await api.addApiKeys({
        provider: newProvider,
        label: newLabel.trim(),
        model: newModel.trim(),
        capabilities: newCaps,
        keysText
      });
      setKeys(r.keys);
      setKeysText("");
      setNewLabel("");
      setAddedMsg(`${r.added} chave(s) adicionada(s) ao pool de rotação!`);
      setTimeout(() => setAddedMsg(""), 3500);
    } catch (e: unknown) {
      setActionErr(e instanceof Error ? e.message : "Erro ao adicionar chaves.");
    } finally {
      setAddingKeys(false);
    }
  };

  const handleKeyAction = async (fn: () => Promise<{ keys: ApiKeyItem[] }>) => {
    setActionErr(null);
    try {
      const r = await fn();
      setKeys(r.keys);
    } catch (e: unknown) {
      setActionErr(e instanceof Error ? e.message : "Erro ao atualizar chave.");
    }
  };

  const handleSavePrefs = async (e: React.FormEvent) => {
    e.preventDefault();
    if (savingPrefs) return;
    setSavingPrefs(true);
    setActionErr(null);
    try {
      const res = await api.saveSettings({
        llmProvider: settings.llmProvider,
        llmModel: settings.llmModel,
        whisperProvider: settings.whisperProvider,
        whisperModel: settings.whisperModel,
        giphyApiKey: settings.giphyApiKey,
        defaultLanguage: settings.defaultLanguage,
        socialCopyPrompt: settings.socialCopyPrompt
      });
      setSettings(res.settings);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (e: unknown) {
      setActionErr(e instanceof Error ? e.message : "Erro ao salvar preferências.");
    } finally {
      setSavingPrefs(false);
    }
  };

  const nowIso = new Date().toISOString();

  return (
    <div className="max-w-3xl mx-auto space-y-6 pb-20">
      {actionErr && (
        <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 text-xs flex items-center justify-between gap-2">
          <span className="flex items-center gap-2"><AlertCircle className="w-4 h-4 shrink-0" /> {actionErr}</span>
          <button type="button" onClick={() => setActionErr(null)} className="text-slate-400 hover:text-white text-xs">✕</button>
        </div>
      )}
      {/* MULTI-KEY POOL CARD */}
      <section className="bg-[#111827] border border-slate-800 rounded-2xl p-5 space-y-4">
        <div className="flex items-start justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-purple-600/20 border border-purple-500/40 flex items-center justify-center text-purple-400">
              <Zap className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-extrabold text-white">Pool Multi-Key com Rotação Automática (Failover 429)</h2>
              <p className="text-xs text-slate-400">
                Adicione quantas contas quiser (Groq, Gemini, OpenAI, OpenRouter). Se uma bater limite 429, o sistema pula automaticamente para a próxima!
              </p>
            </div>
          </div>
          <span className="text-[11px] bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 px-2.5 py-1 rounded-full font-bold flex items-center gap-1">
            <ShieldCheck className="w-3.5 h-3.5" /> {keys.filter(k => k.enabled).length} chave(s) ativa(s)
          </span>
        </div>

        {/* Add 1 or bulk keys */}
        <form onSubmit={handleAddKeys} className="space-y-3 p-3.5 rounded-xl bg-[#090d16] border border-slate-800 text-xs">
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
            <select value={newProvider} onChange={e => setNewProvider(e.target.value)} className="px-3 py-2 rounded-xl bg-[#111827] border border-slate-700 text-white">
              <option value="auto">Detectar Automático (gsk_/AIza/sk-)</option>
              <option value="groq">Groq (LLM + Whisper Grátis)</option>
              <option value="gemini">Google Gemini (LLM Grátis)</option>
              <option value="openai">OpenAI (LLM + Whisper)</option>
              <option value="openrouter">OpenRouter (LLM)</option>
            </select>
            <select value={newCaps} onChange={e => setNewCaps(e.target.value as any)} className="px-3 py-2 rounded-xl bg-[#111827] border border-slate-700 text-white">
              <option value="both">Uso: LLM + Whisper</option>
              <option value="llm">Uso: Somente LLM</option>
              <option value="whisper">Uso: Somente Whisper</option>
            </select>
            <input value={newLabel} onChange={e => setNewLabel(e.target.value)} placeholder="Rótulo (ex: Conta Groq)" className="px-3 py-2 rounded-xl bg-[#111827] border border-slate-700 text-white" />
            <input value={newModel} onChange={e => setNewModel(e.target.value)} placeholder="Modelo (opcional)" className="px-3 py-2 rounded-xl bg-[#111827] border border-slate-700 text-white" />
          </div>

          <textarea
            rows={3}
            value={keysText}
            onChange={e => setKeysText(e.target.value)}
            placeholder={"Cole 1 ou várias chaves (uma por linha):\ngsk_conta1...\ngsk_conta2...\nAIzaSy_gemini1..."}
            className="w-full px-3 py-2 rounded-xl bg-[#111827] border border-slate-700 text-white font-mono text-[11px]"
          />

          <div className="flex items-center justify-between">
            {addedMsg ? (
              <span className="text-emerald-400 font-bold flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5" /> {addedMsg}</span>
            ) : (
              <span className="text-[11px] text-slate-500">Salvo somente no SQLite local (nunca vai para o GitHub).</span>
            )}
            <button type="submit" disabled={addingKeys || !keysText.trim()} className="px-4 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-bold flex items-center gap-1.5 disabled:opacity-50">
              {addingKeys ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
              {addingKeys ? "Adicionando..." : "Adicionar ao Pool"}
            </button>
          </div>
        </form>

        {/* Registered Keys List */}
        {keys.length > 0 && (
          <div className="space-y-2">
            {keys.map(k => {
              const inCooldown = Boolean(k.cooldownUntil && k.cooldownUntil > nowIso);
              return (
                <div key={k.id} className="p-3 rounded-xl bg-[#090d16] border border-slate-800 flex flex-wrap items-center justify-between gap-2 text-xs">
                  <div className="space-y-0.5 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase border ${PROVIDER_BADGE[k.provider] || "bg-slate-800 text-slate-300 border-slate-700"}`}>
                        {k.provider}
                      </span>
                      <span className="font-bold text-white">{k.label}</span>
                      <span className="font-mono text-[11px] text-slate-400">{k.apiKeyMasked}</span>
                      <span className="text-[10px] text-slate-500">({k.capabilities})</span>
                    </div>
                    <div className="flex items-center gap-3 text-[11px] text-slate-400">
                      <span>Usos: <strong className="text-emerald-400">{k.usageCount}</strong></span>
                      <span>Erros: <strong className={k.errorCount ? "text-amber-400" : "text-slate-400"}>{k.errorCount}</strong></span>
                      {inCooldown && (
                        <span className="text-amber-400 flex items-center gap-1 font-semibold">
                          <AlertTriangle className="w-3 h-3" /> Em cooldown até {new Date(k.cooldownUntil).toLocaleTimeString("pt-BR")}
                        </span>
                      )}
                    </div>
                    {k.lastError && <p className="text-[10px] text-red-400 truncate max-w-md">{k.lastError}</p>}
                  </div>

                  <div className="flex items-center gap-1.5">
                    {inCooldown && (
                      <button
                        type="button"
                        onClick={() => handleKeyAction(() => api.updateApiKey(k.id, { resetCooldown: true }))}
                        className="px-2 py-1 rounded-lg bg-amber-500/20 text-amber-300 text-[10px] font-bold flex items-center gap-1"
                        title="Liberar cooldown agora"
                      >
                        <RefreshCw className="w-3 h-3" /> Liberar
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => handleKeyAction(() => api.updateApiKey(k.id, { enabled: !k.enabled }))}
                      className={`px-2.5 py-1 rounded-lg text-[10px] font-bold ${
                        k.enabled ? "bg-emerald-500/20 text-emerald-400" : "bg-slate-800 text-slate-400"
                      }`}
                    >
                      {k.enabled ? "Ativa" : "Pausada"}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleKeyAction(() => api.deleteApiKey(k.id))}
                      className="p-1.5 text-slate-500 hover:text-red-400"
                      title="Remover chave"
                      aria-label={`Remover chave ${k.label}`}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* ENGINE PREFERENCES CARD */}
      <form onSubmit={handleSavePrefs} className="bg-[#111827] border border-slate-800 rounded-2xl p-5 space-y-4">
        <div className="flex items-center gap-2.5">
          <KeyRound className="w-5 h-5 text-purple-400" />
          <h2 className="text-base font-extrabold text-white">Prioridade de Provedor & Transcrição</h2>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
          <label className="space-y-1">
            <span className="font-bold text-slate-300">Provedor LLM Prioritário</span>
            <select
              value={settings.llmProvider}
              onChange={e => setSettings({ ...settings, llmProvider: e.target.value as any })}
              className="w-full px-3 py-2.5 rounded-xl bg-[#090d16] border border-slate-700 text-white"
            >
              <option value="groq">Groq (Llama 3.3 70B)</option>
              <option value="gemini">Google Gemini</option>
              <option value="openai">OpenAI</option>
              <option value="openrouter">OpenRouter</option>
            </select>
          </label>

          <label className="space-y-1">
            <span className="font-bold text-slate-300">Motor de Transcrição</span>
            <select
              value={settings.whisperProvider}
              onChange={e => setSettings({ ...settings, whisperProvider: e.target.value as any })}
              className="w-full px-3 py-2.5 rounded-xl bg-[#090d16] border border-slate-700 text-white"
            >
              <option value="groq">Pool Groq Whisper API (10x rápido)</option>
              <option value="openai">Pool OpenAI Whisper API</option>
              <option value="local">Whisper Local (CPU)</option>
            </select>
          </label>

          <label className="space-y-1">
            <span className="font-bold text-slate-300">Idioma Padrão</span>
            <select
              value={settings.defaultLanguage}
              onChange={e => setSettings({ ...settings, defaultLanguage: e.target.value })}
              className="w-full px-3 py-2.5 rounded-xl bg-[#090d16] border border-slate-700 text-white"
            >
              <option value="pt">Português (pt)</option>
              <option value="en">English (en)</option>
              <option value="es">Español (es)</option>
              <option value="">Automático</option>
            </select>
          </label>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
          <label className="space-y-1">
            <span className="font-bold text-slate-300">Modelo LLM (Override)</span>
            <input
              value={settings.llmModel || ""}
              onChange={e => setSettings({ ...settings, llmModel: e.target.value })}
              placeholder="ex: llama-3.3-70b-versatile"
              className="w-full px-3 py-2.5 rounded-xl bg-[#090d16] border border-slate-700 text-white"
            />
          </label>

          <label className="space-y-1">
            <span className="font-bold text-slate-300">Modelo Whisper Local</span>
            <select
              value={settings.whisperModel || "base"}
              onChange={e => setSettings({ ...settings, whisperModel: e.target.value as Settings["whisperModel"] })}
              className="w-full px-3 py-2.5 rounded-xl bg-[#090d16] border border-slate-700 text-white"
            >
              <option value="tiny">tiny (Mais rápido)</option>
              <option value="base">base (Equilibrado)</option>
              <option value="small">small (Maior precisão)</option>
            </select>
          </label>

          <label className="space-y-1">
            <span className="font-bold text-slate-300">Giphy API Key (B-Roll / GIFs)</span>
            <input
              type="password"
              value={settings.giphyApiKey || ""}
              onChange={e => setSettings({ ...settings, giphyApiKey: e.target.value })}
              placeholder="Opcional"
              className="w-full px-3 py-2.5 rounded-xl bg-[#090d16] border border-slate-700 text-white"
            />
          </label>
        </div>

        <label className="block space-y-1 text-xs">
          <span className="font-bold text-slate-300">Prompt Padrão do PlanSocial (Copy das Redes)</span>
          <textarea
            rows={2}
            value={settings.socialCopyPrompt}
            onChange={e => setSettings({ ...settings, socialCopyPrompt: e.target.value })}
            className="w-full px-3 py-2 rounded-xl bg-[#090d16] border border-slate-700 text-white"
          />
        </label>

        {/* YouTube Cookies (.txt) Upload Section */}
        <div className="p-4 rounded-xl bg-[#090d16] border border-slate-800 space-y-3 text-xs">
          <div className="flex items-center justify-between">
            <div>
              <span className="font-bold text-white block">🍪 YouTube Cookies (cookies.txt)</span>
              <p className="text-[11px] text-slate-400">
                Evita o bloqueio "Sign in to confirm you're not a bot" ao baixar certos vídeos ou lives do YouTube.
              </p>
            </div>
            {cookiesStatus?.hasCookies ? (
              <span className="px-2.5 py-1 rounded-full bg-emerald-500/20 text-emerald-300 font-bold text-[10px] flex items-center gap-1">
                <CheckCircle2 className="w-3 h-3" /> Ativo ({(cookiesStatus.sizeBytes / 1024).toFixed(1)} KB)
              </span>
            ) : (
              <span className="px-2.5 py-1 rounded-full bg-slate-800 text-slate-400 font-bold text-[10px]">
                Nenhum cookie enviado
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <label className="px-3 py-1.5 rounded-xl bg-purple-600/20 border border-purple-500/40 text-purple-300 text-xs font-bold cursor-pointer hover:bg-purple-600/30 transition">
              Selecionar arquivo cookies.txt
              <input
                type="file"
                accept=".txt"
                className="hidden"
                onChange={async e => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  try {
                    await api.uploadCookiesFile(file);
                    const st = await api.getCookiesStatus();
                    setCookiesStatus(st);
                    setCookiesMsg("Arquivo cookies.txt enviado com sucesso!");
                    setTimeout(() => setCookiesMsg(""), 4000);
                  } catch (err: unknown) {
                    setActionErr(err instanceof Error ? err.message : "Erro ao enviar cookies.");
                  }
                }}
              />
            </label>

            {cookiesStatus?.hasCookies && (
              <button
                type="button"
                onClick={async () => {
                  try {
                    await api.deleteCookies();
                    const st = await api.getCookiesStatus();
                    setCookiesStatus(st);
                    setCookiesMsg("Cookies removidos.");
                    setTimeout(() => setCookiesMsg(""), 3000);
                  } catch (err: unknown) {
                    setActionErr(err instanceof Error ? err.message : "Erro ao remover cookies.");
                  }
                }}
                className="px-3 py-1.5 rounded-xl bg-red-600/20 border border-red-500/40 text-red-300 text-xs font-bold hover:bg-red-600/30 transition"
              >
                Remover cookies
              </button>
            )}
            {cookiesMsg && <span className="text-[11px] text-emerald-400 font-semibold">{cookiesMsg}</span>}
          </div>
        </div>

        <div className="flex items-center justify-between pt-2">
          {saved ? (
            <span className="text-xs text-emerald-400 font-bold flex items-center gap-1.5">
              <CheckCircle2 className="w-4 h-4" /> Preferências salvas!
            </span>
          ) : <span />}
          <button type="submit" disabled={savingPrefs} className="px-5 py-2.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold flex items-center gap-2 disabled:opacity-50">
            {savingPrefs ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {savingPrefs ? "Salvando..." : "Salvar Preferências"}
          </button>
        </div>
      </form>
    </div>
  );
};
