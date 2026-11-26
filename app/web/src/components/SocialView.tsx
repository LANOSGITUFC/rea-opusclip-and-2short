import React, { useEffect, useState } from "react";
import { api, Clip, PublishSchedule, SocialAccount } from "../api";
import { Calendar, Plus, Trash2, Sparkles, Send, CheckCircle2, AlertCircle } from "lucide-react";

const PLATFORMS = [
  { id: "YOUTUBE", label: "YouTube Shorts", color: "text-red-400" },
  { id: "TIKTOK_BUSINESS", label: "TikTok", color: "text-cyan-400" },
  { id: "INSTAGRAM_BUSINESS", label: "Instagram Reels", color: "text-pink-400" },
  { id: "FACEBOOK", label: "Facebook Reels", color: "text-blue-400" },
  { id: "LINKEDIN", label: "LinkedIn Video", color: "text-sky-400" },
  { id: "TWITTER", label: "X / Twitter", color: "text-slate-200" },
  { id: "THREADS", label: "Meta Threads", color: "text-slate-300" }
];

interface Props {
  preselectedClip?: Clip | null;
}

export const SocialView: React.FC<Props> = ({ preselectedClip }) => {
  const [accounts, setAccounts] = useState<SocialAccount[]>([]);
  const [schedules, setSchedules] = useState<PublishSchedule[]>([]);

  // Connect form
  const [platform, setPlatform] = useState("YOUTUBE");
  const [accountName, setAccountName] = useState("");
  const [handle, setHandle] = useState("");
  const [accessToken, setAccessToken] = useState("");

  // Schedule form
  const [schedAccountId, setSchedAccountId] = useState("");
  const [schedTitle, setSchedTitle] = useState(preselectedClip?.title || "");
  const [schedDesc, setSchedDesc] = useState(preselectedClip?.description || "");
  const [schedTags, setSchedTags] = useState(preselectedClip?.hashtags || "");
  const [schedTime, setSchedTime] = useState(new Date(Date.now() + 3600_000).toISOString().slice(0, 16));
  const [copyBusy, setCopyBusy] = useState(false);

  const load = async () => {
    const [a, s] = await Promise.all([api.getSocialAccounts(), api.getSchedules()]);
    setAccounts(a.accounts);
    setSchedules(s.schedules);
    if (!schedAccountId && a.accounts.length > 0) setSchedAccountId(a.accounts[0].id);
  };

  useEffect(() => {
    load();
  }, []);

  const handleConnect = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!accountName.trim()) return;
    await api.connectSocialAccount({ platform, accountName, handle, accessToken });
    setAccountName("");
    setHandle("");
    setAccessToken("");
    await load();
  };

  const handleGenCopy = async () => {
    if (!preselectedClip) return;
    setCopyBusy(true);
    try {
      const acc = accounts.find(a => a.id === schedAccountId);
      const r = await api.generateSocialCopy(preselectedClip.id, acc?.platform || "YOUTUBE");
      setSchedTitle(r.copy.title);
      setSchedDesc(r.copy.description);
      setSchedTags(r.copy.hashtags);
    } finally {
      setCopyBusy(false);
    }
  };

  const handleSchedule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!preselectedClip) return;
    const acc = accounts.find(a => a.id === schedAccountId);
    await api.createSchedule({
      clipId: preselectedClip.id,
      accountId: schedAccountId,
      platform: acc?.platform || "YOUTUBE",
      title: schedTitle,
      description: schedDesc,
      hashtags: schedTags,
      scheduledAt: new Date(schedTime).toISOString()
    });
    await load();
  };

  return (
    <div className="space-y-6 pb-20">
      {/* Connected Accounts */}
      <section className="bg-[#111827] border border-slate-800 rounded-2xl p-4 sm:p-5 space-y-4">
        <h2 className="text-base font-extrabold text-white">Contas Sociais Conectadas (7 Plataformas)</h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
          {accounts.map(a => (
            <div key={a.id} className="p-3 rounded-xl bg-[#090d16] border border-slate-800 flex items-center justify-between text-xs">
              <div>
                <div className="font-bold text-white">{a.accountName}</div>
                <div className="text-[11px] text-slate-400">{a.platform} {a.handle ? `• ${a.handle}` : ""}</div>
              </div>
              <button onClick={async () => { await api.deleteSocialAccount(a.id); load(); }} className="text-slate-500 hover:text-red-400 p-1">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>

        <form onSubmit={handleConnect} className="grid grid-cols-1 sm:grid-cols-5 gap-2 pt-2 border-t border-slate-800 text-xs">
          <select value={platform} onChange={e => setPlatform(e.target.value)} className="px-3 py-2 rounded-xl bg-[#090d16] border border-slate-700 text-white">
            {PLATFORMS.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
          <input value={accountName} onChange={e => setAccountName(e.target.value)} placeholder="Nome da conta" className="px-3 py-2 rounded-xl bg-[#090d16] border border-slate-700 text-white" />
          <input value={handle} onChange={e => setHandle(e.target.value)} placeholder="@arroba (opcional)" className="px-3 py-2 rounded-xl bg-[#090d16] border border-slate-700 text-white" />
          <input value={accessToken} onChange={e => setAccessToken(e.target.value)} placeholder="OAuth Access Token" type="password" className="px-3 py-2 rounded-xl bg-[#090d16] border border-slate-700 text-white" />
          <button type="submit" className="px-3 py-2 rounded-xl bg-purple-600 text-white font-bold flex items-center justify-center gap-1">
            <Plus className="w-3.5 h-3.5" /> Conectar
          </button>
        </form>
      </section>

      {/* Schedule Creator (when a clip is selected) */}
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
              <option value="">Selecione a conta...</option>
              {accounts.map(a => <option key={a.id} value={a.id}>{a.platform} — {a.accountName}</option>)}
            </select>
            <input type="datetime-local" value={schedTime} onChange={e => setSchedTime(e.target.value)} className="px-3 py-2 rounded-xl bg-[#090d16] border border-slate-700 text-white" />
          </div>
          <input value={schedTitle} onChange={e => setSchedTitle(e.target.value)} placeholder="Título da postagem" className="w-full px-3 py-2 rounded-xl bg-[#090d16] border border-slate-700 text-white" />
          <textarea rows={2} value={schedDesc} onChange={e => setSchedDesc(e.target.value)} placeholder="Descrição..." className="w-full px-3 py-2 rounded-xl bg-[#090d16] border border-slate-700 text-white" />
          <input value={schedTags} onChange={e => setSchedTags(e.target.value)} placeholder="#hashtags" className="w-full px-3 py-2 rounded-xl bg-[#090d16] border border-slate-700 text-white" />
          <button type="submit" className="px-5 py-2.5 rounded-xl bg-emerald-500 text-black font-black flex items-center gap-1.5">
            <Calendar className="w-4 h-4" /> Confirmar Agendamento
          </button>
        </form>
      )}

      {/* Calendar Queue */}
      <section className="bg-[#111827] border border-slate-800 rounded-2xl p-4 sm:p-5 space-y-3">
        <h3 className="text-sm font-extrabold text-white">Fila de Publicações (PlanSocial)</h3>
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
                    <button onClick={async () => { await api.publishNow(s.id); load(); }} className="px-2.5 py-1 rounded-lg bg-purple-600 text-white font-bold flex items-center gap-1">
                      <Send className="w-3 h-3" /> Publicar Agora
                    </button>
                  )}
                  {s.status === "PUBLISHED" && <CheckCircle2 className="w-4 h-4 text-emerald-400" />}
                  <button onClick={async () => { await api.deleteSchedule(s.id); load(); }} className="text-slate-500 hover:text-red-400 p-1">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
};
