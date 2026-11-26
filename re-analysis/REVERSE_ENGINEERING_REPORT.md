# Relatório Completo de Engenharia Reversa (REA): OpusClip & 2Short.ai

> **Evidências Autenticadas e Inspeção Estática de Bundles**  
> Data: 26 de Novembro de 2026  
> Repositório: `LANOSGITUFC/rea-opusclip-and-2short`  
> Metodologia: REA (`reverse-engineer-anything`), Playwright e `agent-browser` (CDP)

---

## 1. Resumo Executivo

Este documento consolida a engenharia reversa completa de duas das principais plataformas mundiais de inteligência artificial para geração de vídeos curtos (Shorts, Reels e TikTok): **OpusClip** (`clip.opus.pro`) e **2Short.ai** (`app.2short.ai`).

Ambas as aplicações foram mapeadas através de:
1. **Inspeção de Rede Autenticada (.HAR)**: Captura real de sessão contendo requisições da engine de IA, processamento de vídeo, metadados de projetos e templates.
2. **Desmontagem e Análise de Bundles JS**:
   - **OpusClip**: 487 chunks de compilação Next.js (21 MB de código de produção) catalogados via `_buildManifest`.
   - **2Short.ai**: Bundles Vite/React (`App`, `Editor`, `BrandKits`, `ProjectChat`, `overlay-assets`).

---

## 2. Engenharia Reversa do OpusClip (`clip.opus.pro`)

### 2.1. Arquitetura do Sistema e Stack Tecnológico
- **Frontend**: Next.js 14+ (React 18), TailwindCSS, Framer Motion, Radix UI.
- **Player & Canvas**: Renderizador híbrido Canvas 2D + WebGL com pipeline de filtros em tempo real (LUT color correction, deblock, denoise, sharpen).
- **Backend**: Microserviços Python/Node hospedados em `https://api.opus.pro`, CDN `https://public.cdn.opus.pro`, com armazenamento de mídia particionado por organização e usuário.
- **Engine Central**: Identificada internamente como **`ClipAnything`**.

### 2.2. Contrato de Dados da Engine (`/api/engine-clips/:projectId.:curationId`)
O OpusClip trafega o estado completo de cada clipe como um objeto Base64 codificado contendo 5 pilares:

```typescript
interface OpusEngineClip {
  id: string;                     // Ex: "P3112611KQXy.gz5PKQ3UqG"
  projectId: string;              // Ex: "P3112611KQXy"
  curationId: string;             // ID único do clipe gerado
  curation: {
    model: "ClipAnything";
    title: string;                // Título viral gerado pela IA
    description: string;          // Descrição do vídeo
    hashtags: string;             // Hashtags para TikTok/Reels/Shorts
    screenplay: {
      desc: string;
      chapters: Array<{
        i: number;
        tr: [number, number];     // [startSec, endSec] do capítulo
        title: string;
        summary: string;
        annots: Array<{ name: string; desc: string; score: number }>;
        lines: Array<{
          i: number;
          tr: [number, number];   // Timestamp da linha
          type: "verbal" | "non-verbal";
          content: string;
          words: Array<{
            text: string;
            tr: [number, number]; // Word-level timestamp [start, end]
          }>;
          score: number;          // Virality / hook score da fala
        }>;
      }>;
    };
  };
  reLayoutPlans: Array<any>;      // Planos de corte inteligente / multi-speaker
  overlayPlans: {
    captionPlans: Array<{
      sceneId: string;
      frames: Array<{
        elements: Array<{
          content: string;        // Palavra
          color: number;          // 0 = normal, 1 = destaque / highlight
          offsetStartMs: number;  // Início em ms
          offsetEndMs: number;    // Fim em ms
        }>;
        source: {
          offsetStartMs: number;
          offsetEndMs: number;
        };
      }>;
    }>;
  };
  renderPref: {
    aspectRatio: "9:16" | "1:1" | "16:9";
    resolution: "1080p" | "720p";
  };
  brolls: Array<{
    id: string;
    source: string;
    startMs: number;
    endMs: number;
  }>;
  editingScript: {
    tracks: Array<{
      id: string;
      trackType: "KeyFrameTrack";
      sections: Array<{
        id: string;
        sectionDuration: { sO: number; eO: number; type: "TS" };
        sectionTimeline: { in: number; out: number };
        segments: Array<{
          id: string;
          contentType: "KeyFrameGroup";
          content: {
            layoutType: "Game" | "SingleSpeaker" | "SplitScreen" | "ScreenShare";
            autoColor: {
              correctionLutUri: string;
              finish: { deblock: number; denoise: number; glow: number; sharpen: number };
              enabled: boolean;
            };
            keyFrameContents: Array<{
              id: string;
              cropAreas: Array<{
                wPct: number;     // Largura relativa (0.0 a 1.0)
                hPct: number;     // Altura relativa (0.0 a 1.0)
                xPct: number;     // Posição X relativa
                yPct: number;     // Posição Y relativa
                type: "CPct";
              }>;
            }>;
          };
        }>;
      }>;
    }>;
  };
}
```

### 2.3. Endpoints Principais do OpusClip
| Método | Endpoint | Função |
|---|---|---|
| `POST` | `/api/clip-projects` | Criação de novo projeto a partir de URL do YouTube ou upload |
| `GET` | `/api/clip-projects/:id` | Status de ingestão, download e progresso |
| `POST` | `/api/clip-projects/:id/view` | Registro de visualização e telemetria |
| `GET` | `/api/engine-clips/:projectId.:clipId` | Retorna o payload completo do clipe (Base64) |
| `POST` | `/api/curated-clips/like-clips` | Lista de clipes favoritos / selecionados para render |
| `POST` | `/api/curated-clips/render` | Disparo de renderização final em 1080p 60fps |
| `GET` | `/api/brand-templates` | Lista de molduras, fontes, estilos de legenda e logos |
| `GET` | `/api/importable-youtube-playlists` | Importação automática de canais e playlists do YouTube |

---

## 3. Engenharia Reversa do 2Short.ai (`app.2short.ai`)

### 3.1. Arquitetura do Sistema e Stack Tecnológico
- **Frontend**: Vite + React 18 SPA, IndexedDB (`2short-overlay-assets`), TailwindCSS.
- **Client de Armazenamento Local**: Utiliza IndexedDB localmente no navegador do usuário para armazenar mídias, vídeos B-roll, stickers do Giphy e logotipos em alta fidelidade (`Blob`) sem sobrecarregar a largura de banda do servidor durante a edição.
- **API Studio Client (`ae(endpoint, body, signal, isAsync)`)**:
  - Base: `/api/`
  - Cabeçalho assíncrono: `Prefer: respond-async`
  - Evento de sincronização de créditos no browser: `window.dispatchEvent(new Event("studio-credits-changed"))`

### 3.2. Endpoints e Rotas do 2Short.ai
| Endpoint | Método | Descrição |
|---|---|---|
| `/api/auth/google`, `/api/auth/logout` | `POST` | Autenticação OAuth |
| `/api/account/me` | `GET` | Perfil, créditos restantes e plano |
| `/api/projects` | `GET`, `POST` | Criação de projeto e listagem com filtros (`?overview`, `?processing=`, `?usage`) |
| `/api/projects/:id/source` | `GET` | Stream de vídeo fonte original |
| `/api/projects/:id/moments` | `GET` | Momentos virais detectados pela IA |
| `/api/projects/:id/word-timings` | `GET` | Alinhamento temporal palavra por palavra (Word Timings) |
| `/api/projects/:id/transcript` | `GET` | Transcrição completa em texto |
| `/api/moments/preview` | `POST` | Geração rápida de preview de corte |
| `/api/brand-kits` | `GET`, `POST` | Gerenciamento de marcas, logotipos e fontes |
| `/api/exports` | `GET`, `POST` | Fila de exportação e download do vídeo final |
| `/api/giphy-access` | `POST` | Token de acesso para stickers e GIFs animados da GIPHY |

### 3.3. Pipeline do Editor do 2Short (`Editor-DAJ-tHKm.js`)
O 2Short utiliza camadas bem definidas:
1. **Camada de Vídeo Base**: Corte em 9:16 com bounding-box rastreando o rosto do apresentador.
2. **Camada de Legendas Dinâmicas**: Suporte a 12 presets visuais de legenda com sombra, contorno (`stroke`), animação de escala na palavra ativa e cores contrastantes (amarelo, ciano, verde neon).
3. **Camada de Overlays e B-Roll**: Imagens, GIFs e logotipos posicionados com coordenadas normalizadas `(x, y, width, height)`.

---

## 3.4. Análise de Sessão Autenticada ao Vivo (Playwright & agent-browser)

Utilizando o cookie de sessão fornecido (`studio_v2_session`), realizamos a navegação autenticada em `https://app.2short.ai/` via Playwright e `agent-browser` (CDP), inspecionando a conta ativa e o editor de vídeo em tempo real.

### Dados da Conta Autenticada
- **Usuário**: Tiago (`tiagowork071@gmail.com`)
- **Plano**: Starter (13 créditos restantes / 17 vídeos utilizados)
- **Projeto Aberto**: `LOUD CORINGA ASSALTANDO TODAS AS JOALHERIAS DO GTA 6` (Duração: 991s, ID: `e9b2a09b-7974-43b5-a2b6-24d5de42c18e`)

### Captura Completa da Árvore de Componentes do Editor (`editor_full.png`)
Navegamos pela biblioteca de clipes gerados e abrimos o editor completo (`Edit clip`), mapeando as ferramentas:

1. **Edição Interativa Palavra por Palavra (Transcript UI)**:
   - Cada palavra gerada pelo Whisper é um botão interativo individual (`button "Edit word “código”"`, `button "Edit word “cofre?”"`).
   - Permite corrigir ortografia, pontuação ou remover termos indesejados sem quebrar a sincronia do áudio.
2. **Presets de Legendas Dinâmicas (13 Estilos)**:
   - `Spotlight` (destaque com fundo contrastante)
   - `Marker` (efeito marca-texto neon)
   - `One beat` (palavra única centralizada por vez)
   - `Ink trail` (rastro de tinta animado)
   - `Soft rise` (animação suave de subida / fade)
   - `Sticker`, `Editorial`, `Chromatic`, `Curtain`, `Karaoke`, `Headline`, `Typewriter`, `Classic`
   - Gerador de Emojis de IA (`button "Generate AI emojis"`) e Destaques automáticos (`button "Generate AI highlights"`).
3. **Controles de Layout e Enquadramento da Cena**:
   - `Auto` (IA rastreia quem está falando)
   - `Fill` (Preenchimento total 9:16)
   - `Fit` (Letterbox com fundo desfocado)
   - `Split` (Divisão da tela em 2: gameplay embaixo + webcam em cima)
   - `Three` / `Four` (Multi-câmeras para podcasts)
4. **Timeline e Trimming**:
   - Sliders de alta precisão para início e fim do clipe (`slider "Trim part 1 start"`, `slider "Trim part 1 end"`).
   - Ferramentas de corte rápido (`Split`, `Merge`, `Snap to edits`, `Timeline zoom`).

---

## 4. Arquitetura do Clone Unificado (OpusClip + 2Short)

Para reconstruir as ferramentas de forma funcional e sem custos abusivos de APIs pagas, a arquitetura do clone será estruturada em 4 módulos:

```
┌────────────────────────────────────────────────────────────────────────┐
│                      FRONTEND (Next.js 14 / React 18)                 │
│  - Dashboard de Projetos & Importador (YouTube / Upload MP4)           │
│  - Grid de Clipes com Score Viral, Título e Hashtags                   │
│  - Editor de Vídeo Interativo (Canvas 2D / WebGL)                      │
│    ├── Timeline de Áudio & Palavras                                   │
│    ├── Editor de Legendas Karaokê (Highlight color, fontes, emojis)   │
│    ├── Bounding Box de Reframe 9:16 (Active Speaker Crop)             │
│    └── Gerenciador de Brand Kits (Logos, Overlays, Giphy)             │
└──────────────────────────────────┬─────────────────────────────────────┘
                                   │ REST / WebSocket
┌──────────────────────────────────▼─────────────────────────────────────┐
│                       BACKEND (Node.js / Python Fastify)               │
│  - Gerenciador de Jobs & Filas (BullMQ / Redis)                        │
│  - Pipeline de Processamento de Mídia:                                │
│    ├── 1. Extração de Áudio e Download (yt-dlp + ffmpeg)               │
│    ├── 2. Transcrição com Timestamps (OpenAI Whisper / faster-whisper) │
│    ├── 3. Detecção de Momentos Virais & Score (LLM Prompting)          │
│    ├── 4. Rastreamento Facial / Speaker Tracking (MediaPipe / OpenCV)   │
│    └── 5. Renderizador Final (FFmpeg com drawtext / ass subtitles)    │
└────────────────────────────────────────────────────────────────────────┘
```

### 4.1. Algoritmo de Pontuação Viral (Virality Score & Hooks)
Ambas as ferramentas utilizam prompts estruturados enviados a LLMs alimentados pela transcrição com timestamps. O prompt analisa:
1. **Hook (0-5s)**: Abertura forte, quebra de padrão ou pergunta provocativa.
2. **Engajamento & Storytelling (Corpo)**: Coerência, ritmo das frases e ausência de silêncios prolongados.
3. **Clímax ou Conclusão**: Encerramento marcante antes dos 60 segundos.

### 4.2. Motor de Legendas Animadas (Karaoke Subtitles)
- Formato interno idêntico ao extraído: cada palavra possui `offsetStartMs` e `offsetEndMs`.
- Para o preview no navegador: renderização via React Canvas ou elementos CSS absolutos sincronizados com `video.currentTime`.
- Para a exportação final: compilação direta para arquivo `.ass` (Advanced SubStation Alpha) com tags `{\k<duration>}` para karaoke timing perfeito no FFmpeg sem recompressões lentas.

---

## 5. REA Evidence Ledger

| ID de Evidência | Artefato de Origem | SHA-256 / Referência | Descoberta Chave |
|---|---|---|---|
| `EVD-OPUS-001` | `clip.opus.pro.slim.har` | `e7804a6...` | Descoberta do endpoint `GET /api/engine-clips/:id` com payload Base64 |
| `EVD-OPUS-002` | Decoded Engine Payload | Schema `ClipAnything` | Schema completo de capítulos, falas com pontuação e matriz de crop 9:16 |
| `EVD-OPUS-003` | `_buildManifest.js` | `xV7YpLh6YOBNPzVyF8bMw` | Mapeamento de 487 rotas e componentes Next.js do OpusClip |
| `EVD-OPUS-004` | `10xondf2gaa_i.js` | Chunk `clip-editor` | Estrutura de trilhas `KeyFrameTrack` e correção de cor LUT em canvas |
| `EVD-2SHORT-001` | `HomeAppBar-CmL0jYx6.js` | Função `ae()` | Mapeamento de todos os endpoints REST de projetos, momentos e word-timings |
| `EVD-2SHORT-002` | `Editor-DAJ-tHKm.js` | Chunk `Editor` | Sistema de preview, camadas de overlays e estilos de legenda do 2short |
| `EVD-2SHORT-003` | `overlay-assets-YOYn35B2.js`| IndexedDB `2short-overlay-assets` | Cache de mídia client-side em IndexedDB para zero-latency no editor |
| `EVD-2SHORT-004` | Live Session Playwright | `studio_v2_session` cookie | Sessão autenticada ao vivo: APIs `/api/account/me`, `/api/credits`, `/api/projects` |
| `EVD-2SHORT-005` | `agent-browser` CDP Snapshot | `editor_full.png` | Mapeamento completo dos 13 presets de legendas, timeline e edição palavra por palavra |
| `EVD-2SHORT-006` | Live DOM Tree | Interactive Elements Ref | Árvore de botões e seletores do editor (Auto/Fill/Fit/Split, 9:16, AI emojis e highlights) |

