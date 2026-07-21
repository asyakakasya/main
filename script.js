const uploadInputs = document.querySelectorAll('.upload-slot input[type="file"], .image-slot input[type="file"]');
const editableNodes = document.querySelectorAll(".sheet h1, .sheet h2, .sheet h3, .sheet p, .sheet li");
const uploadBlocks = document.querySelectorAll(".upload-block");
const STORAGE_KEY = "makeup-checklist-state-v1";
let latestPdfUrl = "";

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
  });

  document.querySelectorAll(".upload-item").forEach((item) => {
    const slot = item.querySelector(".upload-slot");
    if (!slot) {
      return;
    }

    item.dataset.persistId = slot.dataset.persistId || "";
  });
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return null;
    }

    return JSON.parse(raw);
  } catch (error) {
    return null;
  }
}

function saveState() {
  const state = {
    images: {},
  };

  document.querySelectorAll(".upload-slot, .image-slot").forEach((slot) => {
    const id = slot.dataset.persistId;
    if (!id) {
      return;
    }

    if (slot.closest(".upload-area")) {
      return;
    }

    const image = slot.querySelector("img");
    if (image && image.src) {
      state.images[id] = image.src;
    }
  });

  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
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

function restoreState() {
  const state = loadState();
  if (!state) {
    return;
  }

  document.querySelectorAll(".upload-slot, .image-slot").forEach((slot) => {
    if (slot.closest(".upload-area")) {
      const storedImage = slot.querySelector("img");
      if (storedImage) {
        storedImage.remove();
      }

      slot.classList.remove("is-filled", "is-hidden");
      slot.style.removeProperty("--slot-ratio");
      return;
    }

    const id = slot.dataset.persistId;
    if (!id) {
      return;
    }

    if (state.images && state.images[id]) {
      setSlotImage(slot, state.images[id]);
    }
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
assignPersistentIds();
restoreState();

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

editableNodes.forEach((node) => {
  if (node.closest(".upload-slot") || node.closest(".image-slot")) {
    return;
  }

  node.setAttribute("contenteditable", "true");
  node.classList.add("text-editable");
});

uploadInputs.forEach((input) => {
  input.addEventListener("change", (event) => {
    const file = event.target.files && event.target.files[0];
    if (!file) {
      return;
    }

    const slot = input.closest(".upload-slot") || input.closest(".image-slot");
    if (!slot) {
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      setSlotImage(slot, String(reader.result || ""));
      ensureSlotRemoveButton(slot);
      saveState();
    };

    reader.readAsDataURL(file);
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

function bindPdfButton() {
  const pdfButton = document.querySelector("#savePdfButton");
  if (!pdfButton) {
    return;
  }

  pdfButton.addEventListener("click", async () => {
    const html2canvas = window.html2canvas;
    const JsPdf = getJsPdfConstructor();

    if (!html2canvas || !JsPdf) {
      alert("Не удалось загрузить библиотеку для PDF. Проверь интернет-соединение и попробуй еще раз.");
      return;
    }

    saveState();

    const body = document.body;
    body.classList.add("is-exporting-pdf");
    pdfButton.disabled = true;
    pdfButton.textContent = "Сохраняю...";

    try {
      if (document.fonts && document.fonts.ready) {
        await document.fonts.ready;
      }
      await waitForImages();

      const canvas = await html2canvas(body, {
        backgroundColor: "#ffffff",
        scale: Math.min(2, window.devicePixelRatio || 1),
        useCORS: true,
        allowTaint: true,
        logging: false,
        scrollX: 0,
        scrollY: 0,
        windowWidth: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
        windowHeight: Math.max(document.documentElement.scrollHeight, document.body.scrollHeight),
        onclone: (clonedDoc) => {
          const style = clonedDoc.createElement("style");
          style.textContent = `
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
          `;
          clonedDoc.head.appendChild(style);
        },
      });

      const imageData = canvas.toDataURL("image/jpeg", 0.98);
      const pageWidth = canvas.width * 0.75;
      const pageHeight = canvas.height * 0.75;
      const pdf = new JsPdf({
        orientation: pageWidth >= pageHeight ? "landscape" : "portrait",
        unit: "pt",
        format: [pageWidth, pageHeight],
        compress: true,
      });

      pdf.addImage(imageData, "JPEG", 0, 0, pageWidth, pageHeight, undefined, "FAST");
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
  document.addEventListener("DOMContentLoaded", bindPdfButton);
} else {
  bindPdfButton();
}
