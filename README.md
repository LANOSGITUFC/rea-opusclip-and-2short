# ⚡ Opus2Short AI Studio (OpusClip + 2Short.ai Clone)

[![Open In Colab](https://colab.research.google.com/assets/colab-badge.svg)](https://colab.research.google.com/github/LANOSGITUFC/rea-opusclip-and-2short/blob/main/colab_opus2short.ipynb)

Sistema full-stack de geração e edição de vídeos curtos virais (Shorts, Reels e TikTok) construído a partir da engenharia reversa (REA + Playwright + `agent-browser`) do **OpusClip** e do **2Short.ai**.

## Funcionalidades Reais Implementadas
- **Ingestão Real:** download de vídeos do YouTube/Twitch (`yt-dlp`) ou upload de MP4/MOV/WebM com exclusão completa do banco e do Google Drive/disco.
- **9 Workflows do OpusClip:** `long-to-shorts`, `gaming-streams` (Split 9:16 com Facecam ajustável), `auto-edits` (remoção real de silêncios), `ai-captions`, `ai-reframe`, `social-edit`, `ai-broll`, `auto-cleaning` e `translate-dubbing`.
- **Pool Multi-Key com Rotação & Failover 429:** adicione ilimitadas chaves (Groq, Gemini, OpenAI, OpenRouter) em lote — se uma atingir rate limit 429, o sistema troca automaticamente para a próxima.
- **Transcrição Palavra por Palavra:** `faster-whisper` local **ou** **Groq Whisper API (`whisper-large-v3-turbo`, grátis e 10x mais rápido)**.
- **Curadoria Viral & Project Chat:** Virality Score (Hook/Ritmo/História), tradução automática de legendas com IA e copiloto de vídeo.
- **Editor Multitrack + Renderização Real em FFmpeg:** 14 presets de legenda karaokê compilados em `.ass`, rastreamento facial dinâmico, modos `Auto/Fill/Fit/Split/Three/Four` com preview dividido real, **10 transições**, **3 modos de Motion zoom**, **BGM com Audio Ducking (`sidechaincompress`)**, **AutoColor**, Brand Kits com watermark e download em MP4 `1080p`/`720p`.
- **PlanSocial + OAuth 2.0:** login real com YouTube (auto-importa `client_secret.json` do Google Drive `MyDrive/KEYS`), TikTok e Instagram, gerador de copy por IA e upload automático para YouTube Shorts.

## Como Rodar 100% Gratuito
Veja o guia completo em [DEPLOY_GRATIS.md](DEPLOY_GRATIS.md):
1. **Google Colab (1 clique, grátis, com Google Drive):** clique no botão **Open in Colab** acima.
2. **No seu próprio PC/Notebook:** `docker compose up -d --build` e abra `http://localhost:3000`.

## Documentação de Engenharia Reversa
- [Relatório Completo + REA Evidence Ledger](re-analysis/REVERSE_ENGINEERING_REPORT.md)
