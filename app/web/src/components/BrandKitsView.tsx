import React, { useRef, useState } from "react";
import { api, BrandKit, CaptionPreset } from "../api";
import { Plus, Trash2, Upload, AlertCircle, Loader2, Palette } from "lucide-react";

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
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const logoInputRef = useRef<HTMLInputElement | null>(null);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || busy) return;
    setBusy(true);
    setErr(null);
    try {
      const fd = new FormData();
      fd.append("name", name.trim());
      fd.append("primaryColor", primaryColor);
      fd.append("highlightColor", highlightColor);
      fd.append("defaultPreset", defaultPreset);
      if (logoFile) fd.append("logo", logoFile);
      await api.createBrandKit(fd);
      setName("");
      setLogoFile(null);
      if (logoInputRef.current) logoInputRef.current.value = "";
      onRefresh();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Erro ao criar Brand Kit.");
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (id: string) => {
    setDeletingId(id);
    setErr(null);
    try {
      await api.deleteBrandKit(id);
      setConfirmDeleteId(null);
      onRefresh();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Erro ao excluir Brand Kit.");
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="space-y-6 pb-20">
      <form onSubmit={handleCreate} className="bg-[#111827] border border-slate-800 rounded-2xl p-5 space-y-4 text-xs">
        <h2 className="text-base font-extrabold text-white">Novo Brand Kit (Logo + Cores + Legenda Padrão)</h2>

        {err && (
          <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 text-xs flex items-center justify-between gap-2">
            <span className="flex items-center gap-2"><AlertCircle className="w-4 h-4 shrink-0" /> {err}</span>
            <button type="button" onClick={() => setErr(null)} className="text-slate-400 hover:text-white">✕</button>
          </div>
        )}

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
            <input
              ref={logoInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={e => setLogoFile(e.target.files?.[0] || null)}
            />
          </label>
        </div>

        <button
          type="submit"
          disabled={busy || !name.trim()}
          className="px-5 py-2.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-bold flex items-center gap-1.5 disabled:opacity-50"
        >
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
          {busy ? "Salvando..." : "Salvar Brand Kit"}
        </button>
      </form>

      {kits.length === 0 ? (
        <div className="bg-[#111827] border border-dashed border-slate-800 rounded-2xl p-10 text-center space-y-2">
          <Palette className="w-8 h-8 text-slate-600 mx-auto" />
          <p className="text-sm font-bold text-slate-300">Nenhum Brand Kit cadastrado</p>
          <p className="text-xs text-slate-500">
            Crie um Brand Kit acima para aplicar seu logotipo e cores padrão automaticamente nos clipes.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
          {kits.map(k => (
            <div key={k.id} className="bg-[#111827] border border-slate-800 rounded-2xl p-4 flex items-center justify-between gap-2">
              <div className="flex items-center gap-3 min-w-0">
                {k.logoPath ? (
                  <img src={`/api/brand-kits/${k.id}/logo`} alt={k.name} className="w-11 h-11 rounded-xl object-contain bg-slate-900 p-1 border border-slate-800 shrink-0" />
                ) : (
                  <div className="w-11 h-11 rounded-xl flex items-center justify-center font-black text-white shrink-0" style={{ backgroundColor: k.primaryColor }}>
                    {k.name[0]?.toUpperCase()}
                  </div>
                )}
                <div className="min-w-0">
                  <h4 className="text-sm font-bold text-white truncate">{k.name}</h4>
                  <div className="flex items-center gap-1.5 mt-1">
                    <span className="w-3.5 h-3.5 rounded-full border border-white/20 shrink-0" style={{ backgroundColor: k.primaryColor }} />
                    <span className="w-3.5 h-3.5 rounded-full border border-white/20 shrink-0" style={{ backgroundColor: k.highlightColor }} />
                    <span className="text-[10px] text-slate-400 font-mono truncate">{k.defaultPreset}</span>
                  </div>
                </div>
              </div>
              {confirmDeleteId === k.id ? (
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    disabled={deletingId === k.id}
                    onClick={() => handleDelete(k.id)}
                    className="px-2 py-1 rounded bg-red-600 hover:bg-red-500 text-white text-[10px] font-bold disabled:opacity-50"
                  >
                    {deletingId === k.id ? "..." : "Confirmar"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmDeleteId(null)}
                    className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-[10px] font-bold"
                  >
                    Cancelar
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmDeleteId(k.id)}
                  className="text-slate-500 hover:text-red-400 p-2 shrink-0"
                  title="Excluir Brand Kit"
                  aria-label={`Excluir Brand Kit ${k.name}`}
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
