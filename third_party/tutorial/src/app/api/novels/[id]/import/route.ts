import { NextResponse } from 'next/server';
import { createChapter, getNovelById } from '@/lib/db';
import { requireSiteAccess } from "@/lib/auth";

// 支持两种格式:
// 1. { fullText } - 旧格式，系统自动拆分（保持向后兼容）
// 2. { chapters: [{title, content}] } - 新格式，前端已拆分

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const siteResult = requireSiteAccess(request, new URL(request.url).searchParams.get("site"));
  if (siteResult instanceof NextResponse) return siteResult;
  const libraryId = siteResult.id;
  try {
    const { id } = await params;
    const novelId = parseInt(id);

    const novel = getNovelById(novelId, libraryId);
    if (!novel) {
      return NextResponse.json({ error: 'Novel not found' }, { status: 404 });
    }

    const body = await request.json();
    const existingChaptersCount = novel.chapters?.length || 0;

    // 新格式：前端已拆分章节
    if (body.chapters && Array.isArray(body.chapters)) {
      const created = [];
      for (let i = 0; i < body.chapters.length; i++) {
        const ch = body.chapters[i];
        if (!ch.title || !ch.content) continue;
        const chapter = createChapter({
          novel_id: novelId,
          library_id: libraryId,
          title: ch.title.trim(),
          content: ch.content.trim(),
          chapter_order: existingChaptersCount + i,
        });
        created.push({ id: chapter.id, title: chapter.title, word_count: chapter.word_count });
      }
      return NextResponse.json({
        message: `成功导入 ${created.length} 个章节`,
        chapters: created,
      }, { status: 201 });
    }

    // 旧格式：系统自动拆分
    const { fullText } = body;
    if (!fullText || typeof fullText !== 'string') {
      return NextResponse.json({ error: 'fullText is required' }, { status: 400 });
    }

    // 章节识别正则
    const chapterPatterns = [
      /^\s*第[零一二三四五六七八九十百千万\d]+[章节回卷集部篇][\s\S]*?$/gm,
      /^\s*Chapter\s+\d+[\s\S]*?$/gim,
      /^\s*卷[零一二三四五六七八九十百千万\d]+[\s\S]*?$/gm,
      /^\s*\d+[\s、.][\s\S]*?$/gm,
    ];

    let splitResult: { title: string; content: string }[] = [];

    for (const pattern of chapterPatterns) {
      const matches = [...fullText.matchAll(new RegExp(pattern.source, pattern.flags))];
      if (matches.length >= 2) {
        splitResult = [];
        for (let i = 0; i < matches.length; i++) {
          const start = matches[i].index! + matches[i][0].length;
          const end = i + 1 < matches.length ? matches[i + 1].index! : fullText.length;
          const title = matches[i][0].trim().replace(/[\r\n]+/g, ' ');
          const content = fullText.slice(start, end).trim();
          if (content.length > 0) {
            splitResult.push({ title, content });
          }
        }
        break;
      }
    }

    if (splitResult.length === 0) {
      const lines = fullText.split(/\n/);
      let currentTitle = '';
      let currentContent: string[] = [];
      const chunks: { title: string; content: string }[] = [];

      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.length > 0 && trimmed.length < 50 && !trimmed.endsWith('。') && !trimmed.endsWith('！') && !trimmed.endsWith('？') && !trimmed.endsWith('.') && currentContent.length > 0) {
          chunks.push({ title: currentTitle || `第${chunks.length + 1}节`, content: currentContent.join('\n').trim() });
          currentTitle = trimmed;
          currentContent = [];
        } else if (trimmed.length > 0) {
          if (currentTitle === '' && currentContent.length === 0 && chunks.length === 0) {
            currentTitle = trimmed;
          } else {
            currentContent.push(line);
          }
        }
      }

      if (currentContent.length > 0 || currentTitle) {
        chunks.push({ title: currentTitle || `第${chunks.length + 1}节`, content: currentContent.join('\n').trim() });
      }

      if (chunks.length > 0) {
        splitResult = chunks;
      } else {
        splitResult = [{ title: '全文', content: fullText.trim() }];
      }
    }

    const created = [];
    for (let i = 0; i < splitResult.length; i++) {
      const ch = splitResult[i];
      const chapter = createChapter({
        novel_id: novelId,
        library_id: libraryId,
        title: ch.title,
        content: ch.content,
        chapter_order: existingChaptersCount + i,
      });
      created.push({ id: chapter.id, title: chapter.title, word_count: chapter.word_count });
    }

    return NextResponse.json({
      message: `成功导入 ${created.length} 个章节`,
      chapters: created,
    }, { status: 201 });
  } catch (error) {
    console.error('Failed to import text:', error);
    return NextResponse.json({ error: 'Failed to import text' }, { status: 500 });
  }
}
