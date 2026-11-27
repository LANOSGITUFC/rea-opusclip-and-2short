import React, { useEffect, useState } from "react";
import { api, Clip, fmtTime, ProjectSummary } from "../api";
import { ArrowLeft, Heart, Scissors, Calendar, MessageSquare, Send, Sparkles, Loader2, Download, AlertCircle, RefreshCw } from "lucide-react";

interface Props {
  projectId: string;
  onBack: () => void;
  onEditClip: (clipId: string) => void;
  onScheduleClip: (clip: Clip) => void;
}

export const ProjectView: React.FC<Props> = ({ projectId, onBack, onEditClip, onScheduleClip }) => {
  const [project, setProject] = useState<ProjectSummary | null>(null);
  const [clips, setClips] = useState<Clip[]>([]);
  const [tab, setTab] = useState<"clips" | "chat">("clips");
  const [sort, setSort] = useState<"score" | "order" | "short">("score");
  const [search, setSearch] = useState("");

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [actionErr, setActionErr] = useState<string | null>(null);

  // Project Chat state
  const [messages, setMessages] = useState<Array<{ id: string; role: "user" | "assistant"; content: string }>>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    setErr(null);
    try {
      const [r, ch] = await Promise.all([
        api.getProject(projectId),
        api.getProjectChat(projectId)
      ]);
      setProject(r.project);
      setClips(r.clips);
      setMessages(ch.messages);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Erro ao carregar projeto.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [projectId]);

  const toggleLike = async (c: Clip) => {
    setActionErr(null);
    try {
      const r = await api.updateClip(c.id, { liked: !c.liked });
      setClips(prev => prev.map(x => (x.id === c.id ? r.clip : x)));
    } catch (e: unknown) {
      setActionErr(e instanceof Error ? e.message : "Erro ao atualizar favorito.");
    }
  };

  const sendChat = async (text: string) => {
    if (!text.trim() || chatLoading) return;
    setChatLoading(true);
    setActionErr(null);
    const tmpId = `tmp-${Date.now()}`;
    setMessages(prev => [...prev, { id: tmpId, role: "user", content: text }]);
    setChatInput("");
    try {
      const r = await api.sendProjectChat(projectId, text);
      setMessages(prev => [...prev, r.reply]);
    } catch (e: unknown) {
      setMessages(prev => prev.filter(m => m.id !== tmpId));
      setActionErr(e instanceof Error ? e.message : "Erro ao enviar mensagem para o Copiloto.");
    } finally {
      setChatLoading(false);
    }
  };

  const filteredClips = clips
    .filter(c => !search || c.title.toLowerCase().includes(search.toLowerCase()) || c.description.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => {
      if (sort === "order") return a.startSec - b.startSec;
      if (sort === "short") return (a.endSec - a.startSec) - (b.endSec - b.startSec);
      return b.viralityScore - a.viralityScore;
    });

  if (loading && !project) {
    return (
      <div className="py-16 flex justify-center">
        <Loader2 className="w-6 h-6 text-purple-400 animate-spin" />
      </div>
    );
  }

  if (err && !project) {
    return (
      <div className="max-w-md mx-auto my-12 bg-[#111827] border border-red-500/30 rounded-2xl p-6 text-center space-y-4">
        <AlertCircle className="w-8 h-8 text-red-400 mx-auto" />
        <div className="space-y-1">
          <h3 className="text-sm font-bold text-white">Não foi possível carregar o projeto</h3>
          <p className="text-xs text-red-300">{err}</p>
        </div>
        <div className="flex items-center justify-center gap-2">
          <button
            onClick={onBack}
            className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold flex items-center gap-1.5"
          >
            <ArrowLeft className="w-3.5 h-3.5" /> Voltar
          </button>
          <button
            onClick={load}
            className="px-4 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold flex items-center gap-1.5"
          >
            <RefreshCw className="w-3.5 h-3.5" /> Tentar novamente
          </button>
        </div>
      </div>
    );
  }

  if (!project) return null;

  return (
    <div className="space-y-4 pb-20">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-[#111827] border border-slate-800 rounded-2xl p-4">
        <div className="flex items-center gap-3 min-w-0">
          <button onClick={onBack} className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-white">
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div className="min-w-0">
            <h2 className="text-sm sm:text-base font-extrabold text-white truncate">{project.title}</h2>
            <p className="text-[11px] text-slate-400">
              {fmtTime(project.duration)} • {project.width}x{project.height} • {clips.length} clipes gerados
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setTab("clips")}
            className={`px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 ${
              tab === "clips" ? "bg-purple-600 text-white" : "bg-slate-800 text-slate-300"
            }`}
          >
            <Scissors className="w-3.5 h-3.5" /> Biblioteca ({clips.length})
          </button>
          <button
            onClick={() => setTab("chat")}
            className={`px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 ${
              tab === "chat" ? "bg-purple-600 text-white" : "bg-slate-800 text-slate-300"
            }`}
          >
            <MessageSquare className="w-3.5 h-3.5" /> Project Chat IA
          </button>
        </div>
      </div>

      {actionErr && (
        <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 text-xs flex items-center justify-between gap-2">
          <span className="flex items-center gap-2"><AlertCircle className="w-4 h-4 shrink-0" /> {actionErr}</span>
          <button onClick={() => setActionErr(null)} className="text-slate-400 hover:text-white text-xs">✕</button>
        </div>
      )}

      {tab === "clips" ? (
        <>
          <div className="flex flex-wrap gap-2 items-center justify-between">
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Buscar clipes..."
              className="flex-1 min-w-[180px] px-3.5 py-2 text-xs rounded-xl bg-[#111827] border border-slate-800 text-white focus:outline-none focus:border-purple-500"
            />
            <select
              value={sort}
              onChange={e => setSort(e.target.value as any)}
              className="px-3 py-2 text-xs rounded-xl bg-[#111827] border border-slate-800 text-white"
            >
              <option value="score">Maior Virality Score</option>
              <option value="order">Ordem no Vídeo</option>
              <option value="short">Mais Curtos Primeiro</option>
            </select>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredClips.map(c => (
              <div key={c.id} className="bg-[#111827] border border-slate-800 rounded-2xl p-4 flex flex-col justify-between space-y-3">
                <div className="space-y-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <span className={`px-2.5 py-1 rounded-full text-xs font-black ${
                      c.viralityScore >= 85 ? "bg-emerald-500 text-black" : "bg-amber-400 text-black"
                    }`}>
                      SCORE {c.viralityScore}/100
                    </span>
                    <div className="flex items-center gap-1.5">
                      <span className="text-[11px] font-mono text-slate-400 bg-slate-900 px-2 py-0.5 rounded">
                        {fmtTime(c.startSec)} → {fmtTime(c.endSec)} ({Math.round(c.endSec - c.startSec)}s)
                      </span>
                      <button onClick={() => toggleLike(c)} className={`p-1.5 rounded-lg ${c.liked ? "text-pink-500 bg-pink-500/10" : "text-slate-500 hover:text-white"}`}>
                        <Heart className={`w-4 h-4 ${c.liked ? "fill-current" : ""}`} />
                      </button>
                    </div>
                  </div>

                  <h3 className="text-sm font-bold text-white leading-snug">{c.title}</h3>
                  <p className="text-xs text-slate-400 line-clamp-3">{c.reason || c.description}</p>

                  {/* Sub-scores */}
                  <div className="grid grid-cols-3 gap-1.5 text-[10px] text-center">
                    <div className="bg-slate-900/90 rounded-lg p-1.5 border border-slate-800">
                      <div className="text-slate-400">Hook</div>
                      <div className="font-bold text-emerald-400">{c.hookScore}</div>
                    </div>
                    <div className="bg-slate-900/90 rounded-lg p-1.5 border border-slate-800">
                      <div className="text-slate-400">Ritmo</div>
                      <div className="font-bold text-purple-400">{c.pacingScore}</div>
                    </div>
                    <div className="bg-slate-900/90 rounded-lg p-1.5 border border-slate-800">
                      <div className="text-slate-400">História</div>
                      <div className="font-bold text-sky-400">{c.storyScore}</div>
                    </div>
                  </div>

                  {c.hashtags && <p className="text-[11px] text-purple-400 font-medium truncate">{c.hashtags}</p>}
                </div>

                <div className="flex gap-2 pt-2 border-t border-slate-800/80">
                  <button
                    onClick={() => onEditClip(c.id)}
                    className="flex-1 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold flex items-center justify-center gap-1.5"
                  >
                    <Scissors className="w-3.5 h-3.5" /> Abrir no Editor
                  </button>
                  <button
                    onClick={() => onScheduleClip(c)}
                    className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold flex items-center gap-1"
                    title="Agendar no PlanSocial"
                  >
                    <Calendar className="w-3.5 h-3.5" />
                  </button>
                  {c.exportStatus === "done" && (
                    <a
                      href={`/api/clips/${c.id}/download`}
                      className="px-3 py-2 rounded-xl bg-emerald-500/20 border border-emerald-500/40 text-emerald-400 text-xs font-bold flex items-center"
                      title="Baixar MP4 renderizado"
                    >
                      <Download className="w-3.5 h-3.5" />
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>
        </>
      ) : (
        /* 2Short.ai Project Chat Copilot */
        <div className="bg-[#111827] border border-slate-800 rounded-2xl p-4 space-y-4">
          <div className="flex flex-wrap gap-2">
            {[
              "Encontre momentos engraçados ou de maior tensão neste vídeo",
              "Gere 10 títulos virais de alto CTR para este vídeo",
              "Escreva uma descrição completa otimizada para YouTube e TikTok",
              "Crie capítulos com minutagem para o vídeo completo"
            ].map(prompt => (
              <button
                key={prompt}
                onClick={() => sendChat(prompt)}
                className="px-3 py-1.5 rounded-full bg-slate-800 hover:bg-purple-600/30 border border-slate-700 text-xs text-slate-200 flex items-center gap-1.5 transition"
              >
                <Sparkles className="w-3 h-3 text-purple-400" /> {prompt}
              </button>
            ))}
          </div>

          <div className="h-[340px] overflow-y-auto space-y-3 p-3 bg-[#090d16] rounded-xl border border-slate-800">
            {messages.length === 0 ? (
              <p className="text-xs text-slate-500 text-center mt-24">
                Pergunte qualquer coisa sobre o vídeo "{project.title}" ou toque em uma ação rápida acima.
              </p>
            ) : (
              messages.map(m => (
                <div key={m.id} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-xs whitespace-pre-wrap leading-relaxed ${
                    m.role === "user" ? "bg-purple-600 text-white" : "bg-slate-800 text-slate-100 border border-slate-700"
                  }`}>
                    {m.content}
                  </div>
                </div>
              ))
            )}
            {chatLoading && (
              <div className="flex items-center gap-2 text-xs text-purple-400">
                <Loader2 className="w-4 h-4 animate-spin" /> Pensando com base na transcrição...
              </div>
            )}
          </div>

          <form
            onSubmit={e => { e.preventDefault(); sendChat(chatInput); }}
            className="flex gap-2"
          >
            <input
              value={chatInput}
              onChange={e => setChatInput(e.target.value)}
              placeholder="Pergunte ao Copiloto sobre este vídeo..."
              className="flex-1 px-3.5 py-2.5 text-xs rounded-xl bg-[#090d16] border border-slate-700 text-white focus:outline-none focus:border-purple-500"
            />
            <button
              type="submit"
              disabled={chatLoading || !chatInput.trim()}
              className="px-4 py-2.5 rounded-xl bg-purple-600 text-white font-bold text-xs flex items-center gap-1.5 disabled:opacity-50"
            >
              <Send className="w-3.5 h-3.5" /> Enviar
            </button>
          </form>
        </div>
      )}
    </div>
  );
};
