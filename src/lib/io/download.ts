/** Hands a PNG to the browser as a regular download. */
export function downloadPng(fileName: string, bytes: Uint8Array<ArrayBuffer>) {
  const url = URL.createObjectURL(new Blob([bytes], { type: 'image/png' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  // the download has already captured the blob; give the click a moment before releasing the URL
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
