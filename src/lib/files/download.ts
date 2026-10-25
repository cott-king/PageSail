/** Triggers a browser download for a Blob that was created locally. Nothing is uploaded. */
export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.rel = 'noopener';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke later: some browsers start reading the URL asynchronously after click().
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function bytesToBlob(bytes: Uint8Array, type: string): Blob {
  // Copy into a fresh ArrayBuffer so the Blob never aliases a buffer we may transfer later.
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new Blob([copy.buffer], { type });
}
