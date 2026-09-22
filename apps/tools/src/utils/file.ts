/**
 * Delay (ms) before the temporary object URL used for a download is revoked.
 *
 * Must be > 0: browsers resolve the `blob:` URL asynchronously after the
 * click, so revoking it in the same synchronous task destroys the blob
 * before the download backend starts consuming it. The download item then
 * stays in "downloading" state forever (no bytes ever arrive).
 */
const DOWNLOAD_URL_REVOKE_DELAY_MS = 1000;

/**
 * Returns the file extension
 *
 * @param {string} filename - The filename
 * @return {string} - the file extension
 */
export function getFileExtension(filename: string): string {
  const lastDot = filename.lastIndexOf('.');
  if (lastDot <= 0) return ''; // No extension
  return filename.slice(lastDot + 1).toLowerCase();
}

/**
 * Triggers a browser download of `blob` under the given `filename`.
 *
 * Creates a temporary `<a download>` element, clicks it and revokes the
 * object URL only after {@link DOWNLOAD_URL_REVOKE_DELAY_MS}, once the
 * browser has started consuming the blob. All "download result" buttons
 * must go through this helper instead of hand-rolling the anchor pattern,
 * so none of them ever revokes the URL synchronously.
 *
 * @param {Blob} blob - The file content to download
 * @param {string} filename - The filename suggested to the browser
 * @return {void}
 */
export function triggerBrowserDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  // Never revoke synchronously here — see DOWNLOAD_URL_REVOKE_DELAY_MS.
  setTimeout(() => URL.revokeObjectURL(url), DOWNLOAD_URL_REVOKE_DELAY_MS);
}
