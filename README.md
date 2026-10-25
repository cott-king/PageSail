# PageSail

**English** · [简体中文](#简体中文) · [日本語](#日本語)

Open-source PDF and image tools that run entirely in your browser. No account, no
subscription, no watermark, no daily limits — and your files are never uploaded.

> I got tired of having to sign up for an account — and run into all kinds of usage
> limits — just to convert or edit a PDF. So I'm building PageSail: an open-source,
> no-signup online PDF and image tool, so anyone with the same need can simply open the
> page and get their files done.

Source: <https://github.com/cott-king/PageSail> · License: MIT (see [License](#license))

## Features (v0.1)

| Tool | What it does |
| --- | --- |
| **PDF → PNG/JPG** | Pick all pages or a range such as `1,3-5`; PNG or JPG (quality setting), 36–1200 DPI with output-size estimate; optional transparent PNG background; one page downloads directly, several are zipped; real progress and cancel. Rotated pages and CropBoxes are respected. |
| **PNG/JPG → PDF** | Multiple images with thumbnails; drag or button reordering, remove, add more, sort by name; A4/A3/A5/Letter/Legal or “same as image”; portrait/landscape/auto; margins in mm; fit / fill (crops, clearly labelled) / actual size. Proportions are always kept, EXIF orientation is applied, JPEG data is embedded without re-encoding. |
| **Organize PDF pages** | Merge several PDFs, delete, rotate, reorder (drag, buttons or Alt+arrow keys), extract selected pages, split into one file per page / every N pages / custom ranges. Undo/redo. The generated file can be previewed. Pages are copied as-is — text stays text, nothing is rasterised. |
| **Add text & annotations to PDF** | Add text, images, rectangles, ellipses, lines, arrows and freehand drawings on any page; move, resize, rotate, recolour, change opacity, line width, dashes and layer order; delete; per-page undo/redo; every page keeps its own edits. Text is exported as real, searchable PDF text in a subset-embedded Noto font (Chinese, Japanese, Latin). |
| **Image editor** | PNG/JPG: crop (free or fixed ratios, numeric fields), resize in pixels with aspect lock, rotate 90°, flip, brightness/contrast, text, shapes, arrows, freehand, layer order, undo/redo/reset; export PNG (keeps transparency) or JPG (quality + background colour) at the real output size. |

The interface is available in Simplified Chinese (default), English and Japanese; an
explicit language choice is remembered in the browser.

### What the PDF annotator does *not* do

It adds new content **on top of** pages. It does not edit or reflow text that is already
in the PDF, and covering something with a white rectangle does **not** remove it — the
original content stays in the file. It is not a redaction tool.

## Privacy and how files are handled

- Files are opened and processed by the web page **in your browser** (PDF.js, pdf-lib,
  Fabric.js, Web Workers). They are not uploaded to the PageSail server or to any
  third-party service; there are no ads, analytics or trackers.
- Loading the web page is not uploading files: the browser downloads the app, the
  PDF.js worker, CMaps and fonts **from the same site**. Nothing is loaded from a CDN.
- Work exists only in the current tab; nothing is written to IndexedDB or similar.
  The only thing stored is your language choice (localStorage). “Clear workspace”
  discards everything immediately.
- JavaScript embedded in PDFs is never executed (PDF.js scripting is not shipped).
- The Nginx configuration only allows `GET`/`HEAD`, caps request bodies at 1 KB and
  sends a Content-Security-Policy with `connect-src 'self'`. The access log contains no
  IP addresses or user agents. A tunnel such as ngrok can still see normal request
  metadata (IP, URL path) for page resources — never your documents.
- The end-to-end tests record every network request during real file processing and
  fail if anything other than same-origin `GET` requests for static files occurs, or if
  a file name appears in a URL.

### Resource limits

Everything runs on the visitor's device, so very large files are limited to keep the
browser from freezing or crashing (there are no daily quotas). Defaults, all
configurable at build time via environment variables:

| Limit | Default | Variable |
| --- | --- | --- |
| Largest PDF | 500 MB | `VITE_MAX_PDF_MB` |
| Largest image file | 100 MB | `VITE_MAX_IMAGE_MB` |
| Largest decoded image | 64 MP | `VITE_MAX_IMAGE_MEGAPIXELS` |
| Largest rendered page image | 64 MP | `VITE_MAX_RENDER_MEGAPIXELS` |
| Files per batch | 200 | `VITE_MAX_FILES` |
| Undo steps (per page / image) | 50 | `VITE_HISTORY_STEPS` |

The app also probes whether the browser can actually allocate a canvas of the required
size (iOS Safari, for example, refuses canvases above ~16.7 MP) and explains the problem
instead of producing a blank image. Performance depends on the visitor's device, not on
the server.

## Run locally

Requirements: Node.js **24 LTS** (22.13+ also works) and npm.

```sh
npm ci                 # install exact dependency versions from package-lock.json
npm run dev            # development server on http://127.0.0.1:5173
npm run typecheck      # TypeScript
npm run lint           # ESLint
npm test               # unit tests (Vitest, Node)
npm run test:e2e       # browser tests (Playwright; builds and serves dist/ itself)
npm run build          # production build into dist/ (+ .gz files for Nginx)
```

`npm run test:e2e` needs Playwright's Chromium (`npx playwright install chromium` once).
To test an already running deployment instead:
`PAGESAIL_BASE_URL=http://127.0.0.1:8080 PAGESAIL_EXPECT_HEADERS=1 npm run test:e2e`.

`npm run fixtures` regenerates the synthetic test files in `tests/fixtures/`.

## Deploy

Production uses Docker: a Node build stage and an unprivileged Nginx image (both
multi-arch, including linux/arm64), published on `127.0.0.1:8080`:

```sh
docker compose up -d --build
curl -I http://127.0.0.1:8080/
```

Step-by-step guide for **Raspberry Pi 5 + Raspberry Pi OS 64-bit + external SSD +
ngrok**: [docs/deploy-raspberry-pi.md](docs/deploy-raspberry-pi.md)
([简体中文](docs/deploy-raspberry-pi.zh-CN.md)). The Vite dev server and `vite preview`
are not meant for public serving.

## Architecture in brief

- React 19 + TypeScript + Vite 8, static site; no backend, database or accounts.
- **PDF.js** renders pages and thumbnails; **pdf-lib** writes PDFs in a Web Worker (one
  worker per job, so cancelling terminates the work); **Fabric.js** powers the editors;
  **fflate** builds ZIPs incrementally.
- Annotations are converted into a small serialisable model (object matrix in page
  display space). Export maps display space to PDF user space with the inverse of the
  PDF.js viewport transform, which covers `/Rotate`, CropBox offsets and UserUnit; unit
  tests check it against PDF.js itself.
- More detail: [docs/architecture.md](docs/architecture.md).

## Known limitations

- Password-protected PDFs cannot be opened. Encrypted PDFs without an open password can
  be viewed and converted to images, but not modified (pdf-lib, which writes the PDFs, cannot decrypt them).
- Page organizer outputs are new documents: bookmarks, form fields' interactivity,
  internal links and attachments are not carried over (page content is).
- The annotator adds content only; it does not edit existing PDF text and is not a
  redaction tool. Text is single-weight (Regular) and left-to-right; one font per text
  object. Characters missing from the chosen font block the export with an explanation.
- Exported PNG/JPG files contain no EXIF/ICC metadata (colours are converted to sRGB by
  the browser). Text that is part of a picture is just pixels.
- Input image formats are PNG and JPG only (WebP, HEIC, GIF… are rejected with a hint).
- Very large documents and images are limited by the visitor's browser memory.
- Verified in Chromium (desktop and Android emulation). Firefox and Safari use the same
  standard APIs but were not part of the automated test run.

Planned work is listed in [docs/ROADMAP.md](docs/ROADMAP.md).

## License

PageSail's own code is released under the [MIT License](LICENSE)
(Copyright (c) 2026 cott-king). Third-party components keep their own licenses
(Apache-2.0 for PDF.js, MIT for pdf-lib/Fabric.js/React/fflate, SIL OFL 1.1 for the
Noto fonts, and others) — see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Every
build also publishes the full notices at `/licenses/THIRD_PARTY_NOTICES.txt`.

---

## 简体中文

[English](#pagesail) · **简体中文** · [日本語](#日本語)

PageSail 是一个开源、在浏览器中运行的 PDF 与图片工具。无需账号、无需订阅、不加水印、没有每日次数限制——你的文件也不会被上传。

> 我受够了只是想转换或编辑一个 PDF，却总要先注册账号，还得面对各种使用限制。因此，我正在打造 PageSail：一个开源、无需注册的在线 PDF 与图片工具，让有同样需求的人打开网页就能轻松处理文件。

源代码：<https://github.com/cott-king/PageSail> · 许可证：MIT（见[许可证](#许可证)）

### 已实现的功能（v0.1）

| 工具 | 功能 |
| --- | --- |
| **PDF 转 PNG/JPG** | 导出全部页面或 `1,3-5` 这样的页码范围；PNG 或 JPG（可调质量）；36–1200 DPI 并提示输出尺寸；PNG 可选透明背景；单页直接下载，多页打包 ZIP；真实进度与取消。正确处理页面旋转和 CropBox。 |
| **PNG/JPG 转 PDF** | 一次选择多张图片并显示缩略图；拖动或按钮排序、移除、继续添加、按文件名排序；A4/A3/A5/Letter/Legal 或“与图片相同”；纵向/横向/自动；以毫米设置边距；适应页面 / 填满页面（会裁切，界面明确标注）/ 实际尺寸。始终保持比例，应用 EXIF 方向，JPEG 原样嵌入不重新压缩。 |
| **PDF 页面管理** | 合并多个 PDF，删除、旋转、调整顺序（拖动、按钮或 Alt+方向键），提取选中页面，按每页 / 每 N 页 / 自定义范围拆分。支持撤销/重做，可预览生成的文件。页面按原样复制——文字仍是文字，不会被栅格化。 |
| **PDF 添加文字与标注** | 在任意页面上添加文字、图片、矩形、椭圆、直线、箭头和自由绘制；可移动、缩放、旋转、改色、调整不透明度、线宽、虚线和图层顺序；删除；每页独立撤销/重做，切换页面后保留各页修改。文字以可搜索的真实 PDF 文字导出，并嵌入 Noto 字体子集（中文、日文、拉丁字母）。 |
| **图片编辑** | PNG/JPG：裁剪（自由或固定比例，可输入数值）、按像素调整尺寸并锁定比例、90° 旋转、翻转、亮度/对比度、文字、图形、箭头、自由绘制、图层顺序、撤销/重做/重置；按实际输出尺寸导出 PNG（保留透明）或 JPG（质量与背景色可调）。 |

界面支持简体中文（默认）、英文和日文，主动选择的语言会保存在浏览器中。

**PDF 标注工具不做什么：** 它只在页面**上方**添加新内容，不修改或重新排版 PDF 中原有的文字；用白色矩形遮盖内容**不等于删除**——原内容仍在文件中，它不是脱敏工具。

### 隐私与文件处理

- 文件由网页**在你的浏览器中**处理（PDF.js、pdf-lib、Fabric.js、Web Worker），不会上传到 PageSail 服务器或任何第三方服务；没有广告、统计分析或追踪。
- 加载网页不等于上传文件：浏览器会从**本站**下载程序、PDF.js worker、CMap 和字体，不使用任何 CDN。
- 工作内容只存在于当前标签页，不写入 IndexedDB 等浏览器数据库；唯一保存的是语言选择（localStorage）。“清空工作区”会立即丢弃所有内容。
- 永远不会执行 PDF 中嵌入的 JavaScript（未包含 PDF.js 脚本功能）。
- Nginx 只允许 `GET`/`HEAD`，请求体限制为 1 KB，并发送带有 `connect-src 'self'` 的内容安全策略；访问日志不记录 IP 和浏览器标识。ngrok 等隧道服务仍可看到页面资源请求的常规信息（IP、路径），但看不到你的文档。
- 端到端测试会在真实文件处理过程中记录所有网络请求；只要出现同源静态 `GET` 以外的请求，或 URL 中出现文件名，测试就会失败。

**资源限制**（为防止浏览器卡死或崩溃，均可在构建时修改，没有每日配额）：PDF 500 MB（`VITE_MAX_PDF_MB`）、单张图片 100 MB（`VITE_MAX_IMAGE_MB`）、解码后图片 64 MP（`VITE_MAX_IMAGE_MEGAPIXELS`）、单页导出图片 64 MP（`VITE_MAX_RENDER_MEGAPIXELS`）、每批 200 个文件（`VITE_MAX_FILES`）、每页/每张图片 50 步撤销（`VITE_HISTORY_STEPS`）。应用还会检测浏览器能否真正创建所需尺寸的画布（例如 iOS Safari 约 16.7 MP 上限），并给出说明而不是输出空白图片。性能取决于访客的设备，而不是服务器。

### 本地运行

需要 Node.js **24 LTS**（22.13 以上亦可）和 npm：

```sh
npm ci               # 按 package-lock.json 安装依赖
npm run dev          # 开发服务器 http://127.0.0.1:5173
npm run typecheck    # 类型检查
npm run lint         # 代码检查
npm test             # 单元测试（Vitest）
npm run test:e2e     # 浏览器端到端测试（Playwright，会自行构建并启动）
npm run build        # 生产构建到 dist/（并生成供 Nginx 使用的 .gz 文件）
```

首次运行 `npm run test:e2e` 前需执行 `npx playwright install chromium`。测试已运行的部署：`PAGESAIL_BASE_URL=http://127.0.0.1:8080 PAGESAIL_EXPECT_HEADERS=1 npm run test:e2e`。

### 部署

生产环境使用 Docker（Node 构建阶段 + 非 root 的 Nginx 运行镜像，均支持 linux/arm64），默认只映射到本机 `127.0.0.1:8080`：

```sh
docker compose up -d --build
```

树莓派 5 + Raspberry Pi OS 64 位 + 外接 SSD + ngrok 的完整步骤：[docs/deploy-raspberry-pi.zh-CN.md](docs/deploy-raspberry-pi.zh-CN.md)。Vite 开发服务器和 `vite preview` 不能作为正式公网服务。

### 已知限制

- 无法打开需要密码的 PDF。没有打开密码的加密 PDF 可以查看和转为图片，但不能修改。
- 页面管理生成的是新文档：书签、表单交互、内部链接和附件不会保留（页面内容会保留）。
- 标注工具只添加内容，不修改原有文字，也不是脱敏工具；文字为单一字重（Regular）、从左到右，每个文字对象使用一种字体；所选字体缺字时会阻止导出并说明原因。
- 导出的 PNG/JPG 不含 EXIF/ICC 元数据；图片中的文字只是像素。
- 输入图片仅支持 PNG 和 JPG（WebP、HEIC、GIF 等会被拒绝并提示）。
- 自动化测试在 Chromium（桌面和 Android 模拟）上执行；Firefox 和 Safari 未纳入本次自动测试。

后续计划见 [docs/ROADMAP.md](docs/ROADMAP.md)。

### 许可证

PageSail 自身代码以 [MIT 许可证](LICENSE) 发布（Copyright (c) 2026 cott-king）。第三方组件保留各自的许可证（PDF.js 为 Apache-2.0，pdf-lib/Fabric.js/React/fflate 为 MIT，Noto 字体为 SIL OFL 1.1 等），并不会因此变为 MIT，详见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。每次构建都会在 `/licenses/THIRD_PARTY_NOTICES.txt` 发布完整声明。

---

## 日本語

[English](#pagesail) · [简体中文](#简体中文) · **日本語**

PageSail は、ブラウザだけで動作するオープンソースの PDF・画像ツールです。アカウント不要、サブスクなし、透かしなし、1 日の回数制限なし。ファイルがアップロードされることもありません。

> PDF を変換したり編集したりしたいだけなのに、毎回アカウント登録を求められ、さまざまな利用制限にも悩まされる——そんな状況にうんざりしていました。そこで、同じ悩みを持つ人がページを開くだけで手軽にファイルを処理できるよう、オープンソースで登録不要のオンライン PDF・画像ツール「PageSail」を開発しています。

ソースコード：<https://github.com/cott-king/PageSail> · ライセンス：MIT（[ライセンス](#ライセンス)を参照）

### 実装済みの機能（v0.1）

| ツール | 内容 |
| --- | --- |
| **PDF → PNG/JPG** | 全ページまたは `1,3-5` のような範囲を指定。PNG または JPG（品質設定あり）、36〜1200 DPI と出力サイズの目安、PNG の透明背景オプション。1 ページはそのまま、複数ページは ZIP でダウンロード。実際の進捗表示とキャンセル。回転ページと CropBox に対応。 |
| **PNG/JPG → PDF** | 複数画像をサムネイル付きで追加。ドラッグやボタンで並べ替え、削除、追加、名前順ソート。A4/A3/A5/Letter/Legal または「画像と同じ」、縦/横/自動、mm 単位の余白、ページに合わせる／ページを埋める（端が切れることを明示）／実寸。縦横比を常に保持し、EXIF の向きを反映、JPEG は再圧縮せずに埋め込みます。 |
| **PDF ページの整理** | 複数 PDF の結合、削除、回転、並べ替え（ドラッグ、ボタン、Alt+矢印キー）、選択ページの抽出、1 ページずつ／N ページごと／範囲指定での分割。元に戻す／やり直し、生成ファイルのプレビュー。ページはそのままコピーされ、文字は文字のまま、画像化されません。 |
| **PDF に文字・注釈を追加** | 任意のページに文字、画像、四角形、楕円、直線、矢印、手書きを追加。移動、拡大縮小、回転、色、不透明度、線幅、破線、重ね順の変更、削除。ページごとの元に戻す／やり直し、ページを切り替えても編集内容を保持。文字は Noto フォントのサブセットを埋め込んだ検索可能な本物の PDF テキストとして書き出します（中国語・日本語・ラテン文字）。 |
| **画像編集** | PNG/JPG：トリミング（自由・固定比率、数値入力）、縦横比を保ったピクセル単位のサイズ変更、90° 回転、反転、明るさ・コントラスト、文字、図形、矢印、手書き、重ね順、元に戻す／やり直し／リセット。実際の出力サイズで PNG（透明を保持）または JPG（品質と背景色を指定）に書き出し。 |

表示言語は簡体字中国語（既定）、英語、日本語に対応し、選択した言語はブラウザに保存されます。

**PDF 注釈ツールでできないこと：** ページの**上に**新しい内容を追加するだけで、PDF に元からある文字の編集や再レイアウトはしません。白い四角で隠しても内容は**削除されず**ファイルに残ります。墨消し（安全な黒塗り）ツールではありません。

### プライバシーとファイルの扱い

- ファイルは**ブラウザ内で**処理されます（PDF.js、pdf-lib、Fabric.js、Web Worker）。PageSail のサーバーや第三者のサービスにアップロードされることはなく、広告・アクセス解析・トラッキングもありません。
- ページの読み込みはファイルのアップロードではありません。ブラウザはアプリ、PDF.js worker、CMap、フォントを**同じサイトから**ダウンロードします。CDN は使いません。
- 作業内容は現在のタブにのみ存在し、IndexedDB などには保存されません。保存されるのは表示言語の選択（localStorage）だけです。「ワークスペースをクリア」ですぐに破棄できます。
- PDF に埋め込まれた JavaScript は実行されません（PDF.js のスクリプト機能は同梱していません）。
- Nginx は `GET`/`HEAD` のみを許可し、リクエスト本文を 1 KB に制限し、`connect-src 'self'` を含む CSP を送信します。アクセスログには IP アドレスやユーザーエージェントを記録しません。ngrok などのトンネルサービスはページ資源へのリクエスト情報（IP、パス）を見ることができますが、文書は見えません。
- E2E テストは実際のファイル処理中のネットワークリクエストをすべて記録し、同一オリジンの静的 `GET` 以外が発生した場合や URL にファイル名が含まれた場合に失敗します。

**リソース上限**（ブラウザのフリーズやクラッシュを防ぐためのもので、ビルド時に変更可能。1 日の回数制限はありません）：PDF 500 MB、画像ファイル 100 MB、デコード後の画像 64 MP、書き出すページ画像 64 MP、一度に 200 ファイル、ページ／画像ごとに 50 回の元に戻す。変数名は英語版の表を参照してください。性能はサーバーではなく利用者の端末に依存します。

### ローカルでの実行

Node.js **24 LTS**（22.13 以上でも可）と npm が必要です：

```sh
npm ci
npm run dev          # http://127.0.0.1:5173
npm run typecheck
npm run lint
npm test             # 単体テスト（Vitest）
npm run test:e2e     # ブラウザテスト（Playwright。ビルドとサーバー起動を自動で行います）
npm run build        # 本番ビルド（dist/）
```

### デプロイ

本番環境は Docker（Node のビルドステージ + 非 root の Nginx。どちらも linux/arm64 対応）で、既定では `127.0.0.1:8080` のみに公開します：`docker compose up -d --build`。Raspberry Pi 5 と ngrok での手順は [docs/deploy-raspberry-pi.md](docs/deploy-raspberry-pi.md)（英語）／[简体中文版](docs/deploy-raspberry-pi.zh-CN.md) を参照してください。Vite の開発サーバーや `vite preview` は公開用ではありません。

### 既知の制限

- パスワードが必要な PDF は開けません。開封パスワードのない暗号化 PDF は表示・画像化できますが、変更はできません。
- ページ整理の出力は新しい文書のため、しおり、フォームの操作性、内部リンク、添付ファイルは引き継がれません（ページ内容は保持されます）。
- 注釈ツールは内容を追加するのみで、既存の文字は編集できず、墨消しツールでもありません。文字は Regular の 1 ウェイト・左から右のみで、テキストごとに 1 フォントです。フォントにない文字がある場合は理由を示して書き出しを止めます。
- 書き出した PNG/JPG には EXIF/ICC メタデータは含まれません。画像内の文字はピクセルです。
- 入力画像は PNG と JPG のみです（WebP、HEIC、GIF などはメッセージ付きで拒否）。
- 自動テストは Chromium（デスクトップと Android エミュレーション）で実施しています。Firefox と Safari は今回の自動テストに含まれていません。

今後の予定は [docs/ROADMAP.md](docs/ROADMAP.md) にあります。

### ライセンス

PageSail 独自のコードは [MIT ライセンス](LICENSE)（Copyright (c) 2026 cott-king）で公開しています。サードパーティのコンポーネントはそれぞれのライセンス（PDF.js は Apache-2.0、pdf-lib/Fabric.js/React/fflate は MIT、Noto フォントは SIL OFL 1.1 など）のままであり、MIT に変更されるわけではありません。詳細は [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) を参照してください。各ビルドは `/licenses/THIRD_PARTY_NOTICES.txt` に全文を公開します。
