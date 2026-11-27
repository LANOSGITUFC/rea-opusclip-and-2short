import React, { useEffect, useState } from "react";
import { api, Clip, OAuthConfig, PublishSchedule, SocialAccount } from "../api";
import { Calendar, Trash2, Sparkles, Send, CheckCircle2, AlertCircle, Upload, ExternalLink, KeyRound, Loader2 } from "lucide-react";

interface Props {
  preselectedClip?: Clip | null;
}

export const SocialView: React.FC<Props> = ({ preselectedClip }) => {
  const [accounts, setAccounts] = useState<SocialAccount[]>([]);
  const [schedules, setSchedules] = useState<PublishSchedule[]>([]);
  const [oauth, setOauth] = useState<OAuthConfig | null>(null);
  const [showOAuthSetup, setShowOAuthSetup] = useState(false);
  const [statusMsg, setStatusMsg] = useState("");
  const [errMsg, setErrMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmDeleteAccountId, setConfirmDeleteAccountId] = useState<string | null>(null);
  const [confirmDeleteScheduleId, setConfirmDeleteScheduleId] = useState<string | null>(null);

  // TikTok / Meta manual credentials
  const [tiktokKey, setTiktokKey] = useState("");
  const [tiktokSecret, setTiktokSecret] = useState("");
  const [metaId, setMetaId] = useState("");
  const [metaSecret, setMetaSecret] = useState("");

  // Schedule form
  const [schedAccountId, setSchedAccountId] = useState("");
  const [schedTitle, setSchedTitle] = useState(preselectedClip?.title || "");
  const [schedDesc, setSchedDesc] = useState(preselectedClip?.description || "");
  const [schedTags, setSchedTags] = useState(preselectedClip?.hashtags || "");
  const [schedTime, setSchedTime] = useState(new Date(Date.now() + 3600_000).toISOString().slice(0, 16));
  const [copyBusy, setCopyBusy] = useState(false);
  const [schedBusy, setSchedBusy] = useState(false);

  const load = async () => {
    try {
      const [a, s, o] = await Promise.all([
        api.getSocialAccounts(),
        api.getSchedules(),
        api.getOAuthConfig()
      ]);
      setAccounts(a.accounts);
      setSchedules(s.schedules);
      setOauth(o);
      if (!schedAccountId && a.accounts.length > 0) setSchedAccountId(a.accounts[0].id);
    } catch (e: unknown) {
      setErrMsg(e instanceof Error ? e.message : "Erro ao carregar contas e agendamentos.");
    }
  };

  useEffect(() => {
    load();
    const params = new URLSearchParams(window.location.search);
    if (params.has("oauth")) {
      if (params.get("oauth") === "success") {
        setStatusMsg(`Conta ${params.get("platform") || ""} conectada com sucesso via OAuth!`);
      } else if (params.get("oauth") === "error") {
        setErrMsg(`Erro no OAuth: ${params.get("msg") || "Falha na autenticação"}`);
      }
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  const handleUploadGoogleSecret = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setErrMsg("");
    setStatusMsg("");
    try {
      const fd = new FormData();
      fd.append("file", file);
      await api.uploadGoogleOAuthSecret(fd);
      setStatusMsg("client_secret.json do Google Cloud salvo! Agora clique em 'Login com YouTube'.");
      await load();
    } catch (err: unknown) {
      setErrMsg(err instanceof Error ? err.message : "Erro ao enviar client_secret.json.");
    } finally {
      setBusy(false);
      e.target.value = "";
    }
  };

  const handleSaveOtherOAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErrMsg("");
    setStatusMsg("");
    try {
      await api.saveOAuthConfig({
        tiktokClientKey: tiktokKey,
        tiktokClientSecret: tiktokSecret,
        metaAppId: metaId,
        metaAppSecret: metaSecret
      });
      setStatusMsg("Credenciais OAuth salvas!");
      setTiktokKey(""); setTiktokSecret(""); setMetaId(""); setMetaSecret("");
      await load();
    } catch (err: unknown) {
      setErrMsg(err instanceof Error ? err.message : "Erro ao salvar credenciais OAuth.");
    } finally {
      setBusy(false);
    }
  };

  const handleGenCopy = async () => {
    if (!preselectedClip) return;
    setCopyBusy(true);
    setErrMsg("");
    try {
      const acc = accounts.find(a => a.id === schedAccountId);
      const r = await api.generateSocialCopy(preselectedClip.id, acc?.platform || "YOUTUBE");
      setSchedTitle(r.copy.title);
      setSchedDesc(r.copy.description);
      setSchedTags(r.copy.hashtags);
    } catch (e: unknown) {
      setErrMsg(e instanceof Error ? e.message : "Erro ao gerar copy com IA.");
    } finally {
      setCopyBusy(false);
    }
  };

  const handleSchedule = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrMsg("");
    setStatusMsg("");
    if (!preselectedClip?.id) {
      setErrMsg("Selecione um clipe válido antes de agendar.");
      return;
    }
    if (!schedAccountId) {
      setErrMsg("Selecione uma conta social conectada para agendar.");
      return;
    }
    const parsedDate = new Date(schedTime);
    if (!schedTime || Number.isNaN(parsedDate.getTime())) {
      setErrMsg("Informe uma data e hora válidas para o agendamento.");
      return;
    }
    setSchedBusy(true);
    try {
      const acc = accounts.find(a => a.id === schedAccountId);
      await api.createSchedule({
        clipId: preselectedClip.id,
        accountId: schedAccountId,
        platform: acc?.platform || "YOUTUBE",
        title: schedTitle.trim() || preselectedClip.title,
        description: schedDesc,
        hashtags: schedTags,
        scheduledAt: parsedDate.toISOString()
      });
      setStatusMsg("Publicação agendada com sucesso!");
      await load();
    } catch (err: unknown) {
      setErrMsg(err instanceof Error ? err.message : "Erro ao agendar publicação.");
    } finally {
      setSchedBusy(false);
    }
  };

  const handleDeleteAccount = async (id: string) => {
    setErrMsg("");
    try {
      await api.deleteSocialAccount(id);
      setConfirmDeleteAccountId(null);
      setStatusMsg("Conta social desconectada.");
      await load();
    } catch (e: unknown) {
      setErrMsg(e instanceof Error ? e.message : "Erro ao remover conta social.");
    }
  };

  const handlePublishNow = async (id: string) => {
    setErrMsg("");
    setStatusMsg("");
    try {
      const res = await api.publishNow(id);
      if (res.error) setErrMsg(res.error);
      else setStatusMsg("Publicação disparada!");
      await load();
    } catch (e: unknown) {
      setErrMsg(e instanceof Error ? e.message : "Erro ao publicar agora.");
    }
  };

  const handleDeleteSchedule = async (id: string) => {
    setErrMsg("");
    try {
      await api.deleteSchedule(id);
      setConfirmDeleteScheduleId(null);
      setStatusMsg("Agendamento removido.");
      await load();
    } catch (e: unknown) {
      setErrMsg(e instanceof Error ? e.message : "Erro ao remover agendamento.");
    }
  };

  return (
    <div className="space-y-6 pb-20">
      {errMsg && (
        <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-xs font-semibold text-red-400 flex items-center justify-between gap-2">
          <span className="flex items-center gap-2"><AlertCircle className="w-4 h-4 shrink-0" /> {errMsg}</span>
          <button onClick={() => setErrMsg("")} className="text-slate-400 hover:text-white text-xs">✕</button>
        </div>
      )}
      {statusMsg && (
        <div className="p-3 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-xs font-semibold text-emerald-300 flex items-center justify-between gap-2">
          <span className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 shrink-0" /> {statusMsg}</span>
          <button onClick={() => setStatusMsg("")} className="text-slate-400 hover:text-white text-xs">✕</button>
        </div>
      )}

      {/* ONE-CLICK OAUTH LOGIN BUTTONS */}
      <section className="bg-[#111827] border border-slate-800 rounded-2xl p-4 sm:p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-base font-extrabold text-white">Conectar Redes Sociais via OAuth 2.0</h2>
            <p className="text-xs text-slate-400">
              Faça login oficial no YouTube, TikTok ou Instagram. Você pode subir o <code className="text-purple-300">client_secret.json</code> aqui ou colocá-lo em <code className="text-purple-300">MyDrive/Opus2ShortStudio/data/</code>.
            </p>
          </div>
          <button
            onClick={() => setShowOAuthSetup(!showOAuthSetup)}
            className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-bold text-slate-200 flex items-center gap-1.5"
          >
            <KeyRound className="w-3.5 h-3.5 text-purple-400" />
            {showOAuthSetup ? "Ocultar Credenciais OAuth" : "Configurar Apps OAuth"}
          </button>
        </div>

        {/* 3 Real OAuth Login Buttons */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {/* YouTube */}
          <div className="p-3.5 rounded-2xl bg-[#090d16] border border-slate-800 flex flex-col justify-between gap-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-black text-red-400">▶ YouTube Shorts</span>
              <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${
                oauth?.googleConfigured ? "bg-emerald-500/20 text-emerald-400" : "bg-amber-500/20 text-amber-400"
              }`}>
                {oauth?.googleConfigured ? "Pronto" : "Enviar JSON"}
              </span>
            </div>
            <div className="flex gap-2">
              {oauth?.googleConfigured ? (
                <a
                  href="/api/oauth/youtube/start"
                  className="flex-1 py-2 rounded-xl bg-red-600 hover:bg-red-500 text-white text-xs font-bold text-center transition"
                >
                  Login com YouTube
                </a>
              ) : (
                <label className="flex-1 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-white text-xs font-bold text-center cursor-pointer flex items-center justify-center gap-1.5">
                  <Upload className="w-3.5 h-3.5" /> Enviar client_secret.json
                  <input type="file" accept=".json" className="hidden" onChange={handleUploadGoogleSecret} />
                </label>
              )}
            </div>
          </div>

          {/* TikTok */}
          <div className="p-3.5 rounded-2xl bg-[#090d16] border border-slate-800 flex flex-col justify-between gap-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-black text-cyan-400">🎵 TikTok</span>
              <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${
                oauth?.tiktokConfigured ? "bg-emerald-500/20 text-emerald-400" : "bg-slate-800 text-slate-400"
              }`}>
                {oauth?.tiktokConfigured ? "Pronto" : "Configurar"}
              </span>
            </div>
            {oauth?.tiktokConfigured ? (
              <a
                href="/api/oauth/tiktok/start"
                className="w-full py-2 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-black text-xs font-black text-center transition"
              >
                Login com TikTok
              </a>
            ) : (
              <button
                onClick={() => setShowOAuthSetup(true)}
                className="w-full py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold"
              >
                Inserir TikTok Client Key
              </button>
            )}
          </div>

          {/* Instagram */}
          <div className="p-3.5 rounded-2xl bg-[#090d16] border border-slate-800 flex flex-col justify-between gap-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-black text-pink-400">📸 Instagram Reels</span>
              <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${
                oauth?.metaConfigured ? "bg-emerald-500/20 text-emerald-400" : "bg-slate-800 text-slate-400"
              }`}>
                {oauth?.metaConfigured ? "Pronto" : "Configurar"}
              </span>
            </div>
            {oauth?.metaConfigured ? (
              <a
                href="/api/oauth/instagram/start"
                className="w-full py-2 rounded-xl bg-gradient-to-r from-pink-500 to-purple-600 text-white text-xs font-bold text-center transition"
              >
                Login com Instagram
              </a>
            ) : (
              <button
                onClick={() => setShowOAuthSetup(true)}
                className="w-full py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold"
              >
                Inserir Meta App ID
              </button>
            )}
          </div>
        </div>

        {/* OAuth Setup Drawer */}
        {showOAuthSetup && oauth && (
          <div className="p-4 rounded-xl bg-[#090d16] border border-purple-500/30 space-y-4 text-xs">
            <div className="space-y-1.5">
              <p className="font-bold text-purple-300">URIs de Redirecionamento (cole no Google Cloud / TikTok / Meta Console):</p>
              <div className="space-y-1 font-mono text-[11px] text-slate-300 bg-slate-900 p-2.5 rounded-lg border border-slate-800 break-all">
                <div><strong className="text-red-400">YouTube:</strong> {oauth.redirectUris.youtube}</div>
                <div><strong className="text-cyan-400">TikTok:</strong> {oauth.redirectUris.tiktok}</div>
                <div><strong className="text-pink-400">Instagram:</strong> {oauth.redirectUris.instagram}</div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-slate-800">
              <label className="px-3.5 py-2 rounded-xl bg-red-600/20 border border-red-500/40 text-red-300 font-bold cursor-pointer flex items-center gap-1.5">
                <Upload className="w-3.5 h-3.5" /> Enviar / Atualizar Google client_secret.json
                <input type="file" accept=".json" className="hidden" onChange={handleUploadGoogleSecret} />
              </label>
              {oauth.googleConfigured && (
                <span className="text-emerald-400 font-mono text-[11px]">Google ID: {oauth.googleClientIdPreview}</span>
              )}
            </div>

            <form onSubmit={handleSaveOtherOAuth} className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-2 border-t border-slate-800">
              <input value={tiktokKey} onChange={e => setTiktokKey(e.target.value)} placeholder="TikTok Client Key" className="px-3 py-2 rounded-xl bg-[#111827] border border-slate-700 text-white" />
              <input value={tiktokSecret} onChange={e => setTiktokSecret(e.target.value)} placeholder="TikTok Client Secret" type="password" className="px-3 py-2 rounded-xl bg-[#111827] border border-slate-700 text-white" />
              <input value={metaId} onChange={e => setMetaId(e.target.value)} placeholder="Meta (Instagram) App ID" className="px-3 py-2 rounded-xl bg-[#111827] border border-slate-700 text-white" />
              <input value={metaSecret} onChange={e => setMetaSecret(e.target.value)} placeholder="Meta App Secret" type="password" className="px-3 py-2 rounded-xl bg-[#111827] border border-slate-700 text-white" />
              <button type="submit" disabled={busy} className="sm:col-span-2 py-2 rounded-xl bg-purple-600 text-white font-bold disabled:opacity-50">
                {busy ? "Salvando..." : "Salvar Credenciais TikTok / Meta"}
              </button>
            </form>
          </div>
        )}

        {/* Connected Accounts List */}
        {accounts.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5 pt-2 border-t border-slate-800">
            {accounts.map(a => (
              <div key={a.id} className="p-3 rounded-xl bg-[#090d16] border border-slate-800 flex items-center justify-between text-xs">
                <div>
                  <div className="font-bold text-white flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-emerald-400" />
                    {a.accountName}
                  </div>
                  <div className="text-[11px] text-slate-400">{a.platform} {a.handle ? `• ${a.handle}` : ""}</div>
                </div>
                {confirmDeleteAccountId === a.id ? (
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => handleDeleteAccount(a.id)}
                      className="px-2 py-1 rounded bg-red-600 hover:bg-red-500 text-white text-[10px] font-bold"
                    >
                      Confirmar
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmDeleteAccountId(null)}
                      className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-[10px] font-bold"
                    >
                      Cancelar
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmDeleteAccountId(a.id)}
                    className="text-slate-500 hover:text-red-400 p-1"
                    title="Desconectar conta"
                    aria-label={`Desconectar ${a.accountName}`}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Schedule Creator */}
      {preselectedClip && (
        <form onSubmit={handleSchedule} className="bg-[#111827] border border-purple-500/40 rounded-2xl p-4 sm:p-5 space-y-3 text-xs">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-extrabold text-white">Agendar Clipe: {preselectedClip.title}</h3>
            <button type="button" onClick={handleGenCopy} disabled={copyBusy} className="px-3 py-1.5 rounded-lg bg-purple-600/20 border border-purple-500/40 text-purple-300 font-bold flex items-center gap-1">
              <Sparkles className="w-3.5 h-3.5" /> {copyBusy ? "Gerando..." : "Gerar Copy com IA"}
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <select value={schedAccountId} onChange={e => setSchedAccountId(e.target.value)} className="px-3 py-2 rounded-xl bg-[#090d16] border border-slate-700 text-white">
              <option value="">Selecione a conta conectada...</option>
              {accounts.map(a => <option key={a.id} value={a.id}>{a.platform} — {a.accountName}</option>)}
            </select>
            <input type="datetime-local" value={schedTime} onChange={e => setSchedTime(e.target.value)} className="px-3 py-2 rounded-xl bg-[#090d16] border border-slate-700 text-white" />
          </div>
          <input value={schedTitle} onChange={e => setSchedTitle(e.target.value)} placeholder="Título da postagem" className="w-full px-3 py-2 rounded-xl bg-[#090d16] border border-slate-700 text-white" />
          <textarea rows={2} value={schedDesc} onChange={e => setSchedDesc(e.target.value)} placeholder="Descrição..." className="w-full px-3 py-2 rounded-xl bg-[#090d16] border border-slate-700 text-white" />
          <input value={schedTags} onChange={e => setSchedTags(e.target.value)} placeholder="#hashtags" className="w-full px-3 py-2 rounded-xl bg-[#090d16] border border-slate-700 text-white" />
          <button type="submit" disabled={schedBusy} className="px-5 py-2.5 rounded-xl bg-emerald-500 text-black font-black flex items-center gap-1.5 disabled:opacity-50">
            {schedBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Calendar className="w-4 h-4" />}
            {schedBusy ? "Agendando..." : "Confirmar Agendamento"}
          </button>
        </form>
      )}

      {/* Calendar Queue */}
      <section className="bg-[#111827] border border-slate-800 rounded-2xl p-4 sm:p-5 space-y-3">
        <h3 className="text-sm font-extrabold text-white">Fila de Publicações (Auto-Post a cada 60s)</h3>
        {schedules.length === 0 ? (
          <p className="text-xs text-slate-500 py-6 text-center">Nenhum post agendado ainda. Abra um projeto e clique no ícone de calendário de um clipe.</p>
        ) : (
          <div className="space-y-2.5">
            {schedules.map(s => (
              <div key={s.id} className="p-3.5 rounded-xl bg-[#090d16] border border-slate-800 flex flex-wrap items-center justify-between gap-3 text-xs">
                <div className="space-y-0.5">
                  <div className="font-bold text-white">{s.title}</div>
                  <div className="text-[11px] text-slate-400">
                    {s.platform} {s.accountName ? `(${s.accountName})` : ""} • {new Date(s.scheduledAt).toLocaleString("pt-BR")}
                  </div>
                  {s.publishedUrl && (
                    <a href={s.publishedUrl} target="_blank" rel="noreferrer" className="text-[11px] text-emerald-400 underline flex items-center gap-1">
                      <ExternalLink className="w-3 h-3" /> {s.publishedUrl}
                    </a>
                  )}
                  {s.errorMsg && (
                    <div className="text-[11px] text-red-400 flex items-center gap-1"><AlertCircle className="w-3 h-3" /> {s.errorMsg}</div>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-black ${
                    s.status === "PUBLISHED" ? "bg-emerald-500/20 text-emerald-400" : s.status === "FAILED" ? "bg-red-500/20 text-red-400" : "bg-amber-500/20 text-amber-400"
                  }`}>
                    {s.status}
                  </span>
                  {s.status !== "PUBLISHED" && (
                    <button type="button" onClick={() => handlePublishNow(s.id)} className="px-2.5 py-1 rounded-lg bg-purple-600 text-white font-bold flex items-center gap-1">
                      <Send className="w-3 h-3" /> Publicar Agora
                    </button>
                  )}
                  {s.status === "PUBLISHED" && <CheckCircle2 className="w-4 h-4 text-emerald-400" />}
                  {confirmDeleteScheduleId === s.id ? (
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => handleDeleteSchedule(s.id)}
                        className="px-2 py-1 rounded bg-red-600 hover:bg-red-500 text-white text-[10px] font-bold"
                      >
                        Confirmar
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteScheduleId(null)}
                        className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-[10px] font-bold"
                      >
                        Cancelar
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmDeleteScheduleId(s.id)}
                      className="text-slate-500 hover:text-red-400 p-1"
                      title="Excluir agendamento"
                      aria-label={`Excluir agendamento ${s.title}`}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
};
