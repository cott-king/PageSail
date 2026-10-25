import { Component, type ReactNode } from 'react';
import { ErrorAlert } from '../components/Feedback';
import { useI18n } from '../i18n/I18nProvider';

function Fallback({ error, onReset }: { error: unknown; onReset: () => void }) {
  const { t } = useI18n();
  const isChunkError = error instanceof Error && /dynamically imported module|Importing a module script failed|Failed to fetch/i.test(error.message);
  return (
    <div className="page narrow">
      <ErrorAlert
        error={error}
        actions={
          <>
            <button type="button" className="btn btn-primary" onClick={onReset}>
              {t('common.tryAgain')}
            </button>
            {isChunkError && (
              <button type="button" className="btn" onClick={() => window.location.reload()}>
                {t('common.reloadPage')}
              </button>
            )}
          </>
        }
      />
    </div>
  );
}

/** Keeps a crash inside one tool from taking down the whole app; "Try again" remounts it with a clean workspace. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: unknown; attempt: number }> {
  state = { error: null as unknown, attempt: 0 };

  static getDerivedStateFromError(error: unknown) {
    return { error };
  }

  componentDidCatch(error: unknown) {
    console.error('[PageSail] UI error', error);
  }

  render() {
    if (this.state.error) {
      return <Fallback error={this.state.error} onReset={() => this.setState((s) => ({ error: null, attempt: s.attempt + 1 }))} />;
    }
    return (
      <div key={this.state.attempt} className="boundary">
        {this.props.children}
      </div>
    );
  }
}
