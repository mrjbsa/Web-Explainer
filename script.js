(function(){
  "use strict";

  // ---------- constants ----------
  const CW = 1920, CH = 1080, TOPBAR_H = 96;
  const ZOOM_IN = 900, GAP_BEFORE_PINS = 450, PIN_APPEAR = 350;
  const TYPE_SPEED = 32, MIN_TYPE = 900, HOLD_AFTER_TYPE = 850;
  const PIN_TRANSITION = 350, PAGE_END_HOLD = 750, PAGE_EXIT = 650;
  const NO_PIN_HOLD = 2400, END_CARD = 3200;
  const POPUP_WIDTH = 620, POPUP_PAD = 28, POPUP_INNER_WIDTH = POPUP_WIDTH - POPUP_PAD*2;
  const STORAGE_KEY = "pageflow_project_v1";
  const MAX_ZOOM = 1.32;

  // Free, no-attribution-required sound effects (Mixkit Sound Effects Free License)
  // https://mixkit.co/license/#sfxFree
  const SOUND_URLS = {
    transition: "https://assets.mixkit.co/active_storage/sfx/2605/2605-preview.mp3", // Quick air woosh — page enters
    pop:        "https://assets.mixkit.co/active_storage/sfx/2354/2354-preview.mp3", // Message pop alert — marker appears
    type:       "https://assets.mixkit.co/active_storage/sfx/1366/1366-preview.mp3", // Typewriter soft hit — during typing
    confirm:    "https://assets.mixkit.co/active_storage/sfx/2867/2867-preview.mp3", // Confirmation tone — caption finishes typing
    outro:      "https://assets.mixkit.co/active_storage/sfx/3108/3108-preview.mp3"  // Crystal chime — end card
  };

  // ---------- auto-explain engine ----------
  // Not real image analysis (a static page can't see pixels) — instead it
  // reasons about WHERE a marker sits on the page (top/middle/bottom,
  // left/center/right) and writes a natural caption for that spot, so a
  // page is fully explained the moment a screenshot is added. Every
  // caption stays editable, and edited ones are never overwritten.
  const REGION_PHRASES = {
    "top-left":      ["The logo and brand mark sit here.", "This is the top-left corner visitors see first.", "The site's identity mark lives in this corner."],
    "top-center":    ["The main navigation menu sits here.", "Visitors use this bar to move around the site.", "Key sections of the site are listed in this menu."],
    "top-right":     ["Account, search or menu controls sit here.", "A call-to-action button sits in this corner.", "Sign-in or quick actions usually live here."],
    "middle-left":   ["Supporting content sits on this side.", "A secondary detail is highlighted here.", "This adds context to the main content."],
    "middle-center": ["This is the main focus of the page.", "The core message or feature is shown here.", "This is the centerpiece visitors notice first."],
    "middle-right":  ["A supporting visual or detail sits here.", "Extra context appears on this side.", "This complements the main content."],
    "bottom-left":   ["Footer or legal details sit down here.", "Extra links are tucked into this corner.", "Secondary information sits at the bottom."],
    "bottom-center": ["A call-to-action often sits near the bottom.", "This closes out the page with a clear next step.", "This wraps up the page's main message."],
    "bottom-right":  ["Contact or social links are usually here.", "A final action or shortcut sits in this corner.", "This gives visitors one more way to act."]
  };

  function regionKey(x, y){
    const vx = x < 0.34 ? "left" : x > 0.66 ? "right" : "center";
    const vy = y < 0.35 ? "top" : y > 0.68 ? "bottom" : "middle";
    return vy + "-" + vx;
  }

  function generateAutoCaption(pageName, x, y, seedIndex){
    const pool = REGION_PHRASES[regionKey(x,y)] || REGION_PHRASES["middle-center"];
    const phrase = pool[((seedIndex % pool.length) + pool.length) % pool.length];
    return pageName ? `On ${pageName}, ${phrase.charAt(0).toLowerCase()}${phrase.slice(1)}` : phrase;
  }

  const DEFAULT_SPOTS = [{x:0.24,y:0.22},{x:0.5,y:0.5},{x:0.76,y:0.8}];

  function autoPinsForPage(pageName){
    return DEFAULT_SPOTS.map((s,i) => ({
      id: uid(), x: s.x, y: s.y, auto: true,
      text: generateAutoCaption(pageName, s.x, s.y, i)
    }));
  }

  // ---------- state ----------
  const state = {
    brand: { title: "My Website", url: "", color: "#45D6C0" },
    pages: [],
    currentPageId: null,
    totalPagesDuration: 0,
    grandTotal: 0
  };

  // ---------- dom ----------
  const $ = id => document.getElementById(id);
  const brandTitleInput = $("brandTitle"), brandUrlInput = $("brandUrl"), brandColorInput = $("brandColor");
  const pagesListEl = $("pagesList"), stageFrame = $("stageFrame"), stageEmptyState = $("stageEmptyState");
  const stageBg = $("stageBg"), stageImg = $("stageImg");
  const pageDetailsEl = $("pageDetails"), estimateText = $("estimateText");
  const fileInput = $("fileInput"), addPageBtn = $("addPageBtn"), clearProjectBtn = $("clearProjectBtn");
  const previewBtn = $("previewBtn"), generateBtn = $("generateBtn"), muteBtn = $("muteBtn");
  const overlay = $("overlay"), recCanvas = $("recCanvas"), ctx = recCanvas.getContext("2d");
  const progressFill = $("progressFill"), overlayStatus = $("overlayStatus");
  const downloadLink = $("downloadLink"), stopBtn = $("stopBtn");

  // ---------- utils ----------
  function uid(){ return Math.random().toString(36).slice(2) + Date.now().toString(36); }
  function clamp(v,a,b){ return Math.max(a, Math.min(b, v)); }
  function lerp(a,b,t){ return a + (b-a)*t; }
  function easeOutBack(x){ const c1=1.4, c3=c1+1; x=clamp(x,0,1); return 1 + c3*Math.pow(x-1,3) + c1*Math.pow(x-1,2); }
  function hexToRgba(hex, a){
    const h = hex.replace("#","");
    const r = parseInt(h.substring(0,2),16), g = parseInt(h.substring(2,4),16), b = parseInt(h.substring(4,6),16);
    return `rgba(${r},${g},${b},${a})`;
  }
  function formatTime(ms){
    const s = Math.max(0, Math.round(ms/1000));
    const m = Math.floor(s/60), r = s%60;
    return m + ":" + String(r).padStart(2,"0");
  }
  function slug(s){ return (s||"").toLowerCase().trim().replace(/[^a-z0-9]+/g,"-").replace(/(^-|-$)/g,""); }
  function debounce(fn, ms){ let t; return (...a) => { clearTimeout(t); t = setTimeout(()=>fn(...a), ms); }; }
  function currentPage(){ return state.pages.find(p => p.id === state.currentPageId) || null; }

  function wrapCanvasText(context, text, maxWidth){
    const words = String(text).split(/\s+/).filter(Boolean);
    const lines = [];
    let cur = "";
    for (const w of words){
      const test = cur ? cur + " " + w : w;
      if (context.measureText(test).width > maxWidth && cur){
        lines.push(cur);
        cur = w;
      } else {
        cur = test;
      }
    }
    if (cur) lines.push(cur);
    return lines.length ? lines : [""];
  }

  function roundRect(context, x, y, w, h, r){
    context.beginPath();
    context.moveTo(x+r, y);
    context.arcTo(x+w, y, x+w, y+h, r);
    context.arcTo(x+w, y+h, x, y+h, r);
    context.arcTo(x, y+h, x, y, r);
    context.arcTo(x, y, x+w, y, r);
    context.closePath();
  }

  // ---------- persistence ----------
  function saveProject(){
    try{
      const data = {
        brand: state.brand,
        pages: state.pages.map(p => ({
          id: p.id, name: p.name, src: p.src,
          pins: p.pins.map(({x,y,text,auto}) => ({x,y,text,auto}))
        }))
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch(e){ console.warn("Autosave skipped:", e); }
  }
  const persist = debounce(saveProject, 400);

  function loadProject(){
    try{
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      if (data.brand) state.brand = data.brand;
      state.pages = (data.pages || []).map(p => {
        const img = new Image();
        img.src = p.src;
        return { id: p.id || uid(), name: p.name, src: p.src, img, pins: (p.pins||[]).map(pin => ({ id: uid(), auto:false, ...pin })) };
      });
      if (state.pages.length) state.currentPageId = state.pages[0].id;
    } catch(e){ console.warn("Load skipped:", e); }
  }

  // ---------- file handling ----------
  function handleFiles(fileList){
    const files = Array.from(fileList).filter(f => f.type.startsWith("image/"));
    if (!files.length) return;
    let remaining = files.length;
    files.forEach((file, idx) => {
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.src = reader.result;
        const name = "Page " + (state.pages.length + 1);
        const page = {
          id: uid(),
          name: name,
          src: reader.result,
          img,
          pins: autoPinsForPage(name)
        };
        state.pages.push(page);
        if (idx === 0) state.currentPageId = page.id;
        remaining--;
        if (remaining === 0){ persist(); renderAll(); }
      };
      reader.readAsDataURL(file);
    });
  }

  fileInput.addEventListener("change", e => { handleFiles(e.target.files); fileInput.value = ""; });
  addPageBtn.addEventListener("click", () => fileInput.click());

  stageFrame.addEventListener("dragover", e => { e.preventDefault(); });
  stageFrame.addEventListener("drop", e => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files.length) handleFiles(e.dataTransfer.files);
  });

  clearProjectBtn.addEventListener("click", () => {
    if (!state.pages.length) return;
    if (!confirm("Clear the whole project? This removes all pages and markers.")) return;
    state.pages = [];
    state.currentPageId = null;
    localStorage.removeItem(STORAGE_KEY);
    renderAll();
  });

  // ---------- brand inputs ----------
  brandTitleInput.addEventListener("input", () => { state.brand.title = brandTitleInput.value; persist(); updateEstimate(); });
  brandUrlInput.addEventListener("input", () => { state.brand.url = brandUrlInput.value; persist(); });
  brandColorInput.addEventListener("input", () => {
    state.brand.color = brandColorInput.value;
    document.documentElement.style.setProperty("--accent-dyn", state.brand.color);
    persist(); renderStage(); renderPinsList();
  });

  // ---------- pages list ----------
  function renderPagesList(){
    pagesListEl.innerHTML = "";
    state.pages.forEach((page, i) => {
      const card = document.createElement("div");
      card.className = "page-card" + (page.id === state.currentPageId ? " active" : "");
      card.innerHTML = `
        <span class="page-num">${i+1}</span>
        <div class="page-thumb" style="background-image:url('${page.src}')"></div>
        <div class="page-meta">
          <div class="pname"></div>
          <div class="pcount">${page.pins.length} marker${page.pins.length===1?"":"s"}</div>
        </div>
        <div class="page-actions">
          <button data-act="up" title="Move earlier">▲</button>
          <button data-act="down" title="Move later">▼</button>
          <button data-act="del" title="Remove page">✕</button>
        </div>`;
      card.querySelector(".pname").textContent = page.name;
      card.addEventListener("click", (e) => {
        if (e.target.closest(".page-actions")) return;
        state.currentPageId = page.id;
        renderAll();
      });
      card.querySelector('[data-act="del"]').addEventListener("click", (e) => {
        e.stopPropagation();
        state.pages = state.pages.filter(p => p.id !== page.id);
        if (state.currentPageId === page.id) state.currentPageId = state.pages[0] ? state.pages[0].id : null;
        persist(); renderAll();
      });
      card.querySelector('[data-act="up"]').addEventListener("click", (e) => {
        e.stopPropagation();
        if (i === 0) return;
        [state.pages[i-1], state.pages[i]] = [state.pages[i], state.pages[i-1]];
        persist(); renderAll();
      });
      card.querySelector('[data-act="down"]').addEventListener("click", (e) => {
        e.stopPropagation();
        if (i === state.pages.length-1) return;
        [state.pages[i+1], state.pages[i]] = [state.pages[i], state.pages[i+1]];
        persist(); renderAll();
      });
      pagesListEl.appendChild(card);
    });
  }

  // ---------- stage (editing canvas area) ----------
  let dragging = null;

  function renderStage(){
    const page = currentPage();
    stageFrame.querySelectorAll(".pin-dot").forEach(el => el.remove());
    if (!page){
      stageFrame.classList.add("empty");
      stageBg.style.backgroundImage = "";
      stageImg.style.backgroundImage = "";
      stageEmptyState.style.display = "flex";
      return;
    }
    stageFrame.classList.remove("empty");
    stageEmptyState.style.display = "none";
    stageBg.style.backgroundImage = `url('${page.src}')`;
    stageImg.style.backgroundImage = `url('${page.src}')`;

    page.pins.forEach((pin, i) => {
      const dot = document.createElement("button");
      dot.className = "pin-dot";
      dot.type = "button";
      dot.style.left = (pin.x*100) + "%";
      dot.style.top = (pin.y*100) + "%";
      dot.style.setProperty("--accent-dyn", state.brand.color);
      dot.textContent = i+1;
      dot.setAttribute("aria-label", "Marker " + (i+1));
      dot.addEventListener("pointerdown", (e) => {
        e.stopPropagation();
        dragging = { pinId: pin.id };
        dot.setPointerCapture(e.pointerId);
      });
      dot.addEventListener("pointermove", (e) => {
        if (!dragging || dragging.pinId !== pin.id) return;
        const rect = stageFrame.getBoundingClientRect();
        const relX = clamp((e.clientX - rect.left)/rect.width, 0.02, 0.98);
        const relY = clamp((e.clientY - rect.top)/rect.height, 0.05, 0.95);
        pin.x = relX; pin.y = relY;
        dot.style.left = (relX*100) + "%";
        dot.style.top = (relY*100) + "%";
      });
      dot.addEventListener("pointerup", () => {
        if (dragging && dragging.pinId === pin.id){ dragging = null; persist(); }
      });
      dot.addEventListener("click", (e) => {
        e.stopPropagation();
        const ta = pageDetailsEl.querySelector(`textarea[data-pin="${pin.id}"]`);
        if (ta){ ta.focus(); ta.scrollIntoView({block:"center", behavior:"smooth"}); }
      });
      stageFrame.appendChild(dot);
    });
  }

  stageFrame.addEventListener("click", (e) => {
    const page = currentPage();
    if (!page){ addPageBtn.focus(); return; }
    const rect = stageFrame.getBoundingClientRect();
    const relX = clamp((e.clientX - rect.left)/rect.width, 0.02, 0.98);
    const relY = clamp((e.clientY - rect.top)/rect.height, 0.05, 0.95);
    const newPin = { id: uid(), x: relX, y: relY, auto: true, text: generateAutoCaption(page.name, relX, relY, page.pins.length) };
    page.pins.push(newPin);
    persist();
    renderAll();
    const ta = pageDetailsEl.querySelector(`textarea[data-pin="${newPin.id}"]`);
    if (ta){ ta.focus(); ta.select(); }
  });

  // ---------- inspector (right panel) ----------
  function renderPinsList(){
    const page = currentPage();
    if (!page){
      pageDetailsEl.innerHTML = '<div class="no-page-msg">Select or add a page to see its auto-generated explanation.</div>';
      return;
    }
    const wrap = document.createElement("div");
    wrap.style.display = "flex";
    wrap.style.flexDirection = "column";
    wrap.style.minHeight = "0";
    wrap.style.flex = "1";

    const nameField = document.createElement("div");
    nameField.className = "pagename-field";
    nameField.innerHTML = `
      <label style="display:block;font-size:12.5px;color:var(--text-dim);margin-bottom:6px;">Page name (shown in video)</label>
      <input type="text" id="pageNameInput" style="width:100%;background:var(--panel-2);border:1px solid var(--border);border-radius:8px;padding:8px 10px;font-size:13.5px;" maxlength="40">`;
    wrap.appendChild(nameField);

    const autoRow = document.createElement("div");
    autoRow.className = "auto-explain-row";
    autoRow.innerHTML = `<button class="btn small" id="autoExplainBtn" style="width:100%;justify-content:center;">✨ Auto-explain this page</button>`;
    wrap.appendChild(autoRow);

    const list = document.createElement("div");
    list.id = "pinsList";

    if (!page.pins.length){
      list.innerHTML = '<p class="empty-pins">No markers yet. Click "Auto-explain this page" above, or click anywhere on the screenshot to drop your own marker.</p>';
    } else {
      page.pins.forEach((pin, i) => {
        const row = document.createElement("div");
        row.className = "pin-row";
        row.innerHTML = `
          <div class="pin-row-head">
            <span class="pin-badge"></span>
            <span style="font-size:12px;color:var(--text-dim);">Marker ${i+1}</span>
            ${pin.auto ? '<span class="auto-tag">auto</span>' : ''}
            <span class="spacer"></span>
            <button class="btn icon small" data-act="up" title="Play earlier">▲</button>
            <button class="btn icon small" data-act="down" title="Play later">▼</button>
            <button class="btn icon small danger-text" data-act="del" title="Delete marker">✕</button>
          </div>
          <textarea data-pin="${pin.id}" placeholder="e.g. Click here to open the pricing page.">${pin.text || ""}</textarea>`;
        row.querySelector(".pin-badge").style.setProperty("--accent-dyn", state.brand.color);
        row.querySelector("textarea").addEventListener("input", (e) => {
          pin.text = e.target.value;
          pin.auto = false;
          persist(); updateEstimate();
        });
        row.querySelector('[data-act="del"]').addEventListener("click", () => {
          page.pins = page.pins.filter(p => p.id !== pin.id);
          persist(); renderAll();
        });
        row.querySelector('[data-act="up"]').addEventListener("click", () => {
          if (i === 0) return;
          [page.pins[i-1], page.pins[i]] = [page.pins[i], page.pins[i-1]];
          persist(); renderAll();
        });
        row.querySelector('[data-act="down"]').addEventListener("click", () => {
          if (i === page.pins.length-1) return;
          [page.pins[i+1], page.pins[i]] = [page.pins[i], page.pins[i+1]];
          persist(); renderAll();
        });
        list.appendChild(row);
      });
    }
    wrap.appendChild(list);
    pageDetailsEl.innerHTML = "";
    pageDetailsEl.appendChild(wrap);

    const nameInput = document.getElementById("pageNameInput");
    nameInput.value = page.name;
    nameInput.addEventListener("input", (e) => {
      page.name = e.target.value;
      page.pins.forEach((pin,i) => { if (pin.auto) pin.text = generateAutoCaption(page.name, pin.x, pin.y, i); });
      persist(); renderPagesList(); renderPinsList();
    });

    document.getElementById("autoExplainBtn").addEventListener("click", () => {
      if (!page.pins.length){
        page.pins = autoPinsForPage(page.name);
      } else {
        const seedOffset = Math.floor(Math.random()*97) + 1;
        page.pins.forEach((pin,i) => { if (pin.auto) pin.text = generateAutoCaption(page.name, pin.x, pin.y, i+seedOffset); });
      }
      persist(); renderAll();
    });
  }

  // ---------- timeline / duration ----------
  function buildTimeline(){
    ctx.font = '400 26px Inter';
    let cursor = 0;
    state.pages.forEach(page => {
      page._pageStart = cursor;
      if (!page.pins.length){
        page._duration = ZOOM_IN + NO_PIN_HOLD + PAGE_EXIT;
      } else {
        let pinCursor = ZOOM_IN + GAP_BEFORE_PINS;
        page.pins.forEach((pin, i) => {
          const text = (pin.text && pin.text.trim()) ? pin.text.trim() : generateAutoCaption(page.name, pin.x, pin.y, i);
          pin._fullText = text;
          pin._lines = wrapCanvasText(ctx, text, POPUP_INNER_WIDTH);
          const typeDur = Math.max(MIN_TYPE, text.length * TYPE_SPEED);
          pin._slotStart = pinCursor;
          pin._appearEnd = pinCursor + PIN_APPEAR;
          pin._typeEnd = pin._appearEnd + typeDur;
          pin._holdEnd = pin._typeEnd + HOLD_AFTER_TYPE;
          pin._slotEnd = pin._holdEnd + PIN_TRANSITION;
          pin._poppedSound = false;
          pin._confirmedSound = false;
          pin._lastCharCount = 0;
          pin._lastTickTime = -9999;
          pinCursor = pin._slotEnd;
        });
        page._duration = pinCursor + PAGE_END_HOLD + PAGE_EXIT;
      }
      cursor += page._duration;
    });
    state.totalPagesDuration = cursor;
    state.grandTotal = cursor + END_CARD;
  }

  function updateEstimate(){
    buildTimeline();
    estimateText.textContent = formatTime(state.grandTotal) + " min:sec";
  }

  // ---------- render engine (canvas) ----------
  function drawStageBackdrop(img){
    if (!img || !img.complete || !img.naturalWidth){
      ctx.fillStyle = "#0B0C10"; ctx.fillRect(0,0,CW,CH); return;
    }
    const ir = img.naturalWidth/img.naturalHeight, cr = CW/CH;
    let sw, sh, sx, sy;
    if (ir > cr){ sh = img.naturalHeight; sw = sh*cr; sx = (img.naturalWidth-sw)/2; sy = 0; }
    else { sw = img.naturalWidth; sh = sw/cr; sx = 0; sy = (img.naturalHeight-sh)/2; }
    ctx.save();
    try{ ctx.filter = "blur(36px) brightness(0.42) saturate(1.15)"; } catch(e){ /* unsupported, ignore */ }
    ctx.drawImage(img, sx, sy, sw, sh, -60, -60, CW+120, CH+120);
    ctx.restore();
    ctx.fillStyle = "rgba(6,7,10,0.25)";
    ctx.fillRect(0,0,CW,CH);
  }

  // Draws the FULL, uncropped screenshot fitted (letterboxed) into the frame,
  // then zooms/pans toward (fx,fy) — used to spotlight the marker being explained
  // without ever cutting off any part of the page.
  function drawContainImageZoomed(img, fx, fy, zoom){
    if (!img || !img.complete || !img.naturalWidth) return;
    const ir = img.naturalWidth/img.naturalHeight, cr = CW/CH;
    let dw, dh;
    if (ir > cr){ dw = CW; dh = CW/ir; } else { dh = CH; dw = CH*ir; }
    const dx = (CW-dw)/2, dy = (CH-dh)/2;
    ctx.save();
    ctx.translate(fx, fy);
    ctx.scale(zoom, zoom);
    ctx.translate(-fx, -fy);
    ctx.drawImage(img, dx, dy, dw, dh);
    ctx.restore();
  }

  function drawTopBar(page){
    ctx.fillStyle = "rgba(10,11,14,0.55)";
    ctx.fillRect(0,0,CW,TOPBAR_H);
    const g = ctx.createLinearGradient(0,0,CW,0);
    g.addColorStop(0, hexToRgba(state.brand.color, 0.28));
    g.addColorStop(1, "rgba(10,11,14,0.0)");
    ctx.fillStyle = g; ctx.fillRect(0,0,CW,TOPBAR_H);
    ctx.fillStyle = state.brand.color; ctx.fillRect(0, TOPBAR_H-3, CW, 3);

    ctx.textBaseline = "middle"; ctx.textAlign = "left";
    ctx.fillStyle = "#F3F5F8"; ctx.font = '700 34px "Space Grotesk"';
    ctx.fillText(state.brand.title || "Website", 48, TOPBAR_H/2 - 8);
    ctx.font = '400 19px Inter'; ctx.fillStyle = "rgba(255,255,255,0.62)";
    ctx.fillText(page.name || "", 48, TOPBAR_H/2 + 20);

    if (state.brand.url){
      ctx.textAlign = "right"; ctx.font = '400 22px Inter'; ctx.fillStyle = "rgba(255,255,255,0.8)";
      ctx.fillText(state.brand.url, CW-48, TOPBAR_H/2);
      ctx.textAlign = "left";
    }
  }

  function drawPinDot(pin, number, localT){
    const cx = pin.x*CW, cy = pin.y*CH;
    const tSince = localT - pin._slotStart;
    const scale = tSince < PIN_APPEAR ? easeOutBack(tSince/PIN_APPEAR) : 1;
    const r = 22*Math.max(scale,0);
    ctx.save();
    ctx.globalAlpha = clamp(scale,0,1);
    ctx.beginPath(); ctx.arc(cx,cy,r+9,0,Math.PI*2);
    ctx.strokeStyle = hexToRgba(state.brand.color,0.5); ctx.lineWidth = 3; ctx.stroke();
    ctx.beginPath(); ctx.arc(cx,cy,r,0,Math.PI*2);
    ctx.fillStyle = state.brand.color; ctx.fill();
    ctx.strokeStyle = "#0B0C10"; ctx.lineWidth = 3; ctx.stroke();
    ctx.fillStyle = "#0B0C10"; ctx.font = '700 22px Inter';
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(String(number), cx, cy+1);
    ctx.restore();
    ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
  }

  function drawPopup(pin, number, localT){
    const cx = pin.x*CW, cy = pin.y*CH;
    const tSince = localT - pin._slotStart;
    let boxAlpha = 1;
    if (tSince < PIN_APPEAR) boxAlpha = clamp(tSince/PIN_APPEAR,0,1);
    const tSinceHoldEnd = localT - pin._holdEnd;
    if (tSinceHoldEnd > 0) boxAlpha = clamp(1 - tSinceHoldEnd/PIN_TRANSITION, 0, 1);
    if (boxAlpha <= 0.01) return;

    const lineH = 38;
    const boxH = 72 + pin._lines.length*lineH;
    let bx = cx < CW*0.58 ? cx+50 : cx-50-POPUP_WIDTH;
    let by = cy > CH*0.4 ? cy-boxH-46 : cy+46;
    bx = clamp(bx, 30, CW-POPUP_WIDTH-30);
    by = clamp(by, TOPBAR_H+20, CH-boxH-30);

    ctx.save();
    ctx.globalAlpha = boxAlpha;

    ctx.strokeStyle = hexToRgba(state.brand.color, 0.55); ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx,cy);
    ctx.lineTo(bx + (cx < bx ? 0 : POPUP_WIDTH), by + boxH/2);
    ctx.stroke();

    roundRect(ctx, bx, by, POPUP_WIDTH, boxH, 16);
    ctx.fillStyle = "rgba(15,17,21,0.94)"; ctx.fill();
    ctx.strokeStyle = hexToRgba(state.brand.color, 0.7); ctx.lineWidth = 2; ctx.stroke();

    ctx.fillStyle = state.brand.color;
    ctx.fillRect(bx+12, by+12, 5, boxH-24);

    ctx.fillStyle = state.brand.color; ctx.font = '700 19px Inter';
    ctx.fillText("MARKER " + number, bx+POPUP_PAD, by+34);

    const typeElapsed = localT - pin._appearEnd;
    const charCount = typeElapsed < 0 ? 0 : clamp(Math.floor(typeElapsed/TYPE_SPEED), 0, pin._fullText.length);
    const revealed = pin._fullText.slice(0, charCount);
    ctx.font = '400 25px Inter';
    const lines = wrapCanvasText(ctx, revealed, POPUP_INNER_WIDTH);
    ctx.fillStyle = "#E7EAF0";
    lines.forEach((line,i) => ctx.fillText(line, bx+POPUP_PAD, by+66+i*lineH));

    if (charCount > pin._lastCharCount){
      if (localT - pin._lastTickTime >= 65){
        playSound("type", 0.15);
        pin._lastTickTime = localT;
      }
      pin._lastCharCount = charCount;
    }

    if (charCount < pin._fullText.length){
      const blink = Math.floor(localT/420) % 2 === 0;
      if (blink){
        const lastLine = lines[lines.length-1] || "";
        const w = ctx.measureText(lastLine).width;
        ctx.fillStyle = "#E7EAF0";
        ctx.fillRect(bx+POPUP_PAD+w+3, by+66+(lines.length-1)*lineH-22, 3, 26);
      }
    }
    ctx.restore();
  }

  function drawPage(page, localT){
    const dur = page._duration;
    let alpha = localT < ZOOM_IN ? localT/ZOOM_IN : 1;
    const remaining = dur - localT;
    if (remaining < PAGE_EXIT) alpha = Math.min(alpha, Math.max(0, remaining/PAGE_EXIT));

    let activePin = null, activeIndex = -1;
    for (let i=0;i<page.pins.length;i++){
      const pin = page.pins[i];
      if (localT >= pin._slotStart && localT < pin._slotEnd){ activePin = pin; activeIndex = i; break; }
    }

    let fx = CW/2, fy = CH/2, zoom = 1;
    if (activePin){
      const tSince = localT - activePin._slotStart;
      const pIn = clamp(tSince/PIN_APPEAR, 0, 1);
      const tSinceHoldEnd = localT - activePin._holdEnd;
      const pOut = tSinceHoldEnd > 0 ? 1 - clamp(tSinceHoldEnd/PIN_TRANSITION, 0, 1) : 1;
      const strength = pIn*pOut;
      fx = lerp(CW/2, activePin.x*CW, strength);
      fy = lerp(CH/2, activePin.y*CH, strength);
      zoom = lerp(1, MAX_ZOOM, strength);
    }

    ctx.save();
    ctx.globalAlpha = clamp(alpha,0,1);
    drawStageBackdrop(page.img);
    drawContainImageZoomed(page.img, fx, fy, zoom);
    drawTopBar(page);
    ctx.restore();

    if (activePin){
      if (!activePin._poppedSound){ playSound("pop", 0.42); activePin._poppedSound = true; }
      if (localT >= activePin._typeEnd && !activePin._confirmedSound){ playSound("confirm", 0.32); activePin._confirmedSound = true; }
      drawPinDot(activePin, activeIndex+1, localT);
      drawPopup(activePin, activeIndex+1, localT);
    }
  }

  function drawEndCard(t){
    ctx.fillStyle = "#0F1115"; ctx.fillRect(0,0,CW,CH);
    const fadeIn = 600, fadeOut = 600;
    let alpha = t < fadeIn ? t/fadeIn : 1;
    if (t > END_CARD - fadeOut) alpha = Math.max(0, (END_CARD - t)/fadeOut);
    ctx.save();
    ctx.globalAlpha = clamp(alpha,0,1);
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillStyle = "#F3F5F8"; ctx.font = '700 88px "Space Grotesk"';
    const title = state.brand.title || "Website";
    ctx.fillText(title, CW/2, CH/2-30);
    const titleW = ctx.measureText(title).width;
    const barW = titleW * clamp(t/900,0,1);
    ctx.fillStyle = state.brand.color;
    ctx.fillRect(CW/2-barW/2, CH/2+16, barW, 5);
    ctx.font = '400 30px Inter'; ctx.fillStyle = "rgba(255,255,255,0.7)";
    ctx.fillText(state.brand.url || "Walkthrough complete", CW/2, CH/2+66);
    ctx.restore();
    ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
  }

  let lastDrawnPageId = null, playedEndCardSound = false;

  function drawFrame(t){
    ctx.clearRect(0,0,CW,CH);
    ctx.fillStyle = "#0F1115"; ctx.fillRect(0,0,CW,CH);
    if (t >= state.totalPagesDuration){
      if (!playedEndCardSound){ playSound("outro", 0.55); playedEndCardSound = true; }
      drawEndCard(t - state.totalPagesDuration);
      return;
    }
    let page = state.pages[0], localT = t;
    for (const p of state.pages){
      if (t < p._pageStart + p._duration){ page = p; localT = t - p._pageStart; break; }
    }
    if (page.id !== lastDrawnPageId){ lastDrawnPageId = page.id; playSound("transition", 0.5); }
    drawPage(page, localT);
  }

  // ---------- audio engine (Mixkit sound effects) ----------
  let audioCtx = null, audioDest = null, muted = false;
  const soundBuffers = {};

  async function initAudio(){
    if (audioCtx){
      if (audioCtx.state === "suspended"){ try{ await audioCtx.resume(); } catch(e){ /* ignore */ } }
      return;
    }
    try{
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      audioDest = audioCtx.createMediaStreamDestination();
    } catch(e){ audioCtx = null; return; }
    await Promise.all(Object.keys(SOUND_URLS).map(async key => {
      try{
        const res = await fetch(SOUND_URLS[key]);
        const arr = await res.arrayBuffer();
        soundBuffers[key] = await audioCtx.decodeAudioData(arr);
      } catch(e){
        console.warn("Sound effect unavailable, continuing without it:", key, e);
        soundBuffers[key] = null;
      }
    }));
  }

  function playSound(key, volume){
    if (muted || !audioCtx || !soundBuffers[key]) return;
    try{
      const src = audioCtx.createBufferSource();
      src.buffer = soundBuffers[key];
      const gain = audioCtx.createGain();
      gain.gain.value = volume;
      src.connect(gain);
      gain.connect(audioCtx.destination);
      if (audioDest) gain.connect(audioDest);
      src.start();
    } catch(e){ /* best-effort */ }
  }

  muteBtn.addEventListener("click", () => {
    muted = !muted;
    muteBtn.textContent = muted ? "🔇" : "🔊";
    muteBtn.title = muted ? "Unmute sound effects" : "Mute sound effects";
    muteBtn.setAttribute("aria-label", muteBtn.title);
  });

  // ---------- playback / recording ----------
  let rafId = null, playStartTime = null, mediaRecorder = null, chunks = [], manualStop = false, isRecordingRun = false;

  const canExport = ("captureStream" in HTMLCanvasElement.prototype) && (typeof MediaRecorder !== "undefined");
  if (!canExport){
    generateBtn.disabled = true;
    generateBtn.title = "Video export needs a Chromium browser (Chrome/Edge) or Firefox.";
  }

  async function ensureFonts(){
    try{
      await Promise.all([
        document.fonts.load('700 88px "Space Grotesk"'),
        document.fonts.load('400 25px "Inter"'),
        document.fonts.load('700 19px "Inter"')
      ]);
    } catch(e){ /* fonts best-effort */ }
  }

  function pickMime(){
    const cands = ["video/webm;codecs=vp9","video/webm;codecs=vp8","video/webm"];
    for (const c of cands) if (MediaRecorder.isTypeSupported(c)) return c;
    return "";
  }

  async function openPlayback(record){
    if (!state.pages.length){ alert("Add at least one page (screenshot) first."); return; }
    await Promise.all([ensureFonts(), initAudio()]);
    buildTimeline();
    lastDrawnPageId = null;
    playedEndCardSound = false;
    overlay.classList.add("open");
    downloadLink.hidden = true; downloadLink.removeAttribute("href");
    stopBtn.textContent = "Stop";
    isRecordingRun = !!record;
    manualStop = false;
    chunks = [];
    if (isRecordingRun){
      const videoStream = recCanvas.captureStream(30);
      const tracks = [...videoStream.getVideoTracks()];
      if (audioDest) tracks.push(...audioDest.stream.getAudioTracks());
      const stream = new MediaStream(tracks);
      const mime = pickMime();
      try{
        mediaRecorder = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: 10000000 } : undefined);
      } catch(e){
        mediaRecorder = new MediaRecorder(stream);
      }
      mediaRecorder.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
      mediaRecorder.onstop = onRecorderStop;
      mediaRecorder.start();
    }
    playStartTime = null;
    rafId = requestAnimationFrame(loop);
  }

  function loop(ts){
    if (playStartTime === null) playStartTime = ts;
    const elapsed = ts - playStartTime;
    updateProgress(elapsed, state.grandTotal);
    if (elapsed >= state.grandTotal){
      drawFrame(state.grandTotal);
      endPlayback();
      return;
    }
    drawFrame(elapsed);
    rafId = requestAnimationFrame(loop);
  }

  function updateProgress(elapsed, total){
    const pct = clamp((elapsed/total)*100, 0, 100);
    progressFill.style.width = pct + "%";
    overlayStatus.textContent = formatTime(elapsed) + " / " + formatTime(total) + (isRecordingRun ? " · recording" : " · preview");
  }

  function endPlayback(){
    if (rafId) cancelAnimationFrame(rafId);
    if (isRecordingRun && mediaRecorder && mediaRecorder.state === "recording"){
      mediaRecorder.stop();
    } else {
      stopBtn.textContent = "Close";
    }
  }

  function onRecorderStop(){
    if (manualStop){ manualStop = false; chunks = []; return; }
    const blob = new Blob(chunks, { type: "video/webm" });
    const url = URL.createObjectURL(blob);
    downloadLink.href = url;
    downloadLink.download = (slug(state.brand.title) || "website") + "-walkthrough.webm";
    downloadLink.hidden = false;
    stopBtn.textContent = "Close";
    overlayStatus.textContent = "Video ready — " + formatTime(state.grandTotal) + " · 1920×1080";
    downloadLink.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

  stopBtn.addEventListener("click", () => {
    if (rafId) cancelAnimationFrame(rafId);
    if (mediaRecorder && mediaRecorder.state === "recording"){
      manualStop = true;
      mediaRecorder.stop();
    }
    overlay.classList.remove("open");
  });

  previewBtn.addEventListener("click", () => openPlayback(false));
  generateBtn.addEventListener("click", () => openPlayback(true));

  // ---------- master render ----------
  function renderAll(){
    renderPagesList();
    renderStage();
    renderPinsList();
    updateEstimate();
  }

  // ---------- init ----------
  loadProject();
  brandTitleInput.value = state.brand.title;
  brandUrlInput.value = state.brand.url;
  brandColorInput.value = state.brand.color;
  document.documentElement.style.setProperty("--accent-dyn", state.brand.color);
  renderAll();

})();
