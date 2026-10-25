import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Point, type FabricObject } from 'fabric';
import { ToolHeader } from '../../app/Layout';
import { useLeaveGuard } from '../../app/router';
import { DropZone } from '../../components/DropZone';
import { Alert, ErrorAlert, ProgressBar } from '../../components/Feedback';
import { Icon } from '../../components/Icon';
import { Modal } from '../../components/Modal';
import { PdfResultPreview } from '../../components/PdfResultPreview';
import { PdfThumb } from '../../components/PdfThumb';
import {
  applyStyle,
  createImage,
  createText,
  describeSelection,
  moveLayer,
  nudgeSelected,
  removeSelected,
  type DrawStyle,
  type SelectionInfo,
  type StylePatch,
  type ToolId,
} from '../../editor/fabricKit';
import { missingCharacters } from '../../editor/cmap';
import { fontDef, defaultFontFor, getLoadedFont, loadFont, type FontId } from '../../editor/fonts';
import { PropertiesPanel, type FontIssue } from '../../editor/PropertiesPanel';
import { ToolPalette, toolForKey } from '../../editor/ToolPalette';
import { useI18n } from '../../i18n/I18nProvider';
import type { Locale } from '../../i18n/messages';
import { AppError, isCancelled } from '../../lib/errors';
import { bytesToBlob, downloadBlob } from '../../lib/files/download';
import { baseName, formatBytes, withExtension } from '../../lib/files/names';
import type { ImageInfo } from '../../lib/images/header';
import { checkImageFile } from '../../lib/images/loadImage';
import { displaySize, displayToPdfMatrix, type PageGeometry } from '../../lib/pdf/coords';
import { loadPdfFile, type LoadedPdf } from '../../lib/pdf/loadPdfFile';
import { pageGeometry } from '../../lib/pdf/pdfjs';
import { createCanvas, releaseCanvas } from '../../lib/canvas';
import { runJob } from '../../workers/client';
import { AnnotatorEngine } from './AnnotatorEngine';
import type { AnnotatedPage, Annotation, EmbeddedImage } from './model';
import { objectToAnnotation } from './toModel';

const MAX_BITMAP_PIXELS = 16_000_000;
const ZOOM_STEPS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4];

interface RegisteredImage extends EmbeddedImage {
  url: string;
}

interface ExportIssue {
  page: number;
  font: FontId;
  missing: string[];
}

function initialStyle(locale: Locale): DrawStyle {
  return {
    stroke: '#e5484d',
    fill: null,
    strokeWidth: 2,
    opacity: 1,
    dashed: false,
    textColor: '#1f2937',
    fontSize: 16,
    fontId: defaultFontFor(locale),
  };
}

function suggestionFor(text: string, current: FontId, locale: Locale): FontId | null {
  const order: FontId[] = locale === 'ja' && current !== 'noto-sans-jp' ? ['noto-sans-jp', 'noto-sans-sc'] : ['noto-sans-sc', 'noto-sans-jp'];
  for (const id of order) {
    if (id === current) continue;
    const f = getLoadedFont(id);
    if (!f || missingCharacters(text, f.coverage).length === 0) return id;
  }
  return null;
}

/** Renders the original page with pdf.js under the editing layer (off-screen first, so zooming never flickers). */
function PageBitmap({ pdf, pageIndex, zoom, size }: { pdf: LoadedPdf; pageIndex: number; zoom: number; size: { width: number; height: number } }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let cancelled = false;
    let task: { cancel: () => void } | null = null;
    const off = createCanvas(1, 1);
    (async () => {
      const page = await pdf.opened.doc.getPage(pageIndex + 1);
      if (cancelled) return;
      const base = page.getViewport({ scale: 1 });
      let scale = zoom * Math.min(3, window.devicePixelRatio || 1);
      if (base.width * base.height * scale * scale > MAX_BITMAP_PIXELS) scale = Math.sqrt(MAX_BITMAP_PIXELS / (base.width * base.height));
      const viewport = page.getViewport({ scale });
      off.width = Math.ceil(viewport.width);
      off.height = Math.ceil(viewport.height);
      const render = page.render({ canvas: off, viewport });
      task = render;
      await render.promise;
      if (cancelled || !ref.current) return;
      const c = ref.current;
      c.width = off.width;
      c.height = off.height;
      c.getContext('2d')?.drawImage(off, 0, 0);
    })().catch(() => undefined);
    return () => {
      cancelled = true;
      task?.cancel();
      releaseCanvas(off);
    };
  }, [pdf, pageIndex, zoom]);
  return <canvas ref={ref} className="page-bitmap" style={{ width: size.width * zoom, height: size.height * zoom }} aria-hidden="true" />;
}

export default function PdfAnnotatePage() {
  const { t, locale } = useI18n();
  const [pdf, setPdf] = useState<LoadedPdf | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [current, setCurrent] = useState(0);
  const [geometry, setGeometry] = useState<PageGeometry | null>(null);
  const [zoom, setZoom] = useState(1);
  const [tool, setToolState] = useState<ToolId>('select');
  const [style, setStyle] = useState<DrawStyle>(() => initialStyle(locale));
  const [selection, setSelection] = useState<SelectionInfo | null>(null);
  const [selectionKey, setSelectionKey] = useState('');
  const [focusToken, setFocusToken] = useState(0);
  const [fontLoading, setFontLoading] = useState<FontId | null>(null);
  const [tick, setTick] = useState(0);
  const [exportedVersion, setExportedVersion] = useState(0);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [issues, setIssues] = useState<ExportIssue[] | null>(null);
  const [result, setResult] = useState<{ bytes: Uint8Array; name: string } | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [cancelled, setCancelled] = useState(false);
  /** Fit the page to the width once the editor is laid out (it is hidden until a file is loaded). */
  const [needsFit, setNeedsFit] = useState(false);
  /** The engine is created imperatively; state holds it for rendering, the ref for event handlers. */
  const [engine, setEngine] = useState<AnnotatorEngine | null>(null);

  const engineRef = useRef<AnnotatorEngine | null>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const styleRef = useRef(style);
  useEffect(() => {
    styleRef.current = style;
  }, [style]);
  const pdfRef = useRef<LoadedPdf | null>(null);
  const images = useRef(new Map<string, RegisteredImage>());
  const geometries = useRef(new Map<number, PageGeometry>());
  const abortRef = useRef<AbortController | null>(null);
  const objectIds = useRef(new WeakMap<object, string>());
  const nextObjectId = useRef(1);

  const dirty = engine !== null && engine.version !== exportedVersion;
  useLeaveGuard(dirty, t('common.leaveWarning'));

  const refreshSelection = useCallback(() => {
    const e = engineRef.current;
    if (!e) return;
    setSelection(describeSelection(e.canvas));
    const active = e.canvas.getActiveObject();
    if (active) {
      let id = objectIds.current.get(active);
      if (!id) {
        id = `obj-${nextObjectId.current++}`;
        objectIds.current.set(active, id);
      }
      setSelectionKey(id);
    } else setSelectionKey('');
  }, []);

  const setTool = useCallback((tl: ToolId) => {
    setToolState(tl);
    engineRef.current?.drawing.setTool(tl);
  }, []);

  const addText = useCallback(
    async (at: Point) => {
      const e = engineRef.current;
      if (!e) return;
      const s = styleRef.current;
      try {
        if (!getLoadedFont(s.fontId)) setFontLoading(s.fontId);
        await loadFont(s.fontId);
      } catch (err) {
        setError(err);
        return;
      } finally {
        setFontLoading(null);
      }
      const text = createText(t('editor.defaultText'), at, s);
      e.canvas.add(text);
      setTool('select');
      e.canvas.setActiveObject(text);
      e.canvas.requestRenderAll();
      e.commit();
      refreshSelection();
      setFocusToken((n) => n + 1);
    },
    [refreshSelection, setTool, t],
  );

  // Engine callbacks go through a ref so the engine (created once per document) always calls the latest handlers.
  const hooksRef = useRef({
    onTextClick: (_p: Point) => {},
    onCreated: (_obj: FabricObject) => {},
  });
  useEffect(() => {
    hooksRef.current.onTextClick = (p: Point) => void addText(p);
    hooksRef.current.onCreated = (obj: FabricObject) => {
      const e = engineRef.current!;
      if (e.drawing.tool !== 'pen') {
        setTool('select');
        e.canvas.setActiveObject(obj);
      }
      e.canvas.requestRenderAll();
      e.commit();
      refreshSelection();
    };
  }, [addText, setTool, refreshSelection]);

  const ensureEngine = () => {
    if (engineRef.current || !hostRef.current) return;
    const e = new AnnotatorEngine(hostRef.current, {
      getStyle: () => styleRef.current,
      onChange: () => setTick((n) => n + 1),
      onSelection: refreshSelection,
      onTextClick: (p) => hooksRef.current.onTextClick(p),
      onCreated: (obj) => hooksRef.current.onCreated(obj),
    });
    engineRef.current = e;
    setEngine(e);
  };

  const disposeAll = useCallback(() => {
    abortRef.current?.abort();
    engineRef.current?.dispose();
    engineRef.current = null;
    setEngine(null);
    if (hostRef.current) hostRef.current.innerHTML = '';
    pdfRef.current?.dispose();
    pdfRef.current = null;
    images.current.forEach((img) => URL.revokeObjectURL(img.url));
    images.current.clear();
    geometries.current.clear();
  }, []);

  useEffect(() => disposeAll, [disposeAll]);

  const getGeometry = useCallback(async (index: number): Promise<PageGeometry> => {
    const cached = geometries.current.get(index);
    if (cached) return cached;
    const page = await pdfRef.current!.opened.doc.getPage(index + 1);
    const g = pageGeometry(page);
    geometries.current.set(index, g);
    return g;
  }, []);

  const fitWidth = useCallback((g: PageGeometry) => {
    const container = scrollRef.current;
    const size = displaySize(g);
    const avail = container ? container.clientWidth - 32 : 800;
    return Math.max(0.25, Math.min(2, avail / size.width));
  }, []);

  // Show the current page in the editor when it, or the engine, changes.
  useEffect(() => {
    if (!pdf) return;
    let stop = false;
    getGeometry(current)
      .then((g) => {
        if (stop) return;
        setGeometry(g);
        engineRef.current?.showPage(current, displaySize(g));
        setTick((n) => n + 1);
      })
      .catch((e) => setError(e));
    return () => {
      stop = true;
    };
  }, [pdf, current, getGeometry]);

  useEffect(() => {
    engineRef.current?.setZoom(zoom);
  }, [zoom]);

  useLayoutEffect(() => {
    if (!needsFit || !geometry || !scrollRef.current || scrollRef.current.clientWidth === 0) return;
    setZoom(fitWidth(geometry));
    setNeedsFit(false);
  }, [needsFit, geometry, fitWidth]);

  const clear = () => {
    if (dirty && !window.confirm(t('common.clearConfirm'))) return;
    disposeAll();
    setPdf(null);
    setGeometry(null);
    setCurrent(0);
    setSelection(null);
    setResult(null);
    setIssues(null);
    setError(null);
    setExportedVersion(0);
    setCancelled(false);
    setToolState('select');
  };

  const onFiles = async (files: File[]) => {
    disposeAll();
    setPdf(null);
    setError(null);
    setResult(null);
    setExportedVersion(0);
    setLoading(true);
    try {
      const loaded = await loadPdfFile(files[0]);
      try {
        await runJob('inspectPdf', { bytes: loaded.bytes }, { fallbackError: 'error.pdfParseEdit' });
      } catch (e) {
        loaded.dispose();
        throw e;
      }
      pdfRef.current = loaded;
      ensureEngine();
      await getGeometry(0);
      setNeedsFit(true);
      setCurrent(0);
      setPdf(loaded);
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  };

  const goTo = (index: number) => {
    if (!pdf) return;
    const i = Math.min(pdf.pageCount - 1, Math.max(0, index));
    if (i !== current) {
      setTool(tool === 'pen' ? 'pen' : 'select');
      setCurrent(i);
    }
  };

  const onStyleChange = async (patch: StylePatch, commit: boolean) => {
    const e = engineRef.current;
    if (patch.fontId && !getLoadedFont(patch.fontId)) {
      setFontLoading(patch.fontId);
      try {
        await loadFont(patch.fontId);
      } catch (err) {
        setError(err);
        return;
      } finally {
        setFontLoading(null);
      }
    }
    setStyle((s) => ({
      ...s,
      ...(patch.stroke !== undefined && { stroke: patch.stroke }),
      ...(patch.fill !== undefined && { fill: patch.fill }),
      ...(patch.strokeWidth !== undefined && { strokeWidth: patch.strokeWidth }),
      ...(patch.opacity !== undefined && { opacity: patch.opacity }),
      ...(patch.dashed !== undefined && { dashed: patch.dashed }),
      ...(patch.textColor !== undefined && { textColor: patch.textColor }),
      ...(patch.fontSize !== undefined && { fontSize: patch.fontSize }),
      ...(patch.fontId !== undefined && { fontId: patch.fontId }),
    }));
    if (e && e.canvas.getActiveObject()) {
      applyStyle(e.canvas, patch);
      if (commit) e.commit();
      refreshSelection();
    }
    if (e && tool === 'pen') queueMicrotask(() => e.drawing.updateBrush());
  };

  const addImage = async (file: File) => {
    const e = engineRef.current;
    if (!e || !geometry) return;
    try {
      const info: ImageInfo = await checkImageFile(file);
      const bytes = new Uint8Array(await file.arrayBuffer());
      const url = URL.createObjectURL(file);
      const id = `img-${images.current.size + 1}-${Date.now().toString(36)}`;
      images.current.set(id, { bytes, type: info.type, width: info.width, height: info.height, orientation: info.orientation, url });
      const size = e.pageSize;
      const img = await createImage(url, id, new Point(size.width / 2, size.height / 2), size.width * 0.6, size.height * 0.6);
      e.canvas.add(img);
      setTool('select');
      e.canvas.setActiveObject(img);
      e.canvas.requestRenderAll();
      e.commit();
      refreshSelection();
    } catch (err) {
      setError(err);
    }
  };

  const onDelete = () => {
    const e = engineRef.current;
    if (e && removeSelected(e.canvas)) {
      e.commit();
      refreshSelection();
    }
  };

  const onLayer = (how: Parameters<typeof moveLayer>[1]) => {
    const e = engineRef.current;
    if (e && moveLayer(e.canvas, how)) e.commit();
  };

  const undo = () => void engineRef.current?.undo();
  const redo = () => void engineRef.current?.redo();

  // Keyboard shortcuts (ignored while typing in a form field).
  useEffect(() => {
    if (!pdf) return;
    const onKey = (ev: KeyboardEvent) => {
      const target = ev.target as HTMLElement | null;
      if (target && (target.closest('input, textarea, select, [contenteditable="true"]') || target.closest('dialog'))) return;
      const e = engineRef.current;
      if (!e) return;
      const mod = ev.ctrlKey || ev.metaKey;
      if (mod && ev.key.toLowerCase() === 'z') {
        ev.preventDefault();
        if (ev.shiftKey) redo();
        else undo();
      } else if (mod && ev.key.toLowerCase() === 'y') {
        ev.preventDefault();
        redo();
      } else if (ev.key === 'Delete' || ev.key === 'Backspace') {
        if (e.canvas.getActiveObject()) {
          ev.preventDefault();
          onDelete();
        }
      } else if (ev.key === 'Escape') {
        setTool('select');
        e.canvas.discardActiveObject();
        e.canvas.requestRenderAll();
      } else if (ev.key.startsWith('Arrow') && e.canvas.getActiveObject()) {
        ev.preventDefault();
        const step = ev.shiftKey ? 10 : 1;
        const dx = ev.key === 'ArrowLeft' ? -step : ev.key === 'ArrowRight' ? step : 0;
        const dy = ev.key === 'ArrowUp' ? -step : ev.key === 'ArrowDown' ? step : 0;
        if (nudgeSelected(e.canvas, dx, dy)) e.commit();
      } else if (ev.key === 'PageDown') {
        ev.preventDefault();
        goTo(current + 1);
      } else if (ev.key === 'PageUp') {
        ev.preventDefault();
        goTo(current - 1);
      } else if (!mod && !ev.altKey) {
        const tl = toolForKey(ev.key);
        if (tl) setTool(tl);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const fontIssue: FontIssue | null = (() => {
    if (!selection || selection.text === undefined || !selection.fontId) return null;
    const f = getLoadedFont(selection.fontId);
    if (!f) return null;
    const missing = missingCharacters(selection.text, f.coverage);
    return missing.length ? { missing, suggestion: suggestionFor(selection.text, selection.fontId, locale) } : null;
  })();

  const exportPdf = async () => {
    const e = engineRef.current;
    const doc = pdfRef.current;
    if (!e || !doc) return;
    await e.idle();
    e.canvas.discardActiveObject();
    e.canvas.requestRenderAll();
    setError(null);
    setResult(null);
    setIssues(null);
    setCancelled(false);
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      const pages: AnnotatedPage[] = [];
      const found: ExportIssue[] = [];
      const fonts: Record<string, Uint8Array> = {};
      const imgs: Record<string, EmbeddedImage> = {};
      for (const index of e.editedPages()) {
        const g = await getGeometry(index);
        const annotations = e
          .objectsFor(index)
          .map(objectToAnnotation)
          .filter((a): a is Annotation => a !== null);
        for (const a of annotations) {
          if (a.kind === 'text') {
            const f = await loadFont(a.fontId as FontId);
            fonts[a.fontId] = f.bytes;
            const missing = missingCharacters(a.lines.map((l) => l.text).join('\n'), f.coverage);
            if (missing.length) found.push({ page: index + 1, font: a.fontId as FontId, missing });
          } else if (a.kind === 'image') {
            const img = images.current.get(a.imageId);
            if (!img) throw new AppError('error.internal', undefined, `Missing image ${a.imageId}`);
            imgs[a.imageId] = { bytes: img.bytes, type: img.type, width: img.width, height: img.height, orientation: img.orientation };
          }
        }
        pages.push({ pageIndex: index, displayToPdf: displayToPdfMatrix(g), annotations });
      }
      if (found.length) {
        setIssues(found);
        return;
      }
      const version = e.version;
      setProgress({ done: 0, total: pages.length + 1 });
      const bytes = await runJob(
        'exportAnnotations',
        { pdf: doc.bytes, pages, fonts, images: imgs },
        { signal: ctrl.signal, onProgress: (done, total) => setProgress({ done, total }), fallbackError: 'error.annotateFailed' },
      );
      if (ctrl.signal.aborted) return;
      const name = withExtension(`${baseName(doc.name)}_annotated`, 'pdf');
      setResult({ bytes, name });
      setExportedVersion(version);
      downloadBlob(bytesToBlob(bytes, 'application/pdf'), name);
    } catch (err) {
      if (isCancelled(err) || ctrl.signal.aborted) setCancelled(true);
      else setError(err);
    } finally {
      if (abortRef.current === ctrl) abortRef.current = null;
      setProgress(null);
    }
  };

  const editedPages = engine ? new Set(engine.editedPages()) : new Set<number>();
  const size = geometry ? displaySize(geometry) : null;
  void tick;

  return (
    <div className="page wide">
      <ToolHeader title={t('tool.pdfAnnotate.title')} description={t('tool.pdfAnnotate.desc')} />
      {!pdf && (
        <>
          <DropZone
            accept="application/pdf,.pdf"
            onFiles={onFiles}
            title={t('common.choosePdf')}
            hint={t('common.localHint')}
            disabled={loading}
            testId="pdf-input"
          />
          <Alert kind="info" title={t('annot.scopeTitle')}>
            {t('annot.scopeText')}
          </Alert>
        </>
      )}
      {loading && <ProgressBar label={t('common.openingFile')} />}
      {error !== null && (
        <ErrorAlert
          error={error}
          actions={
            <button type="button" className="btn" onClick={() => setError(null)}>
              {t('common.dismiss')}
            </button>
          }
        />
      )}
      <div className={`editor${pdf ? '' : ' is-hidden'}`}>
        {pdf && (
          <div className="editor-bar">
            <div className="file-info">
              <strong className="file-name">{pdf.name}</strong>
              <span className="muted small">{formatBytes(pdf.size, locale)}</span>
            </div>
            <div className="row gap" role="group" aria-label={t('annot.pageNav')}>
              <button
                type="button"
                className="btn btn-icon"
                onClick={() => goTo(current - 1)}
                disabled={current === 0}
                aria-label={t('annot.prevPage')}
                title={t('annot.prevPage')}
              >
                <Icon name="chevronLeft" />
              </button>
              <label className="page-input">
                <span className="visually-hidden">{t('annot.pageNumber')}</span>
                <input
                  type="number"
                  min={1}
                  max={pdf.pageCount}
                  value={current + 1}
                  onChange={(e) => {
                    const n = Number(e.target.value);
                    if (Number.isInteger(n)) goTo(n - 1);
                  }}
                  data-testid="page-number"
                />
                <span>/ {pdf.pageCount}</span>
              </label>
              <button
                type="button"
                className="btn btn-icon"
                onClick={() => goTo(current + 1)}
                disabled={current >= pdf.pageCount - 1}
                aria-label={t('annot.nextPage')}
                title={t('annot.nextPage')}
                data-testid="next-page"
              >
                <Icon name="chevronRight" />
              </button>
            </div>
            <div className="row gap" role="group" aria-label={t('annot.zoom')}>
              <button
                type="button"
                className="btn btn-icon"
                onClick={() =>
                  setZoom(
                    (z) =>
                      ZOOM_STEPS.slice()
                        .reverse()
                        .find((s) => s < z - 0.001) ?? z,
                  )
                }
                aria-label={t('annot.zoomOut')}
                title={t('annot.zoomOut')}
              >
                <Icon name="zoomOut" />
              </button>
              <span className="zoom-label" aria-live="polite">
                {Math.round(zoom * 100)}%
              </span>
              <button
                type="button"
                className="btn btn-icon"
                onClick={() => setZoom((z) => ZOOM_STEPS.find((s) => s > z + 0.001) ?? z)}
                aria-label={t('annot.zoomIn')}
                title={t('annot.zoomIn')}
              >
                <Icon name="zoomIn" />
              </button>
              <button
                type="button"
                className="btn btn-icon"
                onClick={() => geometry && setZoom(fitWidth(geometry))}
                aria-label={t('annot.fitWidth')}
                title={t('annot.fitWidth')}
              >
                <Icon name="fit" />
              </button>
            </div>
            <div className="row gap">
              <button
                type="button"
                className="btn btn-icon"
                onClick={undo}
                disabled={!engine?.canUndo}
                aria-label={t('common.undo')}
                title={t('common.undoShortcut')}
                data-testid="undo"
              >
                <Icon name="undo" />
              </button>
              <button
                type="button"
                className="btn btn-icon"
                onClick={redo}
                disabled={!engine?.canRedo}
                aria-label={t('common.redo')}
                title={t('common.redoShortcut')}
                data-testid="redo"
              >
                <Icon name="redo" />
              </button>
              <button type="button" className="btn" onClick={clear}>
                {t('common.clearWorkspace')}
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={exportPdf}
                disabled={progress !== null || editedPages.size === 0}
                data-testid="export-pdf"
              >
                <Icon name="download" size={18} /> {t('annot.export')}
              </button>
            </div>
          </div>
        )}
        {progress && (
          <div className="row gap">
            <ProgressBar value={progress.done} max={progress.total} label={t('annot.exporting')} />
            <button type="button" className="btn" onClick={() => abortRef.current?.abort()}>
              {t('common.cancel')}
            </button>
          </div>
        )}
        {cancelled && <Alert kind="info">{t('common.cancelledNoOutput')}</Alert>}
        {issues && (
          <Alert kind="error" title={t('annot.missingTitle')}>
            <p>{t('annot.missingText')}</p>
            <ul className="plain-list" data-testid="missing-glyphs">
              {issues.map((i, k) => (
                <li key={k}>{t('annot.missingItem', { page: i.page, font: t(fontDef(i.font).label), chars: i.missing.slice(0, 20).join(' ') })}</li>
              ))}
            </ul>
          </Alert>
        )}
        {result && (
          <Alert
            kind="success"
            title={t('common.done')}
            actions={
              <>
                <button type="button" className="btn" onClick={() => setPreviewOpen(true)} data-testid="preview-result">
                  <Icon name="eye" size={16} /> {t('common.preview')}
                </button>
                <button type="button" className="btn" onClick={() => downloadBlob(bytesToBlob(result.bytes, 'application/pdf'), result.name)}>
                  {t('common.downloadAgain')}
                </button>
              </>
            }
          >
            {t('annot.done', { name: result.name })}
          </Alert>
        )}
        <div className="editor-body">
          {pdf && (
            <nav className="editor-pages" aria-label={t('common.pages')}>
              <ol>
                {Array.from({ length: pdf.pageCount }, (_, i) => (
                  <li key={i}>
                    <button
                      type="button"
                      className={`page-card small${i === current ? ' is-current' : ''}`}
                      aria-current={i === current ? 'page' : undefined}
                      aria-label={editedPages.has(i) ? t('annot.pageEdited', { page: i + 1 }) : t('common.pageN', { page: i + 1 })}
                      onClick={() => goTo(i)}
                    >
                      <PdfThumb cache={pdf.thumbs} pageIndex={i} size={96} alt="" />
                      <span className="page-num">{i + 1}</span>
                      {editedPages.has(i) && <span className="edited-dot" aria-hidden="true" />}
                    </button>
                  </li>
                ))}
              </ol>
            </nav>
          )}
          <div className="editor-stage-scroll" ref={scrollRef}>
            <div
              className="editor-stage"
              style={size ? { width: size.width * zoom, height: size.height * zoom } : undefined}
              data-testid="stage"
              data-page={current + 1}
              data-display-width={size?.width}
              aria-label={t('annot.stageLabel', { page: current + 1 })}
            >
              {pdf && size && <PageBitmap pdf={pdf} pageIndex={current} zoom={zoom} size={size} />}
              <div className="fabric-host" ref={hostRef} />
            </div>
          </div>
          {pdf && (
            <aside className="editor-side">
              <ToolPalette
                tool={tool}
                onTool={setTool}
                extra={
                  <button
                    type="button"
                    className="btn btn-tool"
                    onClick={() => imageInputRef.current?.click()}
                    aria-label={t('editor.tool.image')}
                    title={t('editor.tool.image')}
                    data-testid="tool-image"
                  >
                    <Icon name="imageAdd" />
                    <span className="btn-tool-label">{t('editor.tool.image')}</span>
                  </button>
                }
              />
              <input
                ref={imageInputRef}
                type="file"
                accept="image/png,image/jpeg,.png,.jpg,.jpeg"
                hidden
                data-testid="annot-image-input"
                onChange={(e) => {
                  const f = e.currentTarget.files?.[0];
                  e.currentTarget.value = '';
                  if (f) void addImage(f);
                }}
              />
              <PropertiesPanel
                tool={tool}
                style={style}
                selection={selection}
                onChange={(p, c) => void onStyleChange(p, c)}
                onCommit={() => engineRef.current?.commit()}
                onLayer={onLayer}
                onDelete={onDelete}
                fontLoading={fontLoading}
                fontIssue={fontIssue}
                focusTextToken={focusToken}
                selectionKey={selectionKey}
              />
              <p className="muted small">{t('annot.historyHint')}</p>
              <details className="small">
                <summary>{t('annot.aboutTitle')}</summary>
                <p className="muted">{t('annot.aboutText')}</p>
              </details>
            </aside>
          )}
        </div>
      </div>
      <Modal
        open={previewOpen && result !== null}
        title={result ? t('pages.previewTitle', { name: result.name }) : ''}
        onClose={() => setPreviewOpen(false)}
        wide
      >
        {result && <PdfResultPreview bytes={result.bytes} />}
      </Modal>
    </div>
  );
}
