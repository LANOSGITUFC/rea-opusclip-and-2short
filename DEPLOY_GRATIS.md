# Como Rodar o Opus2Short AI Studio 100% GRATUITO (24/7 no Celular)

## Passo 1 — Pegar sua Chave Gratuita da Groq (IA + Transcrição Ultra Rápida)
1. Acesse **[console.groq.com](https://console.groq.com)** e entre com sua conta Google (não pede cartão de crédito).
2. Vá em **API Keys → Create API Key** e copie a chave (`gsk_...`).
3. Com essa única chave gratuita você ganha:
   - **Whisper Large-v3-Turbo** (transcreve 1 hora de vídeo em ~10 segundos!)
   - **Llama 3.3 70B** (Virality Score, cortes virais, Project Chat e Copy Social)

---

## Passo 2 — Escolher sua Hospedagem Gratuita 24/7

### Opção A: Hugging Face Spaces (Mais Fácil — 3 minutos, SEM cartão de crédito)
- **Grátis:** 2 vCPUs + **16 GB RAM** + link HTTPS fixo no celular (`https://seu-usuario-opus2short.hf.space`).
1. Crie uma conta grátis em **[huggingface.co](https://huggingface.co)**.
2. Clique em **New Space** → Nome: `opus2short` → SDK: **Docker (Blank)** → **Create Space**.
3. No Space criado, conecte/suba este repositório GitHub (`Dockerfile` já configurado na porta `7860`!).
4. Em ~3 minutos o Space fica **Running** e você abre o link direto no Chrome/Safari do celular!

### Opção B: Oracle Cloud Always Free (Mais Potente — 24/7 para sempre)
- **Grátis para sempre:** **4 vCPUs ARM + 24 GB RAM + 200 GB SSD**.
1. Crie uma VM Ubuntu na [Oracle Cloud Free Tier](https://www.oracle.com/cloud/free/) (Shape `VM.Standard.A1.Flex` com 4 OCPUs e 24 GB RAM).
2. Conecte via SSH e rode:
   ```bash
   sudo apt-get update && sudo apt-get install -y docker.io docker-compose-v2 git
   git clone https://github.com/LANOSGITUFC/rea-opusclip-and-2short.git
   cd rea-opusclip-and-2short
   sudo docker compose up -d --build
   ```
3. Para ter HTTPS gratuito no celular sem configurar domínio, rode o Cloudflare Tunnel (`cloudflared tunnel --url http://localhost:3000`).

---

## Passo 3 — Ativar a IA no App
1. Abra o link do seu Studio no celular.
2. Toque na aba **API Keys** (ícone de engrenagem).
3. Selecione **Provedor: Groq** + **Motor de Transcrição: Groq Whisper API (Grátis — 10x rápido)**, cole sua chave `gsk_...` e clique em **Salvar**.
