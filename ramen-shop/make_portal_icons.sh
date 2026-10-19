#!/bin/sh
# 入口ページ（air-io.com）専用のアイコンを、オーナーが用意した画像1枚から書き出す
#   使い方：./make_portal_icons.sh 元の画像（PNG・JPG・SVG）
#   正方形でない画像は、真ん中を正方形に切り抜く。透明な部分はそのまま残す
# らーめん開業日誌のアイコン（icon.svg・icon-*.png）には触らない
set -e
src="$1"
[ -f "$src" ] || { echo "使い方：$0 元の画像"; exit 1; }
cd "$(dirname "$0")"
case "$src" in
  *.svg|*.SVG) cp "$src" portal-icon.svg ;;
  *) rm -f portal-icon.svg ;;
esac
for s in 512 192 180 32; do
  ffmpeg -hide_banner -loglevel error -y -i "$src" \
    -vf "crop='min(iw,ih)':'min(iw,ih)',scale=${s}:${s}:flags=lanczos" -frames:v 1 "portal-icon-${s}.png"
done
ls -l portal-icon*
