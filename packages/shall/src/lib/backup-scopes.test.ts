import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { BACKUP_SCOPES, BACKUP_SCOPE_META, BROWSER_STORAGE_KEYS } from './backup-scopes.ts';

test('backup scopes cover every required app', () => {
  assert.deepEqual(
    [...BACKUP_SCOPES].sort(),
    ['ai-draw', 'lunatv', 'mediago', 'mei-link', 'panel', 'pansou', 'solara', 'tutorial'].sort(),
  );
  for (const scope of BACKUP_SCOPES) {
    assert.ok(BACKUP_SCOPE_META[scope], `missing meta for ${scope}`);
    assert.ok(Array.isArray(BROWSER_STORAGE_KEYS[scope]), `missing browser keys for ${scope}`);
  }
});
