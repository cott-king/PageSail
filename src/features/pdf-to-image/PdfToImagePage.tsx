import { useEffect, useMemo, useRef, useState } from 'react';
import { ToolHeader } from '../../app/Layout';
import { DropZone } from '../../components/DropZone';
import { Alert, ErrorAlert, ProgressBar } from '../../components/Feedback';
import { PdfThumb } from '../../components/PdfThumb';
import { LIMITS, PIXELS_PER_MEGAPIXEL } from '../../config';
import { useI18n } from '../../i18n/I18nProvider';
import { isCancelled } from '../../lib/errors';
import { downloadBlob } from '../../lib/files/download';
import { baseName, formatBytes } from '../../lib/files/names';
import { loadPdfFile, type LoadedPdf } from '../../lib/pdf/loadPdfFile';
import { formatPageRange, parsePageRange } from '../../lib/pdf/pageRange';
import { RangeErrorText } from '../../components/RangeErrorText';
import { outputPixels, readPageSize, renderPdfToImages, type ImageFormat, type PageSize, type RenderProgress, type RenderResult } from './renderImages';

const DPI_PRESETS = [72, 96, 150, 200, 300, 600];

export default function PdfToImagePage() {
  const { t, locale } = useI18n();
  const [pdf, setPdf] = useState<LoadedPdf | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [sizes, setSizes] = useState<(PageSize | undefined)[]>([]);
  const [range, setRange] = useState('');
  const [format, setFormat] = useState<ImageFormat>('png');
  const [dpi, setDpi] = useState(150);
  const [quality, setQuality] = useState(0.92);
  const [transparent, setTransparent] = useState(false);
  const [progress, setProgress] = useState<RenderProgress | null>(null);
  const [result, setResult] = useState<RenderResult | null>(null);
  const [cancelled, setCancelled] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const pdfRef = useRef<LoadedPdf | null>(null);

  useEffect(
    () => () => {
      abortRef.current?.abort();
      pdfRef.current?.dispose();
    },
    [],
  );

  // Read page sizes in the background for accurate output-size estimates.
  useEffect(() => {
    if (!pdf) return;
    let stop = false;
    (async () => {
      const list: (PageSize | undefined)[] = new Array(pdf.pageCount).fill(undefined);
      for (let i = 0; i < pdf.pageCount && !stop; i++) {
        try {
          list[i] = await readPageSize(pdf.opened.doc, i + 1);
        } catch {
          list[i] = undefined;
        }
        if (i % 25 === 24 || i === pdf.pageCount - 1) setSizes([...list]);
      }
    })();
    return () => {
      stop = true;
    };
  }, [pdf]);

  const clear = () => {
    abortRef.current?.abort();
    pdfRef.current?.dispose();
    pdfRef.current = null;
    setPdf(null);
    setSizes([]);
    setRange('');
    setResult(null);
    setError(null);
    setProgress(null);
    setCancelled(false);
  };

  const onFiles = async (files: File[]) => {
    clear();
    setLoading(true);
    try {
      const loaded = await loadPdfFile(files[0]);
      pdfRef.current = loaded;
      setPdf(loaded);
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  };

  const parsed = useMemo(() => (pdf ? parsePageRange(range, pdf.pageCount) : null), [range, pdf]);
  const selected = useMemo(() => new Set(parsed?.ok ? parsed.pages : []), [parsed]);

  const estimate = useMemo(() => {
    if (!parsed?.ok) return null;
    let maxW = 0;
    let maxH = 0;
    let totalPx = 0;
    let known = 0;
    const shapes = new Set<string>();
    for (const p of parsed.pages) {
      const s = sizes[p - 1];
      if (!s) continue;
      known++;
      const px = outputPixels(s, dpi);
      if (px.width * px.height > maxW * maxH) {
        maxW = px.width;
        maxH = px.height;
      }
      totalPx += px.width * px.height;
      shapes.add(`${px.width}x${px.height}`);
    }
    const first = sizes[parsed.pages[0] - 1];
    return {
      first: first ? outputPixels(first, dpi) : null,
      complete: known === parsed.pages.length,
      uniform: shapes.size <= 1,
      maxW,
      maxH,
      totalPx,
    };
  }, [parsed, sizes, dpi]);

  const togglePage = (n: number) => {
    if (!pdf) return;
    const next = new Set(selected);
    if (parsed && !parsed.ok) next.clear();
    if (next.has(n)) next.delete(n);
    else next.add(n);
    setRange(next.size === pdf.pageCount ? '' : next.size === 0 ? String(n) : formatPageRange(next));
  };

  const convert = async () => {
    if (!pdf || !parsed?.ok) return;
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setError(null);
    setResult(null);
    setCancelled(false);
    setProgress({ done: 0, total: parsed.pages.length, page: parsed.pages[0], stage: 'checking' });
    try {
      const res = await renderPdfToImages(
        pdf.opened.doc,
        { pages: parsed.pages, format, dpi, quality, transparent, baseName: baseName(pdf.name) },
        ctrl.signal,
        (p) => {
          if (!ctrl.signal.aborted) setProgress(p);
        },
      );
      if (ctrl.signal.aborted) return;
      setResult(res);
      downloadBlob(res.blob, res.fileName);
    } catch (e) {
      if (isCancelled(e) || ctrl.signal.aborted) setCancelled(true);
      else setError(e);
    } finally {
      if (abortRef.current === ctrl) abortRef.current = null;
      setProgress(null);
    }
  };

  const busy = progress !== null;
  const progressLabel = progress
    ? progress.stage === 'checking'
      ? t('p2i.progressChecking', { page: progress.page })
      : progress.stage === 'packing'
        ? t('p2i.progressPacking')
        : t('p2i.progressRendering', { page: progress.page, done: progress.done + 1, total: progress.total })
    : '';

  return (
    <div className="page">
      <ToolHeader title={t('tool.pdfToImage.title')} description={t('tool.pdfToImage.desc')} />
      {!pdf && (
        <DropZone
          accept="application/pdf,.pdf"
          onFiles={onFiles}
          title={t('common.choosePdf')}
          hint={t('common.localHint')}
          disabled={loading}
          testId="pdf-input"
        />
      )}
      {loading && <ProgressBar label={t('common.openingFile')} />}
      {error !== null && (
        <ErrorAlert
          error={error}
          actions={
            <button type="button" className="btn" onClick={clear}>
              {t('common.clearWorkspace')}
            </button>
          }
        />
      )}
      {pdf && (
        <div className="workspace two-col">
          <section className="panel grow" aria-label={t('common.pages')}>
            <div className="panel-head">
              <div className="file-info">
                <strong className="file-name">{pdf.name}</strong>
                <span className="muted">
                  {formatBytes(pdf.size, locale)} · {t('common.pageCount', { count: pdf.pageCount })}
                </span>
              </div>
              <div className="row gap">
                <button type="button" className="btn btn-small" onClick={() => setRange('')} disabled={busy}>
                  {t('common.selectAll')}
                </button>
                <button type="button" className="btn btn-small" onClick={clear} disabled={busy}>
                  {t('common.clearWorkspace')}
                </button>
              </div>
            </div>
            {pdf.pageCount > LIMITS.warnPdfPages && <Alert kind="info">{t('common.manyPagesHint', { count: pdf.pageCount })}</Alert>}
            <ul className="page-grid">
              {Array.from({ length: pdf.pageCount }, (_, i) => i + 1).map((n) => (
                <li key={n}>
                  <button
                    type="button"
                    className={`page-card${selected.has(n) ? ' is-selected' : ''}`}
                    aria-pressed={selected.has(n)}
                    aria-label={t('p2i.togglePage', { page: n })}
                    onClick={() => togglePage(n)}
                    disabled={busy}
                  >
                    <PdfThumb cache={pdf.thumbs} pageIndex={n - 1} size={150} alt={t('common.pageN', { page: n })} />
                    <span className="page-num">{n}</span>
                    <span className="page-check" aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          </section>
          <aside className="panel side" aria-label={t('common.settings')}>
            <h2>{t('common.settings')}</h2>
            <label className="field">
              <span>{t('p2i.range')}</span>
              <input
                type="text"
                inputMode="text"
                value={range}
                placeholder={t('p2i.rangePlaceholder')}
                onChange={(e) => setRange(e.target.value)}
                aria-invalid={parsed ? !parsed.ok : undefined}
                aria-describedby="range-help"
                disabled={busy}
                data-testid="page-range"
              />
              <small id="range-help" className={parsed && !parsed.ok ? 'field-error' : 'muted'}>
                {parsed && !parsed.ok ? (
                  <RangeErrorText error={parsed.error} pageCount={pdf.pageCount} />
                ) : (
                  t('p2i.selectedCount', { count: selected.size, total: pdf.pageCount })
                )}
              </small>
            </label>

            <fieldset className="field">
              <legend>{t('p2i.format')}</legend>
              <div className="segmented">
                {(['png', 'jpeg'] as const).map((f) => (
                  <label key={f} className={format === f ? 'is-active' : ''}>
                    <input type="radio" name="format" value={f} checked={format === f} onChange={() => setFormat(f)} disabled={busy} />
                    {f === 'png' ? 'PNG' : 'JPG'}
                  </label>
                ))}
              </div>
            </fieldset>

            <label className="field">
              <span>{t('p2i.resolution')}</span>
              <select
                value={DPI_PRESETS.includes(dpi) ? String(dpi) : 'custom'}
                onChange={(e) => e.target.value !== 'custom' && setDpi(Number(e.target.value))}
                disabled={busy}
                data-testid="dpi"
              >
                {DPI_PRESETS.map((d) => (
                  <option key={d} value={d}>
                    {t('p2i.dpiOption', { dpi: d, scale: (d / 72).toFixed(2) })}
                  </option>
                ))}
                {!DPI_PRESETS.includes(dpi) && <option value="custom">{t('p2i.dpiOption', { dpi, scale: (dpi / 72).toFixed(2) })}</option>}
              </select>
            </label>
            <label className="field">
              <span>{t('p2i.customDpi')}</span>
              <input
                type="number"
                min={36}
                max={1200}
                step={1}
                value={dpi}
                onChange={(e) => {
                  const v = Math.round(Number(e.target.value));
                  if (Number.isFinite(v)) setDpi(Math.min(1200, Math.max(36, v)));
                }}
                disabled={busy}
              />
            </label>
            {estimate && (
              <p className="estimate" data-testid="estimate">
                {estimate.first && t('p2i.estimate', { width: estimate.first.width, height: estimate.first.height })}
                {estimate.complete && !estimate.uniform && (
                  <>
                    <br />
                    {t('p2i.estimateVaries', { width: estimate.maxW, height: estimate.maxH })}
                  </>
                )}
                {!estimate.complete && (
                  <>
                    <br />
                    <span className="muted">{t('p2i.estimateCalculating')}</span>
                  </>
                )}
              </p>
            )}
            {estimate && estimate.maxW * estimate.maxH > LIMITS.maxRenderPixels && (
              <Alert kind="warning">{t('p2i.warnTooLarge', { max: Math.round(LIMITS.maxRenderPixels / PIXELS_PER_MEGAPIXEL) })}</Alert>
            )}
            {estimate && estimate.totalPx > LIMITS.warnTotalRenderPixels && (
              <Alert kind="warning">{t('p2i.warnTotal', { mp: Math.round(estimate.totalPx / PIXELS_PER_MEGAPIXEL) })}</Alert>
            )}

            {format === 'jpeg' ? (
              <>
                <label className="field">
                  <span>{t('common.jpgQuality', { value: Math.round(quality * 100) })}</span>
                  <input type="range" min={0.5} max={1} step={0.01} value={quality} onChange={(e) => setQuality(Number(e.target.value))} disabled={busy} />
                </label>
                <p className="muted small">{t('p2i.jpgWhite')}</p>
              </>
            ) : (
              <label className="check">
                <input type="checkbox" checked={transparent} onChange={(e) => setTransparent(e.target.checked)} disabled={busy} />
                {t('p2i.transparent')}
              </label>
            )}

            {busy ? (
              <div className="stack">
                <ProgressBar value={progress!.done} max={progress!.total} label={progressLabel} />
                <button type="button" className="btn" onClick={() => abortRef.current?.abort()}>
                  {t('common.cancel')}
                </button>
              </div>
            ) : (
              <button
                type="button"
                className="btn btn-primary btn-block"
                onClick={convert}
                disabled={!parsed?.ok || (estimate !== null && estimate.maxW * estimate.maxH > LIMITS.maxRenderPixels)}
                data-testid="convert"
              >
                {t('p2i.convert', { count: selected.size })}
              </button>
            )}
            {cancelled && <Alert kind="info">{t('common.cancelledNoOutput')}</Alert>}
            {result && (
              <Alert
                kind="success"
                title={t('common.done')}
                actions={
                  <button type="button" className="btn" onClick={() => downloadBlob(result.blob, result.fileName)}>
                    {t('common.downloadAgain')}
                  </button>
                }
              >
                {result.count > 1 ? t('p2i.doneZip', { count: result.count, name: result.fileName }) : t('p2i.doneSingle', { name: result.fileName })}
              </Alert>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}
