import { Icon, type IconName } from '../components/Icon';
import { useI18n } from '../i18n/I18nProvider';
import type { MessageKey } from '../i18n/messages';
import type { ToolId } from './fabricKit';

export const TOOLS: { id: ToolId; icon: IconName; label: MessageKey; key: string }[] = [
  { id: 'select', icon: 'select', label: 'editor.tool.select', key: 'V' },
  { id: 'text', icon: 'text', label: 'editor.tool.text', key: 'T' },
  { id: 'rect', icon: 'rect', label: 'editor.tool.rect', key: 'R' },
  { id: 'ellipse', icon: 'ellipse', label: 'editor.tool.ellipse', key: 'O' },
  { id: 'line', icon: 'line', label: 'editor.tool.line', key: 'L' },
  { id: 'arrow', icon: 'arrow', label: 'editor.tool.arrow', key: 'A' },
  { id: 'pen', icon: 'pen', label: 'editor.tool.pen', key: 'P' },
];

export function toolForKey(key: string): ToolId | undefined {
  return TOOLS.find((t) => t.key === key.toUpperCase())?.id;
}

export function ToolPalette({ tool, onTool, extra, disabled }: { tool: ToolId; onTool: (t: ToolId) => void; extra?: React.ReactNode; disabled?: boolean }) {
  const { t } = useI18n();
  return (
    <div className="tool-palette" role="toolbar" aria-label={t('editor.tools')}>
      {TOOLS.map((tl) => (
        <button
          key={tl.id}
          type="button"
          className={`btn btn-tool${tool === tl.id ? ' is-active' : ''}`}
          aria-pressed={tool === tl.id}
          aria-label={`${t(tl.label)} (${tl.key})`}
          title={`${t(tl.label)} (${tl.key})`}
          onClick={() => onTool(tl.id)}
          disabled={disabled}
          data-testid={`tool-${tl.id}`}
        >
          <Icon name={tl.icon} />
          <span className="btn-tool-label">{t(tl.label)}</span>
        </button>
      ))}
      {extra}
    </div>
  );
}
