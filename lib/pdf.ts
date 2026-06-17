// Client-only. Renders each page of a PDF to a downscaled JPEG so the existing
// Gemini vision pipeline (which takes images) can OCR scanned PDFs, and so each
// page can be displayed/processed independently. Keeping pages separate also
// keeps every transcription request well under Vercel's ~4.5MB body cap.

export type ImageInput = { media_type: string; data: string };

// Match the dimensions/quality the image path already used.
const MAX_DIM = 1600;
const JPEG_QUALITY = 0.82;

// Turn a canvas into the base64 ImageInput the API routes expect.
export function canvasToImageInput(canvas: HTMLCanvasElement): ImageInput {
  const dataUrl = canvas.toDataURL("image/jpeg", JPEG_QUALITY);
  return { media_type: "image/jpeg", data: dataUrl.split(",")[1] ?? "" };
}

// Downscale an already-loaded <img> onto a canvas and return its ImageInput.
export function imageElementToInput(img: HTMLImageElement): ImageInput {
  const scale = Math.min(1, MAX_DIM / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas not supported in this browser.");
  ctx.drawImage(img, 0, 0, w, h);
  return canvasToImageInput(canvas);
}

// Render every page of a PDF file to a downscaled JPEG, in order.
export async function renderPdfToImages(file: File): Promise<ImageInput[]> {
  // pdfjs is ESM + ships a web worker; import lazily so it never runs server-side.
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url,
  ).toString();

  const data = await file.arrayBuffer();
  const doc = await pdfjs.getDocument({ data }).promise;
  const out: ImageInput[] = [];

  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const base = page.getViewport({ scale: 1 });
    const scale = Math.min(2.5, MAX_DIM / Math.max(base.width, base.height));
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas not supported in this browser.");
    await page.render({ canvasContext: ctx, viewport }).promise;
    out.push(canvasToImageInput(canvas));
    page.cleanup();
  }
  await doc.destroy();
  return out;
}
