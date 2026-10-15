# LabelCheck

A lightweight prototype for comparing alcohol label artwork with its application details. It runs in the browser and uses Tesseract.js plus PaddleOCR.js; selected image files are processed locally and are not uploaded to an application server.

**Deployed prototype:** [https://czoeed.github.io/treasurytakehome/](https://czoeed.github.io/treasurytakehome/)

## Run locally

Install the JavaScript dependencies and start the local development server:

```sh
npm install
npm run dev
```

For a static build, run `npm run build` and serve the generated `dist/` folder. Internet access is required for Tesseract.js and the ONNX Runtime WebAssembly files. The PaddleOCR model weights are included in `public/models/` and the photos are processed in the browser.

Example labels are in [`sample-labels/`](sample-labels/), including the Old Tom and Seagram's bottle photos and synthetic warning-format samples. The synthetic Old Tom examples use brand `OLD TOM DISTILLERY`, class/type `Kentucky Straight Bourbon Whiskey`, ABV `45`, and net contents `750 mL`. Use the values visible on the Seagram's application when reviewing those photos.

## Use

1. Choose **Individual review** for one application, or **Batch queue** to work on multiple bottles in one session.
2. For an individual review, enter the brand, class/type, and alcohol content from the application. Proof and net contents are optional. Add one or more photos for that same bottle (up to 20, 15 MB each), then choose **Check label artwork**.
3. In **Batch queue**, enter one bottle's application details and select that bottle's front, back, and/or side photos. Choose **Add to queue**. Scanning starts immediately, and you can enter and queue the next application while it runs. Each queued application keeps its own photo group and checklist; jobs scan in order. Use **Show checks** on a bottle to expand its checklist, or search by application details or photo filename.
4. A preliminary checklist appears as OCR discovers information. The scan combines evidence across photos belonging to the same application. Images remain on the device.
5. Expand **View recognized text** within the checklist to inspect OCR output, and verify flags against the original artwork.

## Approach and limitations

- Individual and batch review modes keep each bottle paired with its own application. Batch jobs are queued and processed sequentially; the queue can be searched, and each checklist is collapsed until requested.
- OCR uses an adaptive sequence: one contrast-adjusted full-photo Tesseract.js scan first, followed by an original-photo scan and one PaddleOCR.js PP-OCRv5 pass only when key details remain unread. When the main label details are readable but the warning is small, it tries the targeted warning crop before loading the second OCR engine. The Tesseract worker warms when the first image is added and remains ready across submissions in the same tab. In a multi-photo batch, earlier evidence can avoid repeated recovery scans on later photos. The perspective, unwrap, and flattened-band scans stop once the submitted fields, warning wording, and proof placement are found; so do the enlarged detail-area scans. Harder images continue to Tesseract deskew/rotation and targeted text crops as needed. Scan timings for initialization, preprocessing, each OCR engine, and each photo are written to the browser console to support performance tuning. PaddleOCR runs in ONNX Runtime Web/WebAssembly and returns positioned text lines, which are read in approximate label order. Geometry steps are heuristics; labels without a clear color boundary, strong curvature, glare, or blur can still defeat OCR. Missing ABV or proof in difficult photos triggers one enlarged lower-label crop, followed by one contrast-normalized crop only if the values are still missing. A focused proof-presentation crop runs only if the combined ABV/proof placement check remains unresolved. Images are not sent to a backend; PaddleOCR and its model are initialized only when a submitted batch needs it.
- Each batch application produces one checklist across that application's submitted photos. A requirement found in any of its photos counts as found; missing text in one view does not create a failure when another view contains it. Conflicting clearly read text still gets flagged, while text not found anywhere is sent for manual review. Photos from different queued applications are never combined.
- If the application brand ends with the separately entered class/type (for example, brand `Seagram's Vodka` and class/type `Vodka`), the brand check also accepts the remaining brand wording (`Seagram's`). The class/type is still checked independently on the label.
- Brand, class/type, and net contents are compared with normalized OCR text. ABV detection recognizes percentages with nearby alcohol/volume cues such as `Alc 40% By Vol.`, `40% Alc/Vol`, and `40% Alcohol by Volume`; ambiguous percentage reads go to review. If proof is entered, the program compares case variants such as `90 proof`, `90 Proof`, and `90 PROOF`, while allowing common OCR confusions inside the word. It also performs a focused, enlarged crop around the alcohol statement when OCR provides a likely location. One combined proof placement and distinction check passes only when a single OCR scan reads the expected ABV and proof together and sees an explicit `PROOF` label or brackets; it cannot give separate, contradictory results for placement and distinction. These image-based checks are heuristics and cannot measure the bottle's physical viewing angle or reliably judge every visual distinction. TTB defines the same field of vision as one side of the container where the information is visible simultaneously without turning it, and for a cylindrical container that side is 40% of the circumference. TTB does not allow “ABV” as the mandatory alcohol-content statement abbreviation, so that form is flagged separately.
- The warning is matched to TTB wording with a small OCR edit tolerance, and the heading is checked for uppercase and colon. The format row uses OCR layout plus pixel-density and contrast estimates to check paragraph grouping, separation from extra text, heading weight relative to body text, and visible contrast. Physical type size in millimeters cannot be measured from an unscaled photo. A targeted, enlarged warning-block scan is attempted when the full-photo OCR does not read the statement clearly.
- Full label photos are expected, including imperfect lighting and framing. The geometry and second-engine passes improve the Old Tom sample's class/type and net-contents reads; the brand and warning can still need a sharper image because the sample is blurred and low resolution. Geometric correction cannot reconstruct details missing from a photo.
- Image-based format checks are estimates: curved labels, glare, lighting, background patterns, and photo scaling can affect them. The app cannot measure physical type size in millimeters from an unscaled image and does not determine regulatory compliance.
- The standard warning statement and link are based on [TTB health warning guidance](https://www.ttb.gov/regulated-commodities/beverage-alcohol/distilled-spirits/ds-labeling-home/ds-health-warning). Requirements vary by beverage type, and this prototype is not an official TTB tool.
- This prototype does not store application data, connect to COLA, or provide accounts. The public GitHub Pages site is a demonstration deployment, not a production service.
