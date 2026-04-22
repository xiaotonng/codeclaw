/**
 * Project-level extensions modal — opened from workspace sidebar.
 * Thin wrapper around WorkspaceExtensionsBody; workspace scope operates
 * directly on .mcp.json and .pikiclaw/skills/ in the project directory.
 */

import { useStore } from '../../store';
import { Modal, ModalHeader } from '../../components/ui';
import { WorkspaceExtensionsBody } from './ExtensionsTab';

function L(locale: string, zh: string, en: string): string {
  return locale === 'zh-CN' ? zh : en;
}

export function WorkspaceExtensionsModal({
  open,
  onClose,
  workdir,
}: {
  open: boolean;
  onClose: () => void;
  workdir: string;
}) {
  const locale = useStore(s => s.locale);
  const wsName = workdir.split('/').pop() || workdir;

  return (
    <Modal open={open} onClose={onClose} wide>
      <ModalHeader
        title={L(locale, `${wsName} — 项目扩展`, `${wsName} — Project Extensions`)}
        description={L(
          locale,
          '仅对当前工作区生效。直接操作项目目录中的 .mcp.json 与 .pikiclaw/skills/。',
          'Project-scoped only. Operates directly on .mcp.json and .pikiclaw/skills/ in the workspace directory.',
        )}
        onClose={onClose}
      />
      {open ? <WorkspaceExtensionsBody workdir={workdir} /> : null}
    </Modal>
  );
}
