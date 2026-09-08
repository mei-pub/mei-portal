import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  WEEKDAY_EN,
  convertBangumiDataToCalendar,
  isNativeCalendarPayload,
} from './bangumi-adapter.ts';

test('isNativeCalendarPayload：识别 bgm.tv 原生日历', () => {
  const native = [{ weekday: { en: 'Mon' }, items: [] }];
  assert.equal(isNativeCalendarPayload(native), true);
  assert.equal(isNativeCalendarPayload({ items: [] }), false);
  assert.equal(isNativeCalendarPayload([]), false);
  assert.equal(isNativeCalendarPayload(null), false);
});

test('convertBangumiDataToCalendar：按 dayCN 分组并生成七天骨架', () => {
  const data = {
    items: [
      {
        title: 'Some Anime',
        titleTranslate: { 'zh-Hans': ['某动画'], zh: ['某动画旧译'] },
        image: 'https://lain.bgm.tv/pic/cover/l/a.jpg',
        type: 'tv',
        week: { dayCN: 1 },
        air_date: '2026-10-01',
        rating: 7.5,
        sites: [{ site: 'bangumi', id: '400602' }],
      },
      {
        title: 'Sunday Show',
        type: 'tv',
        week: { dayCN: 0 },
        air_date: '2026-10-04',
        rating: 6,
        sites: [{ site: 'bangumi', id: '400603' }],
      },
    ],
  };
  const groups = convertBangumiDataToCalendar(data);
  assert.equal(groups.length, 7);
  assert.deepEqual(
    groups.map((g) => g.weekday.en),
    WEEKDAY_EN
  );
  // dayCN=1 → 周一组
  assert.equal(groups[1].items.length, 1);
  const anime = groups[1].items[0];
  assert.equal(anime.id, 400602);
  assert.equal(anime.name, 'Some Anime');
  assert.equal(anime.name_cn, '某动画');
  assert.equal(anime.rating.score, 7.5);
  assert.equal(anime.air_date, '2026-10-01');
  assert.equal(anime.images.large, 'https://lain.bgm.tv/pic/cover/l/a.jpg');
  // dayCN=0 → 周日组（0=星期日）
  assert.equal(groups[0].items[0].name, 'Sunday Show');
  assert.equal(groups[0].items[0].name_cn, 'Sunday Show');
  // 其余五天为空
  assert.equal(
    groups.filter((g) => g.items.length === 0).length,
    5
  );
});

test('convertBangumiDataToCalendar：过滤非 TV / 无 bangumi id / 非法星期', () => {
  const data = {
    items: [
      { title: '剧场版', type: 'movie', week: { dayCN: 2 }, sites: [{ site: 'bangumi', id: '1' }] },
      { title: '无ID', type: 'tv', week: { dayCN: 2 }, sites: [{ site: 'official', id: '9' }] },
      { title: '坏星期', type: 'tv', week: { dayCN: 9 }, sites: [{ site: 'bangumi', id: '2' }] },
      { title: '无星期', type: 'tv', sites: [{ site: 'bangumi', id: '3' }] },
    ],
  };
  const groups = convertBangumiDataToCalendar(data);
  assert.ok(groups.every((g) => g.items.length === 0));
});

test('convertBangumiDataToCalendar：空数据返回七天空骨架', () => {
  const groups = convertBangumiDataToCalendar(null);
  assert.equal(groups.length, 7);
  assert.ok(groups.every((g) => g.items.length === 0));
});
