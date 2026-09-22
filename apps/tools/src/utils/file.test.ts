import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getFileExtension, triggerBrowserDownload } from './file';

describe('getFileExtension', () => {
  it('returns the lowercased extension of a filename', () => {
    expect(getFileExtension('photo.PNG')).toBe('png');
    expect(getFileExtension('archive.tar.gz')).toBe('gz');
  });

  it('returns an empty string when there is no extension', () => {
    expect(getFileExtension('README')).toBe('');
    expect(getFileExtension('.hidden')).toBe('');
  });
});

describe('triggerBrowserDownload', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('downloads via a temporary <a download> anchor', () => {
    const createObjectURL = vi.fn(() => 'blob:mock-url');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });

    const anchors: HTMLAnchorElement[] = [];
    const originalCreateElement = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => {
      const element = originalCreateElement(tag);
      if (tag.toLowerCase() === 'a') {
        anchors.push(element as HTMLAnchorElement);
      }
      return element;
    }) as typeof document.createElement);
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click');

    const blob = new Blob(['hello'], { type: 'text/plain' });
    triggerBrowserDownload(blob, 'result.txt');

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(createObjectURL).toHaveBeenCalledWith(blob);
    expect(anchors).toHaveLength(1);
    expect(anchors[0].getAttribute('href')).toBe('blob:mock-url');
    expect(anchors[0].download).toBe('result.txt');
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(document.body.contains(anchors[0])).toBe(false);
  });

  it('revokes the object URL only after a delay, never synchronously', () => {
    const createObjectURL = vi.fn(() => 'blob:mock-url');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });
    vi.spyOn(HTMLAnchorElement.prototype, 'click');

    triggerBrowserDownload(new Blob(['hello']), 'result.txt');

    // Revoking here would abort the browser's async fetch of the blob: URL
    // and leave the download stuck in "downloading" state forever.
    expect(revokeObjectURL).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1000);
    expect(revokeObjectURL).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock-url');
  });
});
