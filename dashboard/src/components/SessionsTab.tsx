import { SessionWorkspace } from './SessionWorkspace';

export function SessionsTab({ active = true }: { active?: boolean }) {
  return <SessionWorkspace active={active} />;
}
