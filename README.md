# LabelCheck

A lightweight prototype for comparing alcohol label artwork with its application details. It runs in the browser and uses Tesseract.js OCR; selected image files are processed locally and are not uploaded to an application server.

## Run locally

Open `index.html` in a current desktop browser, or serve this folder with any static HTTP server. For example, with Python installed:

```sh
python3 -m http.server 8000
```

Then open <http://localhost:8000>. Text recognition loads Tesseract.js, its WebAssembly engine, and the English model from jsDelivr on first use, so internet access is required for OCR. The browser caches those assets for later use.

Three ready-to-upload example labels are in [`sample-labels/`](sample-labels/): one standard label, one with a warning wording change, and one with a title-case warning heading. For the sample labels, enter brand `OLD TOM DISTILLERY`, class/type `Kentucky Straight Bourbon Whiskey`, ABV `45`, and net contents `750 mL`.

## Use

1. Enter the brand, class/type, and ABV from an application. Net contents are optional. The Government Warning is checked against the TTB standard automatically.
2. Add one or more PNG, JPG, or WEBP label images (up to 20, 15 MB each).
3. Choose **Check label artwork**. OCR reads each image in the browser and checks the recognized text for application details and the health warning.
4. Expand **View recognized text** and verify flags against the original artwork.

## Approach and limitations

- A simple form and batch upload keep the routine review path visible and direct.
- OCR uses Tesseract.js in a browser worker. Images are not sent to a backend. Initial loading can exceed the assignment's five-second target on a slow connection or large image; batch processing is sequential.
- Brand, class/type, and net contents are compared with normalized OCR text. ABV is checked against the first recognizable percentage. The warning is checked against the standard statement in TTB's guidance, including its uppercase heading. OCR ambiguity is surfaced for manual review.
- Text recognition cannot verify bold type, that the warning alone is bold, type size, one-paragraph layout, separation, contrast, or overall regulatory compliance. These presentation checks are explicitly flagged for a human to inspect in the artwork. This OCR-only prototype does not claim to provide AI vision or determine compliance.
- The standard warning statement and link are based on [TTB health warning guidance](https://www.ttb.gov/regulated-commodities/beverage-alcohol/distilled-spirits/ds-labeling-home/ds-health-warning). Requirements vary by beverage type, and this prototype is not an official TTB tool.
- This static prototype does not store application data, connect to COLA, provide accounts, or include a production deployment.
