# Pixel Chart

A browser-based tool that turns any image into an editable pixel pattern chart — for cross-stitch, beadwork, perler beads, knitting, or any craft where you work cell-by-cell.

## Features

- Upload any image; crop it like an image editor (8 handles + drag-to-pan)
- Set the chart **detail** (long edge in cells) and **color count**; aspect follows the crop
- **Recolor** any color globally with one click; pick from the palette, presets, or a custom color
- **Mark pixels done** with click, drag, or Shift-drag rectangle
- **Isolate a row** to focus on it; mark the whole row done, mark individual color runs done, or reset just that row
- Show counts as **Total** or **Remaining** (live progress as you work)
- Numbers overlay: **per pixel** (1, 2, 3…), **total per group**, or **off**
- Pinch / ⌘+wheel to **zoom**, two-finger scroll or space+drag to **pan**
- Crop preview shows a band where the isolated row sits in the source image

## Run locally

No build step. Open `index.html` directly in a modern browser, or serve the folder:

```sh
# Python
python3 -m http.server 8000
# or Node
npx serve .
```

Then visit <http://localhost:8000>.

> The page transpiles JSX in the browser via Babel, so the first load is a touch slow then everything is cached. Fine for personal use; see the "optimize later" note below if you'd like to bundle.

## Deploy on GitHub Pages

1. Create a new GitHub repo and push these files:

   ```sh
   git init
   git add .
   git commit -m "Pixel Chart"
   git branch -M main
   git remote add origin https://github.com/<YOUR-USER>/<REPO>.git
   git push -u origin main
   ```

2. In the repo on GitHub: **Settings → Pages**.
3. Under **Source** choose **Deploy from a branch**. Pick `main` and `/ (root)`. **Save**.
4. After ~1 minute your site is live at:
   `https://<your-user>.github.io/<repo>/`

Pushes to `main` redeploy automatically.

## Files

| File | What it is |
|------|------------|
| `index.html` | Page shell, all styles, script tags |
| `app.jsx`    | The React app (JSX, transpiled in-browser by Babel) |
| `quantize.js`| K-means color quantization + nearest-palette remapping |

## Optimize later (optional)

If you ever want a snappier first load, you can replace the in-browser Babel with a build step:

- [Vite](https://vitejs.dev/) — `npm create vite@latest` (pick React)
- Move `app.jsx` and `quantize.js` into `src/`
- Move CSS out of `index.html` into a `.css` file
- `npm run build` outputs a static `dist/` folder you can push to a `gh-pages` branch (or use the [vite-gh-pages](https://vitejs.dev/guide/static-deploy.html#github-pages) workflow)

But for a personal/hobby tool, the current setup is fine.

## License

MIT — do whatever you want.
