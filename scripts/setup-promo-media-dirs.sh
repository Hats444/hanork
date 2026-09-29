#!/usr/bin/env bash
# Cria estrutura de mídias separadas HANORK / SSM em CAMINHO_FOTOS (padrão: ./fotos).
set -euo pipefail

ROOT="${1:-$(cd "$(dirname "$0")/.." && pwd)}"
FOTOS="${CAMINHO_FOTOS:-$ROOT/fotos}"

mkdir -p "$FOTOS/hanork" "$FOTOS/ssm" "$FOTOS/midias/hanork" "$FOTOS/midias/ssm"

echo "Estrutura criada em: $FOTOS"
echo "  hanork/     → hanork_01.jpg … hanork_20.jpg"
echo "  ssm/        → ssm_01.jpg … ssm_20.jpg"
echo "  midias/     → alternativa equivalente (hanork/ e ssm/)"
echo ""
echo "Coloque as imagens nas pastas acima. O bot resolve automaticamente fotos/hanork/ e fotos/ssm/."
