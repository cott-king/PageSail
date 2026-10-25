import { useEffect, useState } from 'react';
import { useI18n } from '../i18n/I18nProvider';
import { openPdf, type OpenedPdf } from '../lib/pdf/pdfjs';
import { ThumbnailCache } from '../lib/pdf/thumbnails';
import { ErrorAlert, ProgressBar } from './Feedback';
import { PdfThumb } from './PdfThumb';

/**
 * Re-opens a generated PDF with pdf.js and shows its pages, so the visitor previews the
 * actual output file rather than the editor state.
 */
export function PdfResultPreview({ bytes }: { bytes: Uint8Array }) {
  const { t } = useI18n();
  const [state, setState] = useState<{ opened: OpenedPdf; thumbs: ThumbnailCache } | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    let alive = true;
    let local: { opened: OpenedPdf; thumbs: ThumbnailCache } | null = null;
    openPdf(bytes)
      .then((opened) => {
        local = { opened, thumbs: new ThumbnailCache(opened.doc, 200) };
        if (alive) setState(local);
        else {
          local.thumbs.dispose();
          void opened.destroy();
        }
      })
      .catch((e) => alive && setError(e));
    return () => {
      alive = false;
      if (local) {
        local.thumbs.dispose();
        void local.opened.destroy();
      }
    };
  }, [bytes]);

  if (error) return <ErrorAlert error={error} />;
  if (!state) return <ProgressBar label={t('common.loading')} />;
  const n = state.opened.doc.numPages;
  return (
    <div>
      <p className="muted">{t('common.pageCount', { count: n })}</p>
      <ul className="page-grid compact" data-testid="result-preview">
        {Array.from({ length: n }, (_, i) => (
          <li key={i} className="preview-cell">
            <PdfThumb cache={state.thumbs} pageIndex={i} size={140} alt={t('common.pageN', { page: i + 1 })} />
            <span className="page-num">{i + 1}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
