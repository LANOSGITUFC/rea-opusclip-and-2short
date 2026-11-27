import React, { useEffect, useState } from "react";
import { api, BrandKit, CaptionPreset, Clip, Workflow } from "./api";
import { DashboardView } from "./components/DashboardView";
import { ProjectView } from "./components/ProjectView";
import { EditorView } from "./components/EditorView";
import { SocialView } from "./components/SocialView";
import { BrandKitsView } from "./components/BrandKitsView";
import { SettingsView } from "./components/SettingsView";
import { Film, Calendar, Palette, Settings, Zap, AlertCircle, RefreshCw, Loader2 } from "lucide-react";

type Route =
  | { name: "dashboard" }
  | { name: "project"; projectId: string }
  | { name: "editor"; clipId: string; projectId: string }
  | { name: "social"; clip?: Clip | null }
  | { name: "brandkits" }
  | { name: "settings" };

function getInitialRoute(): Route {
  if (typeof window !== "undefined" && new URLSearchParams(window.location.search).has("oauth")) {
    return { name: "social" };
  }
  return { name: "dashboard" };
}

export default function App() {
  const [route, setRoute] = useState<Route>(getInitialRoute);
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [presets, setPresets] = useState<CaptionPreset[]>([]);
  const [brandKits, setBrandKits] = useState<BrandKit[]>([]);
  const [globalsLoading, setGlobalsLoading] = useState(true);
  const [globalsErr, setGlobalsErr] = useState<string | null>(null);

  const loadGlobals = async () => {
    setGlobalsLoading(true);
    setGlobalsErr(null);
    try {
      const [wf, pr, bk] = await Promise.all([api.getWorkflows(), api.getPresets(), api.getBrandKits()]);
      setWorkflows(wf.workflows);
      setPresets(pr.presets);
      setBrandKits(bk.kits);
    } catch (e: unknown) {
      setGlobalsErr(e instanceof Error ? e.message : "Erro ao carregar configurações iniciais.");
    } finally {
      setGlobalsLoading(false);
    }
  };

  useEffect(() => {
    loadGlobals();
  }, []);

  return (
    <div className="min-h-screen bg-[#090d16] text-slate-100 flex flex-col">
      {/* Sticky Top Header */}
      <header className="sticky top-0 z-40 bg-[#0d1322]/95 backdrop-blur border-b border-slate-800/80 px-4 py-3">
        <div className="max-w-6xl mx-auto flex items-center justify-between gap-3">
          <button
            onClick={() => setRoute({ name: "dashboard" })}
            className="flex items-center gap-2.5 text-left"
            aria-label="Ir para o Dashboard"
            title="Opus2Short Studio — Projetos"
          >
            <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-purple-600 via-pink-500 to-amber-400 flex items-center justify-center text-white shadow-lg shadow-purple-500/20">
              <Zap className="w-4 h-4 fill-current" />
            </div>
            <div>
              <h1 className="text-sm font-black tracking-tight text-white leading-none">Opus2Short Studio</h1>
              <span className="text-[10px] text-emerald-400 font-semibold">Full-Stack AI Engine • FFmpeg + Whisper</span>
            </div>
          </button>

          <nav className="flex items-center gap-1.5 overflow-x-auto no-scrollbar text-xs font-bold" aria-label="Navegação principal">
            {[
              { id: "dashboard", label: "Projetos", icon: Film },
              { id: "social", label: "PlanSocial", icon: Calendar },
              { id: "brandkits", label: "Brand Kits", icon: Palette },
              { id: "settings", label: "API Keys", icon: Settings }
            ].map(item => {
              const active = route.name === item.id || (item.id === "dashboard" && (route.name === "project" || route.name === "editor"));
              return (
                <button
                  key={item.id}
                  onClick={() => setRoute({ name: item.id } as Route)}
                  aria-label={item.label}
                  title={item.label}
                  aria-current={active ? "page" : undefined}
                  className={`px-3 py-2 rounded-xl flex items-center gap-1.5 whitespace-nowrap transition ${
                    active ? "bg-purple-600 text-white shadow" : "text-slate-400 hover:bg-slate-800 hover:text-white"
                  }`}
                >
                  <item.icon className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">{item.label}</span>
                </button>
              );
            })}
          </nav>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 max-w-6xl w-full mx-auto px-3.5 sm:px-6 pt-5">
        {globalsErr && (
          <div className="mb-4 p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-300 text-xs flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
              <span>Falha ao carregar dados iniciais: {globalsErr}</span>
            </div>
            <button
              onClick={loadGlobals}
              disabled={globalsLoading}
              className="px-3 py-1.5 rounded-lg bg-red-500/20 hover:bg-red-500/30 border border-red-500/40 text-red-200 font-bold flex items-center gap-1.5 shrink-0 disabled:opacity-50"
            >
              {globalsLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
              Tentar novamente
            </button>
          </div>
        )}
        {route.name === "dashboard" && (
          <DashboardView
            workflows={workflows}
            onOpenProject={projectId => setRoute({ name: "project", projectId })}
          />
        )}
        {route.name === "project" && (
          <ProjectView
            projectId={route.projectId}
            onBack={() => setRoute({ name: "dashboard" })}
            onEditClip={clipId => setRoute({ name: "editor", clipId, projectId: route.projectId })}
            onScheduleClip={clip => setRoute({ name: "social", clip })}
          />
        )}
        {route.name === "editor" && (
          <EditorView
            clipId={route.clipId}
            presets={presets}
            brandKits={brandKits}
            onBack={() => setRoute({ name: "project", projectId: route.projectId })}
          />
        )}
        {route.name === "social" && <SocialView preselectedClip={route.clip} />}
        {route.name === "brandkits" && (
          <BrandKitsView kits={brandKits} presets={presets} onRefresh={loadGlobals} />
        )}
        {route.name === "settings" && <SettingsView />}
      </main>
    </div>
  );
}
