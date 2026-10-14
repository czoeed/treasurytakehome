(() => {
  const STANDARD_WARNING = "GOVERNMENT WARNING: (1) According to the Surgeon General, women should not drink alcoholic beverages during pregnancy because of the risk of birth defects. (2) Consumption of alcoholic beverages impairs your ability to drive a car or operate machinery, and may cause health problems.";
  const STANDARD_WARNING_BODY = STANDARD_WARNING.replace(/^GOVERNMENT WARNING:\s*/, "");
  const form = document.querySelector("#application-form");
  const fileInput = document.querySelector("#file-input");
  const dropZone = document.querySelector("#drop-zone");
  const fileList = document.querySelector("#file-list");
  const resultsPanel = document.querySelector("#results-panel");
  const resultsList = document.querySelector("#results-list");
  const checkButton = form.querySelector("button[type=submit]");
  let files = [];
  let toastTimeout;

  document.querySelector("#clear-form").addEventListener("click", () => {
    form.reset();
    resultsPanel.hidden = true;
  });
  document.querySelector("#choose-files").addEventListener("click", (event) => {
    event.stopPropagation();
    fileInput.click();
  });
  dropZone.addEventListener("click", () => fileInput.click());
  dropZone.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      fileInput.click();
    }
  });
  fileInput.addEventListener("change", () => addFiles(fileInput.files));
  document.querySelector("#clear-files").addEventListener("click", () => {
    files = [];
    renderFiles();
    resultsPanel.hidden = true;
  });

  ["dragenter", "dragover"].forEach((name) => dropZone.addEventListener(name, (event) => {
    event.preventDefault();
    dropZone.classList.add("dragover");
  }));
  ["dragleave", "drop"].forEach((name) => dropZone.addEventListener(name, (event) => {
    event.preventDefault();
    dropZone.classList.remove("dragover");
  }));
  dropZone.addEventListener("drop", (event) => addFiles(event.dataTransfer.files));

  function addFiles(fileSet) {
    const incoming = Array.from(fileSet || []).filter((file) => /^image\/(png|jpeg|webp)$/.test(file.type));
    const tooLarge = incoming.filter((file) => file.size > 15 * 1024 * 1024);
    const acceptable = incoming.filter((file) => file.size <= 15 * 1024 * 1024);
    const seen = new Set(files.map((file) => `${file.name}:${file.size}:${file.lastModified}`));
    files = [...files, ...acceptable.filter((file) => !seen.has(`${file.name}:${file.size}:${file.lastModified}`))].slice(0, 20);
    renderFiles();
    if (tooLarge.length) showToast("Images must be 15 MB or smaller.");
    else if (!incoming.length && fileSet?.length) showToast("Choose a PNG, JPG, or WEBP image.");
    else if (files.length === 20 && acceptable.length) showToast("You can review up to 20 images at a time.");
    fileInput.value = "";
  }

  function renderFiles() {
    fileList.replaceChildren();
    files.forEach((file, index) => {
      const row = document.createElement("div");
      row.className = "file-item";
      const image = document.createElement("img");
      image.className = "file-thumb";
      image.src = URL.createObjectURL(file);
      image.alt = "";
      const meta = document.createElement("div");
      meta.style.minWidth = "0";
      const name = document.createElement("div");
      name.className = "file-name";
      name.textContent = file.name;
      const size = document.createElement("div");
      size.className = "file-size";
      size.textContent = formatBytes(file.size);
      meta.append(name, size);
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "remove-file";
      remove.setAttribute("aria-label", `Remove ${file.name}`);
      remove.textContent = "×";
      remove.addEventListener("click", () => {
        files.splice(index, 1);
        renderFiles();
        resultsPanel.hidden = true;
      });
      row.append(image, meta, remove);
      fileList.append(row);
    });
    document.querySelector("#image-count").textContent = files.length ? `${files.length} image${files.length === 1 ? "" : "s"} added` : "No images added";
    document.querySelector("#clear-files").hidden = files.length === 0;
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    if (!files.length) {
      showToast("Add at least one label image to get started.");
      dropZone.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    if (!window.Tesseract) {
      showToast("Text recognition did not load. Check your internet connection and reload.");
      return;
    }

    const application = {
      brand: value("brand"),
      classType: value("classType"),
      abv: value("abv"),
      netContents: value("netContents"),
    };
    checkButton.disabled = true;
    checkButton.querySelector("span:first-child").textContent = "Preparing image reader…";
    resultsPanel.hidden = false;
    resultsList.replaceChildren();
    document.querySelector("#results-title").textContent = "Reading label artwork";
    document.querySelector("#results-summary").textContent = "This may take a few seconds per image.";
    resultsPanel.scrollIntoView({ behavior: "smooth", block: "nearest" });

    let worker;
    try {
      worker = await Tesseract.createWorker("eng", 1, { logger: (message) => updateProgress(message) });
      const records = [];
      for (let i = 0; i < files.length; i += 1) {
        checkButton.querySelector("span:first-child").textContent = `Reading image ${i + 1} of ${files.length}…`;
        const result = await worker.recognize(files[i]);
        records.push({ file: files[i], text: result.data.text || "", confidence: result.data.confidence ?? 0 });
        renderProgressCard(files[i], i + 1, files.length);
      }
      renderResults(records, application);
    } catch (error) {
      console.error("OCR failed", error);
      document.querySelector("#results-title").textContent = "Text reading needs another try";
      document.querySelector("#results-summary").textContent = "No images were uploaded.";
      resultsList.replaceChildren();
      showToast("We couldn't read the image. Try a clearer photo or a smaller file.");
    } finally {
      if (worker) await worker.terminate();
      checkButton.disabled = false;
      checkButton.querySelector("span:first-child").textContent = "Check label artwork";
    }
  });

  function renderProgressCard(file, index, total) {
    const card = document.createElement("article");
    card.className = "result-card loading-card";
    card.innerHTML = `<div class="result-card-head"><div class="result-file"><img alt=""><strong></strong></div><span class="results-summary">Reading ${index} of ${total}</span></div><div class="progress-wrap"><div class="progress-bar" style="width:${Math.round(index / total * 100)}%"></div></div><div class="progress-text">Your image is being read in this browser.</div>`;
    card.querySelector("img").src = URL.createObjectURL(file);
    card.querySelector("strong").textContent = file.name;
    resultsList.append(card);
  }

  function renderResults(records, application) {
    resultsList.replaceChildren();
    let passed = 0;
    records.forEach(({ file, text, confidence }) => {
      const checks = compareText(text, application);
      const outcome = checks.some((check) => check.state === "issue") ? "issue" : checks.some((check) => check.state === "review") ? "review" : "pass";
      if (outcome === "pass") passed += 1;
      const card = document.createElement("article");
      card.className = "result-card";
      const header = document.createElement("div");
      header.className = "result-card-head";
      const fileInfo = document.createElement("div");
      fileInfo.className = "result-file";
      const img = document.createElement("img");
      img.src = URL.createObjectURL(file);
      img.alt = "";
      const fileName = document.createElement("strong");
      fileName.textContent = file.name;
      fileInfo.append(img, fileName);
      const pill = document.createElement("span");
      pill.className = `status-pill ${outcome}`;
      pill.textContent = outcome === "pass" ? "NO TEXT FLAGS" : outcome === "issue" ? "CHECK FLAGS" : "MANUAL REVIEW";
      header.append(fileInfo, pill);
      const list = document.createElement("div");
      list.className = "check-list";
      checks.forEach((check) => list.append(createCheckRow(check)));
      const extracted = document.createElement("details");
      extracted.className = "extracted-text";
      extracted.innerHTML = `<summary>View recognized text · ${Math.round(confidence)}% OCR confidence</summary><pre></pre>`;
      extracted.querySelector("pre").textContent = text.trim() || "No text could be read from this image.";
      card.append(header, list, extracted);
      resultsList.append(card);
    });
    document.querySelector("#results-title").textContent = records.length === 1 ? "Label check complete" : "Batch check complete";
    document.querySelector("#results-summary").textContent = `${passed} of ${records.length} with no text flags`;
  }

  function compareText(text, application) {
    const flat = comparable(text);
    const results = [];
    const matching = (label, expected, matchedText) => {
      if (!expected.trim()) return;
      const needle = comparable(expected);
      const exact = needle && flat.includes(needle);
      results.push({ label, state: exact ? "pass" : "issue", value: exact ? `Found “${expected}”` : `Expected “${expected}” — ${matchedText ? `read “${matchedText.trim().slice(0, 80)}”` : "not found"}` });
    };
    matching("Brand name", application.brand, findNear(text, application.brand));
    matching("Class / type", application.classType, findNear(text, application.classType));
    const abvValue = Number(String(application.abv).replace(/[^\d.]/g, ""));
    const abvMatch = text.match(/\b(\d{1,2}(?:\.\d{1,2})?)\s*(?:%\s*(?:alc\.?\s*\/\s*vol\.?|abv|alcohol(?:\s+by\s+volume)?))\b/i) || text.match(/\b(\d{1,2}(?:\.\d{1,2})?)\s*%/);
    if (Number.isFinite(abvValue) && abvMatch) {
      const matches = Number(abvMatch[1]) === abvValue;
      results.push({ label: "Alcohol content", state: matches ? "pass" : "issue", value: matches ? `Found ${abvMatch[1]}% ABV` : `Application says ${application.abv}% ABV · label reads ${abvMatch[1]}%` });
    } else {
      results.push({ label: "Alcohol content", state: "review", value: "Could not confidently read ABV — verify on artwork" });
    }
    if (application.netContents.trim()) {
      const needle = comparable(application.netContents);
      const found = needle && flat.includes(needle);
      results.push({ label: "Net contents", state: found ? "pass" : "review", value: found ? `Found “${application.netContents}”` : `Could not confirm “${application.netContents}” — verify on artwork` });
    }
    const warningStart = text.search(/government\s+warning/i);
    const warningText = warningStart >= 0 ? text.slice(warningStart) : "";
    if (warningStart < 0) {
      results.push({ label: "Warning heading", state: "issue", value: "GOVERNMENT WARNING was not detected" });
      results.push({ label: "Warning wording", state: "issue", value: "The required TTB statement was not detected" });
    } else {
      const heading = warningText.match(/^government\s+warning\b/i)?.[0] || "";
      const headingIsUppercase = heading === "GOVERNMENT WARNING";
      const warningBody = warningText.replace(/^government\s+warning\s*:?\s*/i, "");
      results.push({
        label: "Warning heading",
        state: headingIsUppercase ? "pass" : "issue",
        value: headingIsUppercase ? "GOVERNMENT WARNING is uppercase" : "The heading must read GOVERNMENT WARNING in uppercase",
      });
      const hasExactWarning = normalizeWarning(warningBody).includes(normalizeWarning(STANDARD_WARNING_BODY));
      results.push({
        label: "Warning wording",
        state: hasExactWarning ? "pass" : "issue",
        value: hasExactWarning ? "Exact standard statement recognized" : "The recognized wording differs from the TTB standard — compare the full text",
      });
    }
    results.push({
      label: "Warning format",
      state: "review",
      value: "Visually verify bold heading only, one continuous paragraph, separation, minimum type size, contrast, and legibility against TTB guidance",
    });
    return results;
  }

  function createCheckRow(check) {
    const row = document.createElement("div");
    row.className = "check-row";
    const icon = document.createElement("span");
    icon.className = `check-icon ${check.state}`;
    icon.textContent = check.state === "pass" ? "✓" : check.state === "review" ? "!" : "×";
    const label = document.createElement("span");
    label.className = "check-name";
    label.textContent = check.label;
    const value = document.createElement("span");
    value.className = "check-value";
    value.textContent = check.value;
    row.append(icon, label, value);
    return row;
  }

  function updateProgress(message) {
    if (message.status === "recognizing text" && Number.isFinite(message.progress)) {
      const current = resultsList.lastElementChild?.querySelector(".progress-bar");
      if (current) current.style.width = `${Math.round(message.progress * 100)}%`;
      const text = resultsList.lastElementChild?.querySelector(".progress-text");
      if (text) text.textContent = `Reading image… ${Math.round(message.progress * 100)}%`;
    }
  }

  function findNear(text, query) {
    if (!query) return "";
    const words = query.split(/\s+/).filter(Boolean);
    const excerpt = text.split(/\n/).find((line) => comparable(line).includes(comparable(words[0] || "")));
    return excerpt || "";
  }
  function comparable(value) { return String(value).toLowerCase().replace(/[^a-z0-9]+/g, ""); }
  function normalizeWarning(value) { return String(value).replace(/\s+/g, " ").trim(); }
  function value(id) { return document.getElementById(id).value.trim(); }
  function formatBytes(bytes) { return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`; }
  function showToast(message) {
    const toast = document.querySelector("#toast");
    toast.textContent = message;
    toast.classList.add("show");
    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => toast.classList.remove("show"), 2800);
  }
})();
