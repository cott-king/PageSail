import { useI18n } from '../i18n/I18nProvider';
import type { RangeError } from '../lib/pdf/pageRange';

export function RangeErrorText({ error, pageCount }: { error: RangeError; pageCount: number }) {
  const { t } = useI18n();
  switch (error.code) {
    case 'syntax':
      return <>{t('range.syntax', { token: error.token })}</>;
    case 'outOfBounds':
      return <>{t('range.outOfBounds', { token: error.token, count: pageCount })}</>;
    case 'reversed':
      return <>{t('range.reversed', { token: error.token })}</>;
    default:
      return <>{t('range.empty')}</>;
  }
}
