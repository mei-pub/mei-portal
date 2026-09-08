import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

test('routes portal search assets before the generic /api proxy', () => {
  const configPath = path.resolve(new URL('../../../../image/nginx/conf.d/00-main.conf', import.meta.url).pathname);
  const config = fs.readFileSync(configPath, 'utf8');
  const searchRoute = config.indexOf('location ^~ /api/search/');
  const searchExactRoute = config.indexOf('location = /api/search');
  const genericRoute = config.indexOf('location /api/');
  assert.ok(searchRoute >= 0, 'search API needs a dedicated nginx location');
  assert.ok(searchExactRoute >= 0, 'search API needs an exact no-slash location');
  assert.ok(genericRoute >= 0, 'generic API route should remain present');
  assert.ok(searchExactRoute < genericRoute, 'exact search route must precede generic API route');
  assert.ok(searchRoute < genericRoute, 'specific search route must precede generic API route');
});
