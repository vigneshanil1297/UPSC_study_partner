// Client-only. Renders each page of a PDF to a downscaled JPEG so the existing
// Gemini vision pipeline (which takes images) can OCR scanned PDFs, and so each
// page can be displayed/processed independently. Keeping pages separate also
// keeps every transcription request well under Vercel's ~4.5MB body cap.

export type ImageInput = { media_type: string; data: string };

// A rendered PDF page: the image to OCR plus its pixel dimensions, so the UI can
// keep the page's true aspect ratio and crop diagram regions from it later.
export type RenderedPage = { input: ImageInput; width: number; height: number };

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

// Render every page of a PDF file to a downscaled JPEG, in order, with dims.
export async function renderPdfToImages(file: File): Promise<RenderedPage[]> {
  // pdfjs is ESM + ships a web worker; import lazily so it never runs server-side.
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url,
  ).toString();

  const data = await file.arrayBuffer();
  const doc = await pdfjs.getDocument({ data }).promise;
  const out: RenderedPage[] = [];

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
    out.push({ input: canvasToImageInput(canvas), width: canvas.width, height: canvas.height });
    page.cleanup();
  }
  await doc.destroy();
  return out;
}

// Load a base64 image into an <img>, resolving once decoded.
function loadImage(input: ImageInput): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not load page image for diagram crop."));
    img.src = `data:${input.media_type};base64,${input.data}`;
  });
}

// Box in Gemini's 0–1000 convention.
type Box = { ymin: number; xmin: number; ymax: number; xmax: number };

// Crop a diagram region out of a rendered page and return it as a PNG whose
// paper background is made transparent — so a drawing reads as a clean figure
// pasted onto the redrawn page rather than a rectangular JPEG crop (req 5).
export async function cropDiagramToPng(input: ImageInput, box: Box): Promise<string | null> {
  const img = await loadImage(input);
  const W = img.naturalWidth || img.width;
  const H = img.naturalHeight || img.height;
  // 0–1000 → pixels, with a small pad so strokes near the edge aren't clipped.
  // Bottom gets a larger pad: figure labels (low wage, low savings…) often sit
  // just under the model's box and were getting clipped.
  const padX = 0.012;
  const padTop = 0.006;
  const padBottom = 0.03;
  const x0 = Math.max(0, Math.floor((Math.min(box.xmin, box.xmax) / 1000 - padX) * W));
  const y0 = Math.max(0, Math.floor((Math.min(box.ymin, box.ymax) / 1000 - padTop) * H));
  const x1 = Math.min(W, Math.ceil((Math.max(box.xmin, box.xmax) / 1000 + padX) * W));
  const y1 = Math.min(H, Math.ceil((Math.max(box.ymin, box.ymax) / 1000 + padBottom) * H));
  const w = x1 - x0;
  const h = y1 - y0;
  if (w < 8 || h < 8) return null;

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(img, x0, y0, w, h, 0, 0, w, h);

  // Mask the paper: fade out light pixels (alpha 0 above ~paper white, soft band
  // below) so only the ink/coloured strokes of the figure remain.
  const data = ctx.getImageData(0, 0, w, h);
  const px = data.data;
  const HI = 235; // brighter than this = paper → fully transparent
  const LO = 200; // darker than this = ink → fully opaque; between = feather
  for (let i = 0; i < px.length; i += 4) {
    const lum = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
    if (lum >= HI) px[i + 3] = 0;
    else if (lum > LO) px[i + 3] = Math.round((1 - (lum - LO) / (HI - LO)) * 255);
    // Recolour the surviving ink to black so blue-pen diagrams render in black,
    // matching the rest of the transcribed page. Paper is already transparent.
    px[i] = 0;
    px[i + 1] = 0;
    px[i + 2] = 0;
  }
  ctx.putImageData(data, 0, 0);
  return canvas.toDataURL("image/png");
}
