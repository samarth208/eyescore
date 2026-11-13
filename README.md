# EyeScore

EyeScore finds the text size and contrast that work for your eyes on your screen, then applies them to the websites you read.

- Website: https://samarth208.github.io/eyescore/
- Chrome extension: https://chromewebstore.google.com/detail/eyescore/nogmmajhdbjmlmfepdlbfodnpmjopona

EyeScore is not an eye exam and does not detect eye conditions.

## How it works

1. **Screen setup.** Matching a card to an on-screen outline gives pixels per millimeter. A blind-spot check estimates viewing distance (after Li et al., 2020, "Virtual Chinrest"), with typed distance as a fallback.
2. **Tests.** Three untimed tests, each driven by an adaptive staircase:
   - **Text size:** a tumbling E that shrinks until it can't be read. Two interleaved staircases give a built-in retest.
   - **Contrast:** the same E fading toward the background, dithered for finer steps than 8-bit gray levels allow.
   - **Color:** four tiles, one differing in chromaticity along the protan, deutan or tritan confusion lines (after the Cambridge Colour Test).
3. **Settings.** Each result is turned into a setting by a published rule:
   - Text x-height at least 2x the smallest readable E (Legge & Bigelow, 2011).
   - Text contrast at least 10x the contrast threshold (Whittaker & Lovie-Kitchin, 1994).
   - Color thresholds compared with reference limits (Hasrod & Rubin, 2019). Color assist uses the Machado et al. (2009) simulation matrices.

The extension applies these settings by zooming pages to the minimum text size (while keeping each site's desktop layout where possible), darkening light-gray text and, if needed, applying color assist.

## Privacy

There is no server, account or analytics. Test results stay in the browser's local storage and in the extension's storage on the user's computer. See [privacy.html](privacy.html).

## Project structure

```
index.html        Home page
app.html          Screen setup, tests and results
privacy.html      Privacy policy
js/
  calib.js        Screen calibration (card match, viewing distance)
  exam.js         Test stimuli and staircases
  rx.js           Rules that turn results into settings
  profile.js      Saving the profile and sending it to the extension
  dalton.js       Color assist math
  util.js         DOM, storage and math helpers
  app.js          Test flow and results page
  landing.js      Home page interactions
  config.js       Deployment settings (site URL, Chrome Web Store link)
css/              Page styles
assets/           Base UI styles and scripts (minified)
fonts/, img/      Bundled fonts and images
```

## Running locally

The site is static and has no build step:

```
python3 -m http.server 8000
```

Then open http://localhost:8000.

## License

Copyright (c) 2026 Samarth Mishra. All rights reserved.
