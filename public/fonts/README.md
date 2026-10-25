# Fonts shipped with PageSail

These fonts are used for text that visitors add in the PDF annotator and the image
editor. They are served by the PageSail site itself and fetched only when a text tool
is used. When text is exported to PDF, pdf-lib embeds a subset containing only the
glyphs that were used.

| File | Family | Source | License |
| --- | --- | --- | --- |
| `NotoSans-Regular.ttf` | Noto Sans | `google/fonts` → `ofl/notosans/NotoSans[wdth,wght].ttf` | SIL OFL 1.1 (`OFL-NotoSans.txt`) |
| `NotoSansSC-Regular.ttf` | Noto Sans SC | `google/fonts` → `ofl/notosanssc/NotoSansSC[wght].ttf` | SIL OFL 1.1 (`OFL-NotoSansSC.txt`) |
| `NotoSansJP-Regular.ttf` | Noto Sans JP | `google/fonts` → `ofl/notosansjp/NotoSansJP[wght].ttf` | SIL OFL 1.1 (`OFL-NotoSansJP.txt`) |

Upstream files were downloaded from
`https://raw.githubusercontent.com/google/fonts/main/ofl/<family>/` on 2026-10-25.

## Modification

The upstream files are variable fonts whose *default* instance is Thin (wght=100).
PDF embedding uses the default outlines, so the files were converted to static
**Regular (wght=400, wdth=100)** instances with fontTools; glyph coverage and
outlines of that instance are otherwise unchanged:

```sh
pip install fonttools
fonttools varLib.instancer "NotoSans[wdth,wght].ttf" wght=400 wdth=100 --static --update-name-table -o NotoSans-Regular.ttf
fonttools varLib.instancer "NotoSansSC[wght].ttf"   wght=400 --static --update-name-table -o NotoSansSC-Regular.ttf
fonttools varLib.instancer "NotoSansJP[wght].ttf"   wght=400 --static --update-name-table -o NotoSansJP-Regular.ttf
```

(`scripts/fonts/build-fonts.sh` repeats these steps.)

The only Reserved Font Name in these fonts' OFL notices is "Source" (from Adobe's
Source Han Sans); the instanced fonts keep the Noto names and do not use it.

SHA-256 of the files in this folder:

```
2ed27496d5369aeeb9faa8279981f2c01f11c20225a192554e9a1e9d82cc784e  NotoSans-Regular.ttf
d0729d384c9ee7a9c318041382ae39e467e931a34d6f884d79265d9eb9638aa4  NotoSansJP-Regular.ttf
7c81433013804799ea9164edd54d315e68d24c535faef8d1baad904597a88ec2  NotoSansSC-Regular.ttf
```

SHA-256 of the upstream variable fonts used:

```
bfb7bb691513f12e734dc346c03a03f784912432d7e3fa8e56efcf906fe86b3d  NotoSans[wdth,wght].ttf
a3041811a78c361b1de50f953c805e0244951c21c5bd412f7232ef0d899af0da  NotoSansSC[wght].ttf
c2f3b4d463500a2ddcd3849cded1fceeb9fd6d1c32e6cbecd568453ba50fc68f  NotoSansJP[wght].ttf
```

Coverage notes: Noto Sans SC covers Simplified Chinese (≈21,000 CJK unified ideographs
plus Extension A), Japanese kana and Latin. Noto Sans JP covers Japanese (JIS kanji,
kana) and Latin but not many Simplified-only hanzi. Noto Sans covers Latin, Greek and
Cyrillic only. The editor warns when the selected font lacks a character.
