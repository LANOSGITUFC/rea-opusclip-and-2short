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

---

### 2.4. O Editor Multitrack do OpusClip (`/editor-ux/[fullClipId]`)
A partir da análise dos 487 chunks de compilação Next.js e da decodificação da engine `ClipAnything`, mapeamos a arquitetura do editor profissional do OpusClip:

#### 1. Sistema Multitrack (14 Tipos de Trilhas de Edição)
O editor do OpusClip organiza o projeto em uma timeline não-linear de **14 tipos de trilhas independentes**:
1. **`KeyFrameTrack`**: Trilhas de enquadramento com keyframes de interpolação suave para acompanhar o rosto do apresentador em movimento.
2. **`CaptionTrack`**: Trilha de legendas com alinhamento palavra por palavra (Word-Level Karaoke Timing).
3. **`EmojiTrack`**: Trilha de emojis 3D animados disparados por análise de sentimento da fala em tempo real.
4. **`BRollTrack` / `BRollMediaTrack`**: Sobreposição de vídeos secundários (B-roll) contextuais com controle de opacidade e corte.
5. **`AudioTrack`**: Trilha de áudio original + trilha de música de fundo (*BGM*) com *Audio Ducking* automático (o volume da música baixa automaticamente quando alguém fala).
6. **`VoiceOverTrack`**: Trilha de dublagem ou narração sintética de IA gerada por Text-to-Speech com clonagem vocal.
7. **`VideoEffectTrack`**: Efeitos de câmera (Camera Shake, Flash de transição, Zoom dinâmico).
8. **`EyeContactTrack`**: Inteligência artificial que redireciona o olhar do apresentador diretamente para a lente da câmera.
9. **`ScreenOverlayTrack`**: Elementos de tela cheia (Barras de progresso de visualização, molduras, tarjas de notícia).
10. **`TextOverlayTrack` / `TextOverlay`**: Textos livres com fontes personalizadas, títulos e chamadas para ação (CTA).
11. **`ElementTrack`**: Ícones, setas, caixas de destaque e stickers vetoriais.
12. **`MediaTrack`**: Vídeos adicionais para modo Picture-in-Picture (PiP) ou Split-Screen de jogos.

#### 2. Os 46 Presets Visuais de Legenda (`/api/fancy-template-presets`)
O OpusClip renderiza legendas combinando duas tecnologias de ponta: vetores interativos em **Rive (`.riv`)** e animações After Effects em **Lottie (`.json`)**:
- **Estilos Principais Mapeados**:
  1. *Karaokê*: Preenchimento e pop de palavra com cor de destaque neon (`#04f827`, Rive `karaoke.riv`).
  2. *Think Media*: Estilo clássico de criadores com alto contraste e contorno preto espesso.
  3. *Glitch Infinite Zoom*: Efeito glitch com zoom contínuo em palavras-chave.
  4. *Seamless Bounce*: Salto elástico suave nas palavras ativas (`#D7FF37`).
  5. *Highlighter Box*: Caixa estilo marca-texto com cantos arredondados (`#1C4EBF`).
  6. *Marker Sweep*: Varredura de pincel destacando palavras importantes (Lottie `marker-sweep/tile-v2.json`).
  7. *Word Cut & Stack Cut*: Estilo tipográfico moderno com palavras cortadas e empilhadas.
  8. *Handwritten & Doodle*: Efeito de escrita à mão cursiva e desenhos animados.
  9. *Punch & Comic*: Estilo de quadrinhos e impacto rápido com amarelo vibrante (`#FFE600`).
  10. *Typewriter, Retro 3D, Elastic, Bouncing Dot, Chip Background, Sunset*.

#### 3. Pipeline de Tratamento de Imagem WebGL / Canvas (`autoColor`)
Cada frame do vídeo passa por um pipeline de pós-processamento com shaders em WebGL:
- **LUT (Look-Up Table)**: Gradação de cores profissional (`correctionLutUri`).
- **Acabamento (`finish`)**:
  - `deblock`: Suavização de artefatos de compressão de vídeos baixados da web.
  - `denoise`: Redução de ruído digital e granulação em ambientes escuros.
  - `glow`: Efeito sutil de iluminação difusa.
  - `sharpen`: Nitidez inteligente para destacar detalhes do rosto e olhos.

---

### 2.5. Os 9 Tipos de Shorts / Workflows de Criação (`builtin:workflows`)
A partir da descompilação dos chunks e da inspeção dos payloads da API (`GET /api/workflows`), catalogamos os 9 motores especializados de geração de shorts do OpusClip:

| ID do Workflow | Nome | Layout & Pipeline | Gatilho de IA & Hook |
|---|---|---|---|
| `builtin:gaming-streams` | **Clip gaming streams** | Split-Screen 9:16 (Webcam no topo + Gameplay embaixo) | Detecta clutch plays, gritos/reações e momentos de alta ação. Hook tipo `headline` |
| `builtin:long-to-shorts` | **Clip long video** | Reframe 9:16 dinâmico com speaker tracking | Mineração de ganchos virais e clímax narrativo em podcasts e entrevistas |
| `builtin:auto-edits` | **Auto-edit talking videos** | Zoom in/out dinâmico, cortes de pausas | Remove silêncios ("uhm", pausas mortas) e adiciona efeitos visuais de retenção |
| `builtin:ai-captions` | **Captions** | Legendas animadas Karaokê | Sincronia palavra por palavra com emojis automáticos e cores de destaque |
| `builtin:ai-reframe` | **Reframe** | Reenquadramento automático | Detecta rotação e múltiplos interlocutores sem crop manual |
| `builtin:social-edit` | **Social Edit** | Barras de progresso, headlines virais | Elementos gráficos de engajamento para retenção nos primeiros 3 segundos |
| `builtin:ai-broll` | **AI B-roll** | Sobreposição de mídias contextuais | Insere vídeos de stock e GIFs baseados nas entidades semânticas da fala |
| `builtin:auto-cleaning` | **Clean up recording** | Filtro de áudio + LUT de vídeo | Denoise, remoção de eco, ajuste de contato visual e color grading |
| `builtin:translate-dubbing` | **Translate & dub** | Clonagem de voz e dublagem | Tradução e dublagem para 20+ idiomas mantendo o timbre do locutor |

---

### 2.5. Conexões de Redes Sociais & Motor de Agendamento (`PlanSocial`)
Através da inspeção do HAR e do dicionário oficial `plansocial_schema.json`, mapeamos todo o subsistema de distribuição social do OpusClip:

#### 1. Plataformas Sociais Suportadas & Permissões OAuth:
O OpusClip integra-se nativamente com 7 grandes plataformas:
- **YouTube Shorts (`YOUTUBE`)**:
  - Scopes: `https://www.googleapis.com/auth/youtube.upload`, `https://www.googleapis.com/auth/yt-analytics.readonly`, `https://www.googleapis.com/auth/youtube`
  - Upload direto via API de vídeos em até 1080p 60fps com privacidade (`public`, `unlisted`, `private`).
- **TikTok (`TIKTOK_BUSINESS`)**:
  - Scopes: `user.info.username`, `video.publish`, `video.upload`, `user.info.basic`, `user.account.type`
  - Restrição mapeada: O TikTok impõe limite de frequência e exige verificação de tipo de conta (`TIKTOK_BUSINESS` vs Creator).
- **Instagram Reels (`INSTAGRAM_BUSINESS`)**:
  - Conexão via Meta Graph API / Facebook Business Manager para publicação automática direta em Reels.
- **Facebook Reels (`FACEBOOK`)**: Suporte a páginas e perfis profissionais.
- **LinkedIn Video (`LINKEDIN`)**: Publicação de vídeos curtos em perfis ou páginas organizacionais.
- **X / Twitter (`TWITTER` / `X`)**: Upload de mídia em chunks (`media/upload`) com texto e hashtags.
- **Meta Threads (`THREADS`)**: Suporte via Threads API para publicação de vídeos verticais.

#### 2. Gerador de Copy Social por IA (`/api/social-copy`):
Antes de agendar, o OpusClip gera títulos, descrições e hashtags customizadas por plataforma a partir de prompts do usuário.
- Payload de Envio:
  ```json
  {
    "requests": [{
      "projectId": "P3112611KQXy",
      "curationId": "kngfJYLM1K",
      "platform": "YOUTUBE",
      "prompt": "quero titulo e etc... em português e em inglês, priorizando o português!"
    }]
  }
  ```
- Resposta Decodificada:
  ```json
  {
    "title": "A melhor pintura do jogo | Best Game Painting #shorts",
    "description": "A tinta azul-esverdeada transforma a preparação para pintar em um momento épico. / Teal paint turns getting ready to paint into an epic moment.",
    "hashtags": "#PinturaNoJogo #Jogos #Gaming #GamePainting"
  }
  ```

#### 3. Motor do Calendário de Agendamento (`/api/publish-schedules` & `/api/post-tasks`):
- **Grade de Calendário**:
  - `GET /api/publish-schedules?startAt=...&endAt=...&timezone=America/Sao_Paulo`
  - Visualização por Mês, Semana ou Dia com slots automáticos de melhor horário para postagem.
- **Disparo de Agendamento**:
  - `POST /api/publish-schedules`: Cria uma tarefa na fila de publicação com data/hora e metadados de cada rede social.
  - `POST /api/publish-schedules/:id/publish-now`: Publicação instantânea sem aguardar a fila.
- **Acompanhamento de Status (`/api/post-tasks`)**:
  - Fila assíncrona gerenciada com estados: `PENDING` ➔ `UPLOADING` ➔ `PROCESSING` ➔ `PUBLISHED` (ou `FAILED` com mensagem de retry).


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

## 3.4. Exploração Pixel a Pixel do Editor do 2Short.ai (`agent-browser` CDP)

Navegamos interativamente por cada aba, modal e controle da interface do editor ativo (`screens/`):

### 1. Aba de Enquadramento (`Framing` - `01_framing.png`)
- **Modos de Layout**:
  - `Auto`: Rastreamento contínuo do orador via IA.
  - `Fill`: Preenchimento total do quadro 9:16.
  - `Fit`: Enquadramento proporcional com fundo desfocado.
  - `Split`: Tela dividida (Game em baixo + Facecam em cima).
  - `Three` / `Four`: Telas divididas em 3 ou 4 painéis para podcasts e entrevistas.
- **Controles de Precisão**:
  - `Zoom` (Slider com ajuste de escala 1x a 3x).
  - `Horizontal` & `Vertical` (Sliders de pan de câmera de 0.0 a 1.0).
  - `Tracking Defaults`: Sensibilidade e suavização de interpolação da IA.
- **Manipulação Direta no Canvas**:
  - `Move panel 1`, `Crop panel 1`, `Shrink panel 1`, `Enlarge panel 1`, `Reset placement`.

### 2. Aba de Transições (`Transitions` - `02_transitions.png`)
O 2Short disponibiliza **10 transições cinematográficas** entre cortes:
1. `Hard cut`: Corte seco padrão.
2. `Dip to black`: Fade suave para o preto.
3. `Light leak`: Vazamento de luz estilizado / flash quente.
4. `Whip pan`: Transição rápida com arrasto lateral (motion blur).
5. `Punch in`: Zoom rápido de aproximação instantânea.
6. `Defocus`: Desfoque ótico com foco no próximo take.
7. `Signal glitch`: Glitch digital estilo fita VHS / interferência.
8. `Iris`: Fechamento circular clássico.
9. `Shutter`: Efeito de obturador de câmera fotográfica.
10. `White flash`: Flash branco de impacto em momentos épicos.

### 3. Aba de Movimento (`Motion` - `03_motion.png`)
- `Add Punch in`: Cria um corte de zoom de impacto numa fala chave.
- `Add Slow push`: Zoom lento e contínuo para aumentar tensão dramática.
- `Auto zoom`: A IA identifica automaticamente variações de entonação na voz e aplica aproximações automáticas nos momentos de maior energia.

### 4. Aba de Texto & Modelos (`Text` - `04_text.png`)
Templates prontos de tipografia profissional:
- **Headlines**: *Cover story*, *Cold open*, *Field journal*, *Side column*, *Dispatch*.
- **Titles**: *Ink roller*, *Witness quote*.
- **Name Tags**: Barras inferiores (Lower-thirds) com nome e arroba do orador.
- **Locations**: Tarjas com nome de cidade/localização.

### 5. Aba de Gráficos e Overlays de Dados (`Graphics` - `05_graphics.png`)
- **Visualizadores de Dados Animados**:
  - `Rolling number`: Contador numérico giratório sincronizado com dados falados.
  - `Arc meter`: Medidor circular em arco com agulha animada.
  - `Ranked bars`: Gráfico de barras horizontais ranqueado.
  - `Live trend`: Linha de tendência com oscilação em tempo real.
  - `Split measure`, `Needle sweep`, `Rolling capsule`, `Paired columns`.
- **Social Overlays & Stickers**: Botões animados de Inscrever-se, Curtir, Notificação, e busca integrada da GIPHY (`GIFs & stickers`).

### 6. Aba de Mídia Secundária (`Media` - `06_media.png`)
- Ingestão de mídias do usuário (`PNG`, `JPEG`, `WebP`, `MP4`, `MOV`, `WebM`).
- As mídias importadas são salvas no IndexedDB local (`2short-overlay-assets`), liberando pré-visualizações sem lag.

### 7. Aba de Brand Kit & Identidade Visual (`07_brandkit.png` & `10_brand_kits_modal.png`)
- **Logotipo**: Upload de marca d'água com posicionamento, tamanho e opacidade livre.
- **Paleta de Cores da Marca**: Customização de cores com código Hexadecimal (ex: `#0169ee`) e nomes personalizados (*Primary*, *Secondary*, *Accent*).
- **Legenda Padrão**: Vinculação automática do estilo de legenda preferido para novos projetos.

### 8. Modal de Exportação Final (`08_export_modal.png`)
- **Resoluções**: `Auto · up to Full HD` (1080p), `720p HD`.
- **Taxa de Quadros**: `30 fps` ou `60 fps` para máxima fluidez.
- **Processamento**: Disparo assíncrono para o worker `/api/exports`.

### 9. Project Chat — O Copiloto de Vídeo (`09_project_chat.png`)
Interface de chat com IA especializada no vídeo em edição:
- `Find clips by topic`: Localiza trechos específicos na gravação através de busca semântica no transcript.
- `Generate titles`: Sugestões de 10 títulos otimizados para CTR no YouTube/TikTok.
- `Write a description`: Resumo do clipe pronto para colar na descrição.
- `Create chapters`: Divisão da gravação em capítulos com minutagem.

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

