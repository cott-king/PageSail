import { useEffect, useRef } from 'react';
import { Icon } from '../components/Icon';
import { useI18n } from '../i18n/I18nProvider';
import type { DrawStyle, LayerMove, SelectionInfo, StylePatch, ToolId } from './fabricKit';
import { FONTS, fontDef, type FontId } from './fonts';

export interface FontIssue {
  missing: string[];
  suggestion: FontId | null;
}

interface Props {
  tool: ToolId;
  style: DrawStyle;
  selection: SelectionInfo | null;
  /** Changes the selection (if any) and the defaults for new objects. `commit` records an undo step. */
  onChange: (patch: StylePatch, commit: boolean) => void;
  onCommit: () => void;
  onLayer: (how: LayerMove) => void;
  onDelete: () => void;
  fontLoading: FontId | null;
  fontIssue: FontIssue | null;
  /** Bumped whenever a text object should take keyboard focus (e.g. just created). */
  focusTextToken: number;
  selectionKey: string;
}

/**
 * Style controls. Text content is edited in a native <textarea> (uncontrolled, keyed by
 * the selected object) so IME composition for Chinese/Japanese works exactly like any
 * other text field; an undo step is recorded when composition ends or after a pause.
 */
export function PropertiesPanel({
  tool,
  style,
  selection,
  onChange,
  onCommit,
  onLayer,
  onDelete,
  fontLoading,
  fontIssue,
  focusTextToken,
  selectionKey,
}: Props) {
  const { t } = useI18n();
  const textRef = useRef<HTMLTextAreaElement>(null);
  const composing = useRef(false);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (focusTextToken && textRef.current) {
      textRef.current.focus();
      textRef.current.select();
    }
  }, [focusTextToken]);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const scheduleCommit = () => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      if (!composing.current) onCommit();
    }, 700);
  };

  const kinds = selection?.kinds ?? [];
  const isText = selection ? kinds.length === 1 && kinds[0] === 'text' : tool === 'text';
  const hasShape = selection ? kinds.some((k) => k !== 'text' && k !== 'image') : ['rect', 'ellipse', 'line', 'arrow', 'pen'].includes(tool);
  const canFill = selection ? kinds.some((k) => k === 'rect' || k === 'ellipse') : tool === 'rect' || tool === 'ellipse';
  const canDash = selection ? kinds.some((k) => k === 'rect' || k === 'ellipse' || k === 'line') : ['rect', 'ellipse', 'line'].includes(tool);
  const v = selection ?? null;
  const stroke = v?.stroke ?? style.stroke;
  const fill = v ? v.fill : style.fill;
  const strokeWidth = v?.strokeWidth ?? style.strokeWidth;
  const opacity = v?.opacity ?? style.opacity;
  const dashed = v?.dashed ?? style.dashed;
  const fontId = v?.fontId ?? style.fontId;
  const fontSize = v?.fontSize ?? style.fontSize;
  const textColor = v?.textColor ?? style.textColor;

  return (
    <div className="props" aria-label={t('editor.properties')}>
      <h3>{selection ? t('editor.selected', { count: selection.count }) : t('editor.newObjects')}</h3>
      {!selection && tool === 'select' && <p className="muted small">{t('editor.selectHint')}</p>}
      {isText && (
        <>
          {selection && selection.text !== undefined && (
            <label className="field">
              <span>{t('editor.textContent')}</span>
              <textarea
                key={selectionKey}
                ref={textRef}
                defaultValue={selection.text}
                rows={4}
                onCompositionStart={() => {
                  composing.current = true;
                }}
                onCompositionEnd={(e) => {
                  composing.current = false;
                  onChange({ text: e.currentTarget.value }, false);
                  scheduleCommit();
                }}
                onChange={(e) => {
                  onChange({ text: e.currentTarget.value }, false);
                  scheduleCommit();
                }}
                onBlur={() => {
                  window.clearTimeout(timer.current);
                  onCommit();
                }}
                data-testid="text-content"
              />
            </label>
          )}
          <label className="field">
            <span>{t('editor.font')}</span>
            <select value={fontId} onChange={(e) => onChange({ fontId: e.target.value as FontId }, true)} data-testid="font-select">
              {FONTS.map((f) => (
                <option key={f.id} value={f.id}>
                  {t(f.label)}
                </option>
              ))}
            </select>
            {fontLoading && <small className="muted">{t('editor.fontLoading', { size: fontDef(fontLoading).approxMB })}</small>}
          </label>
          {fontIssue && fontIssue.missing.length > 0 && (
            <div className="alert alert-warning" role="alert" data-testid="font-issue">
              <Icon name="warning" />
              <div className="alert-body">
                <div className="alert-text">{t('editor.missingGlyphs', { chars: fontIssue.missing.slice(0, 12).join(' ') })}</div>
                {fontIssue.suggestion && (
                  <div className="alert-actions">
                    <button type="button" className="btn btn-small" onClick={() => onChange({ fontId: fontIssue.suggestion! }, true)}>
                      {t('editor.switchFont', { font: t(fontDef(fontIssue.suggestion).label) })}
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}
          <div className="field-row">
            <label className="field">
              <span>{t('editor.fontSize')}</span>
              <input
                type="number"
                min={4}
                max={400}
                step={1}
                value={fontSize}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  if (n >= 4 && n <= 400) onChange({ fontSize: n }, false);
                }}
                onBlur={onCommit}
                data-testid="font-size"
              />
            </label>
            <label className="field">
              <span>{t('editor.textColor')}</span>
              <input type="color" value={textColor} onChange={(e) => onChange({ textColor: e.target.value }, false)} onBlur={onCommit} />
            </label>
          </div>
        </>
      )}
      {hasShape && (
        <>
          <div className="field-row">
            <label className="field">
              <span>{t('editor.strokeColor')}</span>
              <input type="color" value={stroke} onChange={(e) => onChange({ stroke: e.target.value }, false)} onBlur={onCommit} data-testid="stroke-color" />
            </label>
            <label className="field">
              <span>{t('editor.strokeWidth')}</span>
              <input
                type="number"
                min={canFill ? 0 : 1}
                max={60}
                step={1}
                value={strokeWidth}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  if (Number.isFinite(n) && n >= 0 && n <= 60) onChange({ strokeWidth: n }, false);
                }}
                onBlur={onCommit}
                data-testid="stroke-width"
              />
            </label>
          </div>
          {canFill && (
            <div className="field-row">
              <label className="check">
                <input
                  type="checkbox"
                  checked={fill !== null}
                  onChange={(e) => onChange({ fill: e.target.checked ? stroke : null }, true)}
                  data-testid="fill-toggle"
                />
                {t('editor.fill')}
              </label>
              {fill !== null && (
                <label className="field inline">
                  <span className="visually-hidden">{t('editor.fillColor')}</span>
                  <input
                    type="color"
                    value={fill}
                    onChange={(e) => onChange({ fill: e.target.value }, false)}
                    onBlur={onCommit}
                    aria-label={t('editor.fillColor')}
                  />
                </label>
              )}
            </div>
          )}
          {canDash && (
            <label className="check">
              <input type="checkbox" checked={dashed} onChange={(e) => onChange({ dashed: e.target.checked }, true)} />
              {t('editor.dashed')}
            </label>
          )}
        </>
      )}
      <label className="field">
        <span>{t('editor.opacity', { value: Math.round(opacity * 100) })}</span>
        <input
          type="range"
          min={0.05}
          max={1}
          step={0.05}
          value={opacity}
          onChange={(e) => onChange({ opacity: Number(e.target.value) }, false)}
          onPointerUp={onCommit}
          onKeyUp={onCommit}
        />
      </label>
      {selection && (
        <>
          <div className="field">
            <span className="field-label">{t('editor.layer')}</span>
            <div className="row gap wrap">
              <button type="button" className="btn btn-small" onClick={() => onLayer('front')} title={t('editor.toFront')}>
                <Icon name="bringForward" size={16} /> {t('editor.toFront')}
              </button>
              <button type="button" className="btn btn-small" onClick={() => onLayer('forward')}>
                {t('editor.forward')}
              </button>
              <button type="button" className="btn btn-small" onClick={() => onLayer('backward')}>
                {t('editor.backward')}
              </button>
              <button type="button" className="btn btn-small" onClick={() => onLayer('back')} title={t('editor.toBack')}>
                <Icon name="sendBackward" size={16} /> {t('editor.toBack')}
              </button>
            </div>
          </div>
          <button type="button" className="btn btn-block danger" onClick={onDelete} data-testid="delete-object">
            <Icon name="trash" size={16} /> {t('editor.deleteSelected')}
          </button>
        </>
      )}
    </div>
  );
}
