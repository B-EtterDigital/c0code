import type { C0xModuleDescriptor } from './nativeShell';

export const C0X_SESSION_DETAILS_ID = 'c0code-session-details';
export const C0X_SESSION_DETAILS_SURFACE: C0xModuleDescriptor = {
  id: C0X_SESSION_DETAILS_ID,
  title: 'Session',
  blurb: 'Sources, outputs and tool usage for this conversation.',
  icon: 'file-text',
  mark: null,
  accent: null,
  available: true,
  disabledReason: '',
};

export function sessionFileRelativePath(path: string, workspaceRoot: string | null | undefined): string | null {
  const normalized = path.replace(/\\/g, '/').replace(/:\d+(?::\d+)?$/, '');
  const root = workspaceRoot?.replace(/\\/g, '/').replace(/\/$/, '');
  const absolute = normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized);
  if (normalized.startsWith('~/')) return null;
  if (absolute && (!root || !normalized.startsWith(root + '/'))) return null;
  const relative = absolute ? normalized.slice(root!.length + 1) : normalized;
  const parts: string[] = [];
  for (const part of relative.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (parts.length === 0) return null;
      parts.pop();
    } else parts.push(part);
  }
  return parts.length > 0 ? parts.join('/') : null;
}
