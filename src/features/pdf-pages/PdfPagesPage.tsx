import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { ToolHeader } from '../../app/Layout';
import { useLeaveGuard } from '../../app/router';
import { DropZone } from '../../components/DropZone';
import { Alert, ErrorAlert, ProgressBar } from '../../components/Feedback';
import { Icon } from '../../components/Icon';
import { Modal } from '../../components/Modal';
import { PdfResultPreview } from '../../components/PdfResultPreview';
import { PdfThumb } from '../../components/PdfThumb';
import { RangeErrorText } from '../../components/RangeErrorText';
import { LIMITS } from '../../config';
import { useI18n } from '../../i18n/I18nProvider';
import { AppError, isCancelled } from '../../lib/errors';
import { bytesToBlob, downloadBlob } from '../../lib/files/download';
import { baseName, formatBytes, padNumber, safeFileName } from '../../lib/files/names';
import { ZipBuilder } from '../../lib/files/zip';
import { loadPdfFile, type LoadedPdf } from '../../lib/pdf/loadPdfFile';
import { parseRangeGroups } from '../../lib/pdf/pageRange';
import { runJob } from '../../workers/client';
import type { AssembleOutputSpec } from './assemble';
import { chunk, initialPagesState, isModified, pagesReducer, type PageRef } from './pagesState';

interface Source {
  id: string;
  letter: string;
  pdf: LoadedPdf;
}

interface ResultFile {
  name: string;
  bytes: Uint8Array;
  pageCount: number;
}

type SplitMode = 'each' | 'everyN' | 'ranges';

const SOURCE_COLORS = ['#2f6fec', '#e2702f', '#1f9d6b', '#b04cc8', '#c9a227', '#d6455d', '#2aa3b8', '#6b7280'];
let nextSourceId = 1;

function sourceLetter(i: number): string {
  let s = '';
  let n = i;
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}

export default function PdfPagesPage() {
  const { t, locale } = useI18n();
  const [sources, setSources] = useState<Source[]>([]);
  const [state, dispatch] = useReducer(pagesReducer, initialPagesState);
  const [loading, setLoading] = useState<{ done: number; total: number } | null>(null);
  const [rejected, setRejected] = useState<{ name: string; error: unknown }[]>([]);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [results, setResults] = useState<{ files: ResultFile[]; zip?: { blob: Blob; name: string } } | null>(null);
  const [preview, setPreview] = useState<ResultFile | null>(null);
  const [splitMode, setSplitMode] = useState<SplitMode>('each');
  const [everyN, setEveryN] = useState(2);
  const [rangeText, setRangeText] = useState('');
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [anchor, setAnchor] = useState<string | null>(null);
  const [cancelled, setCancelled] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const sourcesRef = useRef<Source[]>([]);
  useEffect(() => {
    sourcesRef.current = sources;
  }, [sources]);

  useEffect(
    () => () => {
      abortRef.current?.abort();
      sourcesRef.current.forEach((s) => s.pdf.dispose());
    },
    [],
  );

  const [savedKey, setSavedKey] = useState<string | null>(null);
  const stateKey = JSON.stringify(state.pages.map((p) => [p.key, p.rotation]));
  const dirty = isModified(state) && savedKey !== stateKey;
  useLeaveGuard(dirty, t('common.leaveWarning'));

  const sourceById = useMemo(() => new Map(sources.map((s) => [s.id, s])), [sources]);
  const selected = useMemo(() => new Set(state.selected), [state.selected]);
  const selectedPages = state.pages.filter((p) => selected.has(p.key));
  const busy = loading !== null || progress !== null;

  const addFiles = async (files: File[]) => {
    setError(null);
    setResults(null);
    setCancelled(false);
    const rej: { name: string; error: unknown }[] = [];
    const room = LIMITS.maxFiles - sources.length;
    files.slice(Math.max(0, room)).forEach((f) => rej.push({ name: f.name, error: new AppError('error.tooManyFiles', { max: LIMITS.maxFiles }) }));
    const accepted = files.slice(0, Math.max(0, room));
    setLoading({ done: 0, total: accepted.length });
    let index = sources.length;
    for (let i = 0; i < accepted.length; i++) {
      const file = accepted[i];
      let pdf: LoadedPdf | null = null;
      try {
        pdf = await loadPdfFile(file);
        // pdf-lib must be able to read (and not be blocked by encryption) for page operations.
        await runJob('inspectPdf', { bytes: pdf.bytes }, { fallbackError: 'error.pdfParseEdit' });
        const id = `src-${nextSourceId++}`;
        const src: Source = { id, letter: sourceLetter(index++), pdf };
        setSources((prev) => [...prev, src]);
        dispatch({
          type: 'add',
          pages: Array.from({ length: pdf.pageCount }, (_, p) => ({ key: `${id}:${p}`, sourceId: id, pageIndex: p, rotation: 0 })),
        });
      } catch (e) {
        pdf?.dispose();
        rej.push({ name: file.name, error: e });
      }
      setLoading({ done: i + 1, total: accepted.length });
    }
    setLoading(null);
    setRejected(rej);
  };

  const clear = () => {
    abortRef.current?.abort();
    sources.forEach((s) => s.pdf.dispose());
    setSources([]);
    dispatch({ type: 'clear' });
    setResults(null);
    setError(null);
    setRejected([]);
    setCancelled(false);
  };

  const outputBase = sources.length === 1 ? baseName(sources[0].pdf.name) : 'merged';

  const toSpec = (pages: PageRef[], name: string): AssembleOutputSpec => ({
    name,
    pages: pages.map((p) => ({ sourceId: p.sourceId, pageIndex: p.pageIndex, rotation: p.rotation })),
  });

  const run = async (outputs: AssembleOutputSpec[], zipName?: string) => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setError(null);
    setResults(null);
    setCancelled(false);
    setProgress({ done: 0, total: outputs.length + 1 });
    try {
      const used = new Set(outputs.flatMap((o) => o.pages.map((p) => p.sourceId)));
      const files = await runJob(
        'assemblePdfs',
        { sources: sources.filter((s) => used.has(s.id)).map((s) => ({ id: s.id, bytes: s.pdf.bytes })), outputs },
        { signal: ctrl.signal, onProgress: (done, total) => setProgress({ done, total }), fallbackError: 'error.pagesFailed' },
      );
      if (ctrl.signal.aborted) return;
      setSavedKey(stateKey);
      if (files.length === 1) {
        setResults({ files });
        downloadBlob(bytesToBlob(files[0].bytes, 'application/pdf'), files[0].name);
      } else {
        const zip = new ZipBuilder();
        files.forEach((f) => zip.add(f.name, f.bytes));
        const blob = await zip.finish();
        if (ctrl.signal.aborted) return;
        const name = zipName ?? `${outputBase}.zip`;
        setResults({ files, zip: { blob, name } });
        downloadBlob(blob, name);
      }
    } catch (e) {
      if (isCancelled(e) || ctrl.signal.aborted) setCancelled(true);
      else setError(e);
    } finally {
      if (abortRef.current === ctrl) abortRef.current = null;
      setProgress(null);
    }
  };

  const saveAll = () => run([toSpec(state.pages, `${safeFileName(outputBase)}${sources.length > 1 ? '' : '_edited'}.pdf`)]);
  const extractSelected = () => run([toSpec(selectedPages, `${safeFileName(outputBase)}_extract.pdf`)]);

  const splitGroups = useMemo((): { ok: true; groups: PageRef[][] } | { ok: false; error: Parameters<typeof RangeErrorText>[0]['error'] } => {
    if (splitMode === 'each') return { ok: true, groups: state.pages.map((p) => [p]) };
    if (splitMode === 'everyN') return { ok: true, groups: chunk(state.pages, everyN) };
    const parsed = parseRangeGroups(rangeText, state.pages.length);
    if (!parsed.ok) return parsed;
    return { ok: true, groups: parsed.groups.map((g) => g.map((n) => state.pages[n - 1])) };
  }, [splitMode, everyN, rangeText, state.pages]);

  const split = () => {
    if (!splitGroups.ok) return;
    const total = splitGroups.groups.length;
    run(
      splitGroups.groups.map((g, i) => toSpec(g, `${safeFileName(outputBase)}_part-${padNumber(i + 1, total)}.pdf`)),
      `${safeFileName(outputBase)}_split.zip`,
    );
  };

  const onCardClick = (e: React.MouseEvent, key: string) => {
    if (e.shiftKey && anchor) dispatch({ type: 'selectRange', fromKey: anchor, toKey: key });
    else dispatch({ type: 'toggle', key });
    setAnchor(key);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest('input, textarea, select')) return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      dispatch({ type: e.shiftKey ? 'redo' : 'undo' });
    } else if (mod && e.key.toLowerCase() === 'y') {
      e.preventDefault();
      dispatch({ type: 'redo' });
    } else if (mod && e.key.toLowerCase() === 'a') {
      e.preventDefault();
      dispatch({ type: 'selectAll' });
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && state.selected.length) {
      e.preventDefault();
      dispatch({ type: 'remove', keys: state.selected });
    } else if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowUp')) {
      e.preventDefault();
      dispatch({ type: 'moveSelected', delta: -1 });
    } else if (e.altKey && (e.key === 'ArrowRight' || e.key === 'ArrowDown')) {
      e.preventDefault();
      dispatch({ type: 'moveSelected', delta: 1 });
    }
  };

  const hasPages = state.pages.length > 0;

  return (
    <div className="page" onKeyDown={onKeyDown}>
      <ToolHeader title={t('tool.pdfPages.title')} description={t('tool.pdfPages.desc')} />
      <DropZone
        accept="application/pdf,.pdf"
        multiple
        onFiles={addFiles}
        title={sources.length ? t('pages.addPdf') : t('common.choosePdfs')}
        hint={t('pages.hint')}
        compact={sources.length > 0}
        disabled={busy}
        testId="pdf-input"
      />
      {loading && <ProgressBar value={loading.done} max={loading.total} label={t('pages.loading', { done: loading.done, total: loading.total })} />}
      {rejected.length > 0 && (
        <Alert kind="warning" title={t('pages.rejectedTitle', { count: rejected.length })}>
          <ul className="plain-list">
            {rejected.map((r, i) => (
              <li key={i}>
                <strong>{r.name}</strong>: {r.error instanceof AppError ? t(r.error.code, r.error.params) : t('error.unexpected')}
              </li>
            ))}
          </ul>
        </Alert>
      )}
      {sources.length > 0 && (
        <div className="workspace two-col">
          <section className="panel grow" aria-label={t('common.pages')}>
            <div className="panel-head wrap">
              <ul className="source-list" aria-label={t('pages.sources')}>
                {sources.map((s, i) => (
                  <li key={s.id}>
                    <span className="source-tag" style={{ background: SOURCE_COLORS[i % SOURCE_COLORS.length] }}>
                      {s.letter}
                    </span>
                    <span className="file-name">{s.pdf.name}</span>
                    <span className="muted small">
                      {t('common.pageCount', { count: s.pdf.pageCount })} · {formatBytes(s.pdf.size, locale)}
                    </span>
                  </li>
                ))}
              </ul>
              <button type="button" className="btn btn-small" onClick={clear} disabled={busy}>
                {t('common.clearWorkspace')}
              </button>
            </div>
            <div className="toolbar" role="toolbar" aria-label={t('pages.toolbar')}>
              <button
                type="button"
                className="btn btn-small"
                onClick={() => dispatch({ type: 'undo' })}
                disabled={busy || state.past.length === 0}
                title={t('common.undoShortcut')}
              >
                <Icon name="undo" size={16} /> {t('common.undo')}
              </button>
              <button
                type="button"
                className="btn btn-small"
                onClick={() => dispatch({ type: 'redo' })}
                disabled={busy || state.future.length === 0}
                title={t('common.redoShortcut')}
              >
                <Icon name="redo" size={16} /> {t('common.redo')}
              </button>
              <span className="toolbar-sep" />
              <button
                type="button"
                className="btn btn-small"
                onClick={() => dispatch({ type: state.selected.length === state.pages.length ? 'selectNone' : 'selectAll' })}
                disabled={busy || !hasPages}
              >
                {state.selected.length === state.pages.length && hasPages ? t('common.selectNone') : t('common.selectAll')}
              </button>
              <button
                type="button"
                className="btn btn-small"
                onClick={() => dispatch({ type: 'rotate', keys: state.selected, delta: -90 })}
                disabled={busy || !state.selected.length}
                data-testid="rotate-left"
              >
                <Icon name="rotateLeft" size={16} /> {t('pages.rotateLeft')}
              </button>
              <button
                type="button"
                className="btn btn-small"
                onClick={() => dispatch({ type: 'rotate', keys: state.selected, delta: 90 })}
                disabled={busy || !state.selected.length}
                data-testid="rotate-right"
              >
                <Icon name="rotateRight" size={16} /> {t('pages.rotateRight')}
              </button>
              <button
                type="button"
                className="btn btn-small"
                onClick={() => dispatch({ type: 'moveSelected', delta: -1 })}
                disabled={busy || !state.selected.length}
                title={t('pages.moveShortcut')}
                data-testid="move-earlier"
              >
                <Icon name="arrowLeft" size={16} /> {t('common.moveEarlier')}
              </button>
              <button
                type="button"
                className="btn btn-small"
                onClick={() => dispatch({ type: 'moveSelected', delta: 1 })}
                disabled={busy || !state.selected.length}
                title={t('pages.moveShortcut')}
                data-testid="move-later"
              >
                <Icon name="arrowRight" size={16} /> {t('common.moveLater')}
              </button>
              <button
                type="button"
                className="btn btn-small danger"
                onClick={() => dispatch({ type: 'remove', keys: state.selected })}
                disabled={busy || !state.selected.length}
                data-testid="delete-pages"
              >
                <Icon name="trash" size={16} /> {t('pages.delete')}
              </button>
            </div>
            <p className="muted small" aria-live="polite">
              {t('pages.status', { total: state.pages.length, selected: state.selected.length })} {t('pages.selectHint')}
            </p>
            {!hasPages && <Alert kind="info">{t('pages.allDeleted')}</Alert>}
            <ol className="page-grid" data-testid="page-grid">
              {state.pages.map((p, i) => {
                const src = sourceById.get(p.sourceId)!;
                const color = SOURCE_COLORS[sources.indexOf(src) % SOURCE_COLORS.length];
                const label = t('pages.cardLabel', { position: i + 1, source: src.letter, page: p.pageIndex + 1 });
                return (
                  <li
                    key={p.key}
                    className={dragKey === p.key ? 'is-dragging' : ''}
                    draggable={!busy}
                    onDragStart={(e) => {
                      setDragKey(p.key);
                      e.dataTransfer.effectAllowed = 'move';
                      e.dataTransfer.setData('text/plain', p.key);
                    }}
                    onDragEnd={() => setDragKey(null)}
                    onDragOver={(e) => dragKey && e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      if (dragKey) dispatch({ type: 'moveTo', key: dragKey, toKey: p.key });
                      setDragKey(null);
                    }}
                    data-testid="page-card"
                    data-source={src.letter}
                    data-page={p.pageIndex + 1}
                    data-rotation={p.rotation}
                  >
                    <button
                      type="button"
                      className={`page-card${selected.has(p.key) ? ' is-selected' : ''}`}
                      aria-pressed={selected.has(p.key)}
                      aria-label={label}
                      onClick={(e) => onCardClick(e, p.key)}
                      disabled={busy}
                    >
                      <PdfThumb cache={src.pdf.thumbs} pageIndex={p.pageIndex} rotation={p.rotation} size={150} alt={label} />
                      <span className="page-num">{i + 1}</span>
                      <span className="source-tag small" style={{ background: color }}>
                        {src.letter}
                        {p.pageIndex + 1}
                      </span>
                      {p.rotation !== 0 && <span className="rotation-badge">{p.rotation}°</span>}
                      <span className="page-check" aria-hidden="true" />
                    </button>
                  </li>
                );
              })}
            </ol>
          </section>
          <aside className="panel side" aria-label={t('pages.export')}>
            <h2>{t('pages.export')}</h2>
            <div className="stack">
              <button type="button" className="btn btn-primary btn-block" onClick={saveAll} disabled={busy || !hasPages} data-testid="save-all">
                <Icon name="download" size={18} />{' '}
                {sources.length > 1 ? t('pages.saveMerged', { count: state.pages.length }) : t('pages.saveAll', { count: state.pages.length })}
              </button>
              <p className="muted small">{t('pages.saveAllHint')}</p>
              <button type="button" className="btn btn-block" onClick={extractSelected} disabled={busy || !selectedPages.length} data-testid="extract">
                {t('pages.extract', { count: selectedPages.length })}
              </button>
            </div>
            <fieldset className="field" disabled={busy || !hasPages}>
              <legend>{t('pages.split')}</legend>
              <div className="radio-list">
                <label className="check">
                  <input type="radio" name="split" checked={splitMode === 'each'} onChange={() => setSplitMode('each')} />
                  {t('pages.splitEach')}
                </label>
                <label className="check">
                  <input type="radio" name="split" checked={splitMode === 'everyN'} onChange={() => setSplitMode('everyN')} />
                  <span className="row gap wrap">
                    {t('pages.splitEvery')}
                    <input
                      type="number"
                      className="input-narrow"
                      min={1}
                      max={Math.max(1, state.pages.length)}
                      value={everyN}
                      onChange={(e) => setEveryN(Math.max(1, Math.round(Number(e.target.value)) || 1))}
                      onFocus={() => setSplitMode('everyN')}
                      aria-label={t('pages.splitEveryLabel')}
                    />
                    {t('pages.splitEveryAfter')}
                  </span>
                </label>
                <label className="check">
                  <input type="radio" name="split" checked={splitMode === 'ranges'} onChange={() => setSplitMode('ranges')} />
                  {t('pages.splitRanges')}
                </label>
                {splitMode === 'ranges' && (
                  <label className="field">
                    <input
                      type="text"
                      value={rangeText}
                      placeholder={t('pages.splitRangesPlaceholder')}
                      onChange={(e) => setRangeText(e.target.value)}
                      aria-label={t('pages.splitRanges')}
                      aria-invalid={!splitGroups.ok}
                      data-testid="split-ranges"
                    />
                    <small className={splitGroups.ok ? 'muted' : 'field-error'}>
                      {splitGroups.ok ? t('pages.splitRangesHint') : <RangeErrorText error={splitGroups.error} pageCount={state.pages.length} />}
                    </small>
                  </label>
                )}
              </div>
              <button type="button" className="btn btn-block" onClick={split} disabled={busy || !splitGroups.ok || !hasPages} data-testid="split">
                {t('pages.splitButton', { count: splitGroups.ok ? splitGroups.groups.length : 0 })}
              </button>
            </fieldset>
            <p className="muted small">{t('pages.preserveNote')}</p>
            {progress && (
              <div className="stack">
                <ProgressBar value={progress.done} max={progress.total} label={t('pages.building')} />
                <button type="button" className="btn" onClick={() => abortRef.current?.abort()}>
                  {t('common.cancel')}
                </button>
              </div>
            )}
            {error !== null && <ErrorAlert error={error} />}
            {cancelled && <Alert kind="info">{t('common.cancelledNoOutput')}</Alert>}
            {results && (
              <Alert kind="success" title={t('common.done')}>
                <ul className="result-list" data-testid="results">
                  {results.files.map((f) => (
                    <li key={f.name}>
                      <span className="file-name">{f.name}</span>
                      <span className="muted small">
                        {t('common.pageCount', { count: f.pageCount })} · {formatBytes(f.bytes.byteLength, locale)}
                      </span>
                      <span className="row gap">
                        <button type="button" className="btn btn-small" onClick={() => setPreview(f)}>
                          <Icon name="eye" size={16} /> {t('common.preview')}
                        </button>
                        <button type="button" className="btn btn-small" onClick={() => downloadBlob(bytesToBlob(f.bytes, 'application/pdf'), f.name)}>
                          <Icon name="download" size={16} /> {t('common.download')}
                        </button>
                      </span>
                    </li>
                  ))}
                </ul>
                {results.zip && (
                  <button type="button" className="btn" onClick={() => downloadBlob(results.zip!.blob, results.zip!.name)}>
                    {t('pages.downloadZip', { name: results.zip.name })}
                  </button>
                )}
              </Alert>
            )}
          </aside>
        </div>
      )}
      <Modal open={preview !== null} title={preview ? t('pages.previewTitle', { name: preview.name }) : ''} onClose={() => setPreview(null)} wide>
        {preview && <PdfResultPreview bytes={preview.bytes} />}
      </Modal>
    </div>
  );
}
