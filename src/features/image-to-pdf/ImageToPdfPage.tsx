import { useEffect, useMemo, useRef, useState } from 'react';
import { ToolHeader } from '../../app/Layout';
import { useLeaveGuard } from '../../app/router';
import { DropZone } from '../../components/DropZone';
import { Alert, ErrorAlert, ProgressBar } from '../../components/Feedback';
import { Icon } from '../../components/Icon';
import { LIMITS } from '../../config';
import { useI18n } from '../../i18n/I18nProvider';
import { AppError, isCancelled } from '../../lib/errors';
import { bytesToBlob, downloadBlob } from '../../lib/files/download';
import { baseName, formatBytes, withExtension } from '../../lib/files/names';
import type { ImageInfo } from '../../lib/images/header';
import { checkImageFile, makeImageThumbnail } from '../../lib/images/loadImage';
import { runJob } from '../../workers/client';
import { layoutImagePage, mmToPt, type FitMode, type LayoutOptions, type PageOrientation, type PageSizeId } from './layout';

interface ImageItem {
  id: string;
  file: File;
  info: ImageInfo;
  thumbUrl: string;
}

interface Rejected {
  name: string;
  error: unknown;
}

let nextId = 1;

function PagePreview({ item, options, index }: { item: ImageItem; options: LayoutOptions; index: number }) {
  const { t } = useI18n();
  let layout;
  try {
    layout = layoutImagePage(item.info.displayWidth, item.info.displayHeight, options);
  } catch {
    return <div className="sheet sheet-error">{t('error.marginTooLarge')}</div>;
  }
  const { pageWidth: pw, pageHeight: ph, image, clip } = layout;
  const box = clip ?? { x: 0, y: 0, width: pw, height: ph };
  const pct = (v: number, of: number) => `${(v / of) * 100}%`;
  return (
    <div className="sheet" style={{ aspectRatio: `${pw} / ${ph}` }} aria-label={t('i2p.previewLabel', { page: index + 1 })}>
      <div className="sheet-clip" style={{ left: pct(box.x, pw), bottom: pct(box.y, ph), width: pct(box.width, pw), height: pct(box.height, ph) }}>
        <img
          src={item.thumbUrl}
          alt=""
          draggable={false}
          style={{
            left: pct(image.x - box.x, box.width),
            bottom: pct(image.y - box.y, box.height),
            width: pct(image.width, box.width),
            height: pct(image.height, box.height),
          }}
        />
      </div>
    </div>
  );
}

export default function ImageToPdfPage() {
  const { t, locale } = useI18n();
  const [items, setItems] = useState<ImageItem[]>([]);
  const [rejected, setRejected] = useState<Rejected[]>([]);
  const [reading, setReading] = useState<{ done: number; total: number } | null>(null);
  const [pageSize, setPageSize] = useState<PageSizeId>('a4');
  const [orientation, setOrientation] = useState<PageOrientation>('auto');
  const [marginMm, setMarginMm] = useState(10);
  const [fit, setFit] = useState<FitMode>('contain');
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [result, setResult] = useState<{ blob: Blob; name: string; pages: number } | null>(null);
  const [cancelled, setCancelled] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const itemsRef = useRef<ImageItem[]>([]);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  useEffect(
    () => () => {
      abortRef.current?.abort();
      itemsRef.current.forEach((it) => URL.revokeObjectURL(it.thumbUrl));
    },
    [],
  );

  useLeaveGuard(items.length > 0 && result === null, t('common.leaveWarning'));

  const options: LayoutOptions = useMemo(() => ({ pageSize, orientation, marginPt: mmToPt(marginMm), fit }), [pageSize, orientation, marginMm, fit]);

  const addFiles = async (files: File[]) => {
    setError(null);
    setResult(null);
    const room = LIMITS.maxFiles - items.length;
    const accepted = files.slice(0, Math.max(0, room));
    const rej: Rejected[] = files.slice(accepted.length).map((f) => ({ name: f.name, error: new AppError('error.tooManyFiles', { max: LIMITS.maxFiles }) }));
    setReading({ done: 0, total: accepted.length });
    for (let i = 0; i < accepted.length; i++) {
      const file = accepted[i];
      try {
        const info = await checkImageFile(file);
        const thumbUrl = await makeImageThumbnail(file, file.name, info);
        const item: ImageItem = { id: `img-${nextId++}`, file, info, thumbUrl };
        setItems((prev) => [...prev, item]);
      } catch (e) {
        rej.push({ name: file.name, error: e });
      }
      setReading({ done: i + 1, total: accepted.length });
    }
    setReading(null);
    setRejected(rej);
  };

  const move = (index: number, delta: number) => {
    setItems((prev) => {
      const next = [...prev];
      const target = index + delta;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const moveTo = (fromId: string, toId: string) => {
    setItems((prev) => {
      const from = prev.findIndex((i) => i.id === fromId);
      const to = prev.findIndex((i) => i.id === toId);
      if (from < 0 || to < 0 || from === to) return prev;
      const next = [...prev];
      const [it] = next.splice(from, 1);
      next.splice(to, 0, it);
      return next;
    });
  };

  const remove = (id: string) => {
    setItems((prev) => {
      const it = prev.find((i) => i.id === id);
      if (it) URL.revokeObjectURL(it.thumbUrl);
      return prev.filter((i) => i.id !== id);
    });
    setResult(null);
  };

  const clear = () => {
    abortRef.current?.abort();
    items.forEach((it) => URL.revokeObjectURL(it.thumbUrl));
    setItems([]);
    setRejected([]);
    setError(null);
    setResult(null);
    setCancelled(false);
  };

  const sortByName = () => {
    const collator = new Intl.Collator(locale, { numeric: true, sensitivity: 'base' });
    setItems((prev) => [...prev].sort((a, b) => collator.compare(a.file.name, b.file.name)));
  };

  const layoutError = useMemo(() => {
    try {
      layoutImagePage(1000, 1000, options);
      return null;
    } catch (e) {
      return e;
    }
  }, [options]);

  const totalBytes = items.reduce((s, i) => s + i.file.size, 0);

  const build = async () => {
    if (items.length === 0 || layoutError) return;
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setError(null);
    setResult(null);
    setCancelled(false);
    const snapshot = [...items];
    setProgress({ done: 0, total: snapshot.length });
    try {
      const payload = [];
      for (const it of snapshot) {
        const bytes = new Uint8Array(await it.file.arrayBuffer());
        payload.push({ bytes, type: it.info.type, width: it.info.width, height: it.info.height, orientation: it.info.orientation });
        if (ctrl.signal.aborted) throw new DOMException('Aborted', 'AbortError');
      }
      const pdf = await runJob(
        'imagesToPdf',
        { items: payload, options },
        {
          signal: ctrl.signal,
          transfer: payload.map((p) => p.bytes.buffer as ArrayBuffer),
          onProgress: (done, total) => setProgress({ done, total }),
          fallbackError: 'error.imageToPdfFailed',
        },
      );
      if (ctrl.signal.aborted) return;
      const name = snapshot.length === 1 ? withExtension(baseName(snapshot[0].file.name), 'pdf') : 'images.pdf';
      const blob = bytesToBlob(pdf, 'application/pdf');
      setResult({ blob, name, pages: snapshot.length });
      downloadBlob(blob, name);
    } catch (e) {
      if (isCancelled(e) || ctrl.signal.aborted) setCancelled(true);
      else setError(e);
    } finally {
      if (abortRef.current === ctrl) abortRef.current = null;
      setProgress(null);
    }
  };

  const busy = progress !== null || reading !== null;

  return (
    <div className="page">
      <ToolHeader title={t('tool.imageToPdf.title')} description={t('tool.imageToPdf.desc')} />
      <DropZone
        accept="image/png,image/jpeg,.png,.jpg,.jpeg"
        multiple
        onFiles={addFiles}
        title={items.length ? t('i2p.addMore') : t('common.chooseImages')}
        hint={t('i2p.hint', { max: LIMITS.maxFiles })}
        compact={items.length > 0}
        disabled={busy}
        testId="image-input"
      />
      {reading && <ProgressBar value={reading.done} max={reading.total} label={t('i2p.reading', { done: reading.done, total: reading.total })} />}
      {rejected.length > 0 && (
        <Alert kind="warning" title={t('i2p.rejectedTitle', { count: rejected.length })}>
          <ul className="plain-list">
            {rejected.map((r, i) => (
              <li key={i}>
                <strong>{r.name}</strong>: {r.error instanceof AppError ? t(r.error.code, r.error.params) : t('error.unexpected')}
              </li>
            ))}
          </ul>
        </Alert>
      )}
      {items.length > 0 && (
        <div className="workspace two-col">
          <section className="panel grow" aria-label={t('i2p.listLabel')}>
            <div className="panel-head">
              <div className="file-info">
                <strong>{t('i2p.count', { count: items.length })}</strong>
                <span className="muted">{formatBytes(totalBytes, locale)}</span>
              </div>
              <div className="row gap">
                <button type="button" className="btn btn-small" onClick={sortByName} disabled={busy}>
                  {t('i2p.sortByName')}
                </button>
                <button type="button" className="btn btn-small" onClick={clear} disabled={busy}>
                  {t('common.clearWorkspace')}
                </button>
              </div>
            </div>
            <p className="muted small">{t('i2p.orderHint')}</p>
            <ol className="image-list" data-testid="image-list">
              {items.map((it, index) => (
                <li
                  key={it.id}
                  className={`image-item${dragId === it.id ? ' is-dragging' : ''}`}
                  draggable={!busy}
                  onDragStart={(e) => {
                    setDragId(it.id);
                    e.dataTransfer.effectAllowed = 'move';
                    e.dataTransfer.setData('text/plain', it.id);
                  }}
                  onDragEnd={() => setDragId(null)}
                  onDragOver={(e) => {
                    if (dragId) e.preventDefault();
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (dragId) moveTo(dragId, it.id);
                    setDragId(null);
                  }}
                  data-testid="image-item"
                  data-name={it.file.name}
                >
                  <span className="image-index">{index + 1}</span>
                  <PagePreview item={it} options={options} index={index} />
                  <div className="image-meta">
                    <span className="file-name" title={it.file.name}>
                      {it.file.name}
                    </span>
                    <span className="muted small">
                      {it.info.displayWidth} × {it.info.displayHeight} px · {formatBytes(it.file.size, locale)}
                    </span>
                  </div>
                  <div className="image-actions">
                    <button
                      type="button"
                      className="btn btn-icon"
                      onClick={() => move(index, -1)}
                      disabled={busy || index === 0}
                      aria-label={t('i2p.moveEarlier', { name: it.file.name })}
                      title={t('common.moveEarlier')}
                    >
                      <Icon name="arrowLeft" />
                    </button>
                    <button
                      type="button"
                      className="btn btn-icon"
                      onClick={() => move(index, 1)}
                      disabled={busy || index === items.length - 1}
                      aria-label={t('i2p.moveLater', { name: it.file.name })}
                      title={t('common.moveLater')}
                    >
                      <Icon name="arrowRight" />
                    </button>
                    <button
                      type="button"
                      className="btn btn-icon danger"
                      onClick={() => remove(it.id)}
                      disabled={busy}
                      aria-label={t('i2p.remove', { name: it.file.name })}
                      title={t('common.remove')}
                    >
                      <Icon name="trash" />
                    </button>
                  </div>
                </li>
              ))}
            </ol>
          </section>
          <aside className="panel side" aria-label={t('common.settings')}>
            <h2>{t('common.settings')}</h2>
            <label className="field">
              <span>{t('i2p.pageSize')}</span>
              <select value={pageSize} onChange={(e) => setPageSize(e.target.value as PageSizeId)} disabled={busy} data-testid="page-size">
                <option value="a4">A4 (210 × 297 mm)</option>
                <option value="letter">Letter (8.5 × 11 in)</option>
                <option value="legal">Legal (8.5 × 14 in)</option>
                <option value="a3">A3 (297 × 420 mm)</option>
                <option value="a5">A5 (148 × 210 mm)</option>
                <option value="fit">{t('i2p.sizeFit')}</option>
              </select>
            </label>
            <fieldset className="field" disabled={busy || pageSize === 'fit'}>
              <legend>{t('i2p.orientation')}</legend>
              <div className="segmented">
                {(['auto', 'portrait', 'landscape'] as const).map((o) => (
                  <label key={o} className={orientation === o ? 'is-active' : ''}>
                    <input type="radio" name="orientation" checked={orientation === o} onChange={() => setOrientation(o)} />
                    {t(`i2p.orientation.${o}`)}
                  </label>
                ))}
              </div>
            </fieldset>
            <label className="field">
              <span>{t('i2p.margin')}</span>
              <input
                type="number"
                min={0}
                max={100}
                step={1}
                value={marginMm}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  if (Number.isFinite(v)) setMarginMm(Math.min(100, Math.max(0, v)));
                }}
                disabled={busy}
                data-testid="margin"
              />
            </label>
            <fieldset className="field" disabled={busy || pageSize === 'fit'}>
              <legend>{t('i2p.fit')}</legend>
              <div className="radio-list">
                {(['contain', 'cover', 'actual'] as const).map((f) => (
                  <label key={f} className="check">
                    <input type="radio" name="fit" checked={fit === f} onChange={() => setFit(f)} />
                    <span>
                      {t(`i2p.fit.${f}`)}
                      <small className="muted block">{t(`i2p.fit.${f}.hint`)}</small>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
            {layoutError !== null && <ErrorAlert error={layoutError} />}
            {totalBytes > 1024 * 1024 * 1024 && <Alert kind="warning">{t('i2p.warnLarge')}</Alert>}
            {progress ? (
              <div className="stack">
                <ProgressBar value={progress.done} max={progress.total} label={t('i2p.building', { done: progress.done, total: progress.total })} />
                <button type="button" className="btn" onClick={() => abortRef.current?.abort()}>
                  {t('common.cancel')}
                </button>
              </div>
            ) : (
              <button type="button" className="btn btn-primary btn-block" onClick={build} disabled={busy || layoutError !== null} data-testid="build-pdf">
                {t('i2p.build', { count: items.length })}
              </button>
            )}
            {error !== null && <ErrorAlert error={error} />}
            {cancelled && <Alert kind="info">{t('common.cancelledNoOutput')}</Alert>}
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
                {t('i2p.done', { name: result.name, count: result.pages })}
              </Alert>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}
