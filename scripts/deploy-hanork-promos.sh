#!/usr/bin/env bash
# Copia código Hanork PRO → produção WSL
set -euo pipefail
DL="/mnt/c/Users/boots/Downloads/hanork"
PROD="/home/vendetta/hanork"
for dir in src scripts shared; do
  cp -a "$DL/$dir/." "$PROD/$dir/"
done
cp -a "$DL/package.json" "$DL/package-lock.json" "$PROD/"
export PATH=/home/vendetta/.nvm/versions/node/v25.2.1/bin:$PATH
cd "$PROD"
npm install --omit=dev
npm rebuild better-sqlite3
node -e "
const fs=require('fs');const path=require('path');
const {writeHanorkOnlyCatalogFile,formatAllVariantsBonusFile,listHanorkPromoPhotos}=require('./src/data/hanorkBroadcastVariants');
const photosDir=path.join(process.cwd(),'fotos');
const { HANORK_PRODUCT_ID }=require('./src/constants/hanorkProduct');
const p={id:HANORK_PRODUCT_ID,name:'Hanork PRO v3.0',price:297.9};
writeHanorkOnlyCatalogFile(p,{username:'hanork_bot',photosDir});
fs.writeFileSync(path.join('fotos','DIVULGACAO-HANORK-PRO.txt'),formatAllVariantsBonusFile(photosDir),'utf8');
console.log('Fotos:', listHanorkPromoPhotos(photosDir).join(', '));
"
