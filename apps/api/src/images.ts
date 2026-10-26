import sharp, { type Metadata } from 'sharp';
import { AppError, files, serverT, type Ctx } from '@openrent/core';

/** Formats accepted for photos. HEIC is left out: the prebuilt sharp cannot decode it. */
const FORMATS = new Set(['jpeg', 'png', 'webp', 'gif', 'avif']);
const VARIANTS = [
  { kind: 'image_sm', width: 480 },
  { kind: 'image_lg', width: 1600 },
] as const;

/**
 * Stores an uploaded photo plus 480 px and 1600 px WebP variants (FR-CAT-1). The original keeps its
 * bytes; variants are owned by the original (owner_type 'file') so deleting the original removes them.
 */
export async function storeImage(ctx: Ctx, input: { kind: 'image' | 'photo'; filename: string; body: Buffer; ownerType?: string | null; ownerId?: string | null }) {
  let meta: Metadata;
  try {
    meta = await sharp(input.body).metadata();
  } catch {
    throw new AppError('unsupported_media_type', 415, serverT('images.unsupported'));
  }
  if (!meta.format || !FORMATS.has(meta.format)) throw new AppError('unsupported_media_type', 415, serverT('images.unsupported'));
  // EXIF orientation is applied to the stored size so width and height match what people see.
  const rotated = (meta.orientation ?? 1) >= 5;
  const original = await files.putFile(ctx, {
    kind: input.kind,
    ownerType: input.ownerType ?? null,
    ownerId: input.ownerId ?? null,
    filename: input.filename,
    contentType: `image/${meta.format}`,
    body: input.body,
    width: (rotated ? meta.height : meta.width) ?? null,
    height: (rotated ? meta.width : meta.height) ?? null,
  });
  const base = input.filename.replace(/\.[^.]+$/, '');
  for (const v of VARIANTS) {
    const { data, info } = await sharp(input.body).rotate().resize({ width: v.width, withoutEnlargement: true }).webp({ quality: 80 }).toBuffer({ resolveWithObject: true });
    await files.putFile(ctx, { kind: v.kind, ownerType: 'file', ownerId: original.id, filename: `${base}-${v.width}.webp`, contentType: 'image/webp', body: data, width: info.width, height: info.height });
  }
  return original;
}

/** Bytes of an image or one of its variants ('sm', 'lg' or 'original'). */
export async function imageBytes(ctx: Ctx, fileId: string, variant: string) {
  const original = await files.getFile(ctx, fileId);
  const kind = variant === 'sm' ? 'image_sm' : variant === 'lg' ? 'image_lg' : null;
  const f = kind ? (await files.derivedFiles(ctx, fileId)).find((x) => x.kind === kind) ?? original : original;
  return { file: f, body: await files.readFile(ctx, f) };
}
