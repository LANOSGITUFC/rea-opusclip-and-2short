import React, { useEffect, useState } from "react";
import { api, fmtTime, ProjectSummary, Workflow } from "../api";
import { Upload, Link2, Sparkles, Trash2, Film, Loader2, CheckCircle2, AlertCircle, Play } from "lucide-react";

interface Props {
  workflows: Workflow[];
  onOpenProject: (id: string) => void;
}

export const DashboardView: React.FC<Props> = ({ workflows, onOpenProject }) => {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [selectedWorkflow, setSelectedWorkflow] = useState("builtin:long-to-shorts");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const loadProjects = async () => {
    try {
      const r = await api.getProjects();
      setProjects(r.projects);
      setErr("");
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Erro ao carregar projetos.");
    }
  };

  useEffect(() => {
    loadProjects();
  }, []);

  useEffect(() => {
    const hasActive = projects.some(p =>
      ["queued", "downloading", "transcribing", "tracking", "curating"].includes(p.status)
    );
    if (!hasActive) return;
    const t = setInterval(loadProjects, 3000);
    return () => clearInterval(t);
  }, [projects]);

  const handleYoutube = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim()) return;
    setBusy(true);
    setErr("");
    try {
      await api.createYoutubeProject(url.trim(), selectedWorkflow);
      setUrl("");
      await loadProjects();
    } catch (ex: any) {
      setErr(ex.message);
    } finally {
      setBusy(false);
    }
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setErr("");
    try {
      await api.uploadVideoProject(file, selectedWorkflow, file.name);
      await loadProjects();
    } catch (ex: any) {
      setErr(ex.message);
    } finally {
      setBusy(false);
      e.target.value = "";
    }
  };

  const handleDelete = async (id: string, ev: React.MouseEvent) => {
    ev.stopPropagation();
    setDeletingId(id);
    setErr("");
    try {
      await api.deleteProject(id);
      setConfirmDeleteId(null);
      await loadProjects();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Erro ao excluir projeto.");
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="space-y-6 pb-20">
      {/* Ingestion Card */}
      <section className="bg-[#111827] border border-slate-800 rounded-2xl p-4 sm:p-6 space-y-4 shadow-xl">
        <div className="space-y-1">
          <h2 className="text-lg sm:text-xl font-extrabold tracking-tight text-white">
            Transforme vídeos longos em Shorts Virais com IA Real
          </h2>
          <p className="text-xs text-slate-400">
            Baixa via yt-dlp, transcreve palavra por palavra com Whisper, rastreia rostos com OpenCV e renderiza em FFmpeg.
          </p>
        </div>

        <form onSubmit={handleYoutube} className="flex flex-col sm:flex-row gap-2.5">
          <div className="relative flex-1">
            <Link2 className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
            <input
              type="url"
              value={url}
              onChange={e => setUrl(e.target.value)}
              placeholder="Cole um link do YouTube, Twitch ou vídeo..."
              className="w-full pl-10 pr-4 py-2.5 text-sm rounded-xl bg-[#090d16] border border-slate-700 text-white placeholder-slate-500 focus:outline-none focus:border-purple-500"
            />
          </div>
          <button
            type="submit"
            disabled={busy || !url.trim()}
            className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 text-white font-bold text-sm flex items-center justify-center gap-2 hover:opacity-95 disabled:opacity-50 transition shadow-lg shadow-purple-600/20"
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            <span>Gerar Clipes</span>
          </button>
          <label className="px-4 py-2.5 rounded-xl bg-slate-800 border border-slate-700 hover:border-purple-500 text-slate-200 font-semibold text-sm flex items-center justify-center gap-2 cursor-pointer transition">
            <Upload className="w-4 h-4" />
            <span>Enviar MP4</span>
            <input type="file" accept="video/*" className="hidden" onChange={handleUpload} disabled={busy} />
          </label>
        </form>

        {err && (
          <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{err}</span>
          </div>
        )}

        {/* 9 OpusClip Workflows */}
        <div className="space-y-2 pt-2 border-t border-slate-800/80">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
              9 Workflows de Criação (OpusClip Engine)
            </span>
            <span className="text-[11px] text-purple-400 font-mono">{selectedWorkflow}</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {workflows.map(w => {
              const active = w.id === selectedWorkflow;
              return (
                <button
                  key={w.id}
                  type="button"
                  onClick={() => setSelectedWorkflow(w.id)}
                  className={`p-3 rounded-xl border text-left transition flex items-start gap-2.5 ${
                    active
                      ? "border-purple-500 bg-purple-500/15 shadow-md shadow-purple-500/10"
                      : "border-slate-800 bg-[#0d1322] hover:border-slate-700"
                  }`}
                >
                  <span className="text-xl leading-none mt-0.5">{w.icon}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-bold text-white truncate">{w.name}</span>
                      <span className="text-[9px] px-1.5 py-0.5 rounded bg-slate-800 text-purple-300 font-semibold shrink-0">
                        {w.badge}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-400 line-clamp-2 mt-0.5">{w.desc}</p>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </section>

      {/* Projects List */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-white flex items-center gap-2">
            <Film className="w-4 h-4 text-purple-400" />
            Seus Projetos ({projects.length})
          </h3>
        </div>

        {projects.length === 0 ? (
          <div className="bg-[#111827] border border-dashed border-slate-800 rounded-2xl p-10 text-center space-y-2">
            <p className="text-sm font-bold text-slate-300">Nenhum projeto ainda</p>
            <p className="text-xs text-slate-500">
              Cole um link do YouTube ou envie um vídeo MP4 do seu celular acima para iniciar o pipeline real de IA.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
            {projects.map(p => (
              <div
                key={p.id}
                onClick={() => p.status === "ready" && onOpenProject(p.id)}
                className={`bg-[#111827] border border-slate-800 rounded-2xl overflow-hidden flex flex-col justify-between transition ${
                  p.status === "ready" ? "cursor-pointer hover:border-purple-500/60" : ""
                }`}
              >
                <div className="relative aspect-video bg-slate-950 flex items-center justify-center overflow-hidden">
                  {p.status === "ready" || p.progress >= 32 ? (
                    <img
                      src={`/api/projects/${p.id}/thumb`}
                      alt={p.title}
                      onError={e => { (e.target as HTMLImageElement).style.display = "none"; }}
                      className="w-full h-full object-cover"
                    />
                  ) : null}
                  {p.status !== "ready" && p.status !== "error" && (
                    <div className="absolute inset-0 bg-black/75 backdrop-blur-sm flex flex-col items-center justify-center p-4 text-center gap-2">
                      <Loader2 className="w-6 h-6 text-purple-400 animate-spin" />
                      <span className="text-xs font-bold text-white">{p.progress}% — {p.status.toUpperCase()}</span>
                      <span className="text-[11px] text-slate-300 line-clamp-2">{p.progressMsg}</span>
                      <div className="w-full max-w-[200px] h-1.5 bg-slate-800 rounded-full overflow-hidden">
                        <div className="h-full bg-purple-500 transition-all duration-300" style={{ width: `${p.progress}%` }} />
                      </div>
                    </div>
                  )}
                  {p.status === "ready" && (
                    <div className="absolute inset-0 bg-black/30 opacity-0 hover:opacity-100 transition flex items-center justify-center">
                      <span className="px-3 py-1.5 rounded-full bg-purple-600 text-white text-xs font-bold flex items-center gap-1.5 shadow-lg">
                        <Play className="w-3.5 h-3.5 fill-current" /> Abrir Clipes
                      </span>
                    </div>
                  )}
                  {p.duration > 0 && (
                    <span className="absolute bottom-2 right-2 bg-black/80 text-white text-[10px] font-mono px-1.5 py-0.5 rounded">
                      {fmtTime(p.duration)}
                    </span>
                  )}
                </div>

                <div className="p-3.5 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <h4 className="text-xs font-bold text-white line-clamp-2">{p.title}</h4>
                    {confirmDeleteId === p.id ? (
                      <div className="flex items-center gap-1 shrink-0" onClick={ev => ev.stopPropagation()}>
                        <button
                          onClick={ev => handleDelete(p.id, ev)}
                          disabled={deletingId === p.id}
                          className="px-2 py-1 rounded bg-red-600 hover:bg-red-500 text-white text-[10px] font-bold disabled:opacity-50"
                        >
                          {deletingId === p.id ? "..." : "Confirmar"}
                        </button>
                        <button
                          onClick={ev => { ev.stopPropagation(); setConfirmDeleteId(null); }}
                          className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-[10px] font-bold"
                        >
                          Cancelar
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={ev => { ev.stopPropagation(); setConfirmDeleteId(p.id); }}
                        className="text-slate-500 hover:text-red-400 p-1 rounded shrink-0"
                        title="Excluir projeto"
                        aria-label={`Excluir projeto ${p.title}`}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>

                  {p.status === "error" && (
                    <p className="text-[11px] text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg p-2 line-clamp-3">
                      {p.errorMsg || p.progressMsg}
                    </p>
                  )}

                  <div className="flex items-center justify-between text-[11px] text-slate-400 pt-1 border-t border-slate-800/80">
                    <span className="flex items-center gap-1">
                      {p.status === "ready" ? (
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                      ) : p.status === "error" ? (
                        <AlertCircle className="w-3.5 h-3.5 text-red-400" />
                      ) : (
                        <Loader2 className="w-3.5 h-3.5 text-purple-400 animate-spin" />
                      )}
                      {p.status === "ready" ? `${p.clipCount || 0} clipes prontos` : p.status}
                    </span>
                    <span className="font-mono text-[10px] text-slate-500">{p.workflowId.replace("builtin:", "")}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
};
