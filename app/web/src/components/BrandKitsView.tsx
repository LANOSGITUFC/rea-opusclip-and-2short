import React, { useState } from "react";
import { api, BrandKit, CaptionPreset } from "../api";
import { Plus, Trash2, Upload } from "lucide-react";

interface Props {
  kits: BrandKit[];
  presets: CaptionPreset[];
  onRefresh: () => void;
}

export const BrandKitsView: React.FC<Props> = ({ kits, presets, onRefresh }) => {
  const [name, setName] = useState("");
  const [primaryColor, setPrimaryColor] = useState("#0169EE");
  const [highlightColor, setHighlightColor] = useState("#04F827");
  const [defaultPreset, setDefaultPreset] = useState("karaoke");
  const [logoFile, setLogoFile] = useState<File | null>(null);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    const fd = new FormData();
    fd.append("name", name.trim());
    fd.append("primaryColor", primaryColor);
    fd.append("highlightColor", highlightColor);
    fd.append("defaultPreset", defaultPreset);
    if (logoFile) fd.append("logo", logoFile);
    await api.createBrandKit(fd);
    setName("");
    setLogoFile(null);
    onRefresh();
  };

  return (
    <div className="space-y-6 pb-20">
      <form onSubmit={handleCreate} className="bg-[#111827] border border-slate-800 rounded-2xl p-5 space-y-4 text-xs">
        <h2 className="text-base font-extrabold text-white">Novo Brand Kit (Logo + Cores + Legenda Padrão)</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <input value={name} onChange={e => setName(e.target.value)} placeholder="Nome do Brand Kit (ex: Meu Canal)" className="px-3.5 py-2.5 rounded-xl bg-[#090d16] border border-slate-700 text-white" />
          <select value={defaultPreset} onChange={e => setDefaultPreset(e.target.value)} className="px-3.5 py-2.5 rounded-xl bg-[#090d16] border border-slate-700 text-white">
            {presets.map(p => <option key={p.id} value={p.id}>{p.name} ({p.source})</option>)}
          </select>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-center">
          <label className="flex items-center justify-between p-2.5 rounded-xl bg-[#090d16] border border-slate-700">
            <span>Cor Primária</span>
            <input type="color" value={primaryColor} onChange={e => setPrimaryColor(e.target.value)} className="w-8 h-7 bg-transparent cursor-pointer" />
          </label>
          <label className="flex items-center justify-between p-2.5 rounded-xl bg-[#090d16] border border-slate-700">
            <span>Destaque Legenda</span>
            <input type="color" value={highlightColor} onChange={e => setHighlightColor(e.target.value)} className="w-8 h-7 bg-transparent cursor-pointer" />
          </label>
          <label className="flex items-center justify-center gap-2 p-2.5 rounded-xl bg-slate-800 border border-slate-700 cursor-pointer hover:border-purple-500">
            <Upload className="w-4 h-4" />
            <span className="truncate">{logoFile ? logoFile.name : "Logo PNG/WebP"}</span>
            <input type="file" accept="image/*" className="hidden" onChange={e => setLogoFile(e.target.files?.[0] || null)} />
          </label>
        </div>

        <button type="submit" className="px-5 py-2.5 rounded-xl bg-purple-600 text-white font-bold flex items-center gap-1.5">
          <Plus className="w-4 h-4" /> Salvar Brand Kit
        </button>
      </form>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
        {kits.map(k => (
          <div key={k.id} className="bg-[#111827] border border-slate-800 rounded-2xl p-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              {k.logoPath ? (
                <img src={`/api/brand-kits/${k.id}/logo`} alt={k.name} className="w-11 h-11 rounded-xl object-contain bg-slate-900 p-1 border border-slate-800" />
              ) : (
                <div className="w-11 h-11 rounded-xl flex items-center justify-center font-black text-white" style={{ backgroundColor: k.primaryColor }}>
                  {k.name[0]?.toUpperCase()}
                </div>
              )}
              <div>
                <h4 className="text-sm font-bold text-white">{k.name}</h4>
                <div className="flex items-center gap-1.5 mt-1">
                  <span className="w-3.5 h-3.5 rounded-full border border-white/20" style={{ backgroundColor: k.primaryColor }} />
                  <span className="w-3.5 h-3.5 rounded-full border border-white/20" style={{ backgroundColor: k.highlightColor }} />
                  <span className="text-[10px] text-slate-400 font-mono">{k.defaultPreset}</span>
                </div>
              </div>
            </div>
            <button onClick={async () => { await api.deleteBrandKit(k.id); onRefresh(); }} className="text-slate-500 hover:text-red-400 p-2">
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
};
