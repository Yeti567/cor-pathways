// Shrinks a camera photo on the phone before it is saved with a form.
//
// WHY. A phone camera photo is 3 to 5 MB. Forms used to keep it at full size: in the phone's
// offline store, in the sync upload over a weak lease-road signal, and in the client's file
// storage for good. Six photos on one incident report was 25 MB, and a free-plan project
// ran out of storage. At 1600 px on the long edge a photo is still sharp enough to read a
// plate or see a dent, at roughly a tenth of the size.
//
// It never loses the photo: if the browser cannot decode the file, or shrinking would not
// make it smaller, the original is kept exactly as before.

export const PHOTO_MAX_EDGE = 1600;
export const PHOTO_JPEG_QUALITY = 0.8;
// What offline sync can upload (see dataUrlToBlob in sync.ts).
const SYNCABLE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export type ShrunkPhoto = {
  dataUrl: string;
  mimeType: string;
  size: number;
};

/** The size to draw at: the long edge capped at maxEdge, proportions kept, never enlarged. */
export function fitWithin(width: number, height: number, maxEdge = PHOTO_MAX_EDGE) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return { height: 0, width: 0 };
  }

  const longest = Math.max(width, height);

  if (longest <= maxEdge) {
    return { height: Math.max(0, Math.round(height)), width: Math.max(0, Math.round(width)) };
  }

  const scale = maxEdge / longest;
  return {
    height: Math.max(1, Math.round(height * scale)),
    width: Math.max(1, Math.round(width * scale)),
  };
}

/** Bytes a base64 data URL decodes to. */
export function dataUrlByteSize(dataUrl: string) {
  const comma = dataUrl.indexOf(",");
  const body = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
  const padding = body.endsWith("==") ? 2 : body.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((body.length * 3) / 4) - padding);
}

function readAsDataUrl(file: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(String(reader.result ?? "")));
    reader.addEventListener("error", () => reject(reader.error ?? new Error("File could not be read.")));
    reader.readAsDataURL(file);
  });
}

async function original(file: File): Promise<ShrunkPhoto> {
  return { dataUrl: await readAsDataUrl(file), mimeType: file.type, size: file.size };
}

/** The same, as a File, for a form that posts the file itself. The name keeps up with a type change. */
export async function shrinkPhotoFile(file: File): Promise<File> {
  const photo = await shrinkPhoto(file);

  if (photo.mimeType === file.type && photo.size === file.size) {
    return file;
  }

  const blob = await (await fetch(photo.dataUrl)).blob();
  const name = photo.mimeType === "image/jpeg" ? file.name.replace(/\.[^./\\]*$/, "") + ".jpg" : file.name;
  return new File([blob], name, { lastModified: file.lastModified, type: photo.mimeType });
}

export async function shrinkPhoto(file: File): Promise<ShrunkPhoto> {
  if (typeof createImageBitmap !== "function" || typeof document === "undefined") {
    return original(file);
  }

  let bitmap: ImageBitmap;

  try {
    // Phones store the photo sideways and say so in EXIF; "from-image" draws it upright.
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    return original(file);
  }

  try {
    const { height, width } = fitWithin(bitmap.width, bitmap.height);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");

    if (!context || width === 0 || height === 0) {
      return original(file);
    }

    // JPEG has no transparency; a transparent PNG would otherwise come out black.
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
    context.drawImage(bitmap, 0, 0, width, height);

    const dataUrl = canvas.toDataURL("image/jpeg", PHOTO_JPEG_QUALITY);
    const size = dataUrlByteSize(dataUrl);

    if (!dataUrl.startsWith("data:image/jpeg")) {
      return original(file);
    }

    // Keep an already-small original, unless sync could not upload its type (an iPhone
    // HEIC decoded here becomes a JPEG it can upload).
    if (size >= file.size && SYNCABLE_TYPES.has(file.type)) {
      return original(file);
    }

    return { dataUrl, mimeType: "image/jpeg", size };
  } catch {
    return original(file);
  } finally {
    bitmap.close();
  }
}
