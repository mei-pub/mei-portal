import { NextResponse } from 'next/server';
import { requireSiteWriteAccess } from "@/lib/auth";

// POST /api/upload-image - 图片上传，返回 base64 markdown 格式
export async function POST(request: Request) {
  const siteResult = requireSiteWriteAccess(request, new URL(request.url).searchParams.get("site"));
  if (siteResult instanceof NextResponse) return siteResult;
  try {
    const formData = await request.formData();
    const file = formData.get('image') as File | null;

    if (!file) {
      return NextResponse.json({ error: 'No image provided' }, { status: 400 });
    }

    // Validate file type（拒绝 SVG：SVG 可内嵌脚本，属 XSS 载体）
    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (!allowedTypes.includes(file.type)) {
      return NextResponse.json({ error: 'Unsupported image type' }, { status: 400 });
    }

    // Limit size to 5MB
    if (file.size > 5 * 1024 * 1024) {
      return NextResponse.json({ error: 'Image too large (max 5MB)' }, { status: 400 });
    }

    const bytes = await file.arrayBuffer();
    const base64 = Buffer.from(bytes).toString('base64');
    const dataUrl = `data:${file.type};base64,${base64}`;

    // Return markdown format（文件名消毒：去除 markdown/链接/引号等危险字符）
    const safeName = (file.name || 'image')
      .replace(/[\][()"'`\\<>]/g, '')
      .replace(/[\r\n\t]/g, ' ')
      .trim() || 'image';
    const markdown = `![${safeName}](${dataUrl})`;

    return NextResponse.json({
      markdown,
      dataUrl,
      size: file.size,
    });
  } catch (error) {
    console.error('Failed to upload image:', error);
    return NextResponse.json({ error: 'Failed to upload image' }, { status: 500 });
  }
}
