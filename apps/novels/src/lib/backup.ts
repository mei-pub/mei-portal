import { getAllNovels, getNovelById, getChaptersByNovelId, getChapterById, createNovel, createVolume, createChapter, getLibraryById, updateNovel } from './db';

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
 */
export function importLibrary(libraryId: number, data: ExportData): { imported: number; skipped: number; errors: string[] } {
  let imported = 0;
  let skipped = 0;
  const errors: string[] = [];

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

      for (const ch of novel.chapters) {
        createChapter({
          novel_id: createdNovel.id,
          library_id: libraryId,
          title: ch.title,
          content: ch.content,
          chapter_order: ch.chapter_order,
        });
      }

      imported++;
    } catch (err) {
      errors.push(`Failed to import "${novel.title}": ${err}`);
      skipped++;
    }
  }

  return { imported, skipped, errors };
}
