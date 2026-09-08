import { describe, expect, it } from 'vite-plus/test';
import { sessionFileRelativePath } from './sessionDetailsSurface';

describe('recorded session file paths', () => {
  it('opens files relative to their actual workspace', () => {
    expect(sessionFileRelativePath('/project/src/main.ts:12', '/project')).toBe('src/main.ts');
    expect(sessionFileRelativePath('src/../README.md', '/project')).toBe('README.md');
    expect(sessionFileRelativePath('C:\\project\\src\\main.ts', 'C:\\project')).toBe('src/main.ts');
  });
  it('refuses outside-workspace and unresolved home paths', () => {
    expect(sessionFileRelativePath('/project-other/file.ts', '/project')).toBeNull();
    expect(sessionFileRelativePath('/project/../secret.txt', '/project')).toBeNull();
    expect(sessionFileRelativePath('../secret.txt', '/project')).toBeNull();
    expect(sessionFileRelativePath('~/secret.txt', '/project')).toBeNull();
    expect(sessionFileRelativePath('/project/file.ts', null)).toBeNull();
  });
});
