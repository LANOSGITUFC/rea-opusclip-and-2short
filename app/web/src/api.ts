export interface Workflow {
  id: string;
  name: string;
  badge: string;
  icon: string;
  desc: string;
}

export interface CaptionPreset {
  id: string;
  name: string;
  source: string;
  primary: string;
  highlight: string;
  uppercase: boolean;
  wordsPerLine: number;
}

export interface WordTiming {
  text: string;
  start: number;
  end: number;
  prob?: number;
  emoji?: string;
}

export interface ProjectSummary {
  id: string;
  title: string;
  channel: string;
  sourceType: "youtube" | "upload";
  sourceUrl: string;
  workflowId: string;
  duration: number;
  width: number;
  height: number;
  status: "queued" | "downloading" | "transcribing" | "tracking" | "curating" | "ready" | "error";
  progress: number;
  progressMsg: string;
  errorMsg: string;
  language: string;
  clipCount?: number;
  createdAt: string;
  transcriptText?: string;
}

export interface Clip {
  id: string;
  projectId: string;
  title: string;
  description: string;
  hashtags: string;
  viralityScore: number;
  hookScore: number;
  pacingScore: number;
  storyScore: number;
  reason: string;
  startSec: number;
  endSec: number;
  aspectRatio: "9:16" | "4:5" | "1:1" | "16:9";
  layoutMode: "auto" | "fill" | "fit" | "split" | "three" | "four";
  captionEnabled: boolean;
  captionPreset: string;
  captionConfig: {
    highlightColor?: string;
    primaryColor?: string;
    fontSize?: number;
    uppercase?: boolean;
    positionY?: number;
  };
  framing: {
    zoom: number;
    panX: number;
    panY: number;
  };
  transitionType: string;
  motionType: string;
  autoColor: {
    enabled: boolean;
    denoise: number;
    sharpen: number;
    deblock: number;
    glow: number;
  };
  words: WordTiming[];
  headlineText: string;
  progressBar: boolean;
  brandKitId: string;
  liked: boolean;
  exportPath: string;
  exportStatus: "idle" | "rendering" | "done" | "error";
  exportError: string;
}

export interface BrandKit {
  id: string;
  name: string;
  logoPath: string;
  primaryColor: string;
  highlightColor: string;
  secondaryColor: string;
  fontFamily: string;
  defaultPreset: string;
  createdAt: string;
}

export interface SocialAccount {
  id: string;
  platform: string;
  accountName: string;
  handle: string;
  scopes: string[];
  enabled: boolean;
  createdAt: string;
}

export interface PublishSchedule {
  id: string;
  clipId: string;
  projectId: string;
  accountId: string;
  platform: string;
  title: string;
  description: string;
  hashtags: string;
  scheduledAt: string;
  timezone: string;
  status: "PENDING" | "UPLOADING" | "PUBLISHED" | "FAILED";
  errorMsg: string;
  accountName?: string;
  handle?: string;
  clipTitle?: string;
}

export interface Settings {
  llmProvider: "openai" | "gemini" | "groq" | "openrouter";
  llmModel: string;
  hasApiKey: boolean;
  llmApiKeyMasked: string;
  whisperProvider: "local" | "groq" | "openai";
  whisperModel: "tiny" | "base" | "small";
  giphyApiKey: string;
  defaultLanguage: string;
  socialCopyPrompt: string;
}

async function req<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data as T;
}

export const api = {
  getWorkflows: () => req<{ workflows: Workflow[] }>("/api/workflows"),
  getPresets: () => req<{ presets: CaptionPreset[] }>("/api/fancy-template-presets"),

  getSettings: () => req<Settings>("/api/settings"),
  saveSettings: (body: Record<string, unknown>) =>
    req<{ ok: boolean; settings: Settings }>("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    }),

  getProjects: () => req<{ projects: ProjectSummary[] }>("/api/projects"),
  createYoutubeProject: (url: string, workflowId: string) =>
    req<{ id: string }>("/api/projects/youtube", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, workflowId })
    }),
  uploadVideoProject: (file: File, workflowId: string, title?: string) => {
    const fd = new FormData();
    fd.append("video", file);
    fd.append("workflowId", workflowId);
    if (title) fd.append("title", title);
    return req<{ id: string }>("/api/projects/upload", { method: "POST", body: fd });
  },
  getProject: (id: string) => req<{ project: ProjectSummary; clips: Clip[] }>(`/api/projects/${id}`),
  deleteProject: (id: string) => req<{ ok: boolean }>(`/api/projects/${id}`, { method: "DELETE" }),

  getProjectChat: (projectId: string) =>
    req<{ messages: Array<{ id: string; role: "user" | "assistant"; content: string; createdAt: string }> }>(
      `/api/projects/${projectId}/chat`
    ),
  sendProjectChat: (projectId: string, message: string) =>
    req<{ reply: { id: string; role: "assistant"; content: string; createdAt: string } }>(
      `/api/projects/${projectId}/chat`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message }) }
    ),

  getClip: (id: string) => req<{ clip: Clip; project: ProjectSummary }>(`/api/clips/${id}`),
  updateClip: (id: string, patch: Partial<Clip>) =>
    req<{ clip: Clip }>(`/api/clips/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch)
    }),
  generateAiEmojis: (id: string) =>
    req<{ words: WordTiming[] }>(`/api/clips/${id}/ai-emojis`, { method: "POST" }),
  renderClip: (id: string, resolution: string, fps: number) =>
    req<{ status: string }>(`/api/clips/${id}/render`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ resolution, fps })
    }),

  getBrandKits: () => req<{ kits: BrandKit[] }>("/api/brand-kits"),
  createBrandKit: (fd: FormData) => req<{ kit: BrandKit }>("/api/brand-kits", { method: "POST", body: fd }),
  deleteBrandKit: (id: string) => req<{ ok: boolean }>(`/api/brand-kits/${id}`, { method: "DELETE" }),

  getSocialAccounts: () => req<{ accounts: SocialAccount[] }>("/api/social-accounts"),
  connectSocialAccount: (body: Record<string, string>) =>
    req<{ account: SocialAccount }>("/api/social-accounts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    }),
  deleteSocialAccount: (id: string) => req<{ ok: boolean }>(`/api/social-accounts/${id}`, { method: "DELETE" }),

  generateSocialCopy: (clipId: string, platform: string, prompt?: string) =>
    req<{ copy: { title: string; description: string; hashtags: string } }>("/api/social-copy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clipId, platform, prompt })
    }),

  getSchedules: () => req<{ schedules: PublishSchedule[] }>("/api/publish-schedules"),
  createSchedule: (body: Record<string, string>) =>
    req<{ schedule: PublishSchedule }>("/api/publish-schedules", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    }),
  publishNow: (id: string) => req<{ status: string; error?: string }>(`/api/publish-schedules/${id}/publish-now`, { method: "POST" }),
  deleteSchedule: (id: string) => req<{ ok: boolean }>(`/api/publish-schedules/${id}`, { method: "DELETE" })
};

export function fmtTime(sec: number): string {
  const s = Math.max(0, Math.floor(sec || 0));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
}
