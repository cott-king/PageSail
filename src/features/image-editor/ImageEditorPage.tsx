import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Point, type FabricObject } from 'fabric';
import { ToolHeader } from '../../app/Layout';
import { useLeaveGuard } from '../../app/router';
import { DropZone } from '../../components/DropZone';
import { Alert, ErrorAlert, ProgressBar } from '../../components/Feedback';
import { Icon } from '../../components/Icon';
import {
  applyStyle,
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
import { defaultFontFor, getLoadedFont, loadFont, type FontId } from '../../editor/fonts';
import { PropertiesPanel, type FontIssue } from '../../editor/PropertiesPanel';
import { ToolPalette, toolForKey } from '../../editor/ToolPalette';
import { useI18n } from '../../i18n/I18nProvider';
import type { Locale } from '../../i18n/messages';
import { canAllocateCanvas } from '../../lib/canvas';
import { AppError } from '../../lib/errors';
import { downloadBlob } from '../../lib/files/download';
import { baseName, formatBytes, withExtension } from '../../lib/files/names';
import { checkImageFile, decodeImage } from '../../lib/images/loadImage';
import { ImageEditorEngine, type CropRect } from './ImageEditorEngine';

const RATIOS: { id: string; label: string; value: number | null | 'original' }[] = [
  { id: 'free', label: '', value: null },
  { id: 'original', label: '', value: 'original' },
  { id: '1:1', label: '1:1', value: 1 },
  { id: '4:3', label: '4:3', value: 4 / 3 },
  { id: '3:4', label: '3:4', value: 3 / 4 },
  { id: '16:9', label: '16:9', value: 16 / 9 },
  { id: '9:16', label: '9:16', value: 9 / 16 },
  { id: '3:2', label: '3:2', value: 3 / 2 },
  { id: '2:3', label: '2:3', value: 2 / 3 },
];

function initialStyle(locale: Locale): DrawStyle {
  return { stroke: '#e5484d', fill: null, strokeWidth: 6, opacity: 1, dashed: false, textColor: '#ffffff', fontSize: 48, fontId: defaultFontFor(locale) };
}

interface Loaded {
  name: string;
  size: number;
  type: 'png' | 'jpeg';
}

export default function ImageEditorPage() {
  const { t, locale } = useI18n();
  const [file, setFile] = useState<Loaded | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [tick, setTick] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [tool, setToolState] = useState<ToolId>('select');
  const [style, setStyle] = useState<DrawStyle>(() => initialStyle(locale));
  const [selection, setSelection] = useState<SelectionInfo | null>(null);
  const [selectionKey, setSelectionKey] = useState('');
  const [focusToken, setFocusToken] = useState(0);
  const [fontLoading, setFontLoading] = useState<FontId | null>(null);
  const [crop, setCrop] = useState<CropRect | null>(null);
  const [ratioId, setRatioId] = useState('free');
  const [resizeW, setResizeW] = useState(0);
  const [resizeH, setResizeH] = useState(0);
  const [lockAspect, setLockAspect] = useState(true);
  const [brightness, setBrightness] = useState(0);
  const [contrast, setContrast] = useState(0);
  const [format, setFormat] = useState<'png' | 'jpeg'>('png');
  const [quality, setQuality] = useState(0.92);
  const [background, setBackground] = useState('#ffffff');
  const [exporting, setExporting] = useState(false);
  const [exportedVersion, setExportedVersion] = useState(0);
  const [result, setResult] = useState<{ blob: Blob; name: string; width: number; height: number } | null>(null);
  /** Fit the image to the window once the editor is laid out (it is hidden until a file is loaded). */
  const [needsFit, setNeedsFit] = useState(false);

  /** The engine is created imperatively; state holds it for rendering, the ref for event handlers. */
  const [engine, setEngine] = useState<ImageEditorEngine | null>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<ImageEditorEngine | null>(null);
  const styleRef = useRef(style);
  useEffect(() => {
    styleRef.current = style;
  }, [style]);
  const objectIds = useRef(new WeakMap<object, string>());
  const nextId = useRef(1);

  const dirty = engine !== null && engine.version !== exportedVersion;
  useLeaveGuard(dirty, t('common.leaveWarning'));
  void tick;

  const syncFromDoc = useCallback(() => {
    const e = engineRef.current;
    if (!e) return;
    setResizeW(e.doc.width);
    setResizeH(e.doc.height);
    setBrightness(e.doc.brightness);
    setContrast(e.doc.contrast);
  }, []);

  const refreshSelection = useCallback(() => {
    const e = engineRef.current;
    if (!e) return;
    const active = e.canvas.getActiveObject();
    const isCrop = active && (active as FabricObject & { psKind?: string }).psKind === 'crop';
    setSelection(isCrop ? null : describeSelection(e.canvas));
    if (active && !isCrop) {
      let id = objectIds.current.get(active);
      if (!id) {
        id = `o${nextId.current++}`;
        objectIds.current.set(active, id);
      }
      setSelectionKey(id);
    } else setSelectionKey('');
  }, []);

  const setTool = useCallback((tl: ToolId) => {
    setToolState(tl);
    engineRef.current?.drawing.setTool(tl);
  }, []);

  const hooksRef = useRef({ onTextClick: (_p: Point) => {}, onCreated: (_o: FabricObject) => {} });
  useEffect(() => {
    hooksRef.current.onTextClick = (p: Point) => {
      void (async () => {
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
        const text = createText(t('editor.defaultText'), p, s);
        e.canvas.add(text);
        setTool('select');
        e.canvas.setActiveObject(text);
        e.canvas.requestRenderAll();
        e.commit();
        refreshSelection();
        setFocusToken((n) => n + 1);
      })();
    };
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
  }, [refreshSelection, setTool, t]);

  const fitZoom = useCallback((w: number, h: number) => {
    const el = scrollRef.current;
    const availW = el ? el.clientWidth - 32 : 800;
    const availH = Math.max(320, window.innerHeight - 260);
    return Math.max(0.02, Math.min(1, availW / w, availH / h));
  }, []);

  const dispose = useCallback(() => {
    engineRef.current?.dispose();
    engineRef.current = null;
    setEngine(null);
    if (hostRef.current) hostRef.current.innerHTML = '';
  }, []);

  useEffect(() => dispose, [dispose]);

  useEffect(() => {
    engineRef.current?.setZoom(zoom);
  }, [zoom]);

  useLayoutEffect(() => {
    if (!needsFit || !engine || !file || !scrollRef.current || scrollRef.current.clientWidth === 0) return;
    setZoom(fitZoom(engine.doc.width, engine.doc.height));
    setNeedsFit(false);
  }, [needsFit, engine, file, fitZoom]);

  useEffect(() => {
    engineRef.current?.setPreviewBackground(format === 'jpeg' ? background : null);
  }, [format, background, tick]);

  const onFiles = async (files: File[]) => {
    const f = files[0];
    dispose();
    setFile(null);
    setError(null);
    setResult(null);
    setCrop(null);
    setExportedVersion(0);
    setLoading(true);
    try {
      const info = await checkImageFile(f);
      if (!canAllocateCanvas(info.displayWidth, info.displayHeight)) {
        throw new AppError('error.canvasTooLarge', { page: 1, width: info.displayWidth, height: info.displayHeight });
      }
      const bitmap = await decodeImage(f, f.name);
      if (!hostRef.current) throw new AppError('error.internal');
      const created = new ImageEditorEngine(hostRef.current, bitmap, {
        getStyle: () => styleRef.current,
        onChange: () => {
          setTick((n) => n + 1);
          syncFromDoc();
        },
        onSelection: refreshSelection,
        onTextClick: (p) => hooksRef.current.onTextClick(p),
        onCreated: (o) => hooksRef.current.onCreated(o),
        onCrop: setCrop,
      });
      engineRef.current = created;
      setEngine(created);
      setNeedsFit(true);
      syncFromDoc();
      setFile({ name: f.name, size: f.size, type: info.type });
      setFormat(info.type);
      setTick((n) => n + 1);
    } catch (e) {
      dispose();
      setError(e);
    } finally {
      setLoading(false);
    }
  };

  const clear = () => {
    if (dirty && !window.confirm(t('common.clearConfirm'))) return;
    dispose();
    setFile(null);
    setResult(null);
    setError(null);
    setSelection(null);
    setCrop(null);
    setExportedVersion(0);
    setToolState('select');
  };

  const run = (fn: (e: ImageEditorEngine) => void) => {
    const e = engineRef.current;
    if (!e) return;
    try {
      fn(e);
      syncFromDoc();
      setTick((n) => n + 1);
    } catch (err) {
      setError(err);
    }
  };

  const rotateFit = (fn: (e: ImageEditorEngine) => void) =>
    run((e) => {
      fn(e);
      const z = fitZoom(e.doc.width, e.doc.height);
      setZoom(z);
      e.setZoom(z);
    });

  const ratioValue = (id: string): number | null => {
    const r = RATIOS.find((x) => x.id === id)?.value ?? null;
    const e = engineRef.current;
    if (r === 'original') return e ? e.sourceSize.width / e.sourceSize.height : null;
    return r;
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
    setStyle((s) => {
      const next = { ...s };
      for (const [k, v] of Object.entries(patch)) if (v !== undefined && k !== 'text') (next as Record<string, unknown>)[k] = v;
      return next;
    });
    if (e && selection) {
      applyStyle(e.canvas, patch);
      if (commit) e.commit();
      refreshSelection();
    }
    if (e && tool === 'pen') queueMicrotask(() => e.drawing.updateBrush());
  };

  const onDelete = () => {
    const e = engineRef.current;
    if (e && removeSelected(e.canvas, (o) => (o as FabricObject & { psKind?: string }).psKind === 'crop')) {
      e.commit();
      refreshSelection();
    }
  };

  const undo = () => void engineRef.current?.undo();
  const redo = () => void engineRef.current?.redo();

  useEffect(() => {
    if (!file) return;
    const onKey = (ev: KeyboardEvent) => {
      const target = ev.target as HTMLElement | null;
      if (target && target.closest('input, textarea, select, [contenteditable="true"], dialog')) return;
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
      } else if ((ev.key === 'Delete' || ev.key === 'Backspace') && selection) {
        ev.preventDefault();
        onDelete();
      } else if (ev.key === 'Enter' && e.isCropping) {
        ev.preventDefault();
        rotateFit((en) => en.applyCrop());
      } else if (ev.key === 'Escape') {
        e.cancelCrop();
        setTool('select');
        e.canvas.discardActiveObject();
        e.canvas.requestRenderAll();
      } else if (ev.key.startsWith('Arrow') && selection) {
        ev.preventDefault();
        const step = ev.shiftKey ? 10 : 1;
        const dx = ev.key === 'ArrowLeft' ? -step : ev.key === 'ArrowRight' ? step : 0;
        const dy = ev.key === 'ArrowUp' ? -step : ev.key === 'ArrowDown' ? step : 0;
        if (nudgeSelected(e.canvas, dx, dy)) e.commit();
      } else if (!mod && !ev.altKey && !e.isCropping) {
        const tl = toolForKey(ev.key);
        if (tl) setTool(tl);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const doExport = async () => {
    const e = engineRef.current;
    if (!e || !file) return;
    setExporting(true);
    setError(null);
    setResult(null);
    try {
      const version = e.version;
      const blob = await e.export(format, quality, background);
      const name = withExtension(`${baseName(file.name)}_edited`, format === 'png' ? 'png' : 'jpg');
      setResult({ blob, name, width: e.doc.width, height: e.doc.height });
      setExportedVersion(version);
      downloadBlob(blob, name);
    } catch (err) {
      setError(err);
    } finally {
      setExporting(false);
      setTick((n) => n + 1);
    }
  };

  const fontIssue: FontIssue | null = (() => {
    if (!selection || selection.text === undefined || !selection.fontId) return null;
    const f = getLoadedFont(selection.fontId);
    if (!f) return null;
    const missing = missingCharacters(selection.text, f.coverage);
    // Canvas text falls back to system fonts, so this is a hint rather than a blocker here.
    return missing.length ? { missing, suggestion: selection.fontId === 'noto-sans-sc' ? null : 'noto-sans-sc' } : null;
  })();

  const doc = engine?.doc;
  const aspect = doc ? doc.width / doc.height : 1;

  return (
    <div className="page wide">
      <ToolHeader title={t('tool.imageEditor.title')} description={t('tool.imageEditor.desc')} />
      {!file && (
        <DropZone
          accept="image/png,image/jpeg,.png,.jpg,.jpeg"
          onFiles={onFiles}
          title={t('common.chooseImage')}
          hint={t('img.hint')}
          disabled={loading}
          testId="image-input"
        />
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
      <div className={`editor${file ? '' : ' is-hidden'}`}>
        {file && doc && (
          <div className="editor-bar">
            <div className="file-info">
              <strong className="file-name">{file.name}</strong>
              <span className="muted small" data-testid="image-size">
                {t('img.size', { width: doc.width, height: doc.height })} · {formatBytes(file.size, locale)}
              </span>
            </div>
            <div className="row gap" role="group" aria-label={t('annot.zoom')}>
              <button
                type="button"
                className="btn btn-icon"
                onClick={() => setZoom((z) => Math.max(0.02, z / 1.25))}
                aria-label={t('annot.zoomOut')}
                title={t('annot.zoomOut')}
              >
                <Icon name="zoomOut" />
              </button>
              <span className="zoom-label">{Math.round(zoom * 100)}%</span>
              <button
                type="button"
                className="btn btn-icon"
                onClick={() => setZoom((z) => Math.min(8, z * 1.25))}
                aria-label={t('annot.zoomIn')}
                title={t('annot.zoomIn')}
              >
                <Icon name="zoomIn" />
              </button>
              <button
                type="button"
                className="btn btn-icon"
                onClick={() => setZoom(fitZoom(doc.width, doc.height))}
                aria-label={t('img.fit')}
                title={t('img.fit')}
              >
                <Icon name="fit" />
              </button>
            </div>
            <div className="row gap">
              <button
                type="button"
                className="btn btn-icon"
                onClick={undo}
                disabled={!engine?.history.canUndo}
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
                disabled={!engine?.history.canRedo}
                aria-label={t('common.redo')}
                title={t('common.redoShortcut')}
                data-testid="redo"
              >
                <Icon name="redo" />
              </button>
              <button type="button" className="btn" onClick={() => rotateFit((e) => e.reset())} data-testid="reset">
                <Icon name="reset" size={16} /> {t('img.reset')}
              </button>
              <button type="button" className="btn" onClick={clear}>
                {t('common.clearWorkspace')}
              </button>
            </div>
          </div>
        )}
        <div className="editor-body">
          <div className="editor-stage-scroll" ref={scrollRef}>
            <div className="editor-stage checkerboard" style={doc ? { width: doc.width * zoom, height: doc.height * zoom } : undefined} data-testid="stage" data-display-width={doc?.width}>
              <div className="fabric-host" ref={hostRef} />
            </div>
          </div>
          {file && doc && (
            <aside className="editor-side">
              <ToolPalette tool={tool} onTool={setTool} disabled={crop !== null} />
              <section className="side-section" aria-labelledby="img-geometry">
                <h3 id="img-geometry">{t('img.geometry')}</h3>
                <div className="row gap wrap">
                  <button type="button" className="btn btn-small" onClick={() => rotateFit((e) => e.rotate(-1))} data-testid="rotate-left">
                    <Icon name="rotateLeft" size={16} /> {t('img.rotateLeft')}
                  </button>
                  <button type="button" className="btn btn-small" onClick={() => rotateFit((e) => e.rotate(1))} data-testid="rotate-right">
                    <Icon name="rotateRight" size={16} /> {t('img.rotateRight')}
                  </button>
                  <button type="button" className="btn btn-small" onClick={() => run((e) => e.flip('h'))} data-testid="flip-h">
                    <Icon name="flipH" size={16} /> {t('img.flipH')}
                  </button>
                  <button type="button" className="btn btn-small" onClick={() => run((e) => e.flip('v'))} data-testid="flip-v">
                    <Icon name="flipV" size={16} /> {t('img.flipV')}
                  </button>
                </div>
                <p className="muted small">{t('img.geometryHint')}</p>
              </section>
              <section className="side-section" aria-labelledby="img-crop">
                <h3 id="img-crop">{t('img.crop')}</h3>
                <label className="field">
                  <span>{t('img.ratio')}</span>
                  <select
                    value={ratioId}
                    onChange={(ev) => {
                      setRatioId(ev.target.value);
                      engineRef.current?.setCropRatio(ratioValue(ev.target.value));
                    }}
                    data-testid="crop-ratio"
                  >
                    {RATIOS.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.id === 'free' ? t('img.ratioFree') : r.id === 'original' ? t('img.ratioOriginal') : r.label}
                      </option>
                    ))}
                  </select>
                </label>
                {crop ? (
                  <>
                    <div className="field-grid">
                      {(['x', 'y', 'width', 'height'] as const).map((k) => (
                        <label key={k} className="field">
                          <span>{t(`img.crop.${k}`)}</span>
                          <input
                            type="number"
                            min={k === 'x' || k === 'y' ? 0 : 1}
                            step={1}
                            value={crop[k]}
                            onChange={(ev) => {
                              const n = Math.round(Number(ev.target.value));
                              if (Number.isFinite(n)) engineRef.current?.setCropRect({ ...crop, [k]: n });
                            }}
                            data-testid={`crop-${k}`}
                          />
                        </label>
                      ))}
                    </div>
                    <div className="row gap">
                      <button type="button" className="btn btn-primary btn-small" onClick={() => rotateFit((e) => e.applyCrop())} data-testid="crop-apply">
                        <Icon name="check" size={16} /> {t('img.cropApply')}
                      </button>
                      <button type="button" className="btn btn-small" onClick={() => engineRef.current?.cancelCrop()}>
                        {t('common.cancel')}
                      </button>
                    </div>
                  </>
                ) : (
                  <button
                    type="button"
                    className="btn btn-small"
                    onClick={() => {
                      setTool('select');
                      engineRef.current?.startCrop(ratioValue(ratioId));
                    }}
                    data-testid="crop-start"
                  >
                    <Icon name="crop" size={16} /> {t('img.cropStart')}
                  </button>
                )}
              </section>
              <section className="side-section" aria-labelledby="img-resize">
                <h3 id="img-resize">{t('img.resize')}</h3>
                <div className="field-grid">
                  <label className="field">
                    <span>{t('img.width')}</span>
                    <input
                      type="number"
                      min={1}
                      step={1}
                      value={resizeW}
                      onChange={(ev) => {
                        const w = Math.max(1, Math.round(Number(ev.target.value)) || 1);
                        setResizeW(w);
                        if (lockAspect) setResizeH(Math.max(1, Math.round(w / aspect)));
                      }}
                      data-testid="resize-width"
                    />
                  </label>
                  <label className="field">
                    <span>{t('img.height')}</span>
                    <input
                      type="number"
                      min={1}
                      step={1}
                      value={resizeH}
                      onChange={(ev) => {
                        const h = Math.max(1, Math.round(Number(ev.target.value)) || 1);
                        setResizeH(h);
                        if (lockAspect) setResizeW(Math.max(1, Math.round(h * aspect)));
                      }}
                      data-testid="resize-height"
                    />
                  </label>
                </div>
                <label className="check">
                  <input type="checkbox" checked={lockAspect} onChange={(ev) => setLockAspect(ev.target.checked)} />
                  {t('img.lockAspect')}
                </label>
                <button
                  type="button"
                  className="btn btn-small"
                  onClick={() => rotateFit((e) => e.resize(resizeW, resizeH))}
                  disabled={resizeW === doc.width && resizeH === doc.height}
                  data-testid="resize-apply"
                >
                  <Icon name="resize" size={16} /> {t('img.resizeApply')}
                </button>
              </section>
              <section className="side-section" aria-labelledby="img-adjust">
                <h3 id="img-adjust">{t('img.adjust')}</h3>
                <label className="field">
                  <span>{t('img.brightness', { value: brightness })}</span>
                  <input
                    type="range"
                    min={-100}
                    max={100}
                    step={1}
                    value={brightness}
                    onChange={(ev) => {
                      const v = Number(ev.target.value);
                      setBrightness(v);
                      engineRef.current?.setAdjust(v, contrast, false);
                    }}
                    onPointerUp={() => engineRef.current?.commit()}
                    onKeyUp={() => engineRef.current?.commit()}
                    data-testid="brightness"
                  />
                </label>
                <label className="field">
                  <span>{t('img.contrast', { value: contrast })}</span>
                  <input
                    type="range"
                    min={-100}
                    max={100}
                    step={1}
                    value={contrast}
                    onChange={(ev) => {
                      const v = Number(ev.target.value);
                      setContrast(v);
                      engineRef.current?.setAdjust(brightness, v, false);
                    }}
                    onPointerUp={() => engineRef.current?.commit()}
                    onKeyUp={() => engineRef.current?.commit()}
                    data-testid="contrast"
                  />
                </label>
              </section>
              <section className="side-section" aria-labelledby="img-annot">
                <h3 id="img-annot">{t('img.annotations')}</h3>
                <PropertiesPanel
                  tool={tool}
                  style={style}
                  selection={selection}
                  onChange={(p, c) => void onStyleChange(p, c)}
                  onCommit={() => engineRef.current?.commit()}
                  onLayer={(how) => {
                    const e = engineRef.current;
                    if (e && moveLayer(e.canvas, how)) e.commit();
                  }}
                  onDelete={onDelete}
                  fontLoading={fontLoading}
                  fontIssue={fontIssue}
                  focusTextToken={focusToken}
                  selectionKey={selectionKey}
                />
              </section>
              <section className="side-section" aria-labelledby="img-export">
                <h3 id="img-export">{t('img.export')}</h3>
                <fieldset className="field">
                  <legend className="visually-hidden">{t('p2i.format')}</legend>
                  <div className="segmented">
                    {(['png', 'jpeg'] as const).map((f) => (
                      <label key={f} className={format === f ? 'is-active' : ''}>
                        <input type="radio" name="img-format" checked={format === f} onChange={() => setFormat(f)} data-testid={`format-${f}`} />
                        {f === 'png' ? 'PNG' : 'JPG'}
                      </label>
                    ))}
                  </div>
                </fieldset>
                {format === 'jpeg' ? (
                  <>
                    <label className="field">
                      <span>{t('common.jpgQuality', { value: Math.round(quality * 100) })}</span>
                      <input type="range" min={0.5} max={1} step={0.01} value={quality} onChange={(ev) => setQuality(Number(ev.target.value))} />
                    </label>
                    <label className="field">
                      <span>{t('img.jpgBackground')}</span>
                      <input type="color" value={background} onChange={(ev) => setBackground(ev.target.value)} data-testid="jpg-background" />
                    </label>
                    <p className="muted small">{t('img.jpgHint')}</p>
                  </>
                ) : (
                  <p className="muted small">{t('img.pngHint')}</p>
                )}
                <p className="muted small">{t('img.exportSize', { width: doc.width, height: doc.height })}</p>
                <button type="button" className="btn btn-primary btn-block" onClick={doExport} disabled={exporting || crop !== null} data-testid="export-image">
                  <Icon name="download" size={18} /> {t('img.download', { format: format === 'png' ? 'PNG' : 'JPG' })}
                </button>
                {exporting && <ProgressBar label={t('img.exporting')} />}
                {result && (
                  <Alert
                    kind="success"
                    title={t('common.done')}
                    actions={
                      <button type="button" className="btn" onClick={() => downloadBlob(result.blob, result.name)}>
                        {t('common.downloadAgain')}
                      </button>
                    }
                  >
                    {t('img.done', { name: result.name, width: result.width, height: result.height })}
                  </Alert>
                )}
                <p className="muted small">{t('img.pixelNote')}</p>
              </section>
            </aside>
          )}
        </div>
      </div>
    </div>
  );
}
