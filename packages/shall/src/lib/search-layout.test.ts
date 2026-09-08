import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const cssPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../app/globals.css');
const searchClientPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../components/SearchClient.tsx',
);
const css = fs.readFileSync(cssPath, 'utf8');
const searchClient = fs.readFileSync(searchClientPath, 'utf8');

function ruleFor(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))?.[1] || '';
}

test('video source badge stays in the info column and footer only aligns actions', () => {
  const info = ruleFor('.mei-video-info');
  const footer = ruleFor('.mei-video-card-footer');
  const actions = ruleFor('.mei-video-actions');

  assert.match(info, /min-width:\s*0/);
  assert.match(footer, /display:\s*flex/);
  assert.match(footer, /grid-column:\s*2/);
  assert.match(actions, /justify-self:\s*end/);
  assert.match(actions, /margin-left:\s*auto/);
});

test('search cards expose distinct resource type and icon action styles', () => {
  const grid = ruleFor('.mei-search-disk-grid');
  const card = ruleFor('.mei-disk-card');
  const footer = ruleFor('.mei-disk-card-footer');
  const password = ruleFor('.mei-disk-password');
  const title = ruleFor('.mei-disk-title');
  const meta = ruleFor('.mei-disk-card-meta');
  const type = ruleFor('.mei-disk-type');
  const actions = ruleFor('.mei-disk-actions');
  const button = ruleFor('.mei-disk-action');

  assert.match(grid, /grid-template-columns:\s*repeat\(4,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(card, /display:\s*flex/);
  assert.match(footer, /justify-content:\s*space-between/);
  assert.match(password, /display:\s*inline-flex/);
  assert.match(title, /-webkit-line-clamp:\s*2/);
  assert.match(meta, /display:\s*(?:inline-)?flex/);
  assert.match(type, /white-space:\s*nowrap/);
  assert.match(actions, /display:\s*flex/);
  assert.match(button, /width:\s*27px/);
});

test('disk card actions merge copy password and copy link, open action removed', () => {
  const cardStart = searchClient.indexOf('function DiskResultCard');
  const cardEnd = searchClient.indexOf('function DiskResults');
  assert.ok(cardStart >= 0 && cardEnd > cardStart, 'DiskResultCard block exists');
  const card = searchClient.slice(cardStart, cardEnd);

  assert.doesNotMatch(card, /打开资源链接/);
  assert.match(card, /复制资源链接/);
  assert.match(card, /复制提取码/);

  const actions = card.slice(card.indexOf('mei-disk-actions'));
  assert.match(actions, /mei-disk-password/);
  assert.match(actions, /mei-disk-action\$\{/);
  assert.ok(
    actions.indexOf('mei-disk-password${') < actions.indexOf('mei-disk-action${'),
    'password chip sits before the copy-link button in the actions row',
  );
});

test('disk results filter through cloud-type tabs mirroring the source app', () => {
  const tabs = ruleFor('.mei-disk-tabs');
  assert.match(tabs, /display:\s*flex/);
  assert.match(tabs, /border-radius:\s*var\(--mei-radius-full\)/);
  assert.match(tabs, /overflow-x:\s*auto/);
  assert.match(searchClient, /aria-label="网盘类型筛选"/);
  assert.match(searchClient, /meta\?\.diskType/);
  assert.match(searchClient, /facets=\{group\.facets\}/);
  assert.doesNotMatch(searchClient, /来源筛选/);
  assert.doesNotMatch(css, /\.mei-disk-filter/);
});

test('search page restores the shared topbar after leaving app hosting', () => {
  assert.match(
    searchClient,
    /mei-topbar-suppress[\s\S]*suppressed:\s*false/,
  );
});
