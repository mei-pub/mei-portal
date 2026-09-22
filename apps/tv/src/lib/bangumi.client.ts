'use client';

export interface BangumiCalendarData {
  weekday: {
    en: string;
  };
  items: {
    id: number;
    name: string;
    name_cn: string;
    rating: {
      score: number;
    };
    air_date: string;
    images: {
      large: string;
      common: string;
      medium: string;
      small: string;
      grid: string;
    };
  }[];
}

export async function GetBangumiCalendarData(): Promise<BangumiCalendarData[]> {
  const response = await fetch('/api/bangumi/calendar');
  if (!response.ok) {
    throw new Error(`获取番剧日历失败: HTTP ${response.status}`);
  }
  const data = await response.json();
  // 上游异常时可能返回非数组（错误对象/HTML 网关页），直接 map 会抛
  // TypeError 且信息不可读，这里归一为空列表交给上层空态处理
  const safeData: BangumiCalendarData[] = Array.isArray(data) ? data : [];
  const filteredData = safeData.map((item: BangumiCalendarData) => ({
    ...item,
    items: (item.items ?? []).filter(bangumiItem => bangumiItem.images)
  }));

  return filteredData;
}
