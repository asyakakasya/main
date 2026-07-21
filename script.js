const uploadInputs = document.querySelectorAll('.upload-slot input[type="file"], .image-slot input[type="file"]');
const editableNodes = document.querySelectorAll(".sheet h1, .sheet h2, .sheet h3, .sheet p, .sheet li");
const uploadBlocks = document.querySelectorAll(".upload-block");
const STORAGE_KEY = "makeup-checklist-state-v2";
const DB_NAME = "makeup-checklist-db";
const DB_VERSION = 1;
const DB_STORE = "state";
const DB_RECORD_KEY = "current";
const IMAGE_MAX_SIDE = 1600;
const IMAGE_JPEG_QUALITY = 0.82;
let latestPdfUrl = "";
let initialState = null;
let stateDbPromise = null;
let saveTimerId = null;
let pendingStateForSave = null;
let restoreStatePromise = Promise.resolve();

function openStateDb() {
  if (!("indexedDB" in window)) {
    return Promise.resolve(null);
  }

  if (stateDbPromise) {
    return stateDbPromise;
  }

  stateDbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(DB_STORE)) {
        db.createObjectStore(DB_STORE);
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("IndexedDB open failed"));
  }).catch(() => null);

  return stateDbPromise;
}

function readStateFromDb() {
  return openStateDb().then((db) => {
    if (!db) {
      return null;
    }

    return new Promise((resolve, reject) => {
      const tx = db.transaction(DB_STORE, "readonly");
      const store = tx.objectStore(DB_STORE);
      const request = store.get(DB_RECORD_KEY);

      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error || new Error("IndexedDB read failed"));
    });
  });
}

function writeStateToDb(state) {
  return openStateDb().then((db) => {
    if (!db) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      return;
    }

    return new Promise((resolve, reject) => {
      const tx = db.transaction(DB_STORE, "readwrite");
      const store = tx.objectStore(DB_STORE);
      store.put(state, DB_RECORD_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error("IndexedDB write failed"));
      tx.onabort = () => reject(tx.error || new Error("IndexedDB transaction aborted"));
    });
  });
}

function persistState(state) {
  writeStateToDb(state).catch(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (error) {
      alert("Не удалось сохранить данные страницы. В браузере закончилось место.");
    }
  });
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("FileReader error"));
    reader.readAsDataURL(file);
  });
}

function loadImageFromUrl(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Image load failed"));
    image.src = url;
  });
}

async function fileToOptimizedDataUrl(file) {
  if (!file || typeof file.type !== "string" || !file.type.startsWith("image/")) {
    return readFileAsDataUrl(file);
  }

  const objectUrl = URL.createObjectURL(file);

  try {
    const image = await loadImageFromUrl(objectUrl);
    const sourceWidth = image.naturalWidth || image.width || 1;
    const sourceHeight = image.naturalHeight || image.height || 1;
    const scale = Math.min(1, IMAGE_MAX_SIDE / Math.max(sourceWidth, sourceHeight));
    const targetWidth = Math.max(1, Math.round(sourceWidth * scale));
    const targetHeight = Math.max(1, Math.round(sourceHeight * scale));

    const canvas = document.createElement("canvas");
    canvas.width = targetWidth;
    canvas.height = targetHeight;

    const context = canvas.getContext("2d");
    if (!context) {
      return readFileAsDataUrl(file);
    }

    context.drawImage(image, 0, 0, targetWidth, targetHeight);
    return canvas.toDataURL("image/jpeg", IMAGE_JPEG_QUALITY);
  } catch (error) {
    return readFileAsDataUrl(file);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function getJsPdfConstructor() {
  if (window.jspdf && window.jspdf.jsPDF) {
    return window.jspdf.jsPDF;
  }

  return null;
}

function waitForImages() {
  const imagePromises = Array.from(document.images).map((image) => {
    if (image.complete) {
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      image.addEventListener("load", resolve, { once: true });
      image.addEventListener("error", resolve, { once: true });
    });
  });

  return Promise.all(imagePromises);
}

function getPdfCloneStyleText() {
  return `
    .upload-slot,
    .image-slot {
      overflow: visible !important;
      aspect-ratio: auto !important;
      height: auto !important;
      min-height: 0 !important;
    }

    .upload-slot img,
    .image-slot img {
      position: static !important;
      inset: auto !important;
      transform: none !important;
      width: 100% !important;
      height: auto !important;
      max-width: 100% !important;
      max-height: none !important;
      object-fit: contain !important;
      object-position: center !important;
    }

    .remove-block-btn,
    .remove-slot-btn,
    .photo-placeholder,
    input[type="file"],
    .pdf-button-wrap {
      display: none !important;
    }
  `;
}

function buildPdfPageNodes() {
  const nodes = [];
  const cover = document.querySelector(".cover-page");
  const sheet = document.querySelector(".sheet");
  if (!sheet) {
    return nodes;
  }

  const uploadArea = sheet.querySelector(".upload-area");

  const firstPageWrapper = document.createElement("div");
  if (cover) {
    firstPageWrapper.appendChild(cover.cloneNode(true));
  }

  const firstPageSheet = document.createElement("main");
  firstPageSheet.className = sheet.className;
  Array.from(sheet.children).forEach((child) => {
    if (child === uploadArea) {
      return;
    }

    firstPageSheet.appendChild(child.cloneNode(true));
  });
  firstPageWrapper.appendChild(firstPageSheet);
  nodes.push(firstPageWrapper);

  if (!uploadArea) {
    const footerOnly = document.querySelector(".site-footer");
    if (footerOnly) {
      const footerWrapper = document.createElement("div");
      footerWrapper.appendChild(footerOnly.cloneNode(true));
      nodes.push(footerWrapper);
    }
    return nodes;
  }

  const cosmeticsTitle = Array.from(uploadArea.children).find(
    (child) => child.classList && child.classList.contains("cosmetics-title"),
  );
  const cosmeticsBlocks = Array.from(uploadArea.children).filter(
    (child) => child.classList && child.classList.contains("upload-block"),
  );

  for (let index = 0; index < cosmeticsBlocks.length; index += 4) {
    const pageSection = document.createElement("section");
    pageSection.className = uploadArea.className;

    if (index === 0 && cosmeticsTitle) {
      pageSection.appendChild(cosmeticsTitle.cloneNode(true));
    }

    cosmeticsBlocks.slice(index, index + 4).forEach((block) => {
      pageSection.appendChild(block.cloneNode(true));
    });

    if (index + 4 >= cosmeticsBlocks.length) {
      const footer = document.querySelector(".site-footer");
      if (footer) {
        pageSection.appendChild(footer.cloneNode(true));
      }
    }

    nodes.push(pageSection);
  }

  return nodes;
}

async function renderPdfPageNode(node, html2canvas, scale) {
  const renderRoot = document.createElement("div");
  renderRoot.style.position = "fixed";
  renderRoot.style.left = "-10000px";
  renderRoot.style.top = "0";
  renderRoot.style.width = `${Math.max(document.documentElement.clientWidth, document.body.clientWidth)}px`;
  renderRoot.style.background = "#ffffff";
  renderRoot.style.zIndex = "-1";
  renderRoot.style.pointerEvents = "none";
  renderRoot.appendChild(node);
  document.body.appendChild(renderRoot);

  try {
    const canvas = await html2canvas(node, {
      backgroundColor: "#ffffff",
      scale,
      useCORS: true,
      allowTaint: true,
      logging: false,
      scrollX: 0,
      scrollY: 0,
      windowWidth: Math.max(node.scrollWidth, renderRoot.clientWidth),
      windowHeight: Math.max(node.scrollHeight, 1),
      onclone: (clonedDoc) => {
        const style = clonedDoc.createElement("style");
        style.textContent = getPdfCloneStyleText();
        clonedDoc.head.appendChild(style);
      },
    });

    return canvas;
  } finally {
    renderRoot.remove();
  }
}

function addCanvasAsPdfPage(pdf, canvas, JsPdf) {
  const MAX_PDF_SIDE_PT = 14000;
  const baseWidthPt = canvas.width * 0.75;
  const baseHeightPt = canvas.height * 0.75;
  const pageScale = Math.min(1, MAX_PDF_SIDE_PT / Math.max(baseWidthPt, baseHeightPt));
  const pageWidthPt = Math.max(1, baseWidthPt * pageScale);
  const pageHeightPt = Math.max(1, baseHeightPt * pageScale);
  const orientation = pageWidthPt >= pageHeightPt ? "landscape" : "portrait";

  if (!pdf) {
    pdf = new JsPdf({
      orientation,
      unit: "pt",
      format: [pageWidthPt, pageHeightPt],
      compress: true,
    });
  } else {
    pdf.addPage([pageWidthPt, pageHeightPt], orientation);
  }

  const imageData = canvas.toDataURL("image/jpeg", 0.96);
  pdf.addImage(imageData, "JPEG", 0, 0, pageWidthPt, pageHeightPt, undefined, "FAST");
  return pdf;
}

async function buildPdfWithCustomPageBreaks(html2canvas, JsPdf) {
  const pageNodes = buildPdfPageNodes();
  if (!pageNodes.length) {
    throw new Error("Нет данных для экспорта PDF");
  }

  const scale = Math.min(2, window.devicePixelRatio || 1);
  let pdf = null;

  for (const pageNode of pageNodes) {
    const canvas = await renderPdfPageNode(pageNode, html2canvas, scale);
    if (!canvas.width || !canvas.height) {
      continue;
    }

    pdf = addCanvasAsPdfPage(pdf, canvas, JsPdf);
  }

  if (!pdf) {
    throw new Error("Не удалось собрать PDF");
  }

  return pdf;
}

async function deliverPdfFile(pdf, fileName) {
  const pdfBlob = pdf.output("blob");
  const objectUrl = URL.createObjectURL(pdfBlob);

  if (latestPdfUrl) {
    URL.revokeObjectURL(latestPdfUrl);
  }
  latestPdfUrl = objectUrl;

  showPdfReadyPanel(objectUrl, fileName);

  const canShareFiles =
    typeof navigator !== "undefined" &&
    typeof navigator.share === "function" &&
    typeof navigator.canShare === "function";

  if (canShareFiles) {
    const pdfFile = new File([pdfBlob], fileName, { type: "application/pdf" });

    if (navigator.canShare({ files: [pdfFile] })) {
      try {
        await navigator.share({
          files: [pdfFile],
          title: "PDF чек-листа",
        });
        return;
      } catch (error) {
        if (error && error.name === "AbortError") {
          return;
        }
      }
    }
  }

  const downloadLink = document.createElement("a");
  downloadLink.href = objectUrl;
  downloadLink.download = fileName;
  downloadLink.rel = "noopener";
  document.body.appendChild(downloadLink);
  downloadLink.click();
  downloadLink.remove();

  const isTouchApple =
    /iP(ad|hone|od)/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

  if (isTouchApple) {
    window.location.href = objectUrl;
    return;
  }

  const openedTab = window.open(objectUrl, "_blank", "noopener,noreferrer");
  if (openedTab) {
    openedTab.focus();
  }
}

function showPdfReadyPanel(objectUrl, fileName) {
  const existing = document.getElementById("pdfReadyPanel");
  if (existing) {
    existing.remove();
  }

  const panel = document.createElement("div");
  panel.id = "pdfReadyPanel";
  panel.style.position = "fixed";
  panel.style.left = "1rem";
  panel.style.bottom = "1rem";
  panel.style.zIndex = "120000";
  panel.style.background = "#ffffff";
  panel.style.border = "1px solid #d8c2a4";
  panel.style.borderRadius = "12px";
  panel.style.padding = "0.7rem 0.9rem";
  panel.style.boxShadow = "0 8px 24px rgba(0, 0, 0, 0.14)";
  panel.style.display = "flex";
  panel.style.gap = "0.7rem";
  panel.style.alignItems = "center";
  panel.style.maxWidth = "92vw";

  const text = document.createElement("span");
  text.textContent = "PDF готов:";
  text.style.fontSize = "0.94rem";

  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = fileName;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.textContent = "Открыть / скачать";
  link.style.color = "#6e4c2a";
  link.style.fontWeight = "600";

  const close = document.createElement("button");
  close.type = "button";
  close.textContent = "Закрыть";
  close.style.border = "none";
  close.style.background = "#f2e2d0";
  close.style.color = "#2f2720";
  close.style.padding = "0.35rem 0.6rem";
  close.style.borderRadius = "999px";
  close.style.cursor = "pointer";
  close.addEventListener("click", () => {
    panel.remove();
  });

  panel.appendChild(text);
  panel.appendChild(link);
  panel.appendChild(close);
  document.body.appendChild(panel);
}

function assignPersistentIds() {
  document.querySelectorAll(".upload-block").forEach((block, index) => {
    if (!block.dataset.persistId) {
      block.dataset.persistId = `block-${index + 1}`;
    }
  });

  document.querySelectorAll(".upload-slot, .image-slot").forEach((slot, index) => {
    if (!slot.dataset.persistId) {
      slot.dataset.persistId = `slot-${index + 1}`;
    }

    const existingImage = slot.querySelector("img");
    if (existingImage && !existingImage.dataset.initialSrc) {
      existingImage.dataset.initialSrc = existingImage.getAttribute("src") || existingImage.src;
    }
  });

  document.querySelectorAll(".upload-item").forEach((item) => {
    const slot = item.querySelector(".upload-slot");
    if (!slot) {
      return;
    }

    item.dataset.persistId = slot.dataset.persistId || "";
  });

  document.querySelectorAll(".text-editable").forEach((node, index) => {
    if (!node.dataset.persistId) {
      node.dataset.persistId = `text-${index + 1}`;
    }
  });
}

async function loadState() {
  try {
    const dbState = await readStateFromDb();
    if (dbState) {
      return dbState;
    }
  } catch (error) {
    // Fallback to localStorage below.
  }

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw);
    persistState(parsed);
    return parsed;
  } catch (error) {
    return null;
  }
}

function saveState(immediate = false) {
  const state = captureState();

  if (immediate) {
    if (saveTimerId) {
      clearTimeout(saveTimerId);
      saveTimerId = null;
    }
    pendingStateForSave = null;
    persistState(state);
    return;
  }

  pendingStateForSave = state;
  if (saveTimerId) {
    clearTimeout(saveTimerId);
  }

  saveTimerId = setTimeout(() => {
    saveTimerId = null;
    if (!pendingStateForSave) {
      return;
    }

    const snapshot = pendingStateForSave;
    pendingStateForSave = null;
    persistState(snapshot);
  }, 180);
}

function captureState() {
  const state = {
    images: {},
    texts: {},
    hiddenIds: [],
  };

  document.querySelectorAll(".upload-slot, .image-slot").forEach((slot) => {
    const id = slot.dataset.persistId;
    if (!id) {
      return;
    }

    const image = slot.querySelector("img");
    state.images[id] = image && image.src ? image.src : "";
  });

  document.querySelectorAll(".text-editable").forEach((node) => {
    const id = node.dataset.persistId;
    if (!id) {
      return;
    }

    state.texts[id] = node.innerHTML;
  });

  document.querySelectorAll("[data-persist-id].is-hidden").forEach((node) => {
    const id = node.dataset.persistId;
    if (id) {
      state.hiddenIds.push(id);
    }
  });

  return state;
}

function setSlotImage(slot, src) {
  if (!src) {
    return;
  }

  let preview = slot.querySelector("img");
  if (!preview) {
    preview = document.createElement("img");
    slot.appendChild(preview);
  }

  preview.src = src;
  preview.alt = "Загруженное изображение";

  preview.onload = () => {
    const width = preview.naturalWidth || 1;
    const height = preview.naturalHeight || 1;
    slot.style.setProperty("--slot-ratio", `${width} / ${height}`);
  };

  slot.classList.add("is-filled");
}

function applyState(state) {
  if (!state || typeof state !== "object") {
    return;
  }

  document.querySelectorAll("[data-persist-id]").forEach((node) => {
    node.classList.remove("is-hidden");
  });

  document.querySelectorAll(".text-editable").forEach((node) => {
    const id = node.dataset.persistId;
    if (!id || !state.texts) {
      return;
    }

    if (Object.prototype.hasOwnProperty.call(state.texts, id)) {
      node.innerHTML = state.texts[id];
    }
  });

  document.querySelectorAll(".upload-slot, .image-slot").forEach((slot) => {
    const id = slot.dataset.persistId;
    if (!id) {
      return;
    }

    const expectedSource = state.images && state.images[id] ? state.images[id] : "";
    const image = slot.querySelector("img");

    if (expectedSource) {
      setSlotImage(slot, expectedSource);
      return;
    }

    if (image) {
      if (image.dataset.initialSrc) {
        image.src = image.dataset.initialSrc;
        slot.classList.add("is-filled");
        image.onload = () => {
          const width = image.naturalWidth || 1;
          const height = image.naturalHeight || 1;
          slot.style.setProperty("--slot-ratio", `${width} / ${height}`);
        };
      } else {
        image.remove();
        slot.classList.remove("is-filled");
        slot.style.removeProperty("--slot-ratio");
      }
    }
  });

  if (Array.isArray(state.hiddenIds)) {
    state.hiddenIds.forEach((id) => {
      if (!id) {
        return;
      }

      const target = document.querySelector(`[data-persist-id="${id}"]`);
      if (target) {
        target.classList.add("is-hidden");
      }
    });
  }
}

async function restoreState() {
  const state = await loadState();
  if (!state) {
    return;
  }

  applyState(state);
}

function clearStateStorage() {
  return openStateDb().then((db) => {
    if (!db) {
      localStorage.removeItem(STORAGE_KEY);
      return;
    }

    return new Promise((resolve, reject) => {
      const tx = db.transaction(DB_STORE, "readwrite");
      const store = tx.objectStore(DB_STORE);
      store.delete(DB_RECORD_KEY);
      tx.oncomplete = () => {
        localStorage.removeItem(STORAGE_KEY);
        resolve();
      };
      tx.onerror = () => reject(tx.error || new Error("IndexedDB clear failed"));
      tx.onabort = () => reject(tx.error || new Error("IndexedDB clear aborted"));
    });
  });
}

function ensureUploadDescriptions() {
  const uploadAreaSlots = document.querySelectorAll(".upload-area .upload-slot");

  uploadAreaSlots.forEach((slot) => {
    if (slot.closest(".upload-item")) {
      return;
    }

    const wrapper = document.createElement("div");
    wrapper.className = "upload-item";

    const description = document.createElement("p");
    description.className = "upload-description text-editable";
    description.textContent = "Описание фото";
    description.setAttribute("contenteditable", "true");

    const parent = slot.parentElement;
    if (!parent) {
      return;
    }

    parent.insertBefore(wrapper, slot);
    wrapper.appendChild(slot);
    wrapper.appendChild(description);
  });
}

ensureUploadDescriptions();
editableNodes.forEach((node) => {
  if (node.closest(".upload-slot") || node.closest(".image-slot")) {
    return;
  }

  node.setAttribute("contenteditable", "true");
  node.classList.add("text-editable");
});

assignPersistentIds();
initialState = captureState();
restoreStatePromise = restoreState().catch(() => {
  // Keep initial markup if restore fails.
});

function createRemoveButton(className, label) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.textContent = "x";
  button.setAttribute("aria-label", label);
  return button;
}

function hideTarget(target) {
  target.classList.add("is-hidden");
  saveState();
}

function ensureSlotRemoveButton(slot) {
  if (slot.classList.contains("is-hidden")) {
    return;
  }

  if (slot.querySelector(".remove-slot-btn")) {
    return;
  }

  const button = createRemoveButton("remove-slot-btn", "Скрыть картинку");
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();

    const uploadItem = slot.closest(".upload-item");
    if (uploadItem) {
      hideTarget(uploadItem);
      return;
    }

    hideTarget(slot);
  });

  slot.appendChild(button);
}

uploadBlocks.forEach((block) => {
  if (block.querySelector(".remove-block-btn")) {
    return;
  }

  const button = createRemoveButton("remove-block-btn", "Скрыть блок");
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    hideTarget(block);
  });

  block.appendChild(button);
});

uploadInputs.forEach((input) => {
  input.addEventListener("change", async (event) => {
    const file = event.target.files && event.target.files[0];
    if (!file) {
      return;
    }

    const slot = input.closest(".upload-slot") || input.closest(".image-slot");
    if (!slot) {
      return;
    }

    try {
      const optimizedDataUrl = await fileToOptimizedDataUrl(file);
      setSlotImage(slot, optimizedDataUrl);
      ensureSlotRemoveButton(slot);
      saveState(true);
    } catch (error) {
      alert("Не удалось обработать изображение. Попробуй другое фото.");
    }
  });
});

document.querySelectorAll(".upload-slot, .image-slot").forEach((slot) => {
  if (slot.querySelector("img") || slot.classList.contains("is-filled")) {
    slot.classList.add("is-filled");
  }

  ensureSlotRemoveButton(slot);
});

document.querySelectorAll(".upload-description").forEach((description) => {
  description.addEventListener("input", () => {
    saveState();
  });
});

document.querySelectorAll(".text-editable").forEach((node) => {
  node.addEventListener("input", () => {
    saveState();
  });
});

function bindResetButton() {
  const resetButton = document.querySelector("#resetPageButton");
  if (!resetButton) {
    return;
  }

  resetButton.addEventListener("click", () => {
    const confirmed = window.confirm("Сбросить страницу к исходному состоянию и удалить все сохраненные изменения?");
    if (!confirmed) {
      return;
    }

    clearStateStorage().catch(() => {
      localStorage.removeItem(STORAGE_KEY);
    });

    if (initialState) {
      applyState(initialState);
    }

    const readyPanel = document.getElementById("pdfReadyPanel");
    if (readyPanel) {
      readyPanel.remove();
    }
  });
}

function bindPdfButton() {
  const pdfButton = document.querySelector("#savePdfButton");
  if (!pdfButton) {
    return;
  }

  pdfButton.addEventListener("click", async () => {
    await restoreStatePromise;

    const html2canvas = window.html2canvas;
    const JsPdf = getJsPdfConstructor();

    if (!html2canvas || !JsPdf) {
      alert("Не удалось загрузить библиотеку для PDF. Проверь интернет-соединение и попробуй еще раз.");
      return;
    }

    saveState(true);

    const body = document.body;
    body.classList.add("is-exporting-pdf");
    pdfButton.disabled = true;
    pdfButton.textContent = "Сохраняю...";

    try {
      if (document.fonts && document.fonts.ready) {
        await document.fonts.ready;
      }
      await waitForImages();

      const pdf = await buildPdfWithCustomPageBreaks(html2canvas, JsPdf);
      await deliverPdfFile(pdf, "makiyazh-dlya-sebya.pdf");
    } catch (error) {
      alert("Не получилось сохранить PDF. Попробуй еще раз.");
    } finally {
      body.classList.remove("is-exporting-pdf");
      pdfButton.disabled = false;
      pdfButton.textContent = "Сохранить как PDF";
    }
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    bindPdfButton();
    bindResetButton();
  });
} else {
  bindPdfButton();
  bindResetButton();
}
