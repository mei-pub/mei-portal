import { getAllNovels, getNovelById, getChaptersByNovelId, getChapterById, createNovel, createVolume, createChapter, getLibraryById, updateNovel, recalcNovelWordCount, withTransaction } from './db';

export interface ExportData {
  version: number;
  libraryName: string;
  exportedAt: string;
  novels: ExportNovel[];
}

export interface ExportNovel {
  title: string;
  author: string;
  description: string;
  cover_url: string;
  category: string;
  tags: string[];
  status: string;
  rating: number;
  volumes: { title: string; position: number }[];
  chapters: { title: string; content: string; chapter_order: number }[];
}

/**
 * Export all novels in a library as structured data.
 */
export function exportLibrary(libraryId: number): ExportData {
  const library = getLibraryById(libraryId);
  const novels = getAllNovels(libraryId);

  const exportNovels: ExportNovel[] = novels.map(novel => {
    const full = getNovelById(novel.id, libraryId);
    const chapterList = getChaptersByNovelId(novel.id, libraryId);

    const chaptersWithContent = chapterList.map(ch => {
      const fullCh = getChapterById(ch.id, libraryId);
      return {
        title: ch.title,
        content: fullCh?.content || '',
        chapter_order: ch.chapter_order,
      };
    });

    return {
      title: novel.title,
      author: novel.author,
      description: novel.description,
      cover_url: novel.cover_url,
      category: novel.category,
      tags: novel.tags,
      status: novel.status,
      rating: novel.rating,
      volumes: (full?.volumes || []).map(v => ({ title: v.title, position: v.position })),
      chapters: chaptersWithContent,
    };
  });

  return {
    version: 1,
    libraryName: library?.name || '',
    exportedAt: new Date().toISOString(),
    novels: exportNovels,
  };
}

/**
 * Import novels from exported data into a library.
 * Returns summary of import operation.
 * - 整个导入包在单个 SQLite 事务中执行（失败整体回滚）
 * - 章节按 (novel_id, title) 去重：同书内标题重复的章节只导入第一次
 * - 字数 SUM 只在全部章节写完后重算一次（不再每章 O(n²)）
 */
export function importLibrary(libraryId: number, data: ExportData): { imported: number; skipped: number; errors: string[] } {
  let imported = 0;
  let skipped = 0;
  const errors: string[] = [];

  withTransaction(() => {
    for (const novel of data.novels) {
      try {
        const createdNovel = createNovel(libraryId, {
          title: novel.title,
          author: novel.author,
          description: novel.description,
          cover_url: novel.cover_url,
          category: novel.category,
          tags: novel.tags,
          status: novel.status,
        });

        if (novel.rating) {
          updateNovel(createdNovel.id, libraryId, { rating: novel.rating });
        }

        for (const vol of novel.volumes) {
          createVolume(createdNovel.id, libraryId, vol.title, vol.position);
        }

        // (novel_id, title) 去重集合
        const seenTitles = new Set<string>();
        for (const ch of novel.chapters) {
          const key = (ch.title || '').trim();
          if (seenTitles.has(key)) {
            skipped++;
            continue;
          }
          const created = createChapter({
            novel_id: createdNovel.id,
            library_id: libraryId,
            title: ch.title,
            content: ch.content,
            chapter_order: ch.chapter_order,
            skipWordCount: true,
          });
          if (!created) {
            errors.push(`Failed to import chapter "${ch.title}" of "${novel.title}": novel not found`);
            skipped++;
            continue;
          }
          seenTitles.add(key);
        }

        imported++;
      } catch (err) {
        errors.push(`Failed to import "${novel.title}": ${err}`);
        skipped++;
      }
    }
  });

  // 全部章节落库后统一重算字数（每本一次 SUM，而非每章一次）
  const novels = getAllNovels(libraryId);
  for (const n of novels) recalcNovelWordCount(n.id);

  return { imported, skipped, errors };
}
