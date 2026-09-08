/**
 * Bangumi 数据源适配器。
 * 本部署环境 api.bgm.tv 不可达（DNS/网络阻断），备源为 bangumi-data 项目
 * 的全量放送数据（unpkg / jsdelivr CDN）。这里把 bangumi-data 的 item
 * 转换为 api.bgm.tv/calendar 的返回格式，前端零改动。
 *
 * bangumi-data item.week.dayCN：在中国大陆的放送星期，0-6 对应周日~周六。
 */
export const WEEKDAY_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const WEEKDAY_CN = [
  '星期日',
  '星期一',
  '星期二',
  '星期三',
  '星期四',
  '星期五',
  '星期六',
];

export interface CalendarWeekday {
  en: string;
  cn: string;
  id: number;
}

export interface CalendarItem {
  id: number;
  name: string;
  name_cn: string;
  rating: { score: number };
  air_date: string;
  images: {
    large: string;
    common: string;
    medium: string;
    small: string;
    grid: string;
  };
}

export interface CalendarGroup {
  weekday: CalendarWeekday;
  items: CalendarItem[];
}

export interface BangumiDataItem {
  title?: string;
  titleTranslate?: Record<string, string[]>;
  image?: string;
  type?: string;
  week?: { dayCN?: number };
  air_date?: string;
  rating?: number | null;
  sites?: Array<{ site?: string; id?: string }>;
}

export interface BangumiDataFile {
  items?: BangumiDataItem[];
}

/** 判断上游响应是否为 bgm.tv 原生日历格式（数组且首组带 weekday.en） */
export function isNativeCalendarPayload(data: unknown): boolean {
  return (
    Array.isArray(data) &&
    data.length > 0 &&
    typeof (data[0] as { weekday?: { en?: unknown } })?.weekday?.en === 'string'
  );
}

/** bangumi-data 全量数据 → 按星期分组的放送日历 */
export function convertBangumiDataToCalendar(
  data: BangumiDataFile | null | undefined
): CalendarGroup[] {
  const groups: CalendarGroup[] = WEEKDAY_EN.map((en, idx) => ({
    weekday: { en, cn: WEEKDAY_CN[idx], id: idx },
    items: [],
  }));
  for (const item of data?.items || []) {
    // 放送表只看 TV；其余类型（剧场版/OVA/网络片）不进每日放送
    if (item.type !== 'tv') continue;
    const day = item.week?.dayCN;
    if (typeof day !== 'number' || day < 0 || day > 6) continue;
    const bangumiSite = (item.sites || []).find((s) => s?.site === 'bangumi');
    const bangumiId = Number(bangumiSite?.id);
    // 无 bangumi id 的条目无法跳转详情，直接跳过
    if (!bangumiSite?.id || !Number.isFinite(bangumiId) || bangumiId <= 0)
      continue;
    const title = item.title || '';
    if (!title) continue;
    const image = item.image || '';
    groups[day].items.push({
      id: bangumiId,
      name: title,
      name_cn:
        item.titleTranslate?.['zh-Hans']?.[0] ||
        item.titleTranslate?.zh?.[0] ||
        title,
      rating: { score: typeof item.rating === 'number' ? item.rating : 0 },
      air_date: item.air_date || '',
      images: { large: image, common: image, medium: image, small: image, grid: image },
    });
  }
  return groups;
}
