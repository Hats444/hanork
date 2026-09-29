#!/usr/bin/env bash
# Pacotes do tema (figlet, neofetch, lolcat) — rode no Ubuntu
set -euo pipefail
sudo apt update
sudo apt upgrade -y
sudo apt install -y git neofetch figlet nano lolcat
echo "OK — dependências visuais instaladas"
