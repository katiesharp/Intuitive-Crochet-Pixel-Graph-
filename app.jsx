/* global React, ReactDOM, PixelQuant */
const { useState, useEffect, useRef, useMemo, useCallback } = React;
const { pixelate, kmeans, remapToPalette, rgbToHex, hexToRgb } = window.PixelQuant;

// -----------------------------------------------------------------------------
// Helpers

function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

function buildRunNumbers(indices, gridW, gridH, rightToLeftRow) {
  // For each cell, the run index (1-based) within its same-color horizontal run.
  // If rightToLeftRow(y) is truthy, that row is counted from the right edge.
  const nums = new Uint16Array(indices.length);
  for (let y = 0; y < gridH; y++) {
    const rtl = rightToLeftRow ? rightToLeftRow(y) : false;
    let count = 0; let prev = -1;
    if (rtl) {
      for (let x = gridW - 1; x >= 0; x--) {
        const i = y * gridW + x;
        const v = indices[i];
        if (v === prev) count++; else { count = 1; prev = v; }
        nums[i] = count;
      }
    } else {
      for (let x = 0; x < gridW; x++) {
        const i = y * gridW + x;
        const v = indices[i];
        if (v === prev) count++; else { count = 1; prev = v; }
        nums[i] = count;
      }
    }
  }
  return nums;
}

function readableTextColor(rgb) {
  // Return black or white for max contrast.
  const [r, g, b] = rgb;
  const L = 0.2126 * (r / 255) + 0.7152 * (g / 255) + 0.0722 * (b / 255);
  return L > 0.58 ? "#1a1a1a" : "#ffffff";
}

// ---- Project storage (localStorage) -----------------------------------------

const STORAGE_KEY = "pixelchart.projects";

function listProjects() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}
function writeProjects(all) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
}
function saveProjectToStorage(project) {
  const all = listProjects();
  all[project.id] = project;
  writeProjects(all);
}
function deleteProjectFromStorage(id) {
  const all = listProjects();
  delete all[id];
  writeProjects(all);
}
function newProjectId() {
  return Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 6);
}
function formatRelativeDate(ts) {
  const diff = (Date.now() - ts) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return Math.floor(diff / 60) + "m ago";
  if (diff < 86400) return Math.floor(diff / 3600) + "h ago";
  if (diff < 86400 * 7) return Math.floor(diff / 86400) + "d ago";
  return new Date(ts).toLocaleDateString();
}

function loadImageFromFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// Build a small demo image so the tool isn't empty on first load.
function makeDemoImage() {
  const w = 160, h = 160;
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const ctx = c.getContext("2d");
  // Sky gradient
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, "#f3d3a8");
  g.addColorStop(0.55, "#e69a6b");
  g.addColorStop(0.7, "#c8693f");
  g.addColorStop(0.71, "#3e6a7a");
  g.addColorStop(1, "#1f3a47");
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  // Sun
  ctx.fillStyle = "#fff1c2";
  ctx.beginPath(); ctx.arc(w * 0.62, h * 0.5, 22, 0, Math.PI * 2); ctx.fill();
  // Mountains
  ctx.fillStyle = "#2a3338";
  ctx.beginPath();
  ctx.moveTo(0, h * 0.78);
  ctx.lineTo(w * 0.18, h * 0.55);
  ctx.lineTo(w * 0.32, h * 0.7);
  ctx.lineTo(w * 0.5, h * 0.5);
  ctx.lineTo(w * 0.68, h * 0.72);
  ctx.lineTo(w * 0.85, h * 0.6);
  ctx.lineTo(w, h * 0.75);
  ctx.lineTo(w, h); ctx.lineTo(0, h); ctx.closePath(); ctx.fill();
  // Foreground
  ctx.fillStyle = "#1a2226";
  ctx.fillRect(0, h * 0.82, w, h * 0.18);

  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.src = c.toDataURL();
  });
}

// -----------------------------------------------------------------------------
// Color Picker dialog

function ColorPickerDialog({ from, palette, onPick, onCancel }) {
  const [custom, setCustom] = useState(rgbToHex(from));
  const presets = [
    "#ffffff", "#e6e2da", "#8a8580", "#1a1a1a",
    "#e74c3c", "#c0392b", "#f39c12", "#f1c40f",
    "#27ae60", "#16a085", "#2980b9", "#3498db",
    "#9b59b6", "#8e44ad", "#e84393", "#d63031",
  ];
  return (
    <div className="picker-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <div className="picker">
        <h3>Recolor</h3>
        <p>Every pixel using the source color will switch to the new color.</p>
        <div className="from-to">
          <div className="preview" style={{ background: rgbToHex(from) }}>
            <span>from</span>
          </div>
          <div className="arrow">→</div>
          <div className="preview" style={{ background: custom }}>
            <span>new</span>
          </div>
        </div>
        <div className="section-label">From palette</div>
        <div className="grid-colors" style={{ gridTemplateColumns: `repeat(${Math.min(palette.length, 12)}, 1fr)` }}>
          {palette.map((p, i) => (
            <button key={i} style={{ background: rgbToHex(p) }} onClick={() => onPick(hexToRgb(rgbToHex(p)))} title={rgbToHex(p)} />
          ))}
        </div>
        <div className="section-label" style={{ marginTop: 10 }}>Presets</div>
        <div className="grid-colors">
          {presets.map((p, i) => (
            <button key={i} style={{ background: p }} onClick={() => onPick(hexToRgb(p))} title={p} />
          ))}
        </div>
        <div className="picker-actions">
          <label className="btn ghost" style={{ padding: "4px 6px" }}>
            <input type="color" value={custom} onChange={(e) => setCustom(e.target.value)} />
            <span style={{ fontFamily: "var(--mono)", fontSize: 11 }}>{custom.toUpperCase()}</span>
          </label>
          <div className="right">
            <button className="btn" onClick={onCancel}>Cancel</button>
            <button className="btn primary" onClick={() => onPick(hexToRgb(custom))}>Apply</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Projects dialog — save/load/delete locally.

function ProjectsDialog({ currentProjectId, currentProjectName, getProjectSnapshot, onLoad, onClose }) {
  const [projects, setProjects] = useState(() => listProjects());
  const [name, setName] = useState(currentProjectName || "");
  const [error, setError] = useState("");
  const refresh = () => setProjects(listProjects());

  const handleSaveAs = (overwriteId) => {
    const trimmed = (name || "").trim() || "Untitled";
    const snap = getProjectSnapshot();
    if (!snap) { setError("Nothing to save yet."); return; }
    const id = overwriteId || newProjectId();
    const project = { ...snap, id, name: trimmed, savedAt: Date.now() };
    try {
      saveProjectToStorage(project);
    } catch (err) {
      setError("Couldn't save (storage full?). Try fewer colors or a smaller chart.");
      return;
    }
    setError("");
    refresh();
    onClose(id, trimmed);
  };

  const handleDelete = (id, projName) => {
    if (!window.confirm(`Delete "${projName}"?`)) return;
    deleteProjectFromStorage(id);
    refresh();
  };

  const sorted = Object.values(projects).sort((a, b) => b.savedAt - a.savedAt);
  const canOverwrite = currentProjectId && projects[currentProjectId];

  return (
    <div className="picker-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="picker" style={{ minWidth: 460, maxWidth: 540 }}>
        <h3>Projects</h3>
        <p>Save your current chart and pick it back up later. Saved locally in this browser.</p>

        <div className="section-label">Save current state</div>
        <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
          <input
            className="text-input"
            placeholder="Project name"
            value={name}
            onChange={e => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleSaveAs(canOverwrite ? currentProjectId : null); }}
            autoFocus
          />
          <button className="btn primary" onClick={() => handleSaveAs(canOverwrite ? currentProjectId : null)}>
            {canOverwrite ? "Save" : "Save new"}
          </button>
          {canOverwrite && (
            <button className="btn" onClick={() => handleSaveAs(null)} title="Save as a separate copy">Save copy</button>
          )}
        </div>
        {error && <div style={{ fontSize: 12, color: "var(--accent)", marginBottom: 6 }}>{error}</div>}

        <div className="section-label" style={{ marginTop: 14 }}>Saved projects</div>
        {sorted.length === 0 ? (
          <div style={{ fontSize: 12, color: "var(--ink-3)", padding: "8px 0" }}>No saved projects yet.</div>
        ) : (
          <div className="project-list">
            {sorted.map(p => (
              <div key={p.id} className={"project-row" + (p.id === currentProjectId ? " current" : "")}>
                <div className="project-swatches">
                  {(p.palette || []).slice(0, 8).map((c, i) => (
                    <span key={i} className="project-swatch" style={{ background: `rgb(${c[0]},${c[1]},${c[2]})` }} />
                  ))}
                </div>
                <div className="project-meta">
                  <div className="project-name">{p.name}{p.id === currentProjectId && <span className="project-current"> · current</span>}</div>
                  <div className="project-sub">{formatRelativeDate(p.savedAt)} · {p.gridW}×{p.gridH} · {(p.palette || []).length} colors · {(p.finished || []).length} done</div>
                </div>
                <div style={{ display: "flex", gap: 4 }}>
                  <button className="btn" onClick={() => onLoad(p)}>Load</button>
                  <button className="icon-btn" title="Delete" onClick={() => handleDelete(p.id, p.name)} style={{ width: 28, height: 28 }}>
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                      <path d="M3 3L9 9M9 3L3 9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
                    </svg>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="picker-actions" style={{ marginTop: 14 }}>
          <div style={{ flex: 1, fontSize: 11, color: "var(--ink-3)" }}>
            {sorted.length} saved · stored in this browser only
          </div>
          <button className="btn" onClick={() => onClose()}>Close</button>
        </div>
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Crop window — image-editor-style crop with 8 resize handles + drag-to-pan.

const HANDLE_DEFS = [
  { name: "nw", x: 0,   y: 0,   cur: "nwse-resize", dx: -1, dy: -1 },
  { name: "n",  x: 0.5, y: 0,   cur: "ns-resize",   dx:  0, dy: -1 },
  { name: "ne", x: 1,   y: 0,   cur: "nesw-resize", dx:  1, dy: -1 },
  { name: "e",  x: 1,   y: 0.5, cur: "ew-resize",   dx:  1, dy:  0 },
  { name: "se", x: 1,   y: 1,   cur: "nwse-resize", dx:  1, dy:  1 },
  { name: "s",  x: 0.5, y: 1,   cur: "ns-resize",   dx:  0, dy:  1 },
  { name: "sw", x: 0,   y: 1,   cur: "nesw-resize", dx: -1, dy:  1 },
  { name: "w",  x: 0,   y: 0.5, cur: "ew-resize",   dx: -1, dy:  0 },
];

function Cropper({ image, cropX, cropY, cropW, cropH, onChange, onFull, isolatedRow, gridH }) {
  const wrapRef = useRef(null);
  const [active, setActive] = useState(null); // "drag" | handle name

  // Fit preview into a 244-wide / 220-tall box.
  const maxDispW = 244, maxDispH = 220;
  const imgAspect = image.width / image.height;
  let dispW, dispH;
  if (imgAspect >= maxDispW / maxDispH) { dispW = maxDispW; dispH = maxDispW / imgAspect; }
  else { dispH = maxDispH; dispW = maxDispH * imgAspect; }
  const scale = dispW / image.width;
  const MIN_CROP_PX = Math.max(4, Math.min(image.width, image.height) * 0.04);

  const winW = cropW * scale;
  const winH = cropH * scale;
  const winX = cropX * scale;
  const winY = cropY * scale;

  const startDrag = (e) => {
    e.preventDefault();
    e.stopPropagation();
    const startMx = e.clientX, startMy = e.clientY;
    const startX = cropX, startY = cropY;
    setActive("drag");
    const move = (ev) => {
      const dx = (ev.clientX - startMx) / scale;
      const dy = (ev.clientY - startMy) / scale;
      const nx = clamp(startX + dx, 0, image.width - cropW);
      const ny = clamp(startY + dy, 0, image.height - cropH);
      onChange(nx, ny, cropW, cropH);
    };
    const up = () => {
      setActive(null);
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  const startResize = (handle) => (e) => {
    e.preventDefault();
    e.stopPropagation();
    const startMx = e.clientX, startMy = e.clientY;
    const startX = cropX, startY = cropY, startW = cropW, startH = cropH;
    setActive(handle.name);
    const move = (ev) => {
      const dx = (ev.clientX - startMx) / scale;
      const dy = (ev.clientY - startMy) / scale;
      let nx = startX, ny = startY, nw = startW, nh = startH;
      if (handle.dx === -1) { nx = startX + dx; nw = startW - dx; }
      else if (handle.dx === 1) { nw = startW + dx; }
      if (handle.dy === -1) { ny = startY + dy; nh = startH - dy; }
      else if (handle.dy === 1) { nh = startH + dy; }
      // Enforce minimums
      if (nw < MIN_CROP_PX) {
        if (handle.dx === -1) nx = startX + startW - MIN_CROP_PX;
        nw = MIN_CROP_PX;
      }
      if (nh < MIN_CROP_PX) {
        if (handle.dy === -1) ny = startY + startH - MIN_CROP_PX;
        nh = MIN_CROP_PX;
      }
      // Clamp to image bounds
      if (nx < 0) { nw += nx; nx = 0; }
      if (ny < 0) { nh += ny; ny = 0; }
      if (nx + nw > image.width) nw = image.width - nx;
      if (ny + nh > image.height) nh = image.height - ny;
      onChange(nx, ny, nw, nh);
    };
    const up = () => {
      setActive(null);
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  // Click outside the crop on the dim area: do nothing (could be added later).
  return (
    <div className="cropper">
      <div className="cropper-stage" ref={wrapRef} style={{ width: dispW, height: dispH }}>
        <img src={image.src} alt="" draggable={false} style={{ width: "100%", height: "100%", display: "block", userSelect: "none", pointerEvents: "none" }} />
        {/* Dim outside crop window with 4 boxes */}
        <div className="cropper-dim" style={{ left: 0, top: 0, width: dispW, height: winY }} />
        <div className="cropper-dim" style={{ left: 0, top: winY + winH, width: dispW, height: Math.max(0, dispH - (winY + winH)) }} />
        <div className="cropper-dim" style={{ left: 0, top: winY, width: winX, height: winH }} />
        <div className="cropper-dim" style={{ left: winX + winW, top: winY, width: Math.max(0, dispW - (winX + winW)), height: winH }} />
        {/* Crop window */}
        <div
          className={"cropper-window" + (active ? " active" : "")}
          style={{ left: winX, top: winY, width: winW, height: winH, cursor: active === "drag" ? "grabbing" : "grab" }}
          onMouseDown={startDrag}
        >
          <div className="cropper-grid" />
        </div>
        {/* Isolated-row indicator */}
        {isolatedRow !== null && gridH > 0 && (
          <div
            className="cropper-row-band"
            style={{
              left: winX,
              top: winY + (isolatedRow * winH / gridH),
              width: winW,
              height: Math.max(2, winH / gridH),
            }}
          />
        )}
        {/* Resize handles */}
        {HANDLE_DEFS.map(h => (
          <div
            key={h.name}
            className={"cropper-handle h-" + h.name}
            style={{
              left: winX + h.x * winW,
              top: winY + h.y * winH,
              cursor: h.cur,
            }}
            onMouseDown={startResize(h)}
          />
        ))}
      </div>
      <div className="cropper-foot">
        <span className="cropper-hint">
          {Math.round(cropW)}×{Math.round(cropH)} px · drag to pan, handles to resize
        </span>
        <button className="btn ghost" onClick={onFull} style={{ fontSize: 11, padding: "4px 8px" }}>Use full image</button>
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Pixel canvas

function PixelCanvas({
  palette, indices, gridW, gridH, cellSize,
  numberStyle, hideFinished, finishedSet,
  isolatedRow, tool, runNums,
  rectPreview, spaceDown, onPanStart,
  showArrows, firstRowFrom,
  onCellDown, onCellEnter, onCellUp,
}) {
  const canvasRef = useRef(null);
  const lastCellRef = useRef({ x: -1, y: -1 });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !indices) return;
    const dpr = window.devicePixelRatio || 1;
    const w = gridW * cellSize;
    const h = gridH * cellSize;
    canvas.width = w * dpr; canvas.height = h * dpr;
    canvas.style.width = w + "px"; canvas.style.height = h + "px";
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Background
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, h);

    // Fill cells
    for (let y = 0; y < gridH; y++) {
      const rowVisible = isolatedRow === null || isolatedRow === y;
      for (let x = 0; x < gridW; x++) {
        const i = y * gridW + x;
        const isFinished = finishedSet.has(i);
        if (hideFinished && isFinished) continue;
        if (!rowVisible) continue;
        const c = palette[indices[i]];
        ctx.fillStyle = `rgb(${c[0]},${c[1]},${c[2]})`;
        ctx.fillRect(x * cellSize, y * cellSize, cellSize, cellSize);
      }
    }

    // Finished marks (hatching) — drawn above fill, beneath gridlines.
    // Hatches are clipped to each cell so adjacent finished cells stay visually distinct.
    if (!hideFinished) {
      for (let y = 0; y < gridH; y++) {
        const rowVisible = isolatedRow === null || isolatedRow === y;
        if (!rowVisible) continue;
        for (let x = 0; x < gridW; x++) {
          const i = y * gridW + x;
          if (!finishedSet.has(i)) continue;
          ctx.save();
          // Clip to this cell
          ctx.beginPath();
          ctx.rect(x * cellSize, y * cellSize, cellSize, cellSize);
          ctx.clip();
          // White wash for legibility
          ctx.globalAlpha = 0.55;
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(x * cellSize, y * cellSize, cellSize, cellSize);
          ctx.globalAlpha = 1;
          // Diagonal stripes
          ctx.strokeStyle = "rgba(26,26,26,0.55)";
          ctx.lineWidth = Math.max(1, cellSize * 0.06);
          const step = Math.max(4, cellSize * 0.22);
          ctx.beginPath();
          for (let k = -cellSize; k < cellSize * 2; k += step) {
            ctx.moveTo(x * cellSize + k, y * cellSize);
            ctx.lineTo(x * cellSize + k + cellSize, y * cellSize + cellSize);
          }
          ctx.stroke();
          ctx.restore();
        }
      }
    }

    // Gridlines (always visible)
    ctx.strokeStyle = "rgba(0,0,0,0.22)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x <= gridW; x++) {
      const px = Math.round(x * cellSize) + 0.5;
      ctx.moveTo(px, 0); ctx.lineTo(px, h);
    }
    for (let y = 0; y <= gridH; y++) {
      const py = Math.round(y * cellSize) + 0.5;
      ctx.moveTo(0, py); ctx.lineTo(w, py);
    }
    ctx.stroke();

    // Bolder gridlines every 10 (chart convention)
    ctx.strokeStyle = "rgba(0,0,0,0.55)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x <= gridW; x += 10) {
      const px = Math.round(x * cellSize) + 0.5;
      ctx.moveTo(px, 0); ctx.lineTo(px, h);
    }
    for (let y = 0; y <= gridH; y += 10) {
      const py = Math.round(y * cellSize) + 0.5;
      ctx.moveTo(0, py); ctx.lineTo(w, py);
    }
    ctx.stroke();

    // Row highlight when isolated — frame the row.
    if (isolatedRow !== null) {
      ctx.strokeStyle = "rgba(26,26,26,1)";
      ctx.lineWidth = 2;
      ctx.strokeRect(
        0 + 1,
        isolatedRow * cellSize + 1,
        w - 2,
        cellSize - 2
      );
    }

    // Numbers — three modes
    if (numberStyle === "per-pixel" && cellSize >= 12) {
      const fontPx = Math.max(8, Math.floor(cellSize * 0.5));
      ctx.font = `500 ${fontPx}px JetBrains Mono, monospace`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      for (let y = 0; y < gridH; y++) {
        const rowVisible = isolatedRow === null || isolatedRow === y;
        if (!rowVisible) continue;
        for (let x = 0; x < gridW; x++) {
          const i = y * gridW + x;
          if (hideFinished && finishedSet.has(i)) continue;
          const c = palette[indices[i]];
          const txt = finishedSet.has(i) ? "rgba(26,26,26,0.4)" : readableTextColor(c);
          ctx.fillStyle = txt;
          ctx.fillText(
            String(runNums[i]),
            x * cellSize + cellSize / 2,
            y * cellSize + cellSize / 2 + 1
          );
        }
      }
    } else if (numberStyle === "group-total") {
      // For each visible row, compute color runs and place one number per run.
      // Isolated row: place number ABOVE the row (or BELOW if the row is at top).
      // Non-isolated: place number inside the middle cell of each run.
      const isolated = isolatedRow !== null;
      const totalFont = isolated
        ? Math.max(12, Math.floor(cellSize * 0.85))
        : Math.max(9, Math.floor(cellSize * 0.55));
      for (let y = 0; y < gridH; y++) {
        const rowVisible = isolatedRow === null || isolatedRow === y;
        if (!rowVisible) continue;
        // Compute runs for this row
        let prev = -1, runStart = 0;
        const runs = [];
        for (let xx = 0; xx <= gridW; xx++) {
          const v = xx < gridW ? indices[y * gridW + xx] : -2;
          if (v !== prev) {
            if (prev !== -1) runs.push({ start: runStart, len: xx - runStart, colorIdx: prev });
            prev = v;
            runStart = xx;
          }
        }
        if (isolated) {
          // Above the row, unless it's the top row — then below.
          const above = y > 0;
          const labelY = above
            ? y * cellSize - cellSize * 0.35
            : (y + 1) * cellSize + cellSize * 0.35;
          const bracketY = above
            ? y * cellSize - cellSize * 0.05
            : (y + 1) * cellSize + cellSize * 0.05;
          ctx.font = `600 ${totalFont}px JetBrains Mono, monospace`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          for (const r of runs) {
            const c = palette[r.colorIdx];
            const cx = (r.start + r.len / 2) * cellSize;
            // Color bracket
            ctx.strokeStyle = `rgb(${c[0]},${c[1]},${c[2]})`;
            ctx.lineWidth = Math.max(2, cellSize * 0.08);
            ctx.lineCap = "round";
            ctx.beginPath();
            ctx.moveTo(r.start * cellSize + cellSize * 0.12, bracketY);
            ctx.lineTo((r.start + r.len) * cellSize - cellSize * 0.12, bracketY);
            ctx.stroke();
            // Number
            ctx.fillStyle = "#1a1a1a";
            ctx.fillText(String(r.len), cx, labelY);
          }
        } else {
          // Inside middle cell of each run
          ctx.font = `600 ${totalFont}px JetBrains Mono, monospace`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          for (const r of runs) {
            const mid = r.start + Math.floor(r.len / 2);
            const i = y * gridW + mid;
            if (hideFinished && finishedSet.has(i)) continue;
            const c = palette[r.colorIdx];
            ctx.fillStyle = finishedSet.has(i) ? "rgba(26,26,26,0.4)" : readableTextColor(c);
            // Offset slightly when len is even so number isn't between two cells
            const offset = r.len % 2 === 0 ? cellSize * 0.5 : cellSize / 2;
            ctx.fillText(
              String(r.len),
              r.start * cellSize + (r.len / 2) * cellSize,
              y * cellSize + cellSize / 2 + 1
            );
          }
        }
      }
    }
    // Rect selection preview (for shift-drag rect in finish tool)
    if (rectPreview) {
      const { x0, y0, x1, y1 } = rectPreview;
      const rx = Math.min(x0, x1) * cellSize;
      const ry = Math.min(y0, y1) * cellSize;
      const rw = (Math.abs(x1 - x0) + 1) * cellSize;
      const rh = (Math.abs(y1 - y0) + 1) * cellSize;
      ctx.save();
      ctx.fillStyle = "rgba(26,26,26,0.10)";
      ctx.fillRect(rx, ry, rw, rh);
      ctx.setLineDash([5, 3]);
      ctx.strokeStyle = "rgba(26,26,26,0.95)";
      ctx.lineWidth = 1.5;
      ctx.strokeRect(rx + 0.75, ry + 0.75, rw - 1.5, rh - 1.5);
      ctx.restore();
    }
  }, [palette, indices, gridW, gridH, cellSize, numberStyle, hideFinished, finishedSet, isolatedRow, runNums, rectPreview]);

  const cellFromEvent = (e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    // Use the on-screen rect (post-CSS-transform) so cell mapping survives zoom.
    const effCellW = rect.width / gridW;
    const effCellH = rect.height / gridH;
    const x = Math.floor((e.clientX - rect.left) / effCellW);
    const y = Math.floor((e.clientY - rect.top) / effCellH);
    if (x < 0 || x >= gridW || y < 0 || y >= gridH) return null;
    return { x, y };
  };

  const handleMouseDown = (e) => {
    if (!indices) return;
    // Middle-button or space-held = pan (delegate to parent).
    if (e.button === 1 || (e.button === 0 && spaceDown)) {
      e.preventDefault();
      onPanStart && onPanStart(e);
      return;
    }
    if (e.button !== 0) return;
    const c = cellFromEvent(e);
    if (!c) return;
    lastCellRef.current = c;
    onCellDown && onCellDown(c.x, c.y, e);

    const move = (ev) => {
      const cc = cellFromEvent(ev);
      if (!cc) return;
      if (cc.x !== lastCellRef.current.x || cc.y !== lastCellRef.current.y) {
        lastCellRef.current = cc;
        onCellEnter && onCellEnter(cc.x, cc.y, ev);
      }
    };
    const up = (ev) => {
      onCellUp && onCellUp(ev);
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  const cursorStyle = spaceDown ? "grab"
    : !tool ? "default"
    : tool === "isolate" ? "crosshair"
    : tool === "finish" ? "cell" : "pointer";

  // Row direction arrows (for tapestry crochet etc.). startsRight(y) returns
  // whether row y starts on the right (and thus reads right-to-left).
  const startsRight = (y) => ((y % 2 === 0) === (firstRowFrom === "right"));
  const arrowPx = Math.max(12, Math.floor(cellSize * 0.55));
  const arrowsLeft = showArrows && (
    <div className="row-arrows">
      {Array.from({ length: gridH }, (_, y) => {
        const sr = startsRight(y);
        const visible = isolatedRow === null || y === isolatedRow;
        const isIso = isolatedRow === y;
        return (
          <div
            key={y}
            className={"arrow-slot" + (isIso ? " iso" : "")}
            style={{ width: cellSize, height: cellSize, opacity: visible ? 1 : 0.12 }}
          >
            {!sr && (
              <svg width={arrowPx} height={arrowPx} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 12h14M13 6l6 6-6 6" />
              </svg>
            )}
          </div>
        );
      })}
    </div>
  );
  const arrowsRight = showArrows && (
    <div className="row-arrows">
      {Array.from({ length: gridH }, (_, y) => {
        const sr = startsRight(y);
        const visible = isolatedRow === null || y === isolatedRow;
        const isIso = isolatedRow === y;
        return (
          <div
            key={y}
            className={"arrow-slot" + (isIso ? " iso" : "")}
            style={{ width: cellSize, height: cellSize, opacity: visible ? 1 : 0.12 }}
          >
            {sr && (
              <svg width={arrowPx} height={arrowPx} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <path d="M19 12H5M11 6l-6 6 6 6" />
              </svg>
            )}
          </div>
        );
      })}
    </div>
  );

  return (
    <div className="chart-wrapper">
      {arrowsLeft}
      <canvas
        ref={canvasRef}
        className="pixel-canvas"
        style={{ cursor: cursorStyle }}
        onMouseDown={handleMouseDown}
      />
      {arrowsRight}
    </div>
  );
}

// -----------------------------------------------------------------------------
// App

// Base render resolution for the chart canvas; on-screen zoom is applied via CSS transform.
const CELL_PX = 32;

function App() {
  const [image, setImage] = useState(null);
  const [imageName, setImageName] = useState("demo.png");
  const [resolution, setResolution] = useState(40); // long-edge pixel count
  const [colorCount, setColorCount] = useState(8);
  const [cropX, setCropX] = useState(0);
  const [cropY, setCropY] = useState(0);
  const [cropW, setCropW] = useState(0);
  const [cropH, setCropH] = useState(0);

  // Zoom / pan of the chart view (CSS transform on stage-inner).
  const [zoom, setZoom] = useState(1);
  const [panX, setPanX] = useState(0);
  const [panY, setPanY] = useState(0);
  const [spaceDown, setSpaceDown] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  const stageRef = useRef(null);

  const [palette, setPalette] = useState([]);
  const [indices, setIndices] = useState(null);
  const [gridW, setGridW] = useState(0);
  const [gridH, setGridH] = useState(0);
  const [paletteCounts, setPaletteCounts] = useState([]);

  const [tool, setTool] = useState("recolor"); // "recolor" | "isolate" | "finish"
  const [isolatedRow, setIsolatedRow] = useState(null);
  const [numberStyle, setNumberStyle] = useState("per-pixel"); // 'per-pixel' | 'group-total' | 'off'
  const [hideFinished, setHideFinished] = useState(false);
  const [finishedSet, setFinishedSet] = useState(new Set());
  const [picker, setPicker] = useState(null); // { fromIndex }
  const [selectedPaletteIdx, setSelectedPaletteIdx] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const [rectPreview, setRectPreview] = useState(null); // {x0,y0,x1,y1}
  const [countMode, setCountMode] = useState("remaining"); // 'total' | 'remaining'
  const [showArrows, setShowArrows] = useState(false);
  const [firstRowFrom, setFirstRowFrom] = useState("right"); // 'right' | 'left'
  const [currentProjectId, setCurrentProjectId] = useState(null);
  const [currentProjectName, setCurrentProjectName] = useState("");
  const [showProjectsDialog, setShowProjectsDialog] = useState(false);
  const dragStateRef = useRef(null);

  // Load demo image on mount.
  useEffect(() => {
    makeDemoImage().then((img) => setImage(img));
  }, []);

  // Hold space to enable pan-on-drag in the chart stage.
  useEffect(() => {
    const down = (e) => {
      if (e.code === "Space" && !e.repeat) {
        // Don't hijack space when typing in an input.
        const t = e.target;
        if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
        e.preventDefault();
        setSpaceDown(true);
      }
    };
    const up = (e) => { if (e.code === "Space") setSpaceDown(false); };
    const blur = () => setSpaceDown(false);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  }, []);

  // Wheel handler: ctrl/cmd + wheel (or trackpad pinch) zooms; plain wheel pans.
  // Bound directly (not via React onWheel) so we can use { passive: false } and
  // call preventDefault to keep the browser from zooming the page itself.
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const onWheel = (e) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      if (e.ctrlKey || e.metaKey) {
        // Zoom around the mouse position.
        setZoom(prevZoom => {
          const next = clamp(prevZoom * Math.exp(-e.deltaY * 0.01), 0.15, 24);
          const factor = next / prevZoom;
          setPanX(px => mx - (mx - px) * factor);
          setPanY(py => my - (my - py) * factor);
          return next;
        });
      } else {
        setPanX(px => px - e.deltaX);
        setPanY(py => py - e.deltaY);
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // Fit the chart inside the stage with some padding whenever dimensions change.
  const fitToView = useCallback(() => {
    const el = stageRef.current;
    if (!el || !gridW || !gridH) return;
    const padding = 80;
    const chartW = gridW * CELL_PX;
    const chartH = gridH * CELL_PX;
    const z = Math.min(
      (el.clientWidth - padding) / chartW,
      (el.clientHeight - padding) / chartH,
      4
    );
    setZoom(z);
    setPanX((el.clientWidth - chartW * z) / 2);
    setPanY((el.clientHeight - chartH * z) / 2);
  }, [gridW, gridH]);

  useEffect(() => { fitToView(); }, [fitToView]);

  // Resize observer: re-fit when the stage resizes? Actually keep current zoom
  // so the user's chosen view isn't disrupted; just keep things in bounds is
  // optional. We'll leave the current view alone.

  const onPanStart = (e) => {
    e.preventDefault();
    setIsPanning(true);
    const startX = e.clientX, startY = e.clientY;
    const startPanX = panX, startPanY = panY;
    const move = (ev) => {
      setPanX(startPanX + (ev.clientX - startX));
      setPanY(startPanY + (ev.clientY - startY));
    };
    const up = () => {
      setIsPanning(false);
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  const onStageMouseDown = (e) => {
    // Middle button anywhere, or space-held left button on the dotted bg = pan.
    if (e.button === 1 || (e.button === 0 && spaceDown)) {
      onPanStart(e);
    }
  };

  const zoomBy = (factor) => {
    const el = stageRef.current;
    if (!el) return;
    const mx = el.clientWidth / 2;
    const my = el.clientHeight / 2;
    setZoom(prevZoom => {
      const next = clamp(prevZoom * factor, 0.15, 24);
      const f = next / prevZoom;
      setPanX(px => mx - (mx - px) * f);
      setPanY(py => my - (my - py) * f);
      return next;
    });
  };

  // Derive chart pixel dimensions from crop aspect + resolution target.
  const { pixelWidth, pixelHeight } = useMemo(() => {
    if (cropW <= 0 || cropH <= 0) return { pixelWidth: 0, pixelHeight: 0 };
    if (cropW >= cropH) {
      const w = resolution;
      const h = Math.max(1, Math.round(resolution * cropH / cropW));
      return { pixelWidth: w, pixelHeight: h };
    } else {
      const h = resolution;
      const w = Math.max(1, Math.round(resolution * cropW / cropH));
      return { pixelWidth: w, pixelHeight: h };
    }
  }, [cropW, cropH, resolution]);

  // When a new image is loaded, set crop to the full image.
  const prevImg = useRef(null);
  useEffect(() => {
    if (!image) return;
    if (prevImg.current !== image) {
      setCropX(0); setCropY(0);
      setCropW(image.width); setCropH(image.height);
      prevImg.current = image;
    }
  }, [image]);

  // Re-pixelate + (re-quantize OR remap to existing palette).
  // Full quant fires only when the image or color count changes;
  // crop or resolution changes remap to the existing palette so the user's
  // recolors persist as they reframe / re-detail.
  const lastQuant = useRef({});
  useEffect(() => {
    if (!image || pixelWidth <= 0 || pixelHeight <= 0 || cropW <= 0 || cropH <= 0) return;
    const data = pixelate(image, pixelWidth, pixelHeight, cropX, cropY, cropW, cropH);
    const sig = `${image.src.length}:${colorCount}`;
    if (lastQuant.current.sig === sig && palette.length > 0) {
      const idx = remapToPalette(data, palette);
      setGridW(pixelWidth); setGridH(pixelHeight);
      setIndices(idx);
    } else {
      const { palette: pal, indices: idx, counts } = kmeans(data, colorCount);
      setGridW(pixelWidth); setGridH(pixelHeight);
      setPalette(pal);
      setIndices(idx);
      setPaletteCounts(counts);
      setFinishedSet(new Set());
      setIsolatedRow(null);
      setSelectedPaletteIdx(null);
      lastQuant.current = { sig };
    }
  }, [image, cropX, cropY, cropW, cropH, colorCount, pixelWidth, pixelHeight]);

  // Recompute counts on palette/indices change (recolor merges may collapse colors).
  useEffect(() => {
    if (!indices || palette.length === 0) return;
    const counts = new Array(palette.length).fill(0);
    for (let i = 0; i < indices.length; i++) counts[indices[i]]++;
    setPaletteCounts(counts);
  }, [indices, palette]);

  const runNums = useMemo(() => {
    if (!indices) return null;
    // When arrows are on, numbers follow the row direction (right-to-left on
    // rows that start on the right). Otherwise always left-to-right.
    const rtl = showArrows
      ? (y) => ((y % 2 === 0) === (firstRowFrom === "right"))
      : null;
    return buildRunNumbers(indices, gridW, gridH, rtl);
  }, [indices, gridW, gridH, showArrows, firstRowFrom]);

  const handleUpload = useCallback(async (file) => {
    if (!file) return;
    const img = await loadImageFromFile(file);
    setImageName(file.name);
    setImage(img);
  }, []);

  const onFileChange = (e) => {
    const f = e.target.files && e.target.files[0];
    if (f) handleUpload(f);
  };

  const onDrop = (e) => {
    e.preventDefault(); setDragOver(false);
    const f = e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) handleUpload(f);
  };

  const handleCellDown = (x, y, e) => {
    if (!indices) return;
    if (!tool) return; // No tool selected — ignore clicks.
    const i = y * gridW + x;
    if (tool === "recolor") {
      setPicker({ fromIndex: indices[i] });
      return;
    }
    if (tool === "isolate") {
      setIsolatedRow(prev => prev === y ? null : y);
      return;
    }
    if (tool === "finish") {
      const action = finishedSet.has(i) ? "unmark" : "mark";
      if (e.shiftKey) {
        // Rectangle select: don't toggle the starting cell yet; apply on mouseup.
        dragStateRef.current = { mode: "rect", x0: x, y0: y, x1: x, y1: y, action };
        setRectPreview({ x0: x, y0: y, x1: x, y1: y });
      } else {
        // Paint mode: toggle the first cell, then paint the same action while dragging.
        dragStateRef.current = { mode: "paint", action, touched: new Set([i]) };
        setFinishedSet(prev => {
          const next = new Set(prev);
          if (action === "mark") next.add(i); else next.delete(i);
          return next;
        });
      }
    }
  };

  const handleCellEnter = (x, y, e) => {
    const ds = dragStateRef.current;
    if (!ds) return;
    if (ds.mode === "paint") {
      const i = y * gridW + x;
      if (ds.touched.has(i)) return;
      ds.touched.add(i);
      setFinishedSet(prev => {
        const next = new Set(prev);
        if (ds.action === "mark") next.add(i); else next.delete(i);
        return next;
      });
    } else if (ds.mode === "rect") {
      ds.x1 = x; ds.y1 = y;
      setRectPreview({ x0: ds.x0, y0: ds.y0, x1: x, y1: y });
    }
  };

  const handleCellUp = () => {
    const ds = dragStateRef.current;
    if (!ds) { return; }
    if (ds.mode === "rect") {
      const xMin = Math.min(ds.x0, ds.x1);
      const yMin = Math.min(ds.y0, ds.y1);
      const xMax = Math.max(ds.x0, ds.x1);
      const yMax = Math.max(ds.y0, ds.y1);
      setFinishedSet(prev => {
        const next = new Set(prev);
        for (let yy = yMin; yy <= yMax; yy++) {
          for (let xx = xMin; xx <= xMax; xx++) {
            const i = yy * gridW + xx;
            if (ds.action === "mark") next.add(i); else next.delete(i);
          }
        }
        return next;
      });
      setRectPreview(null);
    }
    dragStateRef.current = null;
  };

  const applyRecolor = (rgb) => {
    if (!picker) return;
    const fromIdx = picker.fromIndex;
    // Check if rgb already exists in palette to merge
    const existingIdx = palette.findIndex(p => p[0] === rgb[0] && p[1] === rgb[1] && p[2] === rgb[2]);
    if (existingIdx !== -1 && existingIdx !== fromIdx) {
      // Merge: remap all fromIdx → existingIdx, then remove fromIdx from palette and shift.
      const newIndices = new Uint8Array(indices.length);
      for (let k = 0; k < indices.length; k++) {
        let v = indices[k];
        if (v === fromIdx) v = existingIdx;
        // Shift down indices > fromIdx
        if (v > fromIdx) v -= 1;
        newIndices[k] = v;
      }
      const newPalette = palette.filter((_, i) => i !== fromIdx);
      setPalette(newPalette);
      setIndices(newIndices);
    } else {
      // Just replace the palette entry color (in-place)
      const newPalette = palette.map((p, i) => i === fromIdx ? rgb : p);
      setPalette(newPalette);
    }
    setPicker(null);
  };

  const onPaletteSwatchPick = (paletteIdx) => {
    setSelectedPaletteIdx(paletteIdx);
    setPicker({ fromIndex: paletteIdx });
  };

  // ---- Project save / load --------------------------------------------------

  const getProjectSnapshot = () => {
    if (!image || !indices || palette.length === 0) return null;
    return {
      imageSrc: image.src,
      imageName,
      resolution, colorCount,
      cropX, cropY, cropW, cropH,
      palette: palette.map(c => [c[0], c[1], c[2]]),
      indices: Array.from(indices),
      gridW, gridH,
      finished: Array.from(finishedSet),
      isolatedRow,
      numberStyle, hideFinished, countMode,
      showArrows, firstRowFrom,
    };
  };

  const handleLoadProject = async (p) => {
    // Decode image from data URL first.
    const img = await new Promise((resolve) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.src = p.imageSrc;
    });
    // Prevent the auto-recenter effect and the kmeans path; remap will reproduce
    // the saved indices exactly because the operation is deterministic.
    prevImg.current = img;
    lastQuant.current = { sig: `${p.imageSrc.length}:${p.colorCount}` };
    setImage(img);
    setImageName(p.imageName || "untitled");
    setResolution(p.resolution);
    setColorCount(p.colorCount);
    setCropX(p.cropX); setCropY(p.cropY);
    setCropW(p.cropW); setCropH(p.cropH);
    setPalette(p.palette);
    setIndices(new Uint8Array(p.indices));
    setGridW(p.gridW); setGridH(p.gridH);
    setFinishedSet(new Set(p.finished || []));
    setIsolatedRow(p.isolatedRow ?? null);
    setNumberStyle(p.numberStyle || "per-pixel");
    setHideFinished(!!p.hideFinished);
    setCountMode(p.countMode || "remaining");
    setShowArrows(!!p.showArrows);
    setFirstRowFrom(p.firstRowFrom || "right");
    setTool(null);
    setSelectedPaletteIdx(null);
    setRectPreview(null);
    setCurrentProjectId(p.id);
    setCurrentProjectName(p.name);
    setShowProjectsDialog(false);
  };

  const handleNewProject = () => {
    setCurrentProjectId(null);
    setCurrentProjectName("");
    makeDemoImage().then((img) => {
      lastQuant.current = {};
      setImage(img);
      setImageName("demo.png");
    });
  };

  // Remaining (unfinished) cells per palette entry.
  const remainingCounts = useMemo(() => {
    if (!indices || palette.length === 0) return [];
    const counts = new Array(palette.length).fill(0);
    for (let i = 0; i < indices.length; i++) {
      if (!finishedSet.has(i)) counts[indices[i]]++;
    }
    return counts;
  }, [indices, palette, finishedSet]);

  const totalCells = gridW * gridH;
  const finishedCount = finishedSet.size;
  const finishedPct = totalCells > 0 ? Math.round((finishedCount / totalCells) * 100) : 0;

  // Build readout for isolated row
  const rowReadout = useMemo(() => {
    if (isolatedRow === null || !indices) return null;
    const segments = [];
    let prev = -1, count = 0, segStart = 0;
    for (let x = 0; x < gridW; x++) {
      const v = indices[isolatedRow * gridW + x];
      if (v === prev) count++;
      else {
        if (prev !== -1) segments.push({ idx: prev, count, start: segStart });
        prev = v; count = 1; segStart = x;
      }
    }
    if (prev !== -1) segments.push({ idx: prev, count, start: segStart });
    return segments;
  }, [isolatedRow, indices, gridW]);

  // Done-status helpers for the isolated row.
  const segmentStatus = (rowY, start, count) => {
    let done = 0;
    for (let x = start; x < start + count; x++) {
      if (finishedSet.has(rowY * gridW + x)) done++;
    }
    if (done === 0) return "todo";
    if (done === count) return "done";
    return "partial";
  };
  const rowAllDone = useMemo(() => {
    if (isolatedRow === null || gridW === 0) return false;
    for (let x = 0; x < gridW; x++) {
      if (!finishedSet.has(isolatedRow * gridW + x)) return false;
    }
    return true;
  }, [isolatedRow, gridW, finishedSet]);

  const toggleMarkRow = () => {
    if (isolatedRow === null) return;
    setFinishedSet(prev => {
      const next = new Set(prev);
      for (let x = 0; x < gridW; x++) {
        const i = isolatedRow * gridW + x;
        if (rowAllDone) next.delete(i); else next.add(i);
      }
      return next;
    });
  };

  const resetRow = () => {
    if (isolatedRow === null) return;
    setFinishedSet(prev => {
      const next = new Set(prev);
      for (let x = 0; x < gridW; x++) next.delete(isolatedRow * gridW + x);
      return next;
    });
  };

  const toggleMarkRun = (rowY, start, count) => {
    let allDone = true;
    for (let x = start; x < start + count; x++) {
      if (!finishedSet.has(rowY * gridW + x)) { allDone = false; break; }
    }
    setFinishedSet(prev => {
      const next = new Set(prev);
      for (let x = start; x < start + count; x++) {
        const i = rowY * gridW + x;
        if (allDone) next.delete(i); else next.add(i);
      }
      return next;
    });
  };

  return (
    <>
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">
            <span /><span /><span /><span /><span /><span /><span /><span /><span />
          </div>
          Pixel Chart
          <small>cross-stitch · beadwork · pattern tool</small>
        </div>
        <div className="top-tools">
          {image && (
            <span className="badge">
              {currentProjectName || imageName} · {gridW}×{gridH} · {palette.length} colors
            </span>
          )}
          <button className="btn" onClick={handleNewProject} title="Start a fresh project">New</button>
          <button className="btn" onClick={() => setShowProjectsDialog(true)}>
            Projects
          </button>
          <label className="btn">
            <input type="file" accept="image/*" onChange={onFileChange} style={{ display: "none" }} />
            Upload image
          </label>
        </div>
      </header>

      <div className="layout">
        {/* LEFT PANEL */}
        <aside className="panel left">
          <div className="section">
            <div className="section-label">Source</div>
            <label
              className={"upload-zone" + (dragOver ? " drag" : "")}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDrop}
            >
              <input type="file" accept="image/*" onChange={onFileChange} style={{ display: "none" }} />
              <div><strong>Drop image</strong> or click to upload</div>
              <div className="upload-sub">PNG, JPG, GIF, WebP</div>
            </label>
            {image && cropW > 0 && (
              <Cropper
                image={image}
                cropX={cropX} cropY={cropY}
                cropW={cropW} cropH={cropH}
                isolatedRow={isolatedRow}
                gridH={gridH}
                onChange={(x, y, w, h) => {
                  setCropX(x); setCropY(y); setCropW(w); setCropH(h);
                }}
                onFull={() => {
                  setCropX(0); setCropY(0);
                  setCropW(image.width); setCropH(image.height);
                }}
              />
            )}
          </div>

          <div className="section">
            <div className="section-label">Chart resolution</div>
            <div className="control">
              <div className="control-row">
                <span className="control-label">Detail (long edge)</span>
                <span className="control-value">{resolution}</span>
              </div>
              <input
                type="range"
                min="6" max="160" step="1"
                value={resolution}
                onChange={(e) => setResolution(Number(e.target.value))}
              />
            </div>
            <div className="control">
              <div className="control-row">
                <span className="control-label">Chart size</span>
                <span className="control-value">{pixelWidth} × {pixelHeight} cells</span>
              </div>
              <div style={{ fontSize: 11, color: "var(--ink-3)", marginTop: -2 }}>
                Aspect follows the crop window.
              </div>
            </div>
            <div className="control">
              <div className="control-row">
                <span className="control-label">Colors</span>
                <span className="control-value">{colorCount}</span>
              </div>
              <input
                type="range"
                min="2" max="24" step="1"
                value={colorCount}
                onChange={(e) => setColorCount(Number(e.target.value))}
              />
            </div>
          </div>

          <div className="section">
            <div className="section-label">Tool</div>
            <div className="tool-group">
              <button className={"tool" + (tool === "recolor" ? " active" : "")} onClick={() => setTool(t => t === "recolor" ? null : "recolor")}>
                <span className="tool-name">Recolor</span>
                <span className="tool-desc">Click a pixel → remap all of that color.</span>
              </button>
              <button className={"tool" + (tool === "isolate" ? " active" : "")} onClick={() => setTool(t => t === "isolate" ? null : "isolate")}>
                <span className="tool-name">Isolate row</span>
                <span className="tool-desc">Click a row to focus it, hide the rest.</span>
              </button>
              <button className={"tool" + (tool === "finish" ? " active" : "")} onClick={() => setTool(t => t === "finish" ? null : "finish")}>
                <span className="tool-name">Mark done</span>
                <span className="tool-desc">Click, drag, or Shift-drag rect.</span>
              </button>
              <button className="tool" onClick={() => { setFinishedSet(new Set()); setIsolatedRow(null); }}>
                <span className="tool-name">Reset state</span>
                <span className="tool-desc">Clear done marks &amp; isolation.</span>
              </button>
            </div>
          </div>

          <div className="section">
            <div className="section-label">Overlay</div>
            <div className="toggle-row">
              <div>
                <div className="toggle-label">Numbers</div>
                <div className="toggle-sub">
                  {numberStyle === "per-pixel" && "Count each pixel within a color run, per row."}
                  {numberStyle === "group-total" && "Single total per color run—above the row when isolated."}
                  {numberStyle === "off" && "No numbers shown."}
                </div>
              </div>
              <div className="seg">
                <button className={numberStyle === "per-pixel" ? "active" : ""} onClick={() => setNumberStyle("per-pixel")}>1–2–3</button>
                <button className={numberStyle === "group-total" ? "active" : ""} onClick={() => setNumberStyle("group-total")}>Total</button>
                <button className={numberStyle === "off" ? "active" : ""} onClick={() => setNumberStyle("off")}>Off</button>
              </div>
            </div>
            <div className="toggle-row">
              <div>
                <div className="toggle-label">Hide finished pixels</div>
                <div className="toggle-sub">Empty cells where done. {finishedCount > 0 && `(${finishedPct}% done)`}</div>
              </div>
              <div className={"switch" + (hideFinished ? " on" : "")} onClick={() => setHideFinished(v => !v)} />
            </div>
            <div className="toggle-row">
              <div>
                <div className="toggle-label">Row direction arrows</div>
                <div className="toggle-sub">Alternating row arrows for tapestry crochet.</div>
              </div>
              <div className={"switch" + (showArrows ? " on" : "")} onClick={() => setShowArrows(v => !v)} />
            </div>
            {showArrows && (
              <div className="toggle-row" style={{ borderTop: 0, paddingTop: 0 }}>
                <div>
                  <div className="toggle-label">Flip direction</div>
                  <div className="toggle-sub">Switch which side row 1 starts on.</div>
                </div>
                <button
                  className="btn"
                  onClick={() => setFirstRowFrom(d => d === "right" ? "left" : "right")}
                  style={{ fontFamily: "var(--mono)", fontSize: 12, letterSpacing: 1 }}
                  title={firstRowFrom === "right" ? "Row 1 starts on the right" : "Row 1 starts on the left"}
                >
                  {firstRowFrom === "right" ? "← → ← →" : "→ ← → ←"}
                </button>
              </div>
            )}
          </div>
        </aside>

        {/* CENTER STAGE */}
        <main
          className={"stage" + (spaceDown ? " space-down" : "") + (isPanning ? " panning" : "")}
          ref={stageRef}
          onMouseDown={onStageMouseDown}
        >
          {!indices && (
            <div className="stage-empty">Loading…</div>
          )}
          {indices && (
            <div
              className="stage-inner"
              style={{ transform: `translate3d(${panX}px, ${panY}px, 0) scale(${zoom})` }}
            >
              <PixelCanvas
                palette={palette}
                indices={indices}
                gridW={gridW} gridH={gridH}
                cellSize={CELL_PX}
                numberStyle={numberStyle}
                hideFinished={hideFinished}
                finishedSet={finishedSet}
                isolatedRow={isolatedRow}
                tool={tool}
                runNums={runNums}
                rectPreview={rectPreview}
                spaceDown={spaceDown}
                onPanStart={onPanStart}
                showArrows={showArrows}
                firstRowFrom={firstRowFrom}
                onCellDown={handleCellDown}
                onCellEnter={handleCellEnter}
                onCellUp={handleCellUp}
              />
            </div>
          )}

          {/* Isolated-row floating readout (outside stage-inner so it's not scaled) */}
          {indices && isolatedRow !== null && rowReadout && (() => {
            const isolatedRTL = (isolatedRow % 2 === 0) === (firstRowFrom === "right");
            return (
            <div className="row-readout">
              <div className="row-readout-line">
                <span className="row-label">
                  Row {isolatedRow + 1}
                  {showArrows && (
                    <span className="row-dir" title={isolatedRTL ? "Right to left" : "Left to right"}>
                      {isolatedRTL ? (
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5M11 6l-6 6 6 6"/></svg>
                      ) : (
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>
                      )}
                    </span>
                  )}
                </span>
                <span className="row-pills">
                  {rowReadout.map((s, i) => {
                    const status = segmentStatus(isolatedRow, s.start, s.count);
                    let doneInRun = 0;
                    for (let x = s.start; x < s.start + s.count; x++) {
                      if (finishedSet.has(isolatedRow * gridW + x)) doneInRun++;
                    }
                    const remaining = s.count - doneInRun;
                    const displayCount = countMode === "remaining" ? remaining : s.count;
                    return (
                      <button
                        key={i}
                        className={"pill " + status}
                        onClick={() => toggleMarkRun(isolatedRow, s.start, s.count)}
                        title={status === "done" ? "Click to unmark this run" : "Click to mark this run done"}
                      >
                        <span className="dot" style={{ background: rgbToHex(palette[s.idx]) }} />
                        {displayCount}
                        {countMode === "remaining" && doneInRun > 0 && status !== "done" && (
                          <span className="pill-of">/{s.count}</span>
                        )}
                        {status === "done" && <span className="check">✓</span>}
                      </button>
                    );
                  })}
                </span>
              </div>
              <div className="row-actions">
                <button className="btn" onClick={toggleMarkRow}>
                  {rowAllDone ? "Unmark row" : "Mark row done"}
                </button>
                <button className="btn ghost" onClick={resetRow}>Reset row</button>
                <button className="btn ghost" onClick={() => setIsolatedRow(null)}>Clear isolation</button>
              </div>
            </div>
            );
          })()}

          {/* Zoom controls */}
          <div className="zoom-controls">
            <button onClick={() => zoomBy(1/1.25)} title="Zoom out">−</button>
            <button className="zoom-readout" onClick={fitToView} title="Fit to view">{Math.round(zoom * 100)}%</button>
            <button onClick={() => zoomBy(1.25)} title="Zoom in">+</button>
          </div>

          <div className="hintbar">
            <span className="dot" />
            {spaceDown ? <>Drag to pan</> : (
              <>
                {!tool && <>No tool selected · pick one from the left</>}
                {tool === "recolor" && <>Click any pixel to recolor every pixel of that color</>}
                {tool === "isolate" && (isolatedRow === null ? <>Click any row to isolate it</> : <>Row {isolatedRow + 1} isolated · click again to release</>)}
                {tool === "finish" && <>Click or drag to mark · Shift-drag to mark a rectangle</>}
              </>
            )}
            <span className="kbd" title="Hold to pan">space</span>
            <span className="kbd" title="Pinch / Cmd+wheel to zoom">⌘+wheel</span>
          </div>
        </main>

        {/* RIGHT PANEL */}
        <aside className="panel right">
          <div className="section">
            <div className="section-label" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span>Palette</span>
              <div className="seg" style={{ textTransform: "none", letterSpacing: 0, fontWeight: 400 }}>
                <button className={countMode === "remaining" ? "active" : ""} onClick={() => setCountMode("remaining")}>Remaining</button>
                <button className={countMode === "total" ? "active" : ""} onClick={() => setCountMode("total")}>Total</button>
              </div>
            </div>
            <div className="palette-list">
              {palette.map((p, i) => {
                const total = paletteCounts[i] || 0;
                const remaining = remainingCounts[i] || 0;
                const done = total - remaining;
                const allDone = total > 0 && remaining === 0;
                return (
                  <div
                    key={i}
                    className={"swatch-row" + (selectedPaletteIdx === i ? " selected" : "") + (allDone ? " done" : "")}
                    onClick={() => setSelectedPaletteIdx(i)}
                  >
                    <div className="swatch" style={{ background: rgbToHex(p) }} />
                    <div className="swatch-meta">
                      <span className="swatch-hex">{rgbToHex(p).toUpperCase()}</span>
                      <span className="swatch-count">
                        {countMode === "remaining"
                          ? (done > 0 ? <>{remaining}<span className="swatch-count-mute"> / {total} left</span></> : <>{total} cells</>)
                          : <>{total} cells</>
                        }
                      </span>
                    </div>
                    <div className="swatch-actions">
                      <button
                        className="icon-btn"
                        title="Recolor every pixel of this color"
                        onClick={(e) => { e.stopPropagation(); onPaletteSwatchPick(i); }}
                      >
                        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                          <path d="M2 8.5L8.5 2L10 3.5L3.5 10H2V8.5Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
                        </svg>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="section">
            <div className="section-label">Legend</div>
            <div style={{ fontSize: 12, color: "var(--ink-2)", lineHeight: 1.6 }}>
              <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6 }}>
                <div style={{ width: 14, height: 14, background: "#fff", border: "1px solid var(--line-2)", position: "relative", overflow: "hidden" }}>
                  <svg width="14" height="14" style={{ position: "absolute", inset: 0 }}>
                    <line x1="-2" y1="14" x2="14" y2="-2" stroke="#1a1a1a" strokeWidth="1.2" />
                    <line x1="-2" y1="20" x2="20" y2="-2" stroke="#1a1a1a" strokeWidth="1.2" />
                  </svg>
                </div>
                Hatched = marked done
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6 }}>
                <div style={{ width: 14, height: 14, border: "1.5px solid #1a1a1a" }} />
                Bordered = isolated row
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <div style={{ width: 14, height: 14, background: "linear-gradient(to right, #fff 0%, #fff 92%, #1a1a1a 92%, #1a1a1a 100%)", border: "1px solid var(--line-2)" }} />
                Bolder line every 10 cells
              </div>
            </div>
          </div>

          <div className="section">
            <div className="section-label">Progress</div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "var(--ink-2)" }}>
              <span>Cells done</span>
              <span style={{ fontFamily: "var(--mono)", color: "var(--ink)" }}>{finishedCount} / {totalCells}</span>
            </div>
            <div style={{ height: 6, background: "var(--line)", borderRadius: 999, marginTop: 8, overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${finishedPct}%`, background: "var(--ink)", transition: "width .2s" }} />
            </div>
          </div>
        </aside>
      </div>

      {picker && (
        <ColorPickerDialog
          from={palette[picker.fromIndex]}
          palette={palette}
          onPick={applyRecolor}
          onCancel={() => setPicker(null)}
        />
      )}
      {showProjectsDialog && (
        <ProjectsDialog
          currentProjectId={currentProjectId}
          currentProjectName={currentProjectName}
          getProjectSnapshot={getProjectSnapshot}
          onLoad={handleLoadProject}
          onClose={(id, name) => {
            if (id) { setCurrentProjectId(id); setCurrentProjectName(name); }
            setShowProjectsDialog(false);
          }}
        />
      )}
    </>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
