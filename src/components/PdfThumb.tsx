import { useEffect, useRef, useState } from 'react';
import { isCancelled } from '../lib/errors';
import type { ThumbnailCache } from '../lib/pdf/thumbnails';
import { useI18n } from '../i18n/I18nProvider';

/** Renders a page preview only once it scrolls into view. */
export function PdfThumb({
  cache,
  pageIndex,
  rotation = 0,
  size = 160,
  alt,
}: {
  cache: ThumbnailCache;
  pageIndex: number;
  rotation?: number;
  size?: number;
  alt: string;
}) {
  const { t } = useI18n();
  const ref = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<{ key: string; url?: string; failed?: boolean }>({ key: '' });
  const key = `${pageIndex}:${rotation}:${size}`;
  const url = state.key === key ? state.url : cache.peek(pageIndex, rotation, size);
  const failed = state.key === key && state.failed;

  useEffect(() => {
    if (cache.peek(pageIndex, rotation, size)) return;
    const el = ref.current;
    if (!el) return;
    const ctrl = new AbortController();
    const load = () => {
      cache
        .get(pageIndex, rotation, size, ctrl.signal)
        .then((u) => {
          if (!ctrl.signal.aborted) setState({ key, url: u });
        })
        .catch((e) => {
          if (!ctrl.signal.aborted && !isCancelled(e)) setState({ key, failed: true });
        });
    };
    if (typeof IntersectionObserver === 'undefined') {
      load();
      return () => ctrl.abort();
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((en) => en.isIntersecting)) {
          io.disconnect();
          load();
        }
      },
      { rootMargin: '300px' },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      ctrl.abort();
    };
  }, [cache, pageIndex, rotation, size, key]);

  return (
    <div ref={ref} className="thumb" style={{ width: size, height: size }}>
      {url ? (
        <img src={url} alt={alt} draggable={false} />
      ) : failed ? (
        <span className="thumb-failed">{t('common.previewFailed')}</span>
      ) : (
        <span className="thumb-loading" aria-label={t('common.loading')} />
      )}
    </div>
  );
}
