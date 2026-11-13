// Capture surfaces: drag and drop, paste, and the photo picker. Also on-device image compression.

const MAX_EDGE = 1280;        // longest edge in pixels
const TARGET_BYTES = 150000;  // aim for about 150 KB

const isImage = (f) => f && f.type.startsWith('image/');

async function decode(file) {
  if (window.createImageBitmap) {
    try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch (e) { /* fall through */ }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

// Returns a JPEG Blob: longest edge 1280px, quality lowered until it is near the target size.
export async function compress(file) {
  const src = await decode(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(src.width, src.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(src.width * scale));
  canvas.height = Math.max(1, Math.round(src.height * scale));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff'; // transparent PNGs would otherwise turn black
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(src, 0, 0, canvas.width, canvas.height);
  if (src.close) src.close();

  let blob = null;
  for (const quality of [0.8, 0.7, 0.6, 0.5]) {
    blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
    if (!blob) throw new Error('This image could not be converted.');
    if (blob.size <= TARGET_BYTES) break;
  }
  return blob;
}

// Opens the photo picker (photo library or camera on iPhone), with multi-select.
export function pickImages() {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.multiple = true;
    input.hidden = true;
    document.body.append(input); // iOS only reports the choice if the input is in the page
    const done = (files) => { input.remove(); resolve(files); };
    input.onchange = () => done([...input.files].filter(isImage));
    input.oncancel = () => done([]);
    input.click();
  });
}

// Drag and drop anywhere, and paste. onFiles(files, listId) gets the list the files were dropped
// on (an element with data-list-id), or null if they were dropped or pasted elsewhere.
export function initCapture(onFiles) {
  const hasFiles = (e) => e.dataTransfer && [...e.dataTransfer.types].includes('Files');
  let depth = 0;
  let over = null;

  const mark = (target) => {
    const el = target && target.closest ? target.closest('[data-list-id]') : null;
    if (el === over) return;
    if (over) over.classList.remove('drop-target');
    over = el;
    if (over) over.classList.add('drop-target');
  };
  const reset = () => { depth = 0; mark(null); document.body.classList.remove('dragging'); };

  window.addEventListener('dragenter', (e) => {
    if (!hasFiles(e)) return;
    depth++;
    document.body.classList.add('dragging');
  });
  window.addEventListener('dragover', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    mark(e.target);
  });
  window.addEventListener('dragleave', (e) => {
    if (!hasFiles(e)) return;
    if (--depth <= 0) reset();
  });
  window.addEventListener('drop', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    const listId = over ? over.dataset.listId : null;
    reset();
    const files = [...e.dataTransfer.files].filter(isImage);
    if (files.length) onFiles(files, listId);
  });
  window.addEventListener('paste', (e) => {
    const files = [...((e.clipboardData && e.clipboardData.files) || [])].filter(isImage);
    if (!files.length) return; // ordinary text paste
    e.preventDefault();
    onFiles(files, null);
  });
}
