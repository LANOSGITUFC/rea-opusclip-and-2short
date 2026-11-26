import React, { useEffect, useState } from "react";
import { api, BrandKit, CaptionPreset, Clip, Workflow } from "./api";
import { DashboardView } from "./components/DashboardView";
import { ProjectView } from "./components/ProjectView";
import { EditorView } from "./components/EditorView";
import { SocialView } from "./components/SocialView";
import { BrandKitsView } from "./components/BrandKitsView";
import { SettingsView } from "./components/SettingsView";
import { Film, Calendar, Palette, Settings, Zap } from "lucide-react";

type Route =
  | { name: "dashboard" }
  | { name: "project"; projectId: string }
  | { name: "editor"; clipId: string; projectId: string }
  | { name: "social"; clip?: Clip | null }
  | { name: "brandkits" }
  | { name: "settings" };

export default function App() {
  const [route, setRoute] = useState<Route>({ name: "dashboard" });
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [presets, setPresets] = useState<CaptionPreset[]>([]);
  const [brandKits, setBrandKits] = useState<BrandKit[]>([]);

  const loadGlobals = async () => {
    const [wf, pr, bk] = await Promise.all([api.getWorkflows(), api.getPresets(), api.getBrandKits()]);
    setWorkflows(wf.workflows);
    setPresets(pr.presets);
    setBrandKits(bk.kits);
  };

  useEffect(() => {
    loadGlobals();
  }, []);

  return (
    <div className="min-h-screen bg-[#090d16] text-slate-100 flex flex-col">
      {/* Sticky Top Header */}
      <header className="sticky top-0 z-40 bg-[#0d1322]/95 backdrop-blur border-b border-slate-800/80 px-4 py-3">
        <div className="max-w-6xl mx-auto flex items-center justify-between gap-3">
          <button onClick={() => setRoute({ name: "dashboard" })} className="flex items-center gap-2.5 text-left">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-purple-600 via-pink-500 to-amber-400 flex items-center justify-center text-white shadow-lg shadow-purple-500/20">
              <Zap className="w-4 h-4 fill-current" />
            </div>
            <div>
              <h1 className="text-sm font-black tracking-tight text-white leading-none">Opus2Short Studio</h1>
              <span className="text-[10px] text-emerald-400 font-semibold">Full-Stack AI Engine • FFmpeg + Whisper</span>
            </div>
          </button>

          <nav className="flex items-center gap-1.5 overflow-x-auto no-scrollbar text-xs font-bold">
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
