import { useId, useRef, useState, type ReactNode } from 'react';
import { useI18n } from '../i18n/I18nProvider';
import { Icon } from './Icon';

interface DropZoneProps {
  /** Value for the file input's `accept` attribute (a hint only; content is checked later). */
  accept: string;
  multiple?: boolean;
  onFiles: (files: File[]) => void;
  title: string;
  hint?: ReactNode;
  compact?: boolean;
  disabled?: boolean;
  testId?: string;
}

/** File picker that also accepts drag-and-drop. Files never leave the browser. */
export function DropZone({ accept, multiple, onFiles, title, hint, compact, disabled, testId }: DropZoneProps) {
  const { t } = useI18n();
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const hintId = useId();

  const take = (list: FileList | null) => {
    if (!list || list.length === 0) return;
    const files = Array.from(list);
    onFiles(multiple ? files : files.slice(0, 1));
  };

  return (
    <div
      className={`dropzone${over ? ' is-over' : ''}${compact ? ' is-compact' : ''}${disabled ? ' is-disabled' : ''}`}
      onDragOver={(e) => {
        if (disabled) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        if (!disabled) take(e.dataTransfer.files);
      }}
    >
      <Icon name="upload" size={compact ? 20 : 32} />
      <div className="dropzone-text">
        <button type="button" className="btn btn-primary" onClick={() => inputRef.current?.click()} disabled={disabled} aria-describedby={hintId}>
          {title}
        </button>
        {!compact && <span className="dropzone-or">{t('dropzone.orDrag')}</span>}
      </div>
      {hint && (
        <p id={hintId} className="dropzone-hint">
          {hint}
        </p>
      )}
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple={multiple}
        hidden
        data-testid={testId}
        onChange={(e) => {
          take(e.currentTarget.files);
          // Allow picking the same file again after clearing the workspace.
          e.currentTarget.value = '';
        }}
      />
    </div>
  );
}
