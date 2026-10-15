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
  const backButton = document.querySelector("#back-to-application");
  const batchForm = document.querySelector("#batch-form");
  const batchFileInput = document.querySelector("#batch-files");
  const batchQueue = document.querySelector("#batch-queue");
  const batchJobs = [];
  let batchQueueRunning = false;
  let files = [];
  let toastTimeout;
  const scanChecksCache = new WeakMap();
  let tesseractWorkerPromise;
  let tesseractWorker;

  function getTesseractWorker() {
    if (!tesseractWorkerPromise) {
      const startedAt = performance.now();
      tesseractWorkerPromise = (async () => {
        const worker = await Tesseract.createWorker("eng", 1, { logger: updateProgress });
        await worker.setParameters({
          tessedit_pageseg_mode: Tesseract.PSM.SPARSE_TEXT,
          preserve_interword_spaces: "1",
        });
        tesseractWorker = worker;
        console.info(`[LabelCheck timing] Tesseract worker initialized in ${Math.round(performance.now() - startedAt)} ms`);
        return worker;
      })().catch((error) => {
        tesseractWorkerPromise = null;
        throw error;
      });
    }
    return tesseractWorkerPromise;
  }

  window.addEventListener("pagehide", () => {
    if (tesseractWorker) void tesseractWorker.terminate();
    tesseractWorker = null;
    tesseractWorkerPromise = null;
  });

  document.querySelector("#clear-form").addEventListener("click", () => {
    form.reset();
    resultsPanel.hidden = true;
    document.body.classList.remove("results-mode");
  });
  backButton.addEventListener("click", () => {
    resultsPanel.hidden = true;
    document.body.classList.remove("results-mode");
    document.querySelector("#review").scrollIntoView({ behavior: "smooth", block: "start" });
    document.querySelector("#brand").focus({ preventScroll: true });
  });
  fileInput.addEventListener("change", () => addFiles(fileInput.files));
  document.querySelector("#clear-files").addEventListener("click", () => {
    files = [];
    renderFiles();
    resultsPanel.hidden = true;
    document.body.classList.remove("results-mode");
  });

  const singleTab = document.querySelector("#single-tab");
  const batchTab = document.querySelector("#batch-tab");
  function selectMode(mode) {
    const isBatch = mode === "batch";
    document.querySelector("#individual-mode").hidden = isBatch;
    document.querySelector("#batch-mode").hidden = !isBatch;
    singleTab.classList.toggle("active", !isBatch);
    batchTab.classList.toggle("active", isBatch);
    singleTab.setAttribute("aria-selected", String(!isBatch));
    batchTab.setAttribute("aria-selected", String(isBatch));
    resultsPanel.hidden = true;
    document.body.classList.remove("results-mode");
  }
  singleTab.addEventListener("click", () => selectMode("single"));
  batchTab.addEventListener("click", () => selectMode("batch"));
  batchFileInput.addEventListener("change", renderBatchFileNames);
  document.querySelector("#batch-search").addEventListener("input", renderBatchQueue);
  document.querySelector("#clear-batch-queue").addEventListener("click", () => {
    if (batchQueueRunning) return;
    batchJobs.splice(0);
    renderBatchQueue();
  });

  batchForm.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!batchForm.reportValidity()) return;
    const selected = Array.from(batchFileInput.files || []).filter(isImageFile);
    if (!selected.length) {
      showToast("Add at least one image for this bottle.");
      return;
    }
    if (selected.some((file) => file.size > 15 * 1024 * 1024)) {
      showToast("Images must be 15 MB or smaller.");
      return;
    }
    const application = Object.fromEntries(["brand", "classType", "abv", "proof", "netContents"]
      .map((key) => [key, batchForm.elements.namedItem(key).value.trim()]));
    batchJobs.push({ id: crypto.randomUUID(), application, files: selected.slice(0, 20), state: "queued" });
    batchForm.reset();
    renderBatchFileNames();
    renderBatchQueue();
    if (selected.length > 20) showToast("A bottle review can include up to 20 images.");
    void processBatchQueue();
  });

  function renderBatchFileNames() {
    const selected = Array.from(batchFileInput.files || []);
    document.querySelector("#batch-file-names").textContent = selected.length
      ? selected.map((file) => file.name).join(" · ")
      : "No photos selected";
  }

  function renderBatchQueue() {
    if (!batchJobs.length) {
      batchQueue.replaceChildren();
      const empty = document.createElement("p");
      empty.className = "batch-empty";
      empty.textContent = "Your queued bottle reviews will appear here.";
      batchQueue.append(empty);
    } else {
      batchQueue.querySelector(".batch-empty")?.remove();
    }
    batchJobs.forEach((job, index) => {
      if (!job.card) {
        const card = document.createElement("article");
        card.className = "batch-job panel";
        const header = document.createElement("div");
        header.className = "batch-job-header";
        const details = document.createElement("div");
        const title = document.createElement("strong");
        title.textContent = job.application.brand;
        const subtitle = document.createElement("span");
        subtitle.textContent = `${job.application.classType} · ${job.files.length} photo${job.files.length === 1 ? "" : "s"}`;
        details.append(title, subtitle);
        const metadata = document.createElement("span");
        metadata.textContent = [
          job.application.abv && job.application.abv + "% ABV",
          job.application.proof && job.application.proof + " proof",
          job.application.netContents,
        ].filter(Boolean).join(" · ");
        details.append(metadata);
        const state = document.createElement("span");
        const actions = document.createElement("div");
        actions.className = "batch-job-actions";
        const toggle = document.createElement("button");
        toggle.type = "button";
        toggle.className = "batch-toggle-checks";
        toggle.textContent = "Show checks";
        toggle.setAttribute("aria-expanded", "false");
        toggle.addEventListener("click", () => {
          job.checksExpanded = !job.checksExpanded;
          output.hidden = !job.checksExpanded;
          toggle.textContent = job.checksExpanded ? "Hide checks" : "Show checks";
          toggle.setAttribute("aria-expanded", String(job.checksExpanded));
        });
        actions.append(state, toggle);
        header.append(details, actions);
        const output = document.createElement("div");
        output.className = "batch-job-results results-list";
        output.hidden = true;
        card.append(header, output);
        batchQueue.append(card);
        job.card = card;
        job.stateElement = state;
        job.output = output;
      } else if (!job.card.isConnected) {
        batchQueue.append(job.card);
      }
      job.stateElement.className = `status-pill ${job.state === "complete" ? "pass" : job.state === "error" ? "issue" : "review"}`;
      job.stateElement.textContent = job.state === "queued" ? `QUEUED ${index + 1}` : job.state === "running" ? "SCANNING" : job.state === "error" ? "NEEDS RETRY" : "COMPLETE";
      const searchText = [...Object.values(job.application), ...job.files.map((file) => file.name)].join(" ").toLowerCase();
      job.card.hidden = !searchText.includes(document.querySelector("#batch-search").value.trim().toLowerCase());
    });
    document.querySelector("#clear-batch-queue").hidden = !batchJobs.some((job) => job.state === "complete" || job.state === "error");
  }

  async function processBatchQueue() {
    if (batchQueueRunning) return;
    batchQueueRunning = true;
    try {
      for (const job of batchJobs) {
        if (job.state !== "queued") continue;
        job.state = "running";
        renderBatchQueue();
        await runReview(job.application, job.files, {
          target: job.output,
          onProgress: (imageIndex, imageTotal) => {
            job.stateLabel = `Reading image ${imageIndex} of ${imageTotal}`;
          },
          onComplete: (error) => { job.state = error ? "error" : "complete"; },
          showErrors: false,
        });
        job.state = job.state === "error" ? "error" : "complete";
        renderBatchQueue();
      }
    } finally {
      batchQueueRunning = false;
      renderBatchQueue();
    }
  }

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
    const selected = Array.from(fileSet || []);
    const incoming = selected.filter(isImageFile);
    const tooLarge = incoming.filter((file) => file.size > 15 * 1024 * 1024);
    const acceptable = incoming.filter((file) => file.size <= 15 * 1024 * 1024);
    const seen = new Set(files.map((file) => `${file.name}:${file.size}:${file.lastModified}`));
    files = [...files, ...acceptable.filter((file) => !seen.has(`${file.name}:${file.size}:${file.lastModified}`))].slice(0, 20);
    renderFiles();
    if (incoming.length && window.Tesseract) {
      // Load OCR while the user enters application details, instead of after submit.
      void getTesseractWorker().catch((error) => console.warn("Could not warm the OCR worker", error));
    }
    if (tooLarge.length) showToast("Images must be 15 MB or smaller.");
    else if (selected.length && !incoming.length) showToast("Choose an image file in a format supported by your browser.");
    else if (files.length === 20 && acceptable.length) showToast("You can review up to 20 images at a time.");
    fileInput.value = "";
  }

  function isImageFile(file) {
    if (file.type?.toLowerCase().startsWith("image/")) return true;
    return /\.(avif|bmp|gif|heic|heif|jpe?g|png|tiff?|webp)$/i.test(file.name);
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
        document.body.classList.remove("results-mode");
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
      proof: value("proof"),
      netContents: value("netContents"),
    };
    if (batchQueueRunning) {
      showToast("A queued bottle is being scanned. Please wait for the queue to finish.");
      return;
    }
    checkButton.disabled = true;
    backButton.disabled = true;
    checkButton.querySelector("span:first-child").textContent = "Preparing image reader…";
    resultsPanel.hidden = false;
    document.body.classList.add("results-mode");
    resultsList.replaceChildren();
    document.querySelector("#results-title").textContent = "Reading label artwork";
    document.querySelector("#results-summary").textContent = "Photos are read locally with an adaptive OCR pass.";
    document.querySelector("#review").scrollIntoView({ behavior: "smooth", block: "start" });

    await runReview(application, files.slice(), {
      target: resultsList,
      onProgress: (imageIndex, imageTotal) => {
        checkButton.querySelector("span:first-child").textContent = `Reading image ${imageIndex} of ${imageTotal}…`;
      },
      onComplete: () => {
        checkButton.disabled = false;
        backButton.disabled = false;
        checkButton.querySelector("span:first-child").textContent = "Check label artwork";
      },
      title: document.querySelector("#results-title"),
      summary: document.querySelector("#results-summary"),
    });
  });

  async function runReview(application, reviewFiles, options = {}) {
    const target = options.target || resultsList;
    let paddleOcrPromise;
    const getPaddleOcr = () => {
      if (!paddleOcrPromise) {
        const startedAt = performance.now();
        paddleOcrPromise = createPaddleOcr().then((engine) => {
          console.info(`[LabelCheck timing] PaddleOCR initialized in ${Math.round(performance.now() - startedAt)} ms`);
          return engine;
        }).catch((error) => {
          console.warn("PaddleOCR could not initialize; continuing with Tesseract", error);
          return null;
        });
      }
      return paddleOcrPromise;
    };
    try {
      const worker = await getTesseractWorker();
      const records = [];
      const completedScans = [];
      for (let i = 0; i < reviewFiles.length; i += 1) {
        options.onProgress?.(i + 1, reviewFiles.length);
        const progressCard = renderProgressCard(reviewFiles[i], i + 1, reviewFiles.length, target);
        const finishProgress = startProgressAnimation(progressCard);
        try {
          const photoStartedAt = performance.now();
          const scans = await readPhoto(worker, reviewFiles[i], application, getPaddleOcr, completedScans, (currentScans) => {
            renderResults([...records, { file: reviewFiles[i], scans: currentScans }], application,
              { preliminary: true, progressCard, target, title: options.title, summary: options.summary });
          });
          records.push({ file: reviewFiles[i], scans });
          completedScans.push(...scans);
          console.info(`[LabelCheck timing] ${reviewFiles[i].name}: ${Math.round(performance.now() - photoStartedAt)} ms total; ${scans.length} OCR results`);
          finishProgress(true);
        } catch (error) {
          finishProgress(false);
          throw error;
        }
      }
      renderResults(records, application, { target, title: options.title, summary: options.summary });
      options.onComplete?.(null);
    } catch (error) {
      console.error("OCR failed", error);
      if (options.title) options.title.textContent = "Text reading needs another try";
      if (options.summary) options.summary.textContent = "No checks could be completed.";
      target.replaceChildren();
      if (options.showErrors !== false) showToast("We couldn't read the image. Try a clearer photo or a smaller file.");
      options.onComplete?.(error);
    } finally {
      if (paddleOcrPromise) {
        const paddleOcr = await paddleOcrPromise;
        if (paddleOcr) await paddleOcr.dispose();
      }
    }
  }

  function renderProgressCard(file, index, total, target = resultsList) {
    const card = document.createElement("article");
    card.className = "result-card loading-card";
    card.innerHTML = `<div class="result-card-head"><div class="result-file"><img alt=""><strong></strong></div><span class="results-summary">Reading ${index} of ${total}</span></div><div class="progress-wrap"><div class="progress-bar" style="width:0%"></div></div><div class="progress-text">Preparing image reader…</div>`;
    card.querySelector("img").src = URL.createObjectURL(file);
    card.querySelector("strong").textContent = file.name;
    target.append(card);
    return card;
  }

  function startProgressAnimation(card) {
    const bar = card.querySelector(".progress-bar");
    const text = card.querySelector(".progress-text");
    const startedAt = performance.now();
    const timer = window.setInterval(() => {
      const elapsed = performance.now() - startedAt;
      // Scan duration depends on image difficulty and the recovery passes it needs.
      // Approach 94% gradually, then mark complete only after OCR actually returns.
      const progress = Math.min(94, 4 + 90 * (1 - Math.exp(-elapsed / 18000)));
      bar.style.width = `${progress.toFixed(1)}%`;
      if (elapsed > 500) text.textContent = "Reading label text…";
      if (elapsed > 12000) text.textContent = "Checking details across image regions…";
    }, 250);
    return (complete) => {
      window.clearInterval(timer);
      if (complete) {
        bar.style.width = "100%";
        text.textContent = "Image read complete.";
      } else {
        text.textContent = "Image could not be read.";
      }
    };
  }

  function renderResults(records, application, options = {}) {
    const target = options.target || resultsList;
    target.replaceChildren();
    const checks = combinePhotoChecks(records, application);
    const outcome = checks.some((check) => check.state === "issue") ? "issue" : checks.some((check) => check.state === "review") ? "review" : "pass";
    const allScans = records.flatMap(({ file, scans }) => scans.map((scan) => ({ ...scan, fileName: file.name })));
    const text = allScans.map((scan) => `${scan.fileName} · ${scan.name} · ${Math.round(scan.confidence)}% confidence\n${scan.text}`).join("\n\n");
    const confidence = Math.max(...allScans.map((scan) => scan.confidence));
    const card = document.createElement("article");
    card.className = "result-card";
    const header = document.createElement("div");
    header.className = "result-card-head";
    const fileInfo = document.createElement("div");
    fileInfo.className = "result-file";
    const fileName = document.createElement("strong");
    fileName.textContent = `${records.length} photo${records.length === 1 ? "" : "s"} combined`;
    fileInfo.append(fileName);
    const pill = document.createElement("span");
    pill.className = `status-pill ${options.preliminary ? "review" : outcome}`;
    pill.textContent = options.preliminary ? "PRELIMINARY" : outcome === "pass" ? "NO TEXT FLAGS" : outcome === "issue" ? "CHECK FLAGS" : "MANUAL REVIEW";
    header.append(fileInfo, pill);
    const list = document.createElement("div");
    list.className = "check-list";
    checks.forEach((check) => list.append(createCheckRow(check)));
    const extracted = document.createElement("details");
    extracted.className = "extracted-text";
    extracted.innerHTML = `<summary>View recognized text · best scan ${Math.round(confidence)}% OCR confidence</summary><pre></pre>`;
    extracted.querySelector("pre").textContent = text.trim() || "No text could be read from this image.";
    card.append(header, list, extracted);
    if (options.preliminary) {
      const note = document.createElement("p");
      note.className = "preliminary-note";
      note.textContent = "Preliminary checklist. It updates as additional scans discover and confirm information.";
      card.insertBefore(note, list);
    }
    target.append(card);
    if (options.preliminary && options.progressCard) target.append(options.progressCard);
    if (options.title) options.title.textContent = options.preliminary ? "Initial label read" : "Combined label checklist";
    if (options.summary) options.summary.textContent = options.preliminary
      ? `${allScans.length} scan${allScans.length === 1 ? "" : "s"} read so far · checks are continuing.`
      : `One checklist across ${records.length} submitted photo${records.length === 1 ? "" : "s"}`;
  }

  async function readPhoto(worker, file, application, getPaddleOcr, batchScans = [], onScanUpdate = null) {
    const startedAt = performance.now();
    const originalRecognize = worker.recognize;
    let recognizeMs = 0;
    let recognizeCount = 0;
    worker.recognize = async function (...args) {
      const recognizeStartedAt = performance.now();
      try {
        return await originalRecognize.apply(worker, args);
      } finally {
        recognizeMs += performance.now() - recognizeStartedAt;
        recognizeCount += 1;
      }
    };
    try {
      return await readPhotoPipeline(worker, file, application, getPaddleOcr, batchScans, onScanUpdate);
    } finally {
      worker.recognize = originalRecognize;
      const elapsedMs = performance.now() - startedAt;
      console.info(`[LabelCheck timing] ${file.name}: ${Math.round(recognizeMs)} ms Tesseract across ${recognizeCount} passes; ${Math.round(elapsedMs - recognizeMs)} ms preparation, PaddleOCR, and other work`);
    }
  }

  async function readPhotoPipeline(worker, file, application, getPaddleOcr, batchScans, onScanUpdate) {
    const preparationStartedAt = performance.now();
    const { original, enhanced } = await preparePhoto(file);
    console.info(`[LabelCheck timing] ${file.name}: image decode and preprocessing ${Math.round(performance.now() - preparationStartedAt)} ms`);
    const firstPasses = [];
    const addScan = (scan) => {
      firstPasses.push(scan);
      onScanUpdate?.(firstPasses.slice());
    };
    const paddleViews = [{ name: "PaddleOCR original photo", image: original }];
    const enhancedResult = await worker.recognize(enhanced, {}, { blocks: true });
    addScan({
      name: "contrast adjusted full photo",
      text: enhancedResult.data.text || "",
      confidence: enhancedResult.data.confidence ?? 0,
      warningFormat: analyzeWarningFormat(
        enhancedResult.data.blocks || [],
        enhanced,
        enhancedResult.data.text || "",
      ),
    });

    // Small warning print often needs a targeted crop, while the brand, class,
    // alcohol values, and volume are already readable from the full photo.
    // Try that inexpensive crop before paying for another full-image engine pass.
    let triedEarlyWarningCrop = false;
    if (hasBatchLabelDetailsEvidence(batchScans, firstPasses, application)
      && !hasWarningTextEvidence([...batchScans, ...firstPasses], application)) {
      await appendWarningCrop(worker, file, enhancedResult, enhanced, application, firstPasses, batchScans, addScan);
      triedEarlyWarningCrop = true;
    }

    // The enhanced scan is usually enough for straight, well-lit label photos.
    // Pay for a second full-photo recognition only when required evidence is missing.
    if (!hasBatchCoreFieldEvidence(batchScans, firstPasses, application)) {
      const originalResult = await worker.recognize(original);
      addScan({
        name: "original full photo",
        text: originalResult.data.text || "",
        confidence: originalResult.data.confidence ?? 0,
      });
    }

    let paddleOcr = null;
    if (!hasBatchCoreFieldEvidence(batchScans, firstPasses, application) && getPaddleOcr) {
      paddleOcr = await getPaddleOcr();
      if (paddleOcr) {
        try {
          await appendPaddleResults(paddleOcr, paddleViews, firstPasses, 0, addScan);
        } catch (error) {
          console.warn("PaddleOCR failed on the original photo; continuing with other scans", error);
        }
      }
    }
    if (hasBatchCoreFieldEvidence(batchScans, firstPasses, application)) {
      await appendWarningCrop(worker, file, enhancedResult, enhanced, application, firstPasses, batchScans, addScan);
      return firstPasses;
    }

    // Keep a geometry-corrected label candidate alongside the normal photo
    // scans; downstream checks can use whichever view reads the text best.
    try {
      const labelQuad = detectLabelQuadrilateral(original);
      if (labelQuad) {
        const perspectiveLabel = warpLabelQuadrilateral(original, labelQuad);
        paddleViews.push({ name: "PaddleOCR perspective corrected label", image: perspectiveLabel });
        const previousMode = Tesseract.PSM.SPARSE_TEXT;
        try {
          await worker.setParameters({ tessedit_pageseg_mode: Tesseract.PSM.SINGLE_BLOCK });
          const perspectiveResult = await worker.recognize(perspectiveLabel);
          addScan({
            name: "perspective-corrected label",
            text: perspectiveResult.data.text || "",
            confidence: perspectiveResult.data.confidence ?? 0,
          });

          if (!hasBatchCoreFieldEvidence(batchScans, firstPasses, application)) {
            const unwrappedLabel = unwrapCylindricalLabel(perspectiveLabel, 48);
            paddleViews.push({ name: "PaddleOCR unwrapped label", image: unwrappedLabel });
            const unwrappedResult = await worker.recognize(unwrappedLabel);
            addScan({
              name: "cylindrically unwrapped label",
              text: unwrappedResult.data.text || "",
              confidence: unwrappedResult.data.confidence ?? 0,
            });
          }

          if (!hasBatchCoreFieldEvidence(batchScans, firstPasses, application)) {
            const bands = [[0, 0.42], [0.34, 0.78], [0.68, 1]];
            for (let index = 0; index < bands.length; index += 1) {
              const band = warpLabelBand(original, labelQuad, ...bands[index]);
              paddleViews.push({ name: `PaddleOCR flattened label band ${index + 1}`, image: band });
              const bandResult = await worker.recognize(band);
              addScan({
                name: `flattened label band ${index + 1}`,
                text: bandResult.data.text || "",
                confidence: bandResult.data.confidence ?? 0,
              });
              if (hasBatchCoreFieldEvidence(batchScans, firstPasses, application)) break;
            }
          }
        } finally {
          await worker.setParameters({ tessedit_pageseg_mode: previousMode });
        }
      }
    } catch (error) {
      console.warn("Geometry corrected OCR pass failed; continuing with photo scans", error);
    }

    if (paddleOcr && paddleViews.length > 1) {
      try {
        await appendPaddleResults(paddleOcr, paddleViews, firstPasses, 1, addScan);
      } catch (error) {
        console.warn("PaddleOCR failed for this image; keeping the other OCR scans", error);
      }
    }

    if (hasBatchCoreFieldEvidence(batchScans, firstPasses, application)) {
      await appendWarningCrop(worker, file, enhancedResult, enhanced, application, firstPasses, batchScans, addScan);
      return firstPasses;
    }

    let preferredImage = enhanced;
    let preferredBlocks = enhancedResult.data.blocks || [];
    let preferredScan = firstPasses.at(-1);
    const detectedSkew = estimateTextSkew(preferredBlocks);
    if (detectedSkew !== null && Math.abs(detectedSkew) >= 2 && Math.abs(detectedSkew) <= 35) {
      const deskewed = rotateCanvas(enhanced, -detectedSkew);
      const { data } = await worker.recognize(deskewed, {}, { blocks: true });
      const deskewScan = {
        name: `deskewed full photo (${detectedSkew.toFixed(1)}°)`,
        text: data.text || "",
        confidence: data.confidence ?? 0,
        warningFormat: analyzeWarningFormat(data.blocks || [], deskewed, data.text || ""),
      };
      addScan(deskewScan);
      if (scanScore(deskewScan, application) > scanScore(preferredScan, application)) {
        preferredImage = deskewed;
        preferredBlocks = data.blocks || [];
        preferredScan = deskewScan;
      }
    }

    // If the straight pass gives little usable text, try a few tilted views.
    if (keyEvidenceCount(preferredScan.text, application) < 2 || preferredScan.confidence < 55) {
      const rotationBase = preferredImage;
      for (const angle of [-24, -12, 12, 24]) {
        const rotated = rotateCanvas(rotationBase, angle);
        const { data } = await worker.recognize(rotated, {}, { blocks: true });
        const rotatedScan = {
          name: `rotated full photo (${angle > 0 ? "+" : ""}${angle}°)`,
          text: data.text || "",
          confidence: data.confidence ?? 0,
          warningFormat: analyzeWarningFormat(data.blocks || [], rotated, data.text || ""),
        };
        addScan(rotatedScan);
        if (scanScore(rotatedScan, application) > scanScore(preferredScan, application)) {
          preferredImage = rotated;
          preferredBlocks = data.blocks || [];
          preferredScan = rotatedScan;
        }
        if (keyEvidenceCount(preferredScan.text, application) >= 2 && preferredScan.confidence >= 55) break;
      }
    }

    const curvature = estimateTextCurvature(preferredBlocks, preferredImage.width, preferredImage.height);
    if (curvature !== null) {
      const flattened = await flattenCurvedPhoto(preferredImage, curvature);
      const flattenedResult = await worker.recognize(flattened);
      addScan({
        name: "curvature adjusted full photo",
        text: flattenedResult.data.text || "",
        confidence: flattenedResult.data.confidence ?? 0,
      });
    }

    // Whole-photo OCR is the normal path. If the warning or application details
    // were missed, scan overlapping sections so small print gets more pixels.
    const needsDetailTiles = !hasBatchCoreFieldEvidence(batchScans, firstPasses, application);
    if (needsDetailTiles) {
      // Detail regions inherit the best angle found for the full photo, while
      // sparse-text mode handles the multiple text clusters on bottle labels.
      const tiles = makeOverlappingTiles(preferredImage);
      for (let i = 0; i < tiles.length; i += 1) {
        const { data } = await worker.recognize(tiles[i]);
        addScan({ name: `rotated detail area ${i + 1}`, text: data.text || "", confidence: data.confidence ?? 0 });
        if (hasBatchCoreFieldEvidence(batchScans, firstPasses, application)) break;
      }
    }
    if (isAlcoholEvidenceMissing(firstPasses, application)) {
      const bottom = await makeEnlargedBottomRegion(file);
      const { data } = await worker.recognize(bottom);
      addScan({ name: "enlarged lower alcohol details", text: data.text || "", confidence: data.confidence ?? 0 });
      if (isAlcoholEvidenceMissing(firstPasses, application)) {
        const alcoholCrop = await makeAlcoholSearchCrop(file);
        const { data: cropData } = await worker.recognize(alcoholCrop);
        addScan({ name: "focused alcohol area", text: cropData.text || "", confidence: cropData.confidence ?? 0 });
      }
    }
    if (application.proof && !firstPasses.some((scan) => hasExpectedAlcoholAndProof(scan.text, application)
      && hasDistinctProofPresentation(scan.text, application))) {
      const alcoholCrop = await makeAlcoholDetailCrop(file, enhancedResult.data.blocks || [], enhanced.width, enhanced.height);
      if (alcoholCrop) {
        const { data } = await worker.recognize(alcoholCrop);
        const cropText = data.text || "";
        addScan({
          name: "focused ABV and proof detail",
          text: cropText,
          confidence: data.confidence ?? 0,
        });
      }
    }
    if (!triedEarlyWarningCrop) {
      await appendWarningCrop(worker, file, enhancedResult, enhanced, application, firstPasses, batchScans, addScan);
    }
    return firstPasses;
  }

  async function appendPaddleResults(paddleOcr, views, scans, startIndex, onScan = (scan) => scans.push(scan)) {
    const selectedViews = views.slice(startIndex);
    if (!selectedViews.length) return;
    const startedAt = performance.now();
    const results = await paddleOcr.predict(selectedViews.map(({ image }) => image));
    console.info(`[LabelCheck timing] PaddleOCR read ${selectedViews.length} view(s) in ${Math.round(performance.now() - startedAt)} ms`);
    results.forEach((result, index) => {
      const items = result.items || [];
      const scores = items.map((item) => item.score).filter(Number.isFinite);
      onScan({
        name: selectedViews[index].name,
        text: orderPaddleText(items),
        confidence: scores.length ? scores.reduce((sum, score) => sum + score, 0) / scores.length * 100 : 0,
        engine: "paddle",
      });
    });
  }

  async function appendWarningCrop(worker, file, enhancedResult, enhanced, application, scans, batchScans = [], onScan = (scan) => scans.push(scan)) {
    const warningWordingRead = [...batchScans, ...scans].some((scan) => checksForScan(scan, application)
      .some((check) => check.label === "Warning wording" && check.state === "pass"));
    if (warningWordingRead || scans.some((scan) => scan.name === "enlarged warning block")) return;
    const cropStartedAt = performance.now();
    const warningCrop = await makeWarningCrop(
      file,
      enhancedResult.data.blocks || [],
      enhanced.width,
      enhanced.height,
    );
    if (!warningCrop) {
      console.info(`[LabelCheck timing] ${file.name}: warning crop unavailable; locating and preparing took ${Math.round(performance.now() - cropStartedAt)} ms`);
      return;
    }
    const cropPreparedMs = performance.now() - cropStartedAt;
    const recognizeStartedAt = performance.now();
    const { data } = await worker.recognize(warningCrop, {}, { blocks: true });
    console.info(`[LabelCheck timing] ${file.name}: warning crop ${warningCrop.width}x${warningCrop.height}; prepare ${Math.round(cropPreparedMs)} ms, OCR ${Math.round(performance.now() - recognizeStartedAt)} ms`);
    onScan({
      name: "enlarged warning block",
      text: data.text || "",
      confidence: data.confidence ?? 0,
      warningFormat: analyzeWarningFormat(data.blocks || [], warningCrop, data.text || ""),
    });
  }

  async function createPaddleOcr() {
    const { PaddleOCR } = await import("@paddleocr/paddleocr-js");
    const modelUrl = (name) => new URL(`${import.meta.env.BASE_URL}models/${name}`, window.location.href).href;
    return PaddleOCR.create({
      textDetectionModelName: "PP-OCRv5_mobile_det",
      textDetectionModelAsset: { url: modelUrl("PP-OCRv5_mobile_det_onnx_infer.tar") },
      textRecognitionModelName: "PP-OCRv5_mobile_rec",
      textRecognitionModelAsset: { url: modelUrl("PP-OCRv5_mobile_rec_onnx_infer.tar") },
      ortOptions: {
        backend: "wasm",
        wasmPaths: "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.30.0/dist/",
        numThreads: 1,
        simd: true,
      },
    });
  }

  function orderPaddleText(items) {
    const positioned = items.map((item) => {
      const polygon = item.poly || [];
      const xs = polygon.map((point) => point[0]);
      const ys = polygon.map((point) => point[1]);
      const centerX = xs.length ? (Math.min(...xs) + Math.max(...xs)) / 2 : 0;
      const centerY = ys.length ? (Math.min(...ys) + Math.max(...ys)) / 2 : 0;
      const height = ys.length ? Math.max(...ys) - Math.min(...ys) : 0;
      const first = polygon[0];
      const second = polygon[1];
      const slope = first && second && Math.abs(second[0] - first[0]) > 1
        ? (second[1] - first[1]) / (second[0] - first[0]) : 0;
      return { text: item.text || "", centerX, centerY, height, slope };
    }).filter((item) => item.text.trim());
    if (!positioned.length) return "";

    const baselineSlope = median(positioned.map((item) => item.slope).filter((slope) => Math.abs(slope) <= 1));
    const typicalHeight = median(positioned.map((item) => item.height).filter((height) => height > 0)) || 1;
    const projected = positioned.map((item) => ({
      ...item,
      baseline: item.centerY - baselineSlope * item.centerX,
    })).sort((a, b) => a.baseline - b.baseline || a.centerX - b.centerX);
    const rows = [];
    projected.forEach((item) => {
      const row = rows.at(-1);
      if (!row || item.baseline - row.baseline > typicalHeight * 0.8) {
        rows.push({ baseline: item.baseline, items: [item] });
      } else {
        row.items.push(item);
        row.baseline = median(row.items.map((entry) => entry.baseline));
      }
    });
    return rows.map((row) => row.items.sort((a, b) => a.centerX - b.centerX)
      .map((item) => item.text).join(" ")).join("\n");
  }

  function detectLabelQuadrilateral(image) {
    const scale = Math.min(1, 800 / Math.max(image.width, image.height));
    const analysis = document.createElement("canvas");
    analysis.width = Math.max(1, Math.round(image.width * scale));
    analysis.height = Math.max(1, Math.round(image.height * scale));
    const context = analysis.getContext("2d", { willReadFrequently: true });
    context.drawImage(image, 0, 0, analysis.width, analysis.height);
    const { data } = context.getImageData(0, 0, analysis.width, analysis.height);
    const width = analysis.width;
    const height = analysis.height;

    // Estimate the label stock color from the image center. Color quantization
    // suppresses print, grain, and lighting noise while retaining colored stock.
    const bins = new Map();
    for (let y = Math.floor(height * 0.38); y < height * 0.68; y += 2) {
      for (let x = Math.floor(width * 0.35); x < width * 0.65; x += 2) {
        const index = (y * width + x) * 4;
        const red = data[index];
        const green = data[index + 1];
        const blue = data[index + 2];
        if ((red + green + blue) / 3 < 65) continue;
        const key = `${red >> 4},${green >> 4},${blue >> 4}`;
        const bin = bins.get(key) || { count: 0, red: 0, green: 0, blue: 0 };
        bin.count += 1;
        bin.red += red;
        bin.green += green;
        bin.blue += blue;
        bins.set(key, bin);
      }
    }
    const dominant = [...bins.values()].sort((a, b) => b.count - a.count)[0];
    if (!dominant) return null;
    const target = [dominant.red, dominant.green, dominant.blue].map((sum) => sum / dominant.count);
    const pixelCount = width * height;
    const mask = new Uint8Array(pixelCount);
    for (let pixel = 0; pixel < pixelCount; pixel += 1) {
      const index = pixel * 4;
      const red = data[index] - target[0];
      const green = data[index + 1] - target[1];
      const blue = data[index + 2] - target[2];
      if (red * red + green * green + blue * blue < 52 * 52) mask[pixel] = 1;
    }

    const visited = new Uint8Array(pixelCount);
    const stack = new Int32Array(pixelCount);
    let best = null;
    for (let seed = 0; seed < pixelCount; seed += 1) {
      if (!mask[seed] || visited[seed]) continue;
      let stackSize = 1;
      stack[0] = seed;
      visited[seed] = 1;
      let area = 0;
      let sumX = 0;
      let sumY = 0;
      let minSum = Infinity;
      let maxSum = -Infinity;
      let minDiff = Infinity;
      let maxDiff = -Infinity;
      let topLeft;
      let topRight;
      let bottomRight;
      let bottomLeft;
      let minX = width;
      let maxX = 0;
      let minY = height;
      let maxY = 0;
      while (stackSize) {
        const pixel = stack[--stackSize];
        const x = pixel % width;
        const y = Math.floor(pixel / width);
        const sum = x + y;
        const difference = x - y;
        area += 1;
        sumX += x;
        sumY += y;
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
        if (sum < minSum) { minSum = sum; topLeft = { x, y }; }
        if (sum > maxSum) { maxSum = sum; bottomRight = { x, y }; }
        if (difference > maxDiff) { maxDiff = difference; topRight = { x, y }; }
        if (difference < minDiff) { minDiff = difference; bottomLeft = { x, y }; }
        for (let yy = Math.max(0, y - 1); yy <= Math.min(height - 1, y + 1); yy += 1) {
          for (let xx = Math.max(0, x - 1); xx <= Math.min(width - 1, x + 1); xx += 1) {
            const neighbor = yy * width + xx;
            if (mask[neighbor] && !visited[neighbor]) {
              visited[neighbor] = 1;
              stack[stackSize++] = neighbor;
            }
          }
        }
      }
      if (area < pixelCount * 0.025 || maxX - minX < width * 0.24 || maxY - minY < height * 0.24) continue;
      const centerDistance = Math.hypot(sumX / area - width / 2, sumY / area - height / 2);
      const score = area * (1 - Math.min(0.6, centerDistance / Math.hypot(width, height)));
      if (!best || score > best.score) best = { score, points: [topLeft, topRight, bottomRight, bottomLeft] };
    }
    if (!best) return null;

    const points = best.points.map((point) => ({ x: point.x / scale, y: point.y / scale }));
    const crosses = points.map((point, index) => {
      const next = points[(index + 1) % 4];
      const after = points[(index + 2) % 4];
      return (next.x - point.x) * (after.y - next.y) - (next.y - point.y) * (after.x - next.x);
    });
    if (crosses.some((cross) => Math.abs(cross) < 1) || crosses.some((cross) => Math.sign(cross) !== Math.sign(crosses[0]))) return null;
    const area = Math.abs(points.reduce((sum, point, index) => {
      const next = points[(index + 1) % 4];
      return sum + point.x * next.y - next.x * point.y;
    }, 0)) / 2;
    if (area < image.width * image.height * 0.025 || area > image.width * image.height * 0.85) return null;
    return { points };
  }

  function warpLabelQuadrilateral(image, { points }) {
    const [topLeft, topRight, bottomRight, bottomLeft] = points;
    const width = Math.max(1, Math.round((distance(topLeft, topRight) + distance(bottomLeft, bottomRight)) / 2));
    const height = Math.max(1, Math.round((distance(topLeft, bottomLeft) + distance(topRight, bottomRight)) / 2));
    const scale = Math.min(3, 2400 / Math.max(width, height));
    const outputWidth = Math.max(1, Math.round(width * scale));
    const outputHeight = Math.max(1, Math.round(height * scale));
    const output = document.createElement("canvas");
    output.width = outputWidth;
    output.height = outputHeight;
    const source = image.getContext("2d", { willReadFrequently: true })
      .getImageData(0, 0, image.width, image.height);
    const context = output.getContext("2d", { willReadFrequently: true });
    const result = context.createImageData(outputWidth, outputHeight);
    const transform = solveHomography(
      [
        { x: 0, y: 0 }, { x: outputWidth - 1, y: 0 },
        { x: outputWidth - 1, y: outputHeight - 1 }, { x: 0, y: outputHeight - 1 },
      ],
      points,
    );
    if (!transform) return output;
    for (let index = 0; index < result.data.length; index += 4) {
      result.data[index] = 255;
      result.data[index + 1] = 255;
      result.data[index + 2] = 255;
      result.data[index + 3] = 255;
    }
    for (let y = 0; y < outputHeight; y += 1) {
      for (let x = 0; x < outputWidth; x += 1) {
        const denominator = transform[6] * x + transform[7] * y + 1;
        if (Math.abs(denominator) < 1e-8) continue;
        const sourceX = (transform[0] * x + transform[1] * y + transform[2]) / denominator;
        const sourceY = (transform[3] * x + transform[4] * y + transform[5]) / denominator;
        if (sourceX < 0 || sourceY < 0 || sourceX >= image.width - 1 || sourceY >= image.height - 1) continue;
        const x0 = Math.floor(sourceX);
        const y0 = Math.floor(sourceY);
        const dx = sourceX - x0;
        const dy = sourceY - y0;
        const topIndex = (y0 * image.width + x0) * 4;
        const bottomIndex = topIndex + image.width * 4;
        const outputIndex = (y * outputWidth + x) * 4;
        for (let channel = 0; channel < 4; channel += 1) {
          const top = source.data[topIndex + channel] * (1 - dx) + source.data[topIndex + 4 + channel] * dx;
          const bottom = source.data[bottomIndex + channel] * (1 - dx) + source.data[bottomIndex + 4 + channel] * dx;
          result.data[outputIndex + channel] = top * (1 - dy) + bottom * dy;
        }
      }
    }
    context.putImageData(result, 0, 0);
    return output;
  }

  function warpLabelBand(image, { points }, start, end) {
    const [topLeft, topRight, bottomRight, bottomLeft] = points;
    const interpolate = (from, to, amount) => ({
      x: from.x + (to.x - from.x) * amount,
      y: from.y + (to.y - from.y) * amount,
    });
    const bandPoints = [
      interpolate(topLeft, bottomLeft, start),
      interpolate(topRight, bottomRight, start),
      interpolate(topRight, bottomRight, end),
      interpolate(topLeft, bottomLeft, end),
    ];
    return warpLabelQuadrilateral(image, { points: bandPoints });
  }

  function solveHomography(destination, source) {
    const equations = [];
    destination.forEach(({ x, y }, index) => {
      const { x: sourceX, y: sourceY } = source[index];
      equations.push([x, y, 1, 0, 0, 0, -sourceX * x, -sourceX * y, sourceX]);
      equations.push([0, 0, 0, x, y, 1, -sourceY * x, -sourceY * y, sourceY]);
    });
    for (let column = 0; column < 8; column += 1) {
      let pivot = column;
      for (let row = column + 1; row < 8; row += 1) {
        if (Math.abs(equations[row][column]) > Math.abs(equations[pivot][column])) pivot = row;
      }
      if (Math.abs(equations[pivot][column]) < 1e-10) return null;
      [equations[column], equations[pivot]] = [equations[pivot], equations[column]];
      const divisor = equations[column][column];
      for (let cell = column; cell <= 8; cell += 1) equations[column][cell] /= divisor;
      for (let row = 0; row < 8; row += 1) {
        if (row === column) continue;
        const factor = equations[row][column];
        for (let cell = column; cell <= 8; cell += 1) equations[row][cell] -= factor * equations[column][cell];
      }
    }
    return equations.map((row) => row[8]);
  }

  function unwrapCylindricalLabel(image, halfAngleDegrees) {
    const sourceContext = image.getContext("2d", { willReadFrequently: true });
    const source = sourceContext.getImageData(0, 0, image.width, image.height);
    const output = document.createElement("canvas");
    output.width = image.width;
    output.height = image.height;
    const context = output.getContext("2d", { willReadFrequently: true });
    const result = context.createImageData(output.width, output.height);
    const halfAngle = halfAngleDegrees * Math.PI / 180;
    const maxX = image.width - 1;
    const sourceAtX = new Float32Array(image.width);
    for (let x = 0; x < image.width; x += 1) {
      const normalized = 2 * x / Math.max(1, maxX) - 1;
      sourceAtX[x] = Math.max(0, Math.min(maxX,
        (Math.sin(normalized * halfAngle) / Math.sin(halfAngle) + 1) * maxX / 2));
    }
    for (let y = 0; y < image.height; y += 1) {
      const row = y * image.width * 4;
      for (let x = 0; x < image.width; x += 1) {
        const sourceX = sourceAtX[x];
        const left = Math.floor(sourceX);
        const right = Math.min(maxX, left + 1);
        const fraction = sourceX - left;
        const outputIndex = row + x * 4;
        const leftIndex = row + left * 4;
        const rightIndex = row + right * 4;
        for (let channel = 0; channel < 4; channel += 1) {
          result.data[outputIndex + channel] = source.data[leftIndex + channel] * (1 - fraction)
            + source.data[rightIndex + channel] * fraction;
        }
      }
    }
    context.putImageData(result, 0, 0);
    return output;
  }

  function distance(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  async function makeWarningCrop(file, blocks, processedWidth, processedHeight) {
    let warningLines = null;
    for (const block of blocks) {
      const lines = (block.paragraphs || []).flatMap((paragraph) => paragraph.lines || [])
        .filter((line) => line.bbox)
        .sort((a, b) => a.bbox.y0 - b.bbox.y0);
      const start = lines.findIndex((line) => /government\s+warning|surgeon\s+general|birth\s+defects/i.test(line.text || (line.words || []).map((word) => word.text).join(" ")));
      if (start < 0) continue;
      const firstLine = /government\s+warning/i.test(lines[start].text || "") ? start : Math.max(0, start - 1);
      warningLines = lines.slice(firstLine, start + 1);
      for (let i = start + 1; i < lines.length && warningLines.length < 14; i += 1) {
        const previous = warningLines.at(-1).bbox;
        const current = lines[i].bbox;
        const lineHeight = Math.max(previous.y1 - previous.y0, 1);
        if (current.y0 - previous.y1 > lineHeight * 1.8) break;
        warningLines.push(lines[i]);
      }
      break;
    }
    if (!warningLines || warningLines.length < 2) return null;

    const bounds = warningLines.reduce((box, line) => ({
      x0: Math.min(box.x0, line.bbox.x0),
      y0: Math.min(box.y0, line.bbox.y0),
      x1: Math.max(box.x1, line.bbox.x1),
      y1: Math.max(box.y1, line.bbox.y1),
    }), { x0: Infinity, y0: Infinity, x1: 0, y1: 0 });
    const bitmap = await createImageBitmap(file);
    const scaleX = bitmap.width / processedWidth;
    const scaleY = bitmap.height / processedHeight;
    const padX = Math.max(45, (bounds.x1 - bounds.x0) * 0.04);
    const padY = Math.max(35, (bounds.y1 - bounds.y0) * 0.12);
    const left = Math.max(0, Math.floor(bounds.x0 * scaleX - padX));
    const top = Math.max(0, Math.floor(bounds.y0 * scaleY - padY));
    const right = Math.min(bitmap.width, Math.ceil(bounds.x1 * scaleX + padX));
    const bottom = Math.min(bitmap.height, Math.ceil(bounds.y1 * scaleY + padY));
    const sourceWidth = right - left;
    const sourceHeight = bottom - top;
    if (sourceWidth <= 0 || sourceHeight <= 0) {
      bitmap.close?.();
      return null;
    }
    // Warning text needs enlargement, but forcing every crop to 2200 px wide
    // can turn a tiny label region into a needlessly large OCR job. Keep the
    // crop legible while limiting both upscaling and total pixels.
    const scale = Math.min(
      4,
      2200 / sourceWidth,
      Math.sqrt(2_400_000 / (sourceWidth * sourceHeight)),
    );
    const crop = document.createElement("canvas");
    crop.width = Math.max(1, Math.round(sourceWidth * scale));
    crop.height = Math.round(sourceHeight * scale);
    try {
      crop.getContext("2d").drawImage(bitmap, left, top, sourceWidth, sourceHeight, 0, 0, crop.width, crop.height);
    } finally {
      bitmap.close?.();
    }
    return crop;
  }

  async function makeAlcoholDetailCrop(file, blocks, processedWidth, processedHeight) {
    const lines = (blocks || []).flatMap((block) => (block.paragraphs || []).flatMap((paragraph) => paragraph.lines || []));
    const candidates = lines.map((line) => {
      const words = line.words || [];
      const text = line.text || words.map((word) => word.text || "").join(" ");
      const box = line.bbox || mergeWordBoxes(words);
      if (!box) return null;
      const hasPercent = /[0-9OIl]{1,2}(?:[.,][0-9OIl]{1,2})?\s*%/.test(text);
      const hasAlcoholCue = /\b(?:alc(?:ohol)?|vol(?:ume)?|abv)\b/i.test(text);
      return hasPercent && hasAlcoholCue ? { box, score: 3 }
        : hasPercent ? { box, score: 2 }
          : hasAlcoholCue ? { box, score: 1 } : null;
    }).filter(Boolean).sort((a, b) => b.score - a.score);
    if (!candidates.length) return null;

    const target = candidates[0].box;
    const lineHeight = Math.max(1, target.y1 - target.y0);
    const bitmap = await createImageBitmap(file);
    const factorX = bitmap.width / processedWidth;
    const factorY = bitmap.height / processedHeight;
    const padX = Math.max(lineHeight * 7, (target.x1 - target.x0) * 0.6, processedWidth * 0.04);
    const padY = Math.max(lineHeight * 3.5, processedHeight * 0.012);
    const left = Math.max(0, Math.floor(target.x0 * factorX - padX * factorX));
    const top = Math.max(0, Math.floor(target.y0 * factorY - padY * factorY));
    const right = Math.min(bitmap.width, Math.ceil(target.x1 * factorX + padX * factorX));
    const bottom = Math.min(bitmap.height, Math.ceil(target.y1 * factorY + padY * factorY));
    const sourceWidth = right - left;
    const sourceHeight = bottom - top;
    if (sourceWidth <= 0 || sourceHeight <= 0) {
      bitmap.close?.();
      return null;
    }
    const targetWidth = Math.min(4200, Math.max(sourceWidth * 2, 2200));
    const scale = targetWidth / sourceWidth;
    const crop = document.createElement("canvas");
    crop.width = targetWidth;
    crop.height = Math.round(sourceHeight * scale);
    try {
      crop.getContext("2d").drawImage(bitmap, left, top, sourceWidth, sourceHeight, 0, 0, crop.width, crop.height);
    } finally {
      bitmap.close?.();
    }
    return crop;
  }

  async function makeAlcoholSearchCrop(file) {
    const image = await createImageBitmap(file);
    const region = { left: 0.12, top: 0.4, width: 0.76 };
    try {
      const sourceLeft = Math.round(image.width * region.left);
      const sourceTop = Math.round(image.height * region.top);
      const sourceWidth = Math.round(image.width * region.width);
      const sourceHeight = image.height - sourceTop;
      const scale = Math.min(2.5, 3000 / sourceWidth, 3600 / sourceHeight);
      const crop = document.createElement("canvas");
      crop.width = Math.max(1, Math.round(sourceWidth * scale));
      crop.height = Math.max(1, Math.round(sourceHeight * scale));
      const context = crop.getContext("2d", { willReadFrequently: true });
      context.drawImage(image, sourceLeft, sourceTop, sourceWidth, sourceHeight, 0, 0, crop.width, crop.height);

      // Normalize this alcohol-area crop independently so small lettering is
      // not washed out by the darker parts of the full bottle photo.
      const pixels = context.getImageData(0, 0, crop.width, crop.height);
      const histogram = new Uint32Array(256);
      for (let i = 0; i < pixels.data.length; i += 4) {
        if (i > 0 && i % 1_048_576 === 0) await yieldToBrowser();
        const gray = Math.round(0.299 * pixels.data[i] + 0.587 * pixels.data[i + 1] + 0.114 * pixels.data[i + 2]);
        pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = gray;
        histogram[gray] += 1;
      }
      const pixelCount = crop.width * crop.height;
      let low = 0;
      let high = 255;
      let cumulative = 0;
      for (let value = 0; value < 256; value += 1) {
        cumulative += histogram[value];
        if (cumulative >= pixelCount * 0.04) { low = value; break; }
      }
      cumulative = 0;
      for (let value = 255; value >= 0; value -= 1) {
        cumulative += histogram[value];
        if (cumulative >= pixelCount * 0.04) { high = value; break; }
      }
      const range = Math.max(1, high - low);
      for (let i = 0; i < pixels.data.length; i += 4) {
        if (i > 0 && i % 1_048_576 === 0) await yieldToBrowser();
        const value = Math.max(0, Math.min(255, ((pixels.data[i] - low) / range) * 255));
        pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = value;
      }
      context.putImageData(pixels, 0, 0);
      return crop;
    } finally {
      image.close?.();
    }
  }

  async function makeEnlargedBottomRegion(file) {
    const image = await createImageBitmap(file);
    const top = Math.round(image.height * 0.48);
    const sourceHeight = image.height - top;
    const targetWidth = Math.min(4800, Math.max(image.width, 3600));
    const scale = targetWidth / image.width;
    const crop = document.createElement("canvas");
    crop.width = targetWidth;
    crop.height = Math.round(sourceHeight * scale);
    try {
      crop.getContext("2d").drawImage(image, 0, top, image.width, sourceHeight, 0, 0, crop.width, crop.height);
    } finally {
      image.close?.();
    }
    return crop;
  }

  function estimateTextSkew(blocks) {
    const angles = [];
    const lines = (blocks || []).flatMap((block) => (block.paragraphs || []).flatMap((paragraph) => paragraph.lines || []));
    for (const line of lines) {
      const words = (line.words || []).filter((word) => word.bbox && (word.confidence ?? 0) >= 35)
        .map((word) => ({ x: (word.bbox.x0 + word.bbox.x1) / 2, y: word.bbox.y1 }))
        .sort((a, b) => a.x - b.x);
      if (words.length < 3 || words.at(-1).x - words[0].x < 80) continue;
      const meanX = words.reduce((sum, word) => sum + word.x, 0) / words.length;
      const meanY = words.reduce((sum, word) => sum + word.y, 0) / words.length;
      const numerator = words.reduce((sum, word) => sum + (word.x - meanX) * (word.y - meanY), 0);
      const denominator = words.reduce((sum, word) => sum + (word.x - meanX) ** 2, 0);
      if (!denominator) continue;
      const angle = Math.atan(numerator / denominator) * 180 / Math.PI;
      if (Math.abs(angle) <= 35) angles.push(angle);
    }
    if (angles.length < 2) return null;
    return median(angles);
  }

  function rotateCanvas(image, degrees) {
    const radians = degrees * Math.PI / 180;
    const width = Math.ceil(Math.abs(image.width * Math.cos(radians)) + Math.abs(image.height * Math.sin(radians)));
    const height = Math.ceil(Math.abs(image.height * Math.cos(radians)) + Math.abs(image.width * Math.sin(radians)));
    const rotated = document.createElement("canvas");
    rotated.width = width;
    rotated.height = height;
    const context = rotated.getContext("2d", { willReadFrequently: true });
    context.fillStyle = "white";
    context.fillRect(0, 0, width, height);
    context.translate(width / 2, height / 2);
    context.rotate(radians);
    context.drawImage(image, -image.width / 2, -image.height / 2);
    return rotated;
  }

  function keyEvidenceCount(text, application) {
    let count = 0;
    if (brandCandidates(application.brand, application.classType).some((candidate) => matchesExpectedPhrase(text, candidate.text))) count += 1;
    if (application.classType && matchesExpectedPhrase(text, application.classType)) count += 1;
    if (application.abv && confirmsAbv(text, application.abv)) count += 1;
    return count;
  }

  function hasCoreFieldEvidence(scans, application) {
    const required = [
      "Brand name",
      "Class / type",
      "Alcohol content",
      "Alcohol statement wording",
      "Warning heading",
      "Warning wording",
    ];
    if (application.proof) required.push("Proof");
    if (application.netContents) required.push("Net contents");
    const checks = scans.map((scan) => checksForScan(scan, application));
    const fieldsFound = required.every((label) => checks.some((items) => items.some((check) =>
      check.label === label && check.state === "pass")));
    if (!fieldsFound) return false;
    if (application.proof && !scans.some((scan) => hasExpectedAlcoholAndProof(scan.text, application)
      && hasDistinctProofPresentation(scan.text, application))) return false;
    return true;
  }

  function hasBatchCoreFieldEvidence(previousScans, currentScans, application) {
    return hasCoreFieldEvidence([...previousScans, ...currentScans], application);
  }

  function hasBatchLabelDetailsEvidence(previousScans, currentScans, application) {
    const scans = [...previousScans, ...currentScans];
    const required = ["Brand name", "Class / type", "Alcohol content", "Alcohol statement wording"];
    if (application.proof) required.push("Proof");
    if (application.netContents) required.push("Net contents");
    const checks = scans.map((scan) => checksForScan(scan, application));
    if (!required.every((label) => checks.some((items) => items.some((check) =>
      check.label === label && check.state === "pass")))) return false;
    return !application.proof || scans.some((scan) => hasExpectedAlcoholAndProof(scan.text, application)
      && hasDistinctProofPresentation(scan.text, application));
  }

  function hasWarningTextEvidence(scans, application) {
    return ["Warning heading", "Warning wording"].every((label) => scans.some((scan) =>
      checksForScan(scan, application).some((check) => check.label === label && check.state === "pass")));
  }

  function isAlcoholEvidenceMissing(scans, application) {
    return (application.abv && !scans.some((scan) => confirmsAbv(scan.text, application.abv)))
      || (application.proof && !scans.some((scan) => confirmsProof(scan.text, application.proof)));
  }

  function estimateTextCurvature(blocks, imageWidth, imageHeight) {
    const curveEstimates = [];
    const lines = blocks.flatMap((block) => (block.paragraphs || []).flatMap((paragraph) => paragraph.lines || []));
    lines.forEach((line) => {
      const words = (line.words || [])
        .filter((word) => word.text?.trim() && (word.confidence ?? 0) >= 35 && word.bbox)
        .map((word) => ({ x: (word.bbox.x0 + word.bbox.x1) / 2 / imageWidth, y: word.bbox.y1, confidence: word.confidence }))
        .sort((a, b) => a.x - b.x);
      if (words.length < 3 || words.at(-1).x - words[0].x < 0.2) return;
      const first = words[0];
      const last = words.at(-1);
      const lineEstimates = [];
      words.slice(1, -1).forEach((word) => {
        const t = (word.x - first.x) / (last.x - first.x);
        if (t < 0.16 || t > 0.84) return;
        const straightBaseline = first.y + (last.y - first.y) * t;
        const factor = (word.x - first.x) * (word.x - last.x);
        if (Math.abs(factor) < 0.002) return;
        lineEstimates.push((word.y - straightBaseline) / factor);
      });
      if (lineEstimates.length) {
        lineEstimates.sort((a, b) => a - b);
        curveEstimates.push(lineEstimates[Math.floor(lineEstimates.length / 2)]);
      }
    });
    if (curveEstimates.length < 3) return null;
    curveEstimates.sort((a, b) => a - b);
    const curvature = curveEstimates[Math.floor(curveEstimates.length / 2)];
    const centerBend = Math.abs(curvature) / 4;
    return centerBend >= 7 && centerBend <= imageHeight * 0.06 ? curvature : null;
  }

  async function flattenCurvedPhoto(image, curvature) {
    const sourceContext = image.getContext("2d", { willReadFrequently: true });
    const source = sourceContext.getImageData(0, 0, image.width, image.height);
    const flattened = document.createElement("canvas");
    flattened.width = image.width;
    flattened.height = image.height;
    const context = flattened.getContext("2d", { willReadFrequently: true });
    const output = context.createImageData(image.width, image.height);
    output.data.fill(255);
    for (let x = 0; x < image.width; x += 1) {
      if (x > 0 && x % 24 === 0) await yieldToBrowser();
      const u = x / Math.max(1, image.width - 1);
      const sourceOffset = Math.round(-curvature * u * (1 - u));
      for (let y = 0; y < image.height; y += 1) {
        const sourceY = y + sourceOffset;
        if (sourceY < 0 || sourceY >= image.height) continue;
        const sourceIndex = (sourceY * image.width + x) * 4;
        const outputIndex = (y * image.width + x) * 4;
        output.data[outputIndex] = source.data[sourceIndex];
        output.data[outputIndex + 1] = source.data[sourceIndex + 1];
        output.data[outputIndex + 2] = source.data[sourceIndex + 2];
        output.data[outputIndex + 3] = source.data[sourceIndex + 3];
      }
    }
    context.putImageData(output, 0, 0);
    return flattened;
  }

  async function preparePhoto(file) {
    const bitmap = await createImageBitmap(file);
    const maxSide = Math.max(bitmap.width, bitmap.height);
    // Upscaling a small full photo adds work but no source detail. Keep the
    // overview at native resolution and enlarge only focused text crops later.
    const scale = maxSide < 900 ? 1
      : maxSide < 2000 ? Math.min(1.5, 2000 / maxSide)
        : Math.min(1, 3200 / maxSide);
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const original = document.createElement("canvas");
    original.width = width;
    original.height = height;
    original.getContext("2d", { willReadFrequently: true }).drawImage(bitmap, 0, 0, width, height);
    bitmap.close?.();

    // Grayscale and stretch contrast between the 2nd and 98th luminance percentiles.
    const enhanced = document.createElement("canvas");
    enhanced.width = width;
    enhanced.height = height;
    const context = enhanced.getContext("2d", { willReadFrequently: true });
    context.drawImage(original, 0, 0);
    const pixels = context.getImageData(0, 0, width, height);
    const histogram = new Uint32Array(256);
    for (let i = 0; i < pixels.data.length; i += 4) {
      if (i > 0 && i % 1_048_576 === 0) await yieldToBrowser();
      const gray = Math.round(0.299 * pixels.data[i] + 0.587 * pixels.data[i + 1] + 0.114 * pixels.data[i + 2]);
      pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = gray;
      histogram[gray] += 1;
    }
    const pixelCount = width * height;
    let cumulative = 0;
    let low = 0;
    let high = 255;
    for (let value = 0; value < 256; value += 1) {
      cumulative += histogram[value];
      if (cumulative >= pixelCount * 0.02) { low = value; break; }
    }
    cumulative = 0;
    for (let value = 255; value >= 0; value -= 1) {
      cumulative += histogram[value];
      if (cumulative >= pixelCount * 0.02) { high = value; break; }
    }
    const range = Math.max(1, high - low);
    for (let i = 0; i < pixels.data.length; i += 4) {
      if (i > 0 && i % 1_048_576 === 0) await yieldToBrowser();
      const adjusted = Math.max(0, Math.min(255, ((pixels.data[i] - low) / range) * 255));
      pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = adjusted;
    }
    context.putImageData(pixels, 0, 0);
    return { original, enhanced };
  }

  function yieldToBrowser() {
    return new Promise((resolve) => window.setTimeout(resolve, 0));
  }

  function makeOverlappingTiles(image) {
    const tileWidth = Math.round(image.width * 0.6);
    const tileHeight = Math.round(image.height * 0.42);
    const lefts = [0, image.width - tileWidth];
    const tops = [0, Math.round((image.height - tileHeight) / 2), image.height - tileHeight];
    const tiles = [];
    for (const top of tops) {
      for (const left of lefts) {
        const maxSide = Math.max(tileWidth, tileHeight);
        // Small uploads like phone screenshots need larger OCR glyphs. This
        // does not invent detail, but gives Tesseract a better input scale.
        const scale = maxSide < 1800 ? Math.min(3, 2200 / maxSide) : Math.min(1, 3600 / maxSide);
        const tile = document.createElement("canvas");
        tile.width = Math.max(1, Math.round(tileWidth * scale));
        tile.height = Math.max(1, Math.round(tileHeight * scale));
        const context = tile.getContext("2d");
        context.imageSmoothingEnabled = true;
        context.imageSmoothingQuality = "high";
        context.drawImage(image, left, top, tileWidth, tileHeight, 0, 0, tile.width, tile.height);
        tiles.push(tile);
      }
    }
    return tiles;
  }

  function scanScore(scan, application) {
    let evidence = 0;
    [application.classType].filter(Boolean).forEach((expected) => {
      if (matchesExpectedPhrase(scan.text, expected)) evidence += 12;
    });
    if (brandCandidates(application.brand, application.classType).some((candidate) => matchesExpectedPhrase(scan.text, candidate.text))) evidence += 12;
    if (/government\s+warning/i.test(scan.text)) evidence += 12;
    return scan.confidence + evidence;
  }

  function compareScans(scans, application) {
    const allChecks = scans.map((scan) => checksForScan(scan, application));
    const labels = allChecks[0].map((check) => check.label);
    return labels.map((label, index) => {
      if (label === "Warning format") {
        const formatEvidence = scans
          .filter((scan) => scan.warningFormat)
          .sort((a, b) => b.confidence - a.confidence)[0]?.warningFormat;
        return formatEvidence || {
          label,
          state: "issue",
          value: "Could not locate the warning block clearly enough for automated layout checks — submit a sharper photo",
        };
      }
      const candidates = allChecks.map((checks) => checks[index]);
      // OCR confidence is averaged over the entire crop. A small, exact read
      // can be useful even when the rest of that crop is blank or noisy.
      const directMatch = scans
        .map((scan, scanIndex) => ({ scan, check: candidates[scanIndex] }))
        .find(({ scan, check }) => check.state === "pass"
          && (scan.confidence >= 55 || check.label !== "Warning wording"));
      if (directMatch) return directMatch.check;
      const readableCandidates = scans
        .map((scan, scanIndex) => ({ scan, check: candidates[scanIndex] }))
        .filter(({ scan }) => scan.confidence >= 55);
      // A clear match from any independent pass is useful evidence; otherwise
      // keep the most cautious result so a partial tile cannot hide a flag.
      return readableCandidates.find(({ check }) => check.state === "review")?.check
        || (readableCandidates[0]?.check || { label, state: "review", value: "OCR confidence was too low to assess this text — verify on artwork" });
    });
  }

  function checksForScan(scan, application) {
    const cached = scanChecksCache.get(scan);
    if (cached?.application === application) return cached.checks;
    const checks = compareText(scan.text, application);
    scanChecksCache.set(scan, { application, checks });
    return checks;
  }

  function combinePhotoChecks(records, application) {
    const checksByPhoto = records.map(({ scans }) => compareScans(scans, application));
    const labels = checksByPhoto[0].map((check) => check.label);
    return labels.map((label, index) => {
      if (label === "Proof placement & distinction") return assessProofPresentation(records, application);
      const checks = checksByPhoto.map((photoChecks) => photoChecks[index]);
      const passed = checks.find((check) => check.state === "pass");
      if (passed) return { ...passed, value: `Confirmed in at least one photo · ${passed.value}` };

      const explicitIssue = checks.find((check) => check.state === "issue" && !/not found|not detected/i.test(check.value));
      if (explicitIssue) return explicitIssue;
      if (checks.some((check) => check.state === "review") || checks.some((check) => /not found|not detected/i.test(check.value))) {
        return { label, state: "review", value: "Not confirmed across the submitted photos — verify the label manually" };
      }
      return checks[0];
    });
  }

  function mergeWordBoxes(words) {
    const boxes = words.map((word) => word.bbox).filter((box) => box && Number.isFinite(box.x0) && Number.isFinite(box.x1));
    if (!boxes.length) return null;
    return {
      x0: Math.min(...boxes.map((box) => box.x0)),
      y0: Math.min(...boxes.map((box) => box.y0)),
      x1: Math.max(...boxes.map((box) => box.x1)),
      y1: Math.max(...boxes.map((box) => box.y1)),
    };
  }

  function analyzeWarningFormat(blocks, image, recognizedText) {
    const paragraphs = (blocks || []).flatMap((block) => (block.paragraphs || []).map((paragraph) => {
      const lines = (paragraph.lines || []).map((line) => {
        const words = line.words || [];
        return { line, words, text: line.text || words.map((word) => word.text || "").join(" ") };
      }).filter(({ text }) => text.trim());
      return { lines, text: lines.map(({ text }) => text).join(" ") };
    }));
    const candidates = paragraphs.filter(({ text }) =>
      /government\s+warning/i.test(text) && /surgeon\s+general/i.test(text)
      && /operate\s+machinery/i.test(text));
    if (!candidates.length) return {
      label: "Warning format",
      state: "issue",
      value: "Could not isolate the complete warning paragraph for automatic layout checks — submit a sharper photo",
    };

    const target = candidates.sort((a, b) => warningTextScore(b.text) - warningTextScore(a.text))[0];
    const headingLineIndex = target.lines.findIndex(({ text }) => /government\s+warning/i.test(text));
    const headingLine = target.lines[headingLineIndex];
    const headingText = headingLine?.text.match(/government\s+warning/i)?.[0] || "";
    const uppercaseHeading = headingText === "GOVERNMENT WARNING";
    const allWarningWords = comparable(target.text);
    const expectedWords = new Set(comparable(STANDARD_WARNING).split(" ").filter(Boolean));
    const extras = allWarningWords.split(" ").filter((word) => !expectedWords.has(word));
    const isolatedParagraph = extras.length <= 3;
    const continuousParagraph = target.lines.length > 0 && target.lines.every(({ line }, index) => {
      if (!index) return true;
      const previous = target.lines[index - 1].line.bbox;
      const current = line.bbox;
      if (!previous || !current) return true;
      const lineHeight = Math.max(1, previous.y1 - previous.y0);
      return current.y0 - previous.y1 <= lineHeight * 2.2;
    });

    const headingWords = headingLine?.words.filter((word) => /^(government|warning)[,:]?$/i.test(word.text || "")) || [];
    const headingBox = mergeWordBoxes(headingWords);
    const headingInk = measureInkDensity(image, headingBox);
    const bodyInks = target.lines.slice(headingLineIndex).map(({ words }, offset) => {
      const bodyWords = offset === 0
        ? words.filter((word) => !/^(government|warning)[,:]?$/i.test(word.text || ""))
        : words;
      return measureInkDensity(image, mergeWordBoxes(bodyWords));
    }).filter(Boolean);
    const bodyDensity = median(bodyInks.map((reading) => reading.density));
    const bodyContrast = median(bodyInks.map((reading) => reading.contrast));
    const boldHeading = Boolean(headingInk && bodyInks.length && headingInk.contrast >= 45 && bodyContrast >= 45
      && headingInk.density >= bodyDensity * 1.06);
    const visibleContrast = Boolean(headingInk && bodyInks.length && headingInk.contrast >= 45 && bodyContrast >= 45);

    const failures = [];
    if (!uppercaseHeading) failures.push("uppercase heading");
    if (!continuousParagraph) failures.push("continuous paragraph layout");
    if (!isolatedParagraph) failures.push("separation from nearby text");
    if (!boldHeading) failures.push("bold heading versus regular body text");
    if (!visibleContrast) failures.push("text/background contrast");
    return {
      label: "Warning format",
      state: failures.length ? "issue" : "pass",
      value: failures.length
        ? `Image checks could not confirm ${failures.join(", ")} — try a sharper, straight-on photo`
        : "Image checks detected an isolated paragraph, uppercase heavier heading, regular body text, and readable contrast; physical type size cannot be measured without photo scale",
    };
  }

  function measureInkDensity(canvas, box) {
    if (!canvas || !box) return null;
    const x0 = Math.max(0, Math.floor(box.x0));
    const y0 = Math.max(0, Math.floor(box.y0));
    const x1 = Math.min(canvas.width, Math.ceil(box.x1));
    const y1 = Math.min(canvas.height, Math.ceil(box.y1));
    if (x1 <= x0 || y1 <= y0) return null;
    const pixels = canvas.getContext("2d", { willReadFrequently: true }).getImageData(x0, y0, x1 - x0, y1 - y0).data;
    const histogram = new Uint32Array(256);
    for (let i = 0; i < pixels.length; i += 4) {
      const gray = Math.round((pixels[i] + pixels[i + 1] + pixels[i + 2]) / 3);
      histogram[gray] += 1;
    }
    const count = pixels.length / 4;
    const percentile = (fraction) => {
      const target = count * fraction;
      let sum = 0;
      for (let value = 0; value < 256; value += 1) {
        sum += histogram[value];
        if (sum >= target) return value;
      }
      return 255;
    };
    const low = percentile(0.1);
    const high = percentile(0.9);
    const threshold = (low + high) / 2;
    let darker = 0;
    for (let value = 0; value < threshold; value += 1) darker += histogram[value];
    const density = Math.min(darker, count - darker) / count;
    return { density, contrast: high - low };
  }

  function warningTextScore(text) {
    return ( /government\s+warning/i.test(text) ? 4 : 0)
      + (/surgeon\s+general/i.test(text) ? 3 : 0)
      + (/birth\s+defects/i.test(text) ? 2 : 0)
      + (/operate\s+machinery/i.test(text) ? 2 : 0)
      + (/health\s+problems/i.test(text) ? 1 : 0);
  }

  function median(values) {
    const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
    if (!sorted.length) return 0;
    return sorted[Math.floor(sorted.length / 2)];
  }

  function assessProofPresentation(records, application) {
    const pairedEvidence = records.flatMap(({ file, scans }) => scans
      .filter((scan) => hasExpectedAlcoholAndProof(scan.text, application))
      .map((scan) => ({ file, scan })));
    const distinguished = pairedEvidence.find(({ scan }) => hasDistinctProofPresentation(scan.text, application));
    if (distinguished) {
      return {
        label: "Proof placement & distinction",
        state: "pass",
        value: `ABV and proof detected together in “${distinguished.file.name}”; proof is explicitly labeled or bracketed`,
      };
    }
    if (pairedEvidence.length) {
      return {
        label: "Proof placement & distinction",
        state: "issue",
        value: "ABV and proof were found together, but a clear PROOF label or bracket distinction was not detected",
      };
    }
    return {
      label: "Proof placement & distinction",
      state: "issue",
      value: "Could not detect ABV and proof together in one photo view — add a clear, close photo showing both",
    };
  }

  function compareText(text, application) {
    const flat = comparable(text);
    const results = [];
    const matching = (label, expected, matchedText, acceptedValues = [{ text: expected, isTypeSuffix: false }]) => {
      if (!expected.trim()) return;
      const found = acceptedValues.find((candidate) => comparable(candidate.text)
        && (flat.includes(comparable(candidate.text)) || matchesExpectedPhrase(text, candidate.text)));
      // OCR may insert one character into a long class line (for example
      // “STRAIGHT” -> “STRIAIGHT”). Accept only a near-exact full-field match;
      // fuzzy matching is deliberately limited to class/type to avoid making
      // short numeric fields or warning wording pass on weak evidence.
      const approximate = !found && label === "Class / type"
        ? findNearExactMatch(flat, comparable(expected)) : null;
      const isFound = Boolean(found || approximate);
      const value = found?.isTypeSuffix
        ? `Found “${found.text}”; “${application.classType}” is treated as the class/type suffix in the application brand`
        : found ? `Found “${found.text}”`
          : approximate ? `Found a near-exact OCR match for “${expected}”`
            : `Expected “${expected}” — ${matchedText ? `read “${matchedText.trim().slice(0, 80)}”` : "not found"}`;
      results.push({ label, state: isFound ? "pass" : "issue", value });
    };
    matching("Brand name", application.brand, findNear(text, application.brand), brandCandidates(application.brand, application.classType));
    matching("Class / type", application.classType, findNear(text, application.classType));
    const abvValue = numericAbv(application.abv);
    const abvCandidates = extractAbvCandidates(text);
    const matchingAbv = abvCandidates.find((candidate) => candidate.value === abvValue && candidate.hasAlcoholContext)
      || (abvCandidates.length === 1 && abvCandidates[0].value === abvValue ? abvCandidates[0] : null);
    const contextualAbv = abvCandidates.find((candidate) => candidate.hasAlcoholContext);
    const likelyAbv = contextualAbv || (abvCandidates.length === 1 ? abvCandidates[0] : null);
    if (Number.isFinite(abvValue) && matchingAbv) {
      results.push({ label: "Alcohol content", state: "pass", value: `Found ${matchingAbv.raw} (${matchingAbv.value}% by volume)` });
    } else if (Number.isFinite(abvValue) && likelyAbv) {
      results.push({ label: "Alcohol content", state: "issue", value: `Application says ${application.abv}% ABV · label reads ${likelyAbv.raw}` });
    } else {
      results.push({ label: "Alcohol content", state: "review", value: "Could not confidently read ABV — verify on artwork" });
    }
    if (application.abv) {
      const alcoholWording = hasStandardAlcoholWording(text);
      const usesAbvAbbreviation = /\b[0-9OIl]{1,2}(?:[.,][0-9OIl]{1,2})?\s*%\s*ABV\b/i.test(text);
      results.push({
        label: "Alcohol statement wording",
        state: alcoholWording ? "pass" : usesAbvAbbreviation ? "issue" : "review",
        value: alcoholWording
          ? "Recognized alcohol-by-volume wording"
          : usesAbvAbbreviation
            ? "TTB does not allow “ABV” as the mandatory label statement abbreviation"
            : "Could not confirm alcohol-by-volume statement wording — verify on artwork",
      });
    }
    if (application.proof) {
      const proofValue = numericProof(application.proof);
      const proofCandidates = extractProofCandidates(text);
      const matchingProof = proofCandidates.find((candidate) => candidate.value === proofValue);
      const likelyProof = proofCandidates[0];
      if (Number.isFinite(proofValue) && matchingProof) {
        results.push({ label: "Proof", state: "pass", value: `Found ${matchingProof.raw}` });
      } else if (Number.isFinite(proofValue) && likelyProof) {
        results.push({ label: "Proof", state: "issue", value: `Application says ${application.proof} proof · label reads ${likelyProof.raw}` });
      } else {
        results.push({ label: "Proof", state: "review", value: "Could not confidently read proof — verify on artwork" });
      }
      results.push({
        label: "Proof placement & distinction",
        state: "issue",
        value: "Could not detect ABV and proof together in one photo view — add a clear, close photo showing both",
      });
    }
    if (application.netContents.trim()) {
      const needle = comparable(application.netContents);
      const found = needle && flat.includes(needle);
      results.push({ label: "Net contents", state: found ? "pass" : "review", value: found ? `Found “${application.netContents}”` : `Could not confirm “${application.netContents}” — verify on artwork` });
    }
    const headingMatch = text.match(/government\s+warning\b/i);
    const warningStart = headingMatch ? headingMatch.index : text.search(/surgeon\s+general|birth\s+defects/i);
    const warningText = warningStart >= 0 ? text.slice(warningStart) : "";
    if (warningStart < 0) {
      results.push({ label: "Warning heading", state: "issue", value: "GOVERNMENT WARNING was not detected" });
      results.push({ label: "Warning wording", state: "issue", value: "The required TTB statement was not detected" });
    } else {
      const heading = warningText.match(/^government\s+warning\b/i)?.[0] || "";
      const headingIsUppercase = heading === "GOVERNMENT WARNING";
      const hasHeadingColon = /^government\s+warning\s*:/i.test(warningText);
      const warningBody = heading
        ? warningText.replace(/^government\s+warning\b\s*:?\s*/i, "")
        : warningText;
      results.push({
        label: "Warning heading",
        state: headingIsUppercase && hasHeadingColon ? "pass" : "issue",
        value: headingIsUppercase && hasHeadingColon
          ? "GOVERNMENT WARNING is uppercase and followed by a colon"
          : !heading ? "The GOVERNMENT WARNING heading was not confidently detected"
            : !headingIsUppercase ? "The heading must read GOVERNMENT WARNING in uppercase" : "A colon must follow GOVERNMENT WARNING",
      });
      const hasExactWarning = warningTextMatches(warningBody, STANDARD_WARNING_BODY);
      results.push({
        label: "Warning wording",
        state: hasExactWarning ? "pass" : "issue",
        value: hasExactWarning ? "Required warning wording recognized" : "The warning wording could not be matched to the TTB statement",
      });
    }
    results.push({
      label: "Warning format",
      state: "issue",
      value: "Warning layout could not be assessed from text alone",
    });
    return results;
  }

  function brandCandidates(brand, classType) {
    const original = String(brand || "").trim();
    const type = String(classType || "").trim();
    const candidates = original ? [{ text: original, isTypeSuffix: false }] : [];
    const normalizedBrand = comparable(original);
    const normalizedType = comparable(type);
    if (!normalizedType || normalizedBrand.length <= normalizedType.length || !normalizedBrand.endsWith(normalizedType)) return candidates;

    const shortened = original.slice(0, original.length - type.length).replace(/[\s,.-]+$/g, "").trim();
    if (shortened && comparable(shortened) !== normalizedBrand) candidates.push({ text: shortened, isTypeSuffix: true });
    return candidates;
  }

  function extractAbvCandidates(text) {
    const candidates = [];
    const percentPattern = /\b([0-9OIl]{1,2}(?:[.,][0-9OIl]{1,2})?)\s*(?:%|percent\b)/gi;
    let match;
    while ((match = percentPattern.exec(text)) !== null) {
      const context = text.slice(Math.max(0, match.index - 32), Math.min(text.length, percentPattern.lastIndex + 32));
      const normalizedNumber = match[1].replace(/[oO]/g, "0").replace(/[iIl]/g, "1").replace(",", ".");
      candidates.push({
        value: Number(normalizedNumber),
        raw: match[0],
        hasAlcoholContext: /\b(?:alc(?:ohol)?\.?|abv|vol(?:ume)?\.?|proof)\b/i.test(context),
      });
    }
    return candidates;
  }

  function hasStandardAlcoholWording(text) {
    const number = "[0-9OIl]{1,2}(?:[.,][0-9OIl]{1,2})?";
    const patterns = [
      new RegExp(`\\balcohol\\s*${number}\\s*%?\\s*by\\s+volume\\b`, "i"),
      new RegExp(`\\b${number}\\s*%\\s*alc\\.?\\s*by\\s+vol(?:ume)?\\.?`, "i"),
      new RegExp(`\\balc\\.?\\s*${number}\\s*%\\s*(?:by\\s*)?vol(?:ume)?\\.?`, "i"),
      new RegExp(`\\b${number}\\s*%\\s*alc\\.?\\s*(?:by\\s*)?(?:\\/\\s*)?[vnu][o0]l(?:ume)?\\.?`, "i"),
    ];
    return patterns.some((pattern) => pattern.test(text));
  }

  function confirmsAbv(text, expected) {
    const candidates = extractAbvCandidates(text);
    const value = numericAbv(expected);
    return candidates.some((candidate) => candidate.value === value && (candidate.hasAlcoholContext || candidates.length === 1));
  }

  function numericAbv(value) {
    return Number(String(value).replace(/[^\d.,]/g, "").replace(",", "."));
  }

  function extractProofCandidates(text) {
    const candidates = [];
    const number = "[0-9OIl]{1,3}(?:[.,][0-9OIl]{1,2})?";
    // Accept case variants and common OCR substitutions, including F read as K or L.
    const proofWord = "p\\s*r\\s*[o0]\\s*[o0]\\s*[fkl]";
    const pattern = new RegExp(`\\b(${number})\\s*(?:°\\s*)?${proofWord}\\b|\\b${proofWord}\\s*[:\\-]?\\s*(${number})\\b`, "gi");
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const rawNumber = match[1] || match[2];
      const normalizedNumber = rawNumber.replace(/[oO]/g, "0").replace(/[iIl]/g, "1").replace(",", ".");
      candidates.push({ value: Number(normalizedNumber), raw: match[0] });
    }
    return candidates;
  }

  function hasDistinctProofPresentation(text, application) {
    if (!hasExpectedAlcoholAndProof(text, application)) return false;
    // TTB allows proof to be otherwise distinguished; an explicit PROOF label
    // paired with the separate alcohol-by-volume cue is a conservative text cue.
    return /\bp\s*r\s*[o0]\s*[o0]\s*[fkl]\b/i.test(text) || /[([]\s*[0-9OIl]{1,3}(?:[.,][0-9OIl]{1,2})?\s*(?:°\s*)?[0-9OIl]*\s*[)\]]/.test(text);
  }

  function hasExpectedAlcoholAndProof(text, application) {
    const hasExpectedProof = extractProofCandidates(text).some((candidate) =>
      candidate.value === numericProof(application.proof));
    const hasExpectedAbv = extractAbvCandidates(text).some((candidate) =>
      candidate.value === numericAbv(application.abv) && candidate.hasAlcoholContext);
    return hasExpectedProof && hasExpectedAbv;
  }

  function confirmsProof(text, expected) {
    return extractProofCandidates(text).some((candidate) => candidate.value === numericProof(expected));
  }

  function numericProof(value) {
    return Number(String(value).replace(/[^\d.,]/g, "").replace(",", "."));
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
    if (!message.status) return;
    const text = resultsList.lastElementChild?.querySelector(".progress-text");
    if (!text) return;
    if (message.status === "loading tesseract core") text.textContent = "Loading image reader…";
    else if (message.status === "recognizing text") text.textContent = "Reading label text…";
  }

  function findNear(text, query) {
    if (!query) return "";
    const words = query.split(/\s+/).filter(Boolean);
    const excerpt = text.split(/\n/).find((line) => comparable(line).includes(comparable(words[0] || "")));
    return excerpt || "";
  }
  function comparable(value) { return String(value).toLowerCase().replace(/[^a-z0-9]+/g, ""); }

  function matchesExpectedPhrase(text, expected) {
    const expectedWords = String(expected || "").toLowerCase().match(/[a-z0-9]+/g) || [];
    const actualWords = String(text || "").toLowerCase().match(/[a-z0-9]+/g) || [];
    if (!expectedWords.length || !actualWords.length) return false;
    const available = actualWords.slice();
    return expectedWords.every((word) => {
      const exactIndex = available.indexOf(word);
      if (exactIndex >= 0) {
        available.splice(exactIndex, 1);
        return true;
      }
      const limit = word.length >= 6 ? 1 : 0;
      const approximateIndex = limit ? available.findIndex((candidate) => editDistanceWithin(candidate, word, limit) !== null) : -1;
      if (approximateIndex < 0) return false;
      available.splice(approximateIndex, 1);
      return true;
    });
  }

  function findNearExactMatch(text, expected) {
    if (expected.length < 15) return false;
    const maxDistance = Math.max(1, Math.floor(expected.length * 0.04));
    for (let length = expected.length - maxDistance; length <= expected.length + maxDistance; length += 1) {
      for (let start = 0; start + length <= text.length; start += 1) {
        if (editDistanceWithin(text.slice(start, start + length), expected, maxDistance) !== null) return true;
      }
    }
    return false;
  }

  function warningTextMatches(actual, expected) {
    const found = comparable(actual);
    const target = comparable(expected);
    if (!found || !target) return false;
    if (found.includes(target)) return true;
    const maxEdits = 3;
    const minLength = Math.max(1, target.length - maxEdits);
    const maxLength = Math.min(found.length, target.length + maxEdits);
    for (let length = minLength; length <= maxLength; length += 1) {
      for (let start = 0; start + length <= found.length; start += 1) {
        if (editDistanceWithin(found.slice(start, start + length), target, maxEdits) !== null) return true;
      }
    }
    return false;
  }

  function editDistanceWithin(left, right, limit) {
    if (Math.abs(left.length - right.length) > limit) return null;
    let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
    for (let i = 1; i <= left.length; i += 1) {
      const current = [i];
      let rowMin = i;
      for (let j = 1; j <= right.length; j += 1) {
        current[j] = Math.min(current[j - 1] + 1, previous[j] + 1, previous[j - 1] + (left[i - 1] === right[j - 1] ? 0 : 1));
        rowMin = Math.min(rowMin, current[j]);
      }
      if (rowMin > limit) return null;
      previous = current;
    }
    return previous[right.length] <= limit ? previous[right.length] : null;
  }
  function value(id) { return document.getElementById(id).value.trim(); }
  function formatBytes(bytes) { return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`; }
  function showToast(message) {
    const toast = document.querySelector("#toast");
    toast.textContent = message;
    toast.classList.add("show");
    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => toast.classList.remove("show"), 2800);
  }
  window.labelCheckReady = true;
})();
