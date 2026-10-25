import { LIMITS, BYTES_PER_MB, PIXELS_PER_MEGAPIXEL } from '../../config';
import { canvasToBlob, createCanvas, releaseCanvas } from '../canvas';
import { AppError } from '../errors';
import { detectFileType } from '../files/detect';
import { readImageInfoFromFile, type ImageInfo } from './header';

const UNSUPPORTED_LABEL: Record<string, string> = {
  webp: 'WebP',
  gif: 'GIF',
  heic: 'HEIC/HEIF',
  avif: 'AVIF',
  bmp: 'BMP',
  tiff: 'TIFF',
};

/** Validates a PNG/JPG by content and checks size limits before any decoding. */
export async function checkImageFile(file: File): Promise<ImageInfo> {
  if (file.size === 0) throw new AppError('error.emptyFile', { name: file.name });
  const type = await detectFileType(file);
  if (type === 'pdf') throw new AppError('error.notImageButPdf', { name: file.name });
  if (type !== 'png' && type !== 'jpeg') {
    const label = UNSUPPORTED_LABEL[type];
    if (label) throw new AppError('error.unsupportedImageFormat', { name: file.name, format: label });
    throw new AppError('error.notImage', { name: file.name });
  }
  if (file.size > LIMITS.maxImageBytes) {
    throw new AppError('error.imageTooLarge', { name: file.name, max: Math.round(LIMITS.maxImageBytes / BYTES_PER_MB) });
  }
  const info = await readImageInfoFromFile(file).catch((e) => {
    throw e instanceof AppError ? new AppError(e.code, { name: file.name, ...e.params }, e.detail) : e;
  });
  if (info.width * info.height > LIMITS.maxImagePixels) {
    throw new AppError('error.imageTooManyPixels', {
      name: file.name,
      width: info.displayWidth,
      height: info.displayHeight,
      max: Math.round(LIMITS.maxImagePixels / PIXELS_PER_MEGAPIXEL),
    });
  }
  return info;
}

/** Decodes with EXIF orientation applied (what the visitor expects to see). */
export async function decodeImage(file: Blob, name: string): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch (e) {
    throw new AppError('error.imageDecode', { name }, e instanceof Error ? e.message : String(e));
  }
}

/**
 * Small preview as an object URL. Decoding also validates that the browser can read the
 * pixel data (a valid header alone does not guarantee that).
 */
export async function makeImageThumbnail(file: Blob, name: string, info: ImageInfo, maxSide = 240): Promise<string> {
  const bmp = await decodeImage(file, name);
  const s = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const canvas = createCanvas(bmp.width * s, bmp.height * s);
  try {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new AppError('error.canvasExport');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const blob = await canvasToBlob(canvas, info.hasAlpha ? 'image/png' : 'image/jpeg', 0.85);
    return URL.createObjectURL(blob);
  } finally {
    bmp.close();
    releaseCanvas(canvas);
  }
}
