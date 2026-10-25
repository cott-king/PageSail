import type { ReactNode } from 'react';
import { AppError } from '../lib/errors';
import { useI18n } from '../i18n/I18nProvider';
import { Icon } from './Icon';

export function ProgressBar({ value, max, label }: { value?: number; max?: number; label: string }) {
  const determinate = value !== undefined && max !== undefined && max > 0;
  const pct = determinate ? Math.min(100, Math.round((value / max) * 100)) : undefined;
  return (
    <div className="progress">
      <div
        className={`progress-track${determinate ? '' : ' is-indeterminate'}`}
        role="progressbar"
        aria-label={label}
        aria-valuemin={determinate ? 0 : undefined}
        aria-valuemax={determinate ? 100 : undefined}
        aria-valuenow={pct}
      >
        <div className="progress-fill" style={determinate ? { width: `${pct}%` } : undefined} />
      </div>
      <div className="progress-label" aria-live="polite">
        {label}
        {pct !== undefined && <span className="progress-pct"> {pct}%</span>}
      </div>
    </div>
  );
}

type AlertKind = 'info' | 'success' | 'warning' | 'error';

export function Alert({ kind, title, children, actions }: { kind: AlertKind; title?: ReactNode; children?: ReactNode; actions?: ReactNode }) {
  const icon = kind === 'success' ? 'check' : kind === 'info' ? 'info' : 'warning';
  return (
    <div className={`alert alert-${kind}`} role={kind === 'error' ? 'alert' : 'status'}>
      <Icon name={icon} />
      <div className="alert-body">
        {title && <div className="alert-title">{title}</div>}
        {children && <div className="alert-text">{children}</div>}
        {actions && <div className="alert-actions">{actions}</div>}
      </div>
    </div>
  );
}

/** Shows a translated, actionable error with the technical detail tucked away. */
export function ErrorAlert({ error, actions }: { error: unknown; actions?: ReactNode }) {
  const { t } = useI18n();
  const appError = error instanceof AppError ? error : null;
  const message = appError ? t(appError.code, appError.params) : t('error.unexpected');
  const detail = appError?.detail ?? (error instanceof Error ? `${error.name}: ${error.message}` : undefined);
  return (
    <Alert kind="error" title={t('common.errorTitle')} actions={actions}>
      <p>{message}</p>
      {detail && (
        <details className="error-detail">
          <summary>{t('common.technicalDetails')}</summary>
          <code>{detail}</code>
        </details>
      )}
    </Alert>
  );
}
