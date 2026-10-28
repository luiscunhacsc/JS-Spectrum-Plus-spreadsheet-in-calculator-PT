# Calculator video guide

The finished video is [Calculator Guide.mp4](../../Screenshots%20and%20Video/Calculator%20Guide.mp4):
5 minutes 11 seconds, 1280 x 720, with English narration, captions, highlighted
mouse/keyboard actions, and 13 seekable chapters. A separate `.srt`, transcript,
and preview image sit beside it.

The recording executes the production HTML and native Z80 Calculator through
the emulator harness. It enters every label, value, and formula through the
real keyboard/mouse handlers and checks the resulting cell contents. No sheet
data or calculated results are injected. The shopping-list example reaches
17, then recalculates to 19.5 after changing a quantity.

To regenerate on Windows, install Node.js and FFmpeg, rebuild `index.html` if
the app has changed, and run from the repository root:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File developer/calculator-guide/narrate.ps1
node developer/calculator-guide/record.cjs
```

Narration uses the installed Microsoft Zira voice, falling back to the default
Windows SAPI voice. `scenes.json` contains the instructions and narration.
Intermediate recordings and audio are kept in `.render/`; the final video,
captions, and transcript are written to `Screenshots and Video/`.

Validation: every demonstrated cell entry/copy/cancellation is checked during
recording; the finished MP4 was decoded end to end, checked for audible audio
without clipping, and visually reviewed at the total, editing, and help steps.
