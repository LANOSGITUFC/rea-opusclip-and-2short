# Como Rodar o Opus2Short AI Studio 100% GRATUITO (Notebook & Celular)

## Passo 1 — Pegar sua Chave Gratuita da Groq (IA + Transcrição 10x mais rápida)
1. Acesse **[console.groq.com](https://console.groq.com)** e entre com sua conta Google (**não pede cartão de crédito**).
2. Vá em **API Keys → Create API Key** e copie a chave (`gsk_...`).
3. Com essa única chave gratuita você ganha:
   - **Whisper Large-v3-Turbo** (transcreve 1 hora de vídeo com timestamps palavra por palavra em ~10 segundos!)
   - **Llama 3.3 70B** (Virality Score, cortes virais, Project Chat e Copy Social)

---

## Passo 2 — Escolher Onde Rodar (100% Grátis, Sem Cartão)

### Opção A: Google Colab + Google Drive (1 Clique, GPU T4 Grátis)
1. Clique neste link direto: **[Abrir no Google Colab](https://colab.research.google.com/github/LANOSGITUFC/rea-opusclip-and-2short/blob/main/colab_opus2short.ipynb)**
2. Execute a **Célula 1** (conecta seu Google Drive para salvar seus projetos, clipes, Brand Kits e API Keys permanentemente).
3. Execute a **Célula 2** e aguarde ~2 minutos.
4. Abra o link `https://...trycloudflare.com` que aparecer no final (funciona no notebook e no celular!).

### Opção B: Direto no seu Notebook (Sem Limite de Horas)
```bash
git clone https://github.com/LANOSGITUFC/rea-opusclip-and-2short.git
cd rea-opusclip-and-2short
docker compose up -d --build
```
Abra `http://localhost:3000` no navegador do notebook (ou use `cloudflared tunnel --url http://localhost:3000` para abrir pelo celular).

---

## Passo 3 — Ativar a IA Gratuita no App
1. Abra o Studio e toque na aba **API Keys** (ícone de engrenagem).
2. Selecione:
   - **Provedor de LLM:** `Groq (Llama 3.3 70B — Grátis & Ultra Rápido)`
   - **Motor de Transcrição:** `Groq Whisper API (Grátis — 10x rápido)`
3. Cole sua chave `gsk_...` e clique em **Salvar Configurações**.

---

## Dica: Vídeos do YouTube com Bloqueio de Bot
Se algum vídeo do YouTube apresentar o aviso *"Sign in to confirm you're not a bot"*:
1. Vá na aba **Configurações** no Studio.
2. Na seção **YouTube Cookies**, selecione seu arquivo `cookies.txt` (exportado via extensão de navegador como *Get cookies.txt LOCALLY*).
3. Ou simplesmente faça o upload direto do arquivo de vídeo (`.mp4`, `.mov`, `.webm`) na tela inicial do Studio!

