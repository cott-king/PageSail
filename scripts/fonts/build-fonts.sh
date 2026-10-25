#!/usr/bin/env bash
# Regenerates public/fonts/*.ttf from the upstream Google Fonts variable fonts.
# Requires: curl, python3 with fonttools (pip install fonttools).
set -euo pipefail
cd "$(dirname "$0")/../.."
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
base="https://raw.githubusercontent.com/google/fonts/main/ofl"
curl -fsSL -o "$work/NotoSans.ttf"   "$base/notosans/NotoSans%5Bwdth,wght%5D.ttf"
curl -fsSL -o "$work/NotoSansSC.ttf" "$base/notosanssc/NotoSansSC%5Bwght%5D.ttf"
curl -fsSL -o "$work/NotoSansJP.ttf" "$base/notosansjp/NotoSansJP%5Bwght%5D.ttf"
for f in notosans notosanssc notosansjp; do curl -fsSL -o "$work/OFL-$f.txt" "$base/$f/OFL.txt"; done
fonttools varLib.instancer "$work/NotoSans.ttf"   wght=400 wdth=100 --static --update-name-table -o public/fonts/NotoSans-Regular.ttf
fonttools varLib.instancer "$work/NotoSansSC.ttf" wght=400 --static --update-name-table -o public/fonts/NotoSansSC-Regular.ttf
fonttools varLib.instancer "$work/NotoSansJP.ttf" wght=400 --static --update-name-table -o public/fonts/NotoSansJP-Regular.ttf
cp "$work/OFL-notosans.txt"   public/fonts/OFL-NotoSans.txt
cp "$work/OFL-notosanssc.txt" public/fonts/OFL-NotoSansSC.txt
cp "$work/OFL-notosansjp.txt" public/fonts/OFL-NotoSansJP.txt
sha256sum public/fonts/*.ttf
echo "Upstream files may have changed since PageSail v0.1; compare the hashes with public/fonts/README.md."
