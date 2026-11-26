#!/usr/bin/env bash
set -euo pipefail

echo "=================================================="
echo "  Opus2Short AI Studio — Oracle Cloud Free Setup  "
echo "  (Suporta ARM64 Ampere 4 vCPU / 24GB RAM & x64)  "
echo "=================================================="

# 1. Instalar Docker, Docker Compose e Git
sudo apt-get update -y
sudo apt-get install -y docker.io docker-compose-v2 git curl

sudo systemctl enable --now docker
sudo usermod -aG docker "$USER" || true

# 2. Clonar ou atualizar repositorio
REPO_DIR="$HOME/rea-opusclip-and-2short"
if [ -d "$REPO_DIR/.git" ]; then
  echo "[*] Atualizando repositorio em $REPO_DIR..."
  git -C "$REPO_DIR" pull origin main
else
  echo "[*] Clonando repositorio..."
  git clone https://github.com/LANOSGITUFC/rea-opusclip-and-2short.git "$REPO_DIR"
fi

cd "$REPO_DIR"

# 3. Subir o Opus2Short Studio via Docker Compose (24/7 com auto-restart)
echo "[*] Construindo e iniciando container Docker (pode levar ~3-5 min na primeira vez)..."
sudo docker compose up -d --build

# 4. Instalar cloudflared (detecta ARM64 da Oracle Ampere ou AMD64 automaticamente)
ARCH=$(uname -m)
if [ "$ARCH" = "aarch64" ] || [ "$ARCH" = "arm64" ]; then
  CF_BIN="cloudflared-linux-arm64"
else
  CF_BIN="cloudflared-linux-amd64"
fi

if ! command -v cloudflared >/dev/null 2>&1; then
  echo "[*] Instalando cloudflared ($CF_BIN)..."
  sudo curl -sL "https://github.com/cloudflare/cloudflared/releases/latest/download/${CF_BIN}" -o /usr/local/bin/cloudflared
  sudo chmod +x /usr/local/bin/cloudflared
fi

# 5. Abrir porta 3000 no firewall local da Oracle Ubuntu (opcional se usar IP direto)
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 3000 -j ACCEPT 2>/dev/null || true

echo ""
echo "=================================================="
echo "  INSTALACAO CONCLUIDA COM SUCESSO!"
echo "=================================================="
echo "Container rodando em http://localhost:3000"
echo ""
echo "Para gerar seu link HTTPS gratis para abrir no celular e notebook, rode:"
echo "  cloudflared tunnel --url http://localhost:3000"
echo ""
echo "Dica: para deixar o tunel rodando em segundo plano mesmo fechando o SSH:"
echo "  nohup cloudflared tunnel --url http://localhost:3000 > ~/tunnel.log 2>&1 &"
echo "  sleep 3 && grep -o 'https://[-a-zA-Z0-9.]*\.trycloudflare\.com' ~/tunnel.log"
