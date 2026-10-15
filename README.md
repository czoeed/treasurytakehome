# LabelCheck

A lightweight prototype for comparing alcohol label artwork with its application details. It runs in the browser and uses Tesseract.js OCR; selected image files are processed locally and are not uploaded to an application server.

## Run locally

Install the JavaScript dependencies and start the local development server:

```sh
npm install
npm run dev
```

For a static build, run `npm run build` and serve the generated `dist/` folder. Internet access is required for Tesseract.js and the ONNX Runtime WebAssembly files. The PaddleOCR model weights are included in `public/models/` and the photos are processed in the browser.

Three ready-to-upload example labels are in [`sample-labels/`](sample-labels/): one standard label, one with a warning wording change, and one with a title-case warning heading. For the sample labels, enter brand `OLD TOM DISTILLERY`, class/type `Kentucky Straight Bourbon Whiskey`, ABV `45`, and net contents `750 mL`.

## Use

1. Enter the brand, class/type, and alcohol content from an application. Proof and net contents are optional. The Government Warning wording is checked against the TTB standard automatically.
2. Add one or more image files supported by the browser (up to 20, 15 MB each). The chooser accepts image formats broadly; the browser must be able to decode the selected format for OCR.
3. Choose **Check label artwork**. The browser runs PaddleOCR.js and Tesseract.js locally, then normalizes image size and contrast, estimates text skew and deskews the photo, tries alternate rotations when the first OCR passes read little, and scans six enlarged, overlapping sections when key text is missing. It also estimates a label quadrilateral from the central label color, applies a projective correction, unwraps a cylindrical view, and scans separate flattened label bands. If the entered ABV or proof is still missing, it scans enlarged, independently contrast-normalized crops from the lower photo area, as well as a focused crop when OCR located the alcohol statement. Images remain on the device.
4. Review the centered checklist, then choose **Back to application** to enter another submission. Expand **View recognized text** and verify flags against the original artwork.

## Approach and limitations

- A simple form and batch upload keep the routine review path visible and direct.
- OCR combines PaddleOCR.js PP-OCRv5 (ONNX Runtime Web/WebAssembly) with Tesseract.js. PaddleOCR checks the original and geometry-corrected views; Tesseract handles the rotated images, curved-line correction, warning layout analysis, and targeted text crops. PaddleOCR returns positioned text lines, which are read in approximate label order before field checks. A geometry pass estimates the label's four corners from its central color, applies a projective transform, unwraps a cylindrical view, and reads separate flattened bands. These geometry steps are heuristics; labels without a clear color boundary, strong curvature, glare, or blur can still defeat OCR. Small source images are enlarged for OCR; this changes glyph scale but cannot restore details absent from the upload. Missing ABV or proof triggers two enlarged lower-label crops with independent contrast normalization, including a narrower central crop, even when the first OCR pass did not find the alcohol statement. If OCR did locate a likely alcohol line, a separate focused crop is also scanned. Alcohol wording and proof detection tolerate observed OCR substitutions, including V read as N and F read as K or L. Exact matches from a detail crop can count even when the crop's overall OCR confidence is low; warning wording still uses the confidence threshold because it allows fuzzy text matching. Images are not sent to a backend. Photo scans and detail passes take longer than a single OCR pass; batch processing is sequential.
- A batch produces one checklist across all submitted photos. A requirement found in any photo counts as found; missing text in one view does not create a failure when another view contains it. Conflicting clearly read text still gets flagged, while text not found anywhere is sent for manual review.
- If the application brand ends with the separately entered class/type (for example, brand `Seagram's Vodka` and class/type `Vodka`), the brand check also accepts the remaining brand wording (`Seagram's`). The class/type is still checked independently on the label.
- Brand, class/type, and net contents are compared with normalized OCR text. ABV detection recognizes percentages with nearby alcohol/volume cues such as `Alc 40% By Vol.`, `40% Alc/Vol`, and `40% Alcohol by Volume`; ambiguous percentage reads go to review. If proof is entered, the program compares case variants such as `90 proof`, `90 Proof`, and `90 PROOF`, while allowing common OCR confusions inside the word. It also performs a focused, enlarged crop around the alcohol statement when OCR provides a likely location. One combined proof placement and distinction check passes only when a single OCR scan reads the expected ABV and proof together and sees an explicit `PROOF` label or brackets; it cannot give separate, contradictory results for placement and distinction. These image-based checks are heuristics and cannot measure the bottle's physical viewing angle or reliably judge every visual distinction. TTB defines the same field of vision as one side of the container where the information is visible simultaneously without turning it, and for a cylindrical container that side is 40% of the circumference. TTB does not allow “ABV” as the mandatory alcohol-content statement abbreviation, so that form is flagged separately.
- The warning is matched to TTB wording with a small OCR edit tolerance, and the heading is checked for uppercase and colon. The format row uses OCR layout plus pixel-density and contrast estimates to check paragraph grouping, separation from extra text, heading weight relative to body text, and visible contrast. Physical type size in millimeters cannot be measured from an unscaled photo. A targeted, enlarged warning-block scan is attempted when the full-photo OCR does not read the statement clearly.
- Full label photos are expected, including imperfect lighting and framing. The geometry and second-engine passes improve the Old Tom sample's class/type and net-contents reads; the brand and warning can still need a sharper image because the sample is blurred and low resolution. Geometric correction cannot reconstruct details missing from a photo.
- Image-based format checks are estimates: curved labels, glare, lighting, background patterns, and photo scaling can affect them. The app cannot measure physical type size in millimeters from an unscaled image and does not determine regulatory compliance.
- The standard warning statement and link are based on [TTB health warning guidance](https://www.ttb.gov/regulated-commodities/beverage-alcohol/distilled-spirits/ds-labeling-home/ds-health-warning). Requirements vary by beverage type, and this prototype is not an official TTB tool.
- This static prototype does not store application data, connect to COLA, provide accounts, or include a production deployment.
