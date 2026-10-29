#!/bin/bash
cd "$(dirname "$0")"
echo "== Portal de Construcción (servidor local) =="
if ! command -v node >/dev/null 2>&1; then
  echo "No se encontró Node.js (versión 22.13 o superior). Instálalo desde https://nodejs.org y vuelve a abrir este archivo."
  read -p "Pulsa Enter para cerrar"; exit 1
fi
echo "Node $(node -v)"
if [ ! -f node_modules/.instalado-en-mac ]; then
  echo "Instalando dependencias (solo la primera vez)…"
  rm -rf node_modules web/.nuxt web/.output
  npm install --no-audit --no-fund || { read -p "Falló la instalación. Pulsa Enter"; exit 1; }
  touch node_modules/.instalado-en-mac
fi
(sleep 12; open http://localhost:3000) &
npm start
read -p "Servidor detenido. Pulsa Enter para cerrar"
