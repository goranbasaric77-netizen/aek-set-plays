/* AEK Set - Plays · Drawing board (2026-11-19)
   A third tab next to Week planner and History: draw set plays on a 3D-style half pitch, in the look of the staff's
   current drawings (striped light pitch, dark lines, standing figures with names, dashed runs, ball arcs, zones).
   Everything lives in pitch metres (x along the goal line, y out from the goal line, z up) and is projected to the screen,
   so the same drawing can be viewed from any angle. Drawings are grouped by the app's set-play list (PLAYS) and saved in
   localStorage under BOARD_KEY; they are part of Export / Import backup (see dump / restore).
   Public API: window.SPBoard = { mount(el), unmount(), dump(), restore(data) } */
(function () {
  "use strict";
  const BOARD_KEY = "aek-setplays-boards-v1";
  const W = 1100, H = 640;                       // stage size in SVG units (same proportion as the current drawings)
  const HALF_W = 34, HALF_L = 52.5, FULL_L = 105; // pitch half-width, half-length and full length in metres
  const FIG = 5;                                 // figure height in metres (exaggerated on purpose, as in the current drawings)

  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const uid = () => Math.random().toString(36).slice(2, 9);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const rad = (d) => (d * Math.PI) / 180;
  const plays = () => (typeof PLAYS !== "undefined" ? PLAYS : [{ id: "o-corner", g: "off", n: "Corner" }]);
  const groups = () => (typeof GROUPS !== "undefined" ? GROUPS : { off: "Offensive set pieces", def: "Defensive set pieces" });
  const squad = () => (typeof roster !== "undefined" ? roster : []).map((r) => String(r).replace(/^\d+\s+/, "").trim()).filter(Boolean);
  const playName = (id) => { const p = plays().find((x) => x.id === id); return p ? p.n + (p.s ? " · " + p.s : "") : ""; };

  /* ───────── camera views ───────── */
  const VIEWS = [
    // Facing the goal from the pitch (az 180), +x is on the LEFT of the screen. "Right" always means the attacking right, so x < 0.
    { id: "corner-r", n: "Corner · right", az: 140, el: 33, zoom: 1.5, tx: -14, ty: 6 },
    { id: "corner-l", n: "Corner · left", az: 220, el: 33, zoom: 1.5, tx: 14, ty: 6 },
    { id: "fk-central", n: "Free kick · central", az: 180, el: 35, zoom: 1.45, tx: 0, ty: 13 },
    { id: "wide-r", n: "Wide · right", az: 152, el: 33, zoom: 1.4, tx: -8, ty: 12 },
    { id: "wide-l", n: "Wide · left", az: 208, el: 33, zoom: 1.4, tx: 8, ty: 12 },
    { id: "behind-goal", n: "From behind the goal", az: 0, el: 35, zoom: 1.5, tx: 0, ty: 13 },
    // Straight views of the half: the camera is square to the pitch, so the lines run level and upright instead of slanted.
    // The pitch is stretched to fill the whole board: a high tilt makes it tall, kx stretches it sideways (proportions are
    // no longer true, a circle becomes an ellipse; the figures keep their shape).
    { id: "half-r", n: "Side · goal right", az: 90, el: 48, zoom: 0.95, tx: 0, ty: 24.6, kx: 1.56 },
    { id: "half-l", n: "Side · goal left", az: 270, el: 48, zoom: 0.95, tx: 0, ty: 24.6, kx: 1.56 },
    { id: "half-up", n: "Front · wide", az: 180, el: 50, zoom: 1.06, tx: 0, ty: 22, kx: 1.16 },
    { id: "top", n: "Top view", az: 180, el: 90, zoom: 0.85, tx: 0, ty: 25 },
  ];
  const viewOf = (id) => VIEWS.find((v) => v.id === id) || VIEWS[0];
  const camFrom = (v) => ({ az: v.az, el: v.el, zoom: v.zoom, tx: v.tx, ty: v.ty, kx: v.kx || 1 });

  /* ───────── templates: a starting shape for each kind of set play (positions in metres, side = +1 right, -1 left) ───────── */
  const CORE = ["Mantalos", "Majer", "Jovic", "Varga", "Relvas", "Moukoudi", "Arriaga", "Vitalis", "Rota", "Pilios"];
  function names(n) {
    const s = squad(), out = CORE.filter((x) => s.includes(x));
    for (const x of s) { if (out.length >= n) break; if (!out.includes(x) && x !== "Strakosha") out.push(x); }
    while (out.length < n) out.push("Player " + (out.length + 1));
    return out.slice(0, n);
  }
  const gkName = () => (squad().includes("Strakosha") ? "Strakosha" : squad()[0] || "GK");
  const P = (team, x, y, name) => ({ id: uid(), t: "p", team, x, y, name: name || "" });
  const TEMPLATES = [
    { id: "off-corner", n: "Offensive corner", view: (s) => (s > 0 ? "corner-r" : "corner-l"), build(s) {
      const n = names(10);
      return [{ id: uid(), t: "b", x: 33.6 * s, y: 0.4 }, P("aek", 34.6 * s, -0.7, n[0]), P("aek", 27 * s, 5, n[1]),
        P("aek", 1.2 * s, 2.6, n[2]), P("aek", 2.6 * s, 9.5, n[3]), P("aek", -1.2 * s, 11, n[4]), P("aek", -4.5 * s, 9.5, n[5]),
        P("aek", 5.5 * s, 12.5, n[6]), P("aek", -1 * s, 18.5, n[7]), P("aek", 9 * s, 36, n[8]), P("aek", -9 * s, 38, n[9])];
    } },
    { id: "def-corner", n: "Defensive corner", view: (s) => (s > 0 ? "corner-r" : "corner-l"), build(s) {
      const n = names(10);
      return [{ id: uid(), t: "b", x: 33.6 * s, y: 0.4 }, P("opp", 34.8 * s, -0.8, ""), P("gk", 0.4 * s, 1.2, gkName()),
        P("aek", 3.9 * s, 0.6, n[8]), P("aek", -3.9 * s, 0.9, n[9]), P("aek", 4.6 * s, 5.4, n[4]), P("aek", 0.6 * s, 5.6, n[5]), P("aek", -3.6 * s, 5.6, n[3]),
        P("aek", 6 * s, 9.5, n[6]), P("aek", 0.5 * s, 10.5, n[2]), P("aek", -5 * s, 10, n[7]), P("aek", 19 * s, 9, n[0]), P("aek", 2 * s, 19, n[1])];
    } },
    { id: "off-wide", n: "Wide free kick", view: (s) => (s > 0 ? "wide-r" : "wide-l"), build(s) {
      const n = names(10);
      return [{ id: uid(), t: "b", x: 25 * s, y: 24 }, P("aek", 26.2 * s, 25.4, n[0]), P("aek", 27.6 * s, 23.2, n[1]),
        P("aek", 8 * s, 17, n[2]), P("aek", 5 * s, 17.4, n[3]), P("aek", 2 * s, 17.4, n[4]), P("aek", -1 * s, 17.4, n[5]), P("aek", -4 * s, 17.4, n[6]),
        P("aek", 4 * s, 23, n[7]), P("aek", 8 * s, 40, n[8]), P("aek", -8 * s, 42, n[9])];
    } },
    { id: "off-central", n: "Central free kick", view: () => "fk-central", build(s) {
      const n = names(10);
      return [{ id: uid(), t: "b", x: 4 * s, y: 30 }, P("aek", 5.4 * s, 31.6, n[0]), P("aek", 2.4 * s, 31.8, n[1]),
        P("aek", 9 * s, 17.4, n[2]), P("aek", 6 * s, 17.4, n[3]), P("aek", 3 * s, 17.4, n[4]), P("aek", 0, 17.4, n[5]), P("aek", -3 * s, 17.4, n[6]), P("aek", -6 * s, 17.4, n[7]),
        P("aek", 10 * s, 42, n[8]), P("aek", -10 * s, 43, n[9])];
    } },
    { id: "throw-in", n: "Throw in", view: (s) => (s > 0 ? "wide-r" : "wide-l"), build(s) {
      const n = names(10);
      return [{ id: uid(), t: "b", x: 34.3 * s, y: 16 }, P("aek", 35.3 * s, 16.4, n[8]), P("aek", 27 * s, 12, n[0]), P("aek", 26 * s, 20, n[1]),
        P("aek", 16 * s, 9, n[2]), P("aek", 6 * s, 8, n[3]), P("aek", 1 * s, 10.5, n[4]), P("aek", -4 * s, 8, n[5]), P("aek", 9 * s, 19, n[6]),
        P("aek", -2 * s, 21, n[7]), P("aek", 6 * s, 40, n[9])];
    } },
    { id: "empty", n: "Empty pitch", view: () => "fk-central", build() { return []; } },
  ];

  /* ───────── state ───────── */
  let store = { list: [], cur: null };
  let board = null, sel = null, tool = "select", armed = null, side = 1, host = null, dragging = null, undo = [], redo = [], saveT = null, raf = 0;
  function load() { try { const j = JSON.parse(localStorage.getItem(BOARD_KEY) || "null"); if (j && Array.isArray(j.list)) store = j; } catch (e) { /* keep empty */ } }
  function persist() {
    try { localStorage.setItem(BOARD_KEY, JSON.stringify(store)); if (typeof setStatus === "function") setStatus("Drawing saved on this computer · " + new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })); }
    catch (e) { if (typeof setStatus === "function") setStatus("Could not save the drawing in this browser. Use Export backup."); }
  }
  function touch() { if (!board) return; board.updated = new Date().toISOString(); clearTimeout(saveT); saveT = setTimeout(persist, 300); }
  function snapshot() { undo.push(JSON.stringify(board.items)); if (undo.length > 60) undo.shift(); redo = []; }
  function newBoard(play, tplId) {
    const tpl = TEMPLATES.find((t) => t.id === tplId) || TEMPLATES[0];
    const b = { id: uid(), play, name: "", opponent: "", notes: "", style: "paper", cam: camFrom(viewOf(tpl.view(side))), items: tpl.build(-side), updated: new Date().toISOString() };
    store.list.push(b); store.cur = b.id; board = b; sel = null; undo = []; redo = []; persist();
    return b;
  }
  const guessTemplate = (play) => (/corner|short/.test(play) ? (play.startsWith("d-") ? "def-corner" : "off-corner") : /ti-|throwin/.test(play) ? "throw-in" : /wide/.test(play) ? "off-wide" : /fk|indirect/.test(play) ? "off-central" : "empty");

  /* ───────── projection (parallel, like the current drawings): pitch metres -> stage ───────── */
  const scale = () => 12.5 * board.cam.zoom;
  function proj(x, y, z) {
    const c = board.cam, a = rad(c.az), dx = x - c.tx, dy = y - c.ty, s = scale();
    const xr = dx * Math.cos(a) - dy * Math.sin(a), yr = dx * Math.sin(a) + dy * Math.cos(a);
    return [W / 2 + s * (c.kx || 1) * xr, H / 2 - s * (yr * Math.sin(rad(c.el)) + (z || 0) * Math.cos(rad(c.el))), yr];
  }
  function unproj(sx, sy) {                       // stage -> ground (z = 0)
    const c = board.cam, a = rad(c.az), s = scale();
    const xr = (sx - W / 2) / (s * (c.kx || 1)), yr = -(sy - H / 2) / (s * Math.sin(rad(c.el)));
    return [c.tx + xr * Math.cos(a) + yr * Math.sin(a), c.ty - xr * Math.sin(a) + yr * Math.cos(a)];
  }
  const pt = (x, y, z) => { const p = proj(x, y, z); return p[0].toFixed(1) + "," + p[1].toFixed(1); };
  const poly = (pts, z) => pts.map((p) => pt(p[0], p[1], z === undefined ? p[2] : z)).join(" ");

  /* ───────── pitch ───────── */
  function pitchSvg() {
    const paper = board.style !== "grass";
    const C = paper ? { a: "#ffffff", b: "#e7e7e5", line: "#3b3b3d", out: "#f6f6f4", net: "rgba(120,120,125,.34)", post: "#55565a" }
      : { a: "#4f9a4f", b: "#478f48", line: "#f4f7f2", out: "#3f8442", net: "rgba(255,255,255,.3)", post: "#ffffff" };
    let s = `<rect x="0" y="0" width="${W}" height="${H}" fill="${C.out}"/>`;
    for (let i = -2, n = 0; i < 13; i++, n++) {           // mowing stripes parallel to the goal line, 5.5 m wide
      const y0 = i * 5.5, y1 = y0 + 5.5;
      s += `<polygon points="${poly([[-60, y0], [60, y0], [60, y1], [-60, y1]], 0)}" fill="${n % 2 ? C.b : C.a}"/>`;
    }
    const L = (pts, extra) => `<polyline points="${poly(pts, 0)}" fill="none" stroke="${C.line}" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round" ${extra || ""}/>`;
    const arc = (cx, cy, r, a0, a1) => { const p = []; for (let i = 0; i <= 28; i++) { const a = rad(a0 + ((a1 - a0) * i) / 28); p.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); } return p; };
    // The attacking half, 68 x 52.5 m: the goal is on the line y = 0, the halfway line on y = HALF_L.
    s += L([[-HALF_W, HALF_L], [-HALF_W, 0], [HALF_W, 0], [HALF_W, HALF_L], [-HALF_W, HALF_L]]) + L(arc(0, HALF_L, 9.15, 180, 360));
    for (const [y0, d] of [[0, 1]]) {                      // penalty area, goal area, arc, spot, corner arcs
      s += L([[-20.16, y0], [-20.16, y0 + d * 16.5], [20.16, y0 + d * 16.5], [20.16, y0]]) + L([[-9.16, y0], [-9.16, y0 + d * 5.5], [9.16, y0 + d * 5.5], [9.16, y0]]);
      s += L(arc(0, y0 + d * 11, 9.15, d > 0 ? 37 : 217, d > 0 ? 143 : 323));
      s += L(arc(-HALF_W, y0, 1, d > 0 ? 0 : 270, d > 0 ? 90 : 360)) + L(arc(HALF_W, y0, 1, d > 0 ? 90 : 180, d > 0 ? 180 : 270));
      const spot = proj(0, y0 + d * 11, 0); s += `<ellipse cx="${spot[0].toFixed(1)}" cy="${spot[1].toFixed(1)}" rx="3.4" ry="1.9" fill="${C.line}"/>`;
    }
    return { svg: s, C };
  }
  function goalSvg(C, y0, dir) {                           // drawn larger than life, like the figures: a true 7.32 x 2.44 m goal next to 5 m figures
    const x = 7, h = FIG * 1.3, d = y0 - dir * 3.6, g = y0;                 // looked like a hockey goal. Bar 1.3x a player (as in reality: 2.44 m vs 1.88 m), 14 m wide, inside the goal area.
    const face = (pts) => `<polygon points="${poly(pts)}" fill="${C.net}" stroke="${C.post}" stroke-width="1.1" stroke-linejoin="round"/>`;
    let s = face([[-x, d, 0], [x, d, 0], [x, d, h], [-x, d, h]]) + face([[-x, g, 0], [-x, d, 0], [-x, d, h], [-x, g, h]]) + face([[x, g, 0], [x, d, 0], [x, d, h], [x, g, h]])
      + face([[-x, g, h], [x, g, h], [x, d, h], [-x, d, h]]);
    s += `<polyline points="${poly([[-x, g, 0], [-x, g, h], [x, g, h], [x, g, 0]])}" fill="none" stroke="${C.post}" stroke-width="4.6" stroke-linejoin="round" stroke-linecap="round"/>`;
    return s;
  }

  /* ───────── player photos ─────────
     heads/<key>.webp is the player's head on a transparent background (cut from the Player Hub portraits); heads/aek-crest.png is the crest (no leading underscore: GitHub Pages skips such files).
     A photo is fetched once and kept as a data URL, because the exported picture can only carry embedded images. */
  const PHOTO_FILES = ["alexiou", "argyriou", "ariaga", "balamotis", "brignoli", "christakopoulos", "gacinovic", "georgiev", "joaomario", "jovic", "kairinen",
    "kaloskamis", "koita", "kutesa", "likogiannis", "majer", "mantalos", "marin", "moukoudi", "pilios", "relvas", "rota", "sahabo", "strakosha", "varga", "vida",
    "vitalis", "zine", "zubkov"];
  const PHOTO_ALIAS = { arriaga: "ariaga", lykogiannis: "likogiannis", zini: "zine" };       // squad list spelling -> file name
  const photos = {};                                                                           // key -> data URL | "wait" | "none"
  function photoKey(name) {
    const k = String(name || "").toLowerCase().normalize("NFD").replace(/[^a-z]/g, "");
    const f = PHOTO_ALIAS[k] || k;
    return PHOTO_FILES.includes(f) || f === "grb" ? f : "";
  }
  function photoOf(name) {
    const k = photoKey(name);
    if (!k || (board && board.photos === false && k !== "grb")) return "";
    if (!photos[k]) {
      photos[k] = "wait";
      fetch(k === "grb" ? "heads/aek-crest.png" : "heads/" + k + ".webp").then((r) => (r.ok ? r.blob() : Promise.reject())).then((b) => new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(b); }))
        .then((url) => { photos[k] = url; draw(); }).catch(() => { photos[k] = "none"; });
    }
    return photos[k].startsWith("data:") ? photos[k] : "";
  }

  /* ───────── figures ───────── */
  /* ───────── player figure: the shape Goran sent on 19.11.2026 (cartoon player from the front) ─────────
     V-neck shirt with black stripes and short sleeves with black cuffs, arms hanging to mid-thigh, black shorts to above the knee,
     long yellow socks with two black bands, white boots, legs a little apart. The face is the player's photo (heads/<key>.webp,
     cut from the Player Hub portraits); keeper green, opponent black; no photo = drawn head.
     Units: feet on y = 0, top of the head at about -117. */
  const KIT = { aek: { shirt: "url(#sbAekShirt)", trim: "#17181b", shorts: "#17181b", socks: "#f5c400", band: "#17181b" },
    gk: { shirt: "#2bb24c", trim: "#17181b", shorts: "#17181b", socks: "#2bb24c", band: "#17181b" },
    opp: { shirt: "#24252a", trim: "#d9d9dc", shorts: "#24252a", socks: "#24252a", band: "#d9d9dc" },
    oppgk: { shirt: "#e0572f", trim: "#17181b", shorts: "#17181b", socks: "#e0572f", band: "#17181b" } };
  const DEFS = `<defs>
    <pattern id="sbAekShirt" patternUnits="userSpaceOnUse" width="6.4" height="10" x="-1.2"><rect width="6.4" height="10" fill="#f8d200"/><rect x="0" width="2.4" height="10" fill="#17181b"/></pattern>
    <linearGradient id="sbShade" x1="0" x2="1" y1="0" y2="0"><stop offset="0" stop-color="#fff" stop-opacity=".2"/><stop offset=".5" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".22"/></linearGradient>
    <clipPath id="sbFace"><ellipse cx="0" cy="-107.4" rx="7.5" ry="9.4"/></clipPath>
  </defs>`;
  const FIG_PATH = {
    knees: "M-12.5 -40 L-12.2 -32 L-5.7 -32 L-5.6 -40 Z M12.5 -40 L12.2 -32 L5.7 -32 L5.6 -40 Z",
    socks: "M-12.6 -33 L-12.1 -10.2 L-6.2 -10.2 L-5.5 -33 Z M12.6 -33 L12.1 -10.2 L6.2 -10.2 L5.5 -33 Z",
    bands: "M-12.55 -31.9 L-5.55 -31.9 L-5.6 -30.7 L-12.5 -30.7 Z M-12.5 -29.7 L-5.6 -29.7 L-5.65 -28.5 L-12.45 -28.5 Z M12.55 -31.9 L5.55 -31.9 L5.6 -30.7 L12.5 -30.7 Z M12.5 -29.7 L5.6 -29.7 L5.65 -28.5 L12.45 -28.5 Z",
    boots: "M-16.4 -1.4 Q-16.6 -5.6 -12.8 -8.6 L-12.2 -10.8 L-6 -10.8 Q-5.2 -6 -5.8 -0.8 L-14.6 -0.1 Q-16.3 0 -16.4 -1.4 Z M16.4 -1.4 Q16.6 -5.6 12.8 -8.6 L12.2 -10.8 L6 -10.8 Q5.2 -6 5.8 -0.8 L14.6 -0.1 Q16.3 0 16.4 -1.4 Z",
    laces: "M-12.2 -7.2 L-8.4 -7.6 M-12.6 -5.6 L-8.6 -6 M12.2 -7.2 L8.4 -7.6 M12.6 -5.6 L8.6 -6",
    shorts: "M-12.9 -63.4 L13.1 -63.4 L14 -39.2 L1.3 -39.2 L0.2 -45.4 L-0.8 -39.2 L-13.6 -39.2 Z",
    arms: "M-19.6 -80 L-19.9 -55.4 Q-20.2 -48.8 -17.6 -46.8 Q-15.1 -46.8 -14.8 -50.2 L-15.3 -55.6 L-14.6 -79.4 Z M19.6 -80 L19.9 -55.4 Q20.2 -48.8 17.6 -46.8 Q15.1 -46.8 14.8 -50.2 L15.3 -55.6 L14.6 -79.4 Z",
    shirt: "M-6.6 -95.6 L-15.6 -93 Q-18.6 -92 -19.1 -88.6 L-20.1 -78.6 L-14.6 -78.2 L-13.8 -84 L-13 -62.6 L13 -62.6 L13.8 -84 L14.6 -78.2 L20.1 -78.6 L19.1 -88.6 Q18.6 -92 15.6 -93 L6.6 -95.6 L0 -88.6 Z",
    cuffs: "M-20.3 -80.8 L-14.7 -80.4 L-14.6 -78.2 L-20.1 -78.6 Z M20.3 -80.8 L14.7 -80.4 L14.6 -78.2 L20.1 -78.6 Z",
    collar: "M-6.6 -95.6 L0 -88.6 L6.6 -95.6 L5.1 -96 L0 -90.6 L-5.1 -96 Z",
    neck: "M-2.9 -99.6 L2.9 -99.6 L3.3 -93.6 L0 -90.6 L-3.3 -93.6 Z",
  };
  function figureSvg(it, selected) {
    const [sx, sy] = proj(it.x, it.y, 0), k = (scale() * FIG) / 104, o = "#26272b", skin = "#ecbf98", kit = KIT[it.team] || KIT.aek, F = FIG_PATH;
    const photo = it.team === "aek" || it.team === "gk" ? photoOf(it.name) : "";
    const crest = it.team === "aek" ? photoOf("_grb") : "";
    const line = (d, fill, w) => `<path d="${d}" fill="${fill}" stroke="${o}" stroke-width="${w || 1.1}" stroke-linejoin="round"/>`;
    const shade = (d) => `<path d="${d}" fill="url(#sbShade)"/>`;
    const head = photo
      ? `<ellipse cx="0" cy="-107.4" rx="7.7" ry="9.6" fill="${skin}"/><image href="${photo}" x="-8.9" y="-118" width="17.8" height="22.4" preserveAspectRatio="xMidYMin meet" clip-path="url(#sbFace)"/>
         <ellipse cx="0" cy="-107.4" rx="7.5" ry="9.4" fill="none" stroke="${o}" stroke-width=".9"/>`
      : `<ellipse cx="0" cy="-107.6" rx="6.8" ry="8.6" fill="${skin}" stroke="${o}" stroke-width="1.1"/>
         <path d="M-6.9 -108.6 Q-7.2 -117 0 -116.8 Q7.2 -117 6.9 -108.6 Q3.8 -112.4 0 -112 Q-3.8 -112.4 -6.9 -108.6 Z" fill="#2a211b" stroke="${o}" stroke-width=".9" stroke-linejoin="round"/>`;
    const body = `<ellipse cx="0" cy="0.4" rx="19" ry="4.6" fill="rgba(0,0,0,.16)"/>
      ${line(F.knees, skin)}${line(F.socks, kit.socks)}<path d="${F.bands}" fill="${kit.band}"/>${shade(F.socks)}
      ${line(F.boots, "#fbfbfb")}<path d="${F.laces}" stroke="#55565a" stroke-width=".7" fill="none" stroke-linecap="round"/>
      ${line(F.shorts, kit.shorts)}${shade(F.shorts)}
      ${line(F.arms, skin)}${shade(F.arms)}
      ${line(F.shirt, kit.shirt, 1.2)}<path d="${F.cuffs}" fill="${kit.trim}"/><path d="${F.collar}" fill="${kit.trim}"/>${shade(F.shirt)}
      ${crest ? `<image href="${crest}" x="3.6" y="-89.4" width="4.6" height="6.1"/>` : it.team === "aek" ? `<circle cx="5.9" cy="-86.4" r="2" fill="#17181b" stroke="#f8d200" stroke-width=".7"/>` : ""}
      ${line(F.neck, skin, 0.9)}${head}`;
    const fs = clamp(scale() * 0.78, 12, 21);
    const label = it.name ? `<text x="${sx.toFixed(1)}" y="${(sy - 122 * k).toFixed(1)}" text-anchor="middle" font-size="${fs.toFixed(1)}" class="sb-name">${esc(it.name)}</text>` : "";
    const ring = selected ? `<ellipse cx="${sx.toFixed(1)}" cy="${(sy + 1).toFixed(1)}" rx="${(24 * k).toFixed(1)}" ry="${(7.8 * k).toFixed(1)}" fill="rgba(245,196,0,.35)" stroke="#f5c400" stroke-width="2.4"/>` : "";
    return `<g data-id="${it.id}" class="sb-item sb-fig">${ring}<g transform="translate(${sx.toFixed(1)},${sy.toFixed(1)}) scale(${k.toFixed(3)})">${body}</g>
      <rect x="${(sx - 18 * k).toFixed(1)}" y="${(sy - 119 * k).toFixed(1)}" width="${(36 * k).toFixed(1)}" height="${(121 * k).toFixed(1)}" fill="transparent"/>${label}</g>`;
  }
  function ballSvg(it, selected) {
    const [sx, sy] = proj(it.x, it.y, 0), r = clamp(scale() * 0.4, 4.5, 11);
    return `<g data-id="${it.id}" class="sb-item">${selected ? `<circle cx="${sx.toFixed(1)}" cy="${sy.toFixed(1)}" r="${(r + 6).toFixed(1)}" fill="rgba(245,196,0,.4)" stroke="#f5c400" stroke-width="2"/>` : ""}
      <ellipse cx="${sx.toFixed(1)}" cy="${(sy + r * 0.2).toFixed(1)}" rx="${(r * 1.2).toFixed(1)}" ry="${(r * 0.45).toFixed(1)}" fill="rgba(0,0,0,.18)"/>
      <circle cx="${sx.toFixed(1)}" cy="${(sy - r * 0.75).toFixed(1)}" r="${r.toFixed(1)}" fill="#fff" stroke="#1d1e22" stroke-width="1.4"/>
      <path d="M${(sx - r * 0.38).toFixed(1)} ${(sy - r * 0.95).toFixed(1)} l${(r * 0.38).toFixed(1)} ${(-r * 0.32).toFixed(1)} l${(r * 0.38).toFixed(1)} ${(r * 0.32).toFixed(1)} l${(-r * 0.15).toFixed(1)} ${(r * 0.46).toFixed(1)} l${(-r * 0.46).toFixed(1)} 0 Z" fill="#1d1e22"/>
      <circle cx="${sx.toFixed(1)}" cy="${(sy - r * 0.75).toFixed(1)}" r="${(r + 7).toFixed(1)}" fill="transparent"/></g>`;
  }

  /* ───────── arrows and zones ───────── */
  const INK = { k: "#1b1c20", b: "#1f3fe0", r: "#e02424", g: "#12903f", o: "#f07c00", p: "#8a3fd6", y: "#f5c400", w: "#ffffff" };
  const INK_NAME = { k: "Black", b: "Blue", r: "Red", g: "Green", o: "Orange", p: "Purple", y: "Yellow", w: "White" };
  let ink = "k";                                           // colour for the next line; clicking a colour also recolours the selected line
  const KINDS = { run: { n: "Run", dash: "7 6", w: 2.2 }, pass: { n: "Pass", dash: "", w: 2.4 }, air: { n: "Ball in the air", dash: "", w: 2.4 }, block: { n: "Block / screen", dash: "6 5", w: 2.4 } };
  function arrowPts(it) {                                  // quadratic curve on the ground; "air" lifts it into an arc
    const out = [], len = Math.hypot(it.b[0] - it.a[0], it.b[1] - it.a[1]), lift = it.kind === "air" ? clamp(len * 0.22, 1.2, 7) : 0;
    for (let i = 0; i <= 26; i++) {
      const t = i / 26, u = 1 - t;
      out.push(proj(u * u * it.a[0] + 2 * u * t * it.c[0] + t * t * it.b[0], u * u * it.a[1] + 2 * u * t * it.c[1] + t * t * it.b[1], lift * 4 * t * u));
    }
    return out;
  }
  function arrowSvg(it, selected) {
    const p = arrowPts(it), k = KINDS[it.kind] || KINDS.run, col = INK[it.color] || INK.k, n = p.length;
    const d = p.map((q) => q[0].toFixed(1) + "," + q[1].toFixed(1)).join(" ");
    const ang = Math.atan2(p[n - 1][1] - p[n - 4][1], p[n - 1][0] - p[n - 4][0]), e = p[n - 1], hl = 13;
    const head = it.kind === "block"
      ? `<path d="M${(e[0] - Math.sin(ang) * 8).toFixed(1)} ${(e[1] + Math.cos(ang) * 8).toFixed(1)} L${(e[0] + Math.sin(ang) * 8).toFixed(1)} ${(e[1] - Math.cos(ang) * 8).toFixed(1)} M${(e[0] - Math.cos(ang) * 5 - Math.sin(ang) * 8).toFixed(1)} ${(e[1] - Math.sin(ang) * 5 + Math.cos(ang) * 8).toFixed(1)} L${(e[0] - Math.cos(ang) * 5 + Math.sin(ang) * 8).toFixed(1)} ${(e[1] - Math.sin(ang) * 5 - Math.cos(ang) * 8).toFixed(1)}" stroke="${col}" stroke-width="2.4" fill="none" stroke-linecap="round"/>`
      : `<path d="M${e[0].toFixed(1)} ${e[1].toFixed(1)} L${(e[0] - hl * Math.cos(ang - 0.36)).toFixed(1)} ${(e[1] - hl * Math.sin(ang - 0.36)).toFixed(1)} L${(e[0] - hl * Math.cos(ang + 0.36)).toFixed(1)} ${(e[1] - hl * Math.sin(ang + 0.36)).toFixed(1)} Z" fill="${col}"/>`;
    const shadow = it.kind === "air" ? `<polyline points="${[0, 0.25, 0.5, 0.75, 1].map((t) => { const u = 1 - t; return pt(u * u * it.a[0] + 2 * u * t * it.c[0] + t * t * it.b[0], u * u * it.a[1] + 2 * u * t * it.c[1] + t * t * it.b[1], 0); }).join(" ")}" fill="none" stroke="rgba(0,0,0,.13)" stroke-width="2" stroke-dasharray="2 5"/>` : "";
    return `<g data-id="${it.id}" class="sb-item">${shadow}${selected ? `<polyline points="${d}" fill="none" stroke="rgba(245,196,0,.55)" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/>` : ""}
      <polyline points="${d}" fill="none" stroke="${col}" stroke-width="${k.w}" stroke-dasharray="${k.dash}" stroke-linecap="round" stroke-linejoin="round"/>${head}
      <polyline points="${d}" fill="none" stroke="transparent" stroke-width="16"/></g>`;
  }
  const ZONE = { cyan: ["rgba(64,224,235,.30)", "#2ccfdc"], gray: ["rgba(90,90,95,.26)", "#6c6d72"], yellow: ["rgba(245,196,0,.32)", "#d9ad00"], red: ["rgba(224,36,36,.2)", "#e02424"] };
  function zonePts(it) {
    if (it.shape === "rect") return [[it.x - it.w, it.y - it.h], [it.x + it.w, it.y - it.h], [it.x + it.w, it.y + it.h], [it.x - it.w, it.y + it.h]];
    const p = []; for (let i = 0; i < 44; i++) { const a = (i / 44) * Math.PI * 2; p.push([it.x + it.w * Math.cos(a), it.y + it.h * Math.sin(a)]); } return p;
  }
  function zoneSvg(it, selected) {
    const c = ZONE[it.color] || ZONE.cyan;
    return `<g data-id="${it.id}" class="sb-item"><polygon points="${poly(zonePts(it), 0)}" fill="${c[0]}" stroke="${selected ? "#f5c400" : c[1]}" stroke-width="${selected ? 3 : 1.6}" stroke-linejoin="round"/></g>`;
  }
  function textSvg(it, selected) {
    const [sx, sy] = proj(it.x, it.y, 0), fs = clamp(scale() * 1.05, 12, 22), w = Math.max(30, String(it.text).length * fs * 0.6 + 14);
    return `<g data-id="${it.id}" class="sb-item"><rect x="${(sx - w / 2).toFixed(1)}" y="${(sy - fs * 1.05).toFixed(1)}" width="${w.toFixed(1)}" height="${(fs * 1.5).toFixed(1)}" rx="5" fill="${selected ? "#fff3bf" : "rgba(255,255,255,.9)"}" stroke="${selected ? "#f5c400" : "#55565a"}" stroke-width="${selected ? 2.4 : 1}"/>
      <text x="${sx.toFixed(1)}" y="${sy.toFixed(1)}" text-anchor="middle" font-size="${fs.toFixed(1)}" class="sb-note">${esc(it.text)}</text></g>`;
  }
  function handlesSvg(it) {
    const H1 = (x, y, key, kind) => { const [sx, sy] = proj(x, y, 0); return `<circle data-h="${key}" cx="${sx.toFixed(1)}" cy="${sy.toFixed(1)}" r="8" class="sb-h ${kind || ""}"/>`; };
    if (it.t === "a") return H1(it.a[0], it.a[1], "a") + H1(it.c[0], it.c[1], "c", "mid") + H1(it.b[0], it.b[1], "b");
    if (it.t === "z") return H1(it.x + it.w, it.y, "w") + H1(it.x, it.y + it.h, "h");
    return "";
  }

  /* ───────── drawing the stage ───────── */
  function stageSvg(forExport) {
    const { svg: pitch, C } = pitchSvg(), items = board.items, isSel = (it) => !forExport && sel === it.id;
    let s = DEFS + pitch;
    s += items.filter((i) => i.t === "z").map((i) => zoneSvg(i, isSel(i))).join("");
    s += goalSvg(C, 0, 1);
    s += items.filter((i) => i.t === "a" && i.kind !== "air").map((i) => arrowSvg(i, isSel(i))).join("");
    s += items.filter((i) => i.t === "p" || i.t === "b").sort((a, b) => proj(b.x, b.y)[2] - proj(a.x, a.y)[2]).map((i) => (i.t === "p" ? figureSvg(i, isSel(i)) : ballSvg(i, isSel(i)))).join("");
    s += items.filter((i) => i.t === "a" && i.kind === "air").map((i) => arrowSvg(i, isSel(i))).join("");
    s += items.filter((i) => i.t === "t").map((i) => textSvg(i, isSel(i))).join("");
    if (!forExport) { const it = items.find((i) => i.id === sel); if (it) s += handlesSvg(it); }
    if (forExport) {
      const title = [playName(board.play), board.name, board.opponent ? "vs " + board.opponent : ""].filter(Boolean).join("  ·  ");
      s += `<rect x="0" y="${H - 34}" width="${W}" height="34" fill="rgba(255,255,255,.88)"/><text x="16" y="${H - 12}" font-size="16" font-weight="700" fill="#16171b" font-family="Arial, sans-serif">${esc(title)}</text>
        <text x="${W - 16}" y="${H - 12}" font-size="13" text-anchor="end" fill="#666a72" font-family="Arial, sans-serif">AEK Athens FC · Set plays</text>`;
    }
    return s;
  }
  function draw() { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => { const svg = host && host.querySelector("#sbSvg"); if (svg && board) svg.innerHTML = stageSvg(false); }); }

  /* ───────── interface ───────── */
  const ICON = {
    select: '<path d="M5 3l14 7-6 2-2 6z"/>', aek: '<circle cx="12" cy="6" r="3"/><path d="M6 21v-7l2-5h8l2 5v7"/>', opp: '<circle cx="12" cy="6" r="3"/><path d="M6 21v-7l2-5h8l2 5v7"/>',
    gk: '<circle cx="12" cy="6" r="3"/><path d="M4 12l4-3h8l4 3M7 21v-9M17 21v-9"/>', ball: '<circle cx="12" cy="12" r="8"/><path d="M12 8l3.5 2.6-1.3 4h-4.4l-1.3-4z"/>',
    run: '<path d="M4 18c4-9 9-11 15-11" stroke-dasharray="3 3"/><path d="M15 4l5 3-4 4"/>', pass: '<path d="M4 18L19 7"/><path d="M13 6l6 1-1 6"/>',
    air: '<path d="M3 19C7 4 15 4 20 12"/><path d="M20 6v6h-6"/>', block: '<path d="M4 17c5-7 9-8 13-8" stroke-dasharray="3 3"/><path d="M17 4v10M20 4v10"/>',
    ell: '<ellipse cx="12" cy="12" rx="9" ry="5.5"/>', rect: '<path d="M4 9l10-4 6 6-10 4z"/>', text: '<path d="M5 6h14M12 6v13M9 19h6"/>',
    undo: '<path d="M8 5L3 10l5 5"/><path d="M3 10h11a6 6 0 010 12h-3"/>', redo: '<path d="M16 5l5 5-5 5"/><path d="M21 10H10a6 6 0 000 12h3"/>', trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
    png: '<path d="M12 3v12M7 10l5 5 5-5M4 20h16"/>', plus: '<path d="M12 5v14M5 12h14"/>', copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 00-1-1H5a1 1 0 00-1 1v10a1 1 0 001 1h3"/>',
  };
  const ic = (n) => `<svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[n] || ""}</svg>`;
  const TOOLS = [["select", "Select and move", "Select · move · drag empty pitch to pan"], ["aek", "AEK player", "Click the pitch to place an AEK player"], ["opp", "Opponent", "Click the pitch to place an opponent"],
    ["gk", "Goalkeeper", "Click the pitch to place a goalkeeper"], ["ball", "Ball", "Click the pitch to place the ball"], null,
    ["run", "Run", "Drag from start to finish: a player's run (dashed)"], ["pass", "Pass", "Drag from start to finish: a pass on the ground"], ["air", "Ball in the air", "Drag from start to finish: a cross or lofted ball"],
    ["block", "Block / screen", "Drag from start to finish: a block or screen (red)"], null,
    ["ell", "Zone · ellipse", "Drag on the pitch to draw a target zone"], ["rect", "Zone · rectangle", "Drag on the pitch to draw a rectangular zone"], ["text", "Text", "Click the pitch to add a note"]];

  function shell() {
    const gs = groups(), opts = Object.keys(gs).filter((g) => g !== "vid").map((g) => `<optgroup label="${esc(gs[g])}">${plays().filter((p) => p.g === g).map((p) => `<option value="${p.id}" ${board.play === p.id ? "selected" : ""}>${esc(playName(p.id))}</option>`).join("")}</optgroup>`).join("");
    const mine = store.list.filter((b) => b.play === board.play);
    return `<div class="sb">
      <div class="sb-bar">
        <label class="sb-f"><span>Set play</span><select id="sbPlay">${opts}</select></label>
        <label class="sb-f grow"><span>Drawing</span><select id="sbPick">${mine.map((b, i) => `<option value="${b.id}" ${b.id === board.id ? "selected" : ""}>${esc(b.name || "Variation " + (i + 1))}${b.opponent ? " · vs " + esc(b.opponent) : ""}</option>`).join("")}</select></label>
        <button class="btn primary sb-ib" id="sbNew" title="New drawing for this set play">${ic("plus")}<span>New</span></button>
        <button class="btn sb-ib" id="sbDup" title="Copy this drawing as a new variation">${ic("copy")}<span>Duplicate</span></button>
        <button class="btn sb-ib" id="sbPng" title="Download the drawing as a picture">${ic("png")}<span>Picture</span></button>
        <button class="btn danger sb-ib" id="sbDel" title="Delete this drawing">${ic("trash")}</button>
      </div>
      <div class="sb-meta">
        <label class="sb-f grow"><span>Name of the variation</span><input id="sbName" maxlength="60" value="${esc(board.name)}" placeholder="For example: Near post, block on the keeper"></label>
        <label class="sb-f"><span>Opponent / match</span><input id="sbOpp" maxlength="40" value="${esc(board.opponent)}" placeholder="Kalamata"></label>
      </div>
      <div class="sb-main">
        <div class="sb-tools" role="toolbar" aria-label="Drawing tools">${TOOLS.map((t) => (t ? `<button class="sb-t ${t[0]}" data-tool="${t[0]}" title="${esc(t[2])}" aria-label="${esc(t[1])}" aria-pressed="${tool === t[0]}">${ic(t[0])}<span>${esc(t[1])}</span></button>` : `<i></i>`)).join("")}
          <i></i><button class="sb-t" id="sbUndo" title="Undo (Ctrl+Z)" aria-label="Undo">${ic("undo")}<span>Undo</span></button><button class="sb-t" id="sbRedo" title="Redo (Ctrl+Y)" aria-label="Redo">${ic("redo")}<span>Redo</span></button>
          <i></i><div class="sb-ink" id="sbInk" role="group" aria-label="Line colour"><span>Line colour</span><div>${Object.keys(INK).map((k) => `<button class="sb-sw ${ink === k ? "on" : ""}" data-ink="${k}" style="--c:${INK[k]}" title="${INK_NAME[k]}" aria-label="${INK_NAME[k]}"></button>`).join("")}</div></div></div>
        <div class="sb-stage"><svg id="sbSvg" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg"></svg><div class="sb-hint" id="sbHint"></div></div>
        <aside class="sb-side">
          <section><h3>View</h3><div class="sb-views" id="sbViews">${VIEWS.map((v) => `<button class="sb-chip" data-view="${v.id}">${esc(v.n)}</button>`).join("")}</div>
            <label class="sb-sl"><span>Rotate</span><input type="range" id="sbAz" min="0" max="360" step="1" value="${Math.round(board.cam.az)}"></label>
            <label class="sb-sl"><span>Width</span><input type="range" id="sbEl" min="22" max="90" step="1" title="Tilt of the camera: higher makes the pitch wider from touchline to touchline" value="${Math.round(board.cam.el)}"></label>
            <label class="sb-sl"><span>Stretch</span><input type="range" id="sbKx" min="1" max="2.2" step="0.02" value="${board.cam.kx || 1}" title="Stretches the pitch sideways to fill the board (1 = true proportions)"></label>
            <label class="sb-sl"><span>Zoom</span><input type="range" id="sbZoom" min="0.4" max="3.2" step="0.02" value="${board.cam.zoom}"></label>
            <div class="sb-row"><button class="sb-chip ${board.photos !== false ? "on" : ""}" data-photos="1">Player faces</button><button class="sb-chip ${board.photos === false ? "on" : ""}" data-photos="0">Drawn faces</button></div>
            <div class="sb-row"><button class="sb-chip ${board.style !== "grass" ? "on" : ""}" data-style="paper">White pitch</button><button class="sb-chip ${board.style === "grass" ? "on" : ""}" data-style="grass">Green pitch</button></div></section>
          <section id="sbInspect"></section>
          <section><h3>Squad <small>click a name, then the pitch</small></h3><div class="sb-squad" id="sbSquad"></div></section>
          <section><h3>Start from a shape</h3><div class="sb-row"><button class="sb-chip ${side > 0 ? "on" : ""}" data-side="1">Right side</button><button class="sb-chip ${side < 0 ? "on" : ""}" data-side="-1">Left side</button></div>
            <div class="sb-views">${TEMPLATES.map((t) => `<button class="sb-chip" data-tpl="${t.id}">${esc(t.n)}</button>`).join("")}</div></section>
          <section><h3>Notes</h3><textarea id="sbNotes" rows="4" maxlength="1200" placeholder="Roles, signal, timing of the runs">${esc(board.notes)}</textarea></section>
        </aside>
      </div></div>`;
  }
  function squadHtml() {
    const used = new Set(board.items.filter((i) => i.t === "p").map((i) => i.name));
    return squad().map((n) => `<button class="sb-pl ${used.has(n) ? "used" : ""} ${armed === n ? "on" : ""}" data-pl="${esc(n)}">${esc(n)}</button>`).join("") || `<p class="sb-muted">The squad list is empty. Add players in the Week planner.</p>`;
  }
  function inspectHtml() {
    const it = board.items.find((i) => i.id === sel);
    if (!it) return `<h3>Selected</h3><p class="sb-muted">Nothing selected. Click a player, an arrow or a zone to change it.</p>`;
    const del = `<button class="btn danger sb-ib" data-act="del">${ic("trash")}<span>Delete</span></button>`;
    const sw = (set, cur, attr) => Object.keys(set).map((k) => `<button class="sb-sw ${cur === k ? "on" : ""}" data-${attr}="${k}" style="--c:${Array.isArray(set[k]) ? set[k][1] : set[k]}" aria-label="${k}"></button>`).join("");
    if (it.t === "p") return `<h3>Player</h3><input id="sbPName" list="sbNames" maxlength="24" value="${esc(it.name)}" placeholder="Name"><datalist id="sbNames">${squad().map((n) => `<option value="${esc(n)}">`).join("")}</datalist>
      <div class="sb-row">${[["aek", "AEK"], ["gk", "Goalkeeper"], ["opp", "Opponent"], ["oppgk", "Opp. GK"]].map(([k, n]) => `<button class="sb-chip ${it.team === k ? "on" : ""}" data-team="${k}">${n}</button>`).join("")}</div>${del}`;
    if (it.t === "a") return `<h3>Arrow</h3><div class="sb-row">${Object.keys(KINDS).map((k) => `<button class="sb-chip ${it.kind === k ? "on" : ""}" data-kind="${k}">${KINDS[k].n}</button>`).join("")}</div>
      <div class="sb-row">${sw(INK, it.color, "color")}</div><p class="sb-muted">Drag the middle point to bend the line.</p>${del}`;
    if (it.t === "z") return `<h3>Zone</h3><div class="sb-row">${sw(ZONE, it.color, "zcolor")}</div><p class="sb-muted">Drag the two points to change its size.</p>${del}`;
    if (it.t === "t") return `<h3>Text</h3><input id="sbText" maxlength="40" value="${esc(it.text)}">${del}`;
    return `<h3>Ball</h3>${del}`;
  }
  function refreshSide() {
    if (!host) return;
    host.querySelector("#sbInspect").innerHTML = inspectHtml();
    host.querySelector("#sbSquad").innerHTML = squadHtml();
    host.querySelectorAll("[data-tool]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.tool === tool)));
    const picked = board.items.find((i) => i.id === sel); if (picked && picked.t === "a") ink = picked.color;
    host.querySelectorAll("[data-ink]").forEach((b) => b.classList.toggle("on", b.dataset.ink === ink));
    const t = TOOLS.find((x) => x && x[0] === tool);
    host.querySelector("#sbHint").textContent = armed ? `Click the pitch to place ${armed}` : t ? t[2] : "";
  }
  function redraw(full) { if (!host) return; if (full) { host.innerHTML = shell(); bind(); } refreshSide(); draw(); }
  function setTool(t) { tool = t; armed = null; if (t !== "select") sel = null; refreshSide(); draw(); }

  /* ───────── pointer work ───────── */
  function stagePoint(e) { const r = host.querySelector("#sbSvg").getBoundingClientRect(); return [((e.clientX - r.left) / r.width) * W, ((e.clientY - r.top) / r.height) * H]; }
  const ground = (e) => { const [sx, sy] = stagePoint(e); const g = unproj(sx, sy); return [clamp(g[0], -45, 45), clamp(g[1], -8, 62)]; };
  function down(e) {
    if (e.button && e.button !== 0) return;
    const svg = host.querySelector("#sbSvg"), g = ground(e), h = e.target.closest("[data-h]"), node = e.target.closest("[data-id]");
    try { svg.setPointerCapture(e.pointerId); } catch (g) { /* pointer already gone: dragging still works while it stays over the pitch */ }
    if (armed) { snapshot(); const it = P("aek", g[0], g[1], armed); board.items.push(it); sel = it.id; armed = null; tool = "select"; touch(); refreshSide(); draw(); return; }
    if (tool === "select") {
      if (h && sel) { snapshot(); dragging = { kind: "handle", key: h.dataset.h, id: sel }; return; }
      if (node) {
        const it = board.items.find((i) => i.id === node.dataset.id); sel = it.id; snapshot();
        dragging = { kind: "move", id: it.id, g0: g, orig: JSON.parse(JSON.stringify(it)), moved: false }; refreshSide(); draw(); return;
      }
      sel = null; dragging = { kind: "pan", s0: stagePoint(e), cam0: { ...board.cam } }; refreshSide(); draw(); return;
    }
    if (["aek", "opp", "gk"].includes(tool)) {
      snapshot(); const n = tool === "aek" ? nextName() : tool === "gk" ? gkName() : "";
      const it = P(tool, g[0], g[1], n); board.items.push(it); sel = it.id; dragging = { kind: "move", id: it.id, g0: g, orig: { ...it }, moved: true }; touch(); refreshSide(); draw(); return;
    }
    if (tool === "ball") { snapshot(); board.items = board.items.filter((i) => i.t !== "b"); const it = { id: uid(), t: "b", x: g[0], y: g[1] }; board.items.push(it); sel = it.id; touch(); refreshSide(); draw(); return; }
    if (tool === "text") {                                 // the note is typed in the side panel (no pop-up: it does not exist in every browser)
      snapshot(); const it = { id: uid(), t: "t", x: g[0], y: g[1], text: "Text" }; board.items.push(it); sel = it.id; tool = "select"; touch(); refreshSide(); draw();
      const f = host.querySelector("#sbText"); if (f) { f.focus(); f.select(); }
      return;
    }
    if (["run", "pass", "air", "block"].includes(tool)) {
      snapshot(); const it = { id: uid(), t: "a", kind: tool, color: tool === "block" && ink === "k" ? "r" : ink, a: g, c: g, b: g }; board.items.push(it); sel = it.id; dragging = { kind: "arrow", id: it.id }; draw(); return;
    }
    if (tool === "ell" || tool === "rect") { snapshot(); const it = { id: uid(), t: "z", shape: tool, color: "cyan", x: g[0], y: g[1], w: 0.5, h: 0.5 }; board.items.push(it); sel = it.id; dragging = { kind: "zone", id: it.id, g0: g }; draw(); }
  }
  function move(e) {
    if (!dragging) return;
    const g = ground(e), it = board.items.find((i) => i.id === dragging.id);
    if (dragging.kind === "pan") {
      const s = stagePoint(e), a = unproj(dragging.s0[0], dragging.s0[1]), b = unproj(s[0], s[1]);
      board.cam.tx = clamp(board.cam.tx + (a[0] - b[0]), -40, 40); board.cam.ty = clamp(board.cam.ty + (a[1] - b[1]), -10, 60); dragging.s0 = s; return draw();
    }
    if (!it) return;
    if (dragging.kind === "move") {
      const dx = g[0] - dragging.g0[0], dy = g[1] - dragging.g0[1], o = dragging.orig; dragging.moved = dragging.moved || Math.hypot(dx, dy) > 0.15;
      if (it.t === "a") { it.a = [o.a[0] + dx, o.a[1] + dy]; it.b = [o.b[0] + dx, o.b[1] + dy]; it.c = [o.c[0] + dx, o.c[1] + dy]; } else { it.x = o.x + dx; it.y = o.y + dy; }
    } else if (dragging.kind === "arrow") { it.b = g; it.c = [(it.a[0] + g[0]) / 2, (it.a[1] + g[1]) / 2]; }
    else if (dragging.kind === "zone") { it.w = Math.max(0.6, Math.abs(g[0] - dragging.g0[0])); it.h = Math.max(0.6, Math.abs(g[1] - dragging.g0[1])); }
    else if (dragging.kind === "handle") {
      if (it.t === "a") it[dragging.key] = g; else if (dragging.key === "w") it.w = Math.max(0.6, Math.abs(g[0] - it.x)); else it.h = Math.max(0.6, Math.abs(g[1] - it.y));
    }
    draw();
  }
  function up() {
    if (!dragging) return;
    const d = dragging, it = board.items.find((i) => i.id === d.id); dragging = null;
    if (d.kind === "pan") { touch(); syncSliders(); return; }
    if (d.kind === "arrow" && it && Math.hypot(it.b[0] - it.a[0], it.b[1] - it.a[1]) < 0.8) { board.items = board.items.filter((i) => i !== it); sel = null; undo.pop(); }
    if (d.kind === "move" && !d.moved) undo.pop();
    if (d.kind === "arrow" || d.kind === "zone") tool = "select";
    touch(); refreshSide(); draw();
  }
  function nextName() { const used = new Set(board.items.filter((i) => i.t === "p").map((i) => i.name)); return squad().find((n) => !used.has(n) && n !== gkName()) || ""; }
  function syncSliders() { const c = board.cam; [["#sbAz", c.az], ["#sbEl", c.el], ["#sbZoom", c.zoom], ["#sbKx", c.kx || 1]].forEach(([q, v]) => { const el = host.querySelector(q); if (el) el.value = v; }); }
  function remove() { if (!sel) return; snapshot(); board.items = board.items.filter((i) => i.id !== sel); sel = null; touch(); refreshSide(); draw(); }
  function step(from, to) { if (!from.length) return; to.push(JSON.stringify(board.items)); board.items = JSON.parse(from.pop()); sel = null; touch(); refreshSide(); draw(); }
  function keys(e) {
    if (!host || !host.isConnected || /INPUT|TEXTAREA|SELECT/.test((e.target.tagName || ""))) return;
    if (e.key === "Delete" || e.key === "Backspace") { if (sel) { e.preventDefault(); remove(); } }
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { e.preventDefault(); step(undo, redo); }
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") { e.preventDefault(); step(redo, undo); }
    else if (e.key === "Escape") { sel = null; armed = null; tool = "select"; refreshSide(); draw(); }
  }

  /* ───────── picture ───────── */
  function picture() {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W * 2}" height="${H * 2}"><style>.sb-name{font-family:Arial,Helvetica,sans-serif;fill:#2b2c30;paint-order:stroke;stroke:#fff;stroke-width:3px}.sb-note{font-family:Arial,Helvetica,sans-serif;font-weight:700;fill:#16171b}</style>${stageSvg(true)}</svg>`;
    const img = new Image();
    img.onload = () => {
      const c = document.createElement("canvas"); c.width = W * 2; c.height = H * 2; c.getContext("2d").drawImage(img, 0, 0);
      c.toBlob((blob) => { const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = ("set-play " + playName(board.play) + " " + (board.name || "")).trim().replace(/[^\w\- ]+/g, "").replace(/\s+/g, "-") + ".png"; document.body.appendChild(a); a.click(); a.remove(); }, "image/png");
    };
    img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  }

  /* ───────── wiring ───────── */
  function open(b) { board = b; store.cur = b.id; sel = null; undo = []; redo = []; persist(); redraw(true); }
  function bind() {
    const q = (s) => host.querySelector(s), svg = q("#sbSvg");
    svg.addEventListener("pointerdown", down); svg.addEventListener("pointermove", move); svg.addEventListener("pointerup", up); svg.addEventListener("pointercancel", up);
    svg.addEventListener("dblclick", (e) => { const n = e.target.closest("[data-id]"); const it = n && board.items.find((i) => i.id === n.dataset.id); if (it && it.t === "p") { sel = it.id; refreshSide(); draw(); const f = q("#sbPName"); if (f) { f.focus(); f.select(); } } });
    svg.addEventListener("wheel", (e) => { e.preventDefault(); board.cam.zoom = clamp(board.cam.zoom * (e.deltaY < 0 ? 1.08 : 0.926), 0.4, 3.2); syncSliders(); touch(); draw(); }, { passive: false });
    q("#sbPlay").onchange = (e) => { const p = e.target.value, list = store.list.filter((b) => b.play === p); open(list[list.length - 1] || newBoard(p, guessTemplate(p))); };
    q("#sbPick").onchange = (e) => open(store.list.find((b) => b.id === e.target.value));
    q("#sbNew").onclick = () => open(newBoard(board.play, guessTemplate(board.play)));
    q("#sbDup").onclick = () => { const b = JSON.parse(JSON.stringify(board)); b.id = uid(); b.name = (board.name || "Variation") + " (copy)"; b.items.forEach((i) => (i.id = uid())); store.list.push(b); open(b); };
    q("#sbDel").onclick = () => {
      if (!confirm("Delete this drawing?\n\n" + playName(board.play) + (board.name ? " · " + board.name : ""))) return;
      const play = board.play; store.list = store.list.filter((b) => b.id !== board.id); const rest = store.list.filter((b) => b.play === play);
      open(rest[rest.length - 1] || newBoard(play, guessTemplate(play)));
    };
    q("#sbPng").onclick = picture;
    q("#sbName").oninput = (e) => { board.name = e.target.value; touch(); const o = q("#sbPick").selectedOptions[0]; if (o) o.textContent = (board.name || "Variation") + (board.opponent ? " · vs " + board.opponent : ""); };
    q("#sbOpp").oninput = (e) => { board.opponent = e.target.value; touch(); };
    q("#sbNotes").oninput = (e) => { board.notes = e.target.value; touch(); };
    q("#sbUndo").onclick = () => step(undo, redo); q("#sbRedo").onclick = () => step(redo, undo);
    q(".sb-tools").addEventListener("click", (e) => {
      const c = e.target.closest("[data-ink]");
      if (c) {                                             // colour for new lines; a selected line takes it at once
        ink = c.dataset.ink; const it = board.items.find((i) => i.id === sel);
        if (it && it.t === "a" && it.color !== ink) { snapshot(); it.color = ink; touch(); draw(); }
        return refreshSide();
      }
      const b = e.target.closest("[data-tool]"); if (b) setTool(b.dataset.tool);
    });
    q("#sbAz").oninput = (e) => { let a = +e.target.value; const r = Math.round(a / 90) * 90; if (Math.abs(a - r) <= 6) a = r % 360; board.cam.az = a; touch(); draw(); };
    q("#sbAz").onchange = () => syncSliders();
    q("#sbEl").oninput = (e) => { board.cam.el = +e.target.value; touch(); draw(); };
    q("#sbZoom").oninput = (e) => { board.cam.zoom = +e.target.value; touch(); draw(); };
    q("#sbKx").oninput = (e) => { board.cam.kx = +e.target.value; touch(); draw(); };
    q(".sb-side").addEventListener("click", (e) => {
      const b = e.target.closest("button"); if (!b) return;
      const it = board.items.find((i) => i.id === sel), d = b.dataset;
      if (d.view) { board.cam = camFrom(viewOf(d.view)); syncSliders(); touch(); return draw(); }
      if (d.style) { board.style = d.style; touch(); return redraw(true); }
      if (d.photos) { board.photos = d.photos === "1"; touch(); return redraw(true); }
      if (d.side) { side = +d.side; return redraw(true); }
      if (d.tpl) {
        if (board.items.length && !confirm("Replace what is on the pitch with this shape?")) return;
        const t = TEMPLATES.find((x) => x.id === d.tpl); snapshot(); board.items = t.build(-side); board.cam = camFrom(viewOf(t.view(side))); sel = null; touch(); return redraw(true);
      }
      if (d.pl) { armed = armed === d.pl ? null : d.pl; tool = "select"; sel = null; refreshSide(); return draw(); }
      if (d.act === "del") return remove();
      if (!it) return;
      snapshot();
      if (d.team) it.team = d.team; if (d.kind) { it.kind = d.kind; if (d.kind === "block" && it.color === "k") it.color = "r"; } if (d.color) it.color = d.color; if (d.zcolor) it.color = d.zcolor;
      touch(); refreshSide(); draw();
    });
    q(".sb-side").addEventListener("input", (e) => {
      const it = board.items.find((i) => i.id === sel); if (!it) return;
      if (e.target.id === "sbPName") { it.name = e.target.value; touch(); draw(); host.querySelector("#sbSquad").innerHTML = squadHtml(); }
      if (e.target.id === "sbText") { it.text = e.target.value; touch(); draw(); }
    });
  }

  const CSS = `
.wrap:has(.sb){max-width:1680px}
.sb{display:flex;flex-direction:column;gap:12px}
.sb-bar,.sb-meta{display:flex;flex-wrap:wrap;gap:10px;align-items:flex-end}
.sb-f{display:flex;flex-direction:column;gap:4px;min-width:170px}.sb-f.grow{flex:1;min-width:220px}
.sb-f span,.sb-side h3{font:600 11px/1 var(--f-body);letter-spacing:.12em;text-transform:uppercase;color:var(--muted)}
.sb-f select,.sb-f input,.sb-side input:not([type=range]),.sb-side textarea{width:100%;border:1px solid var(--line);background:var(--surface);color:var(--ink);border-radius:6px;padding:8px 10px;font:500 14px var(--f-body)}
.sb-side textarea{resize:vertical;line-height:1.45}
.sb-ib{display:inline-flex;align-items:center;gap:6px;padding:8px 12px}
.sb-main{display:grid;grid-template-columns:auto minmax(0,1fr) 270px;gap:12px;align-items:start}
.sb-tools{display:flex;flex-direction:column;gap:4px;background:var(--surface);border:1px solid var(--line);border-radius:10px;padding:6px}
.sb-tools i{height:1px;background:var(--line);margin:3px 4px}
.sb-t{display:flex;align-items:center;gap:8px;border:0;background:none;color:var(--ink);border-radius:7px;padding:8px 10px;cursor:pointer;font:500 12.5px var(--f-body);text-align:left;white-space:nowrap}
.sb-t:hover{background:var(--surface2)}.sb-t[aria-pressed="true"]{background:var(--accent);color:var(--accent-ink);font-weight:600}
.sb-t.aek svg{color:#b89200}.sb-t[aria-pressed="true"] svg{color:inherit}.sb-t.gk svg{color:#2bb24c}.sb-t.block svg{color:#e02424}
.sb-tools,.sb-stage{position:sticky;top:10px}
.sb-stage{background:var(--surface);border:1px solid var(--line);border-radius:12px;overflow:hidden;box-shadow:0 1px 0 rgba(0,0,0,.03)}
#sbSvg{display:block;width:100%;height:auto;touch-action:none;user-select:none;-webkit-user-select:none;cursor:crosshair;background:#f6f6f4}
.sb-item{cursor:grab}.sb-item:active{cursor:grabbing}
.sb-name{font-family:var(--f-body);font-weight:500;fill:#2b2c30;paint-order:stroke;stroke:#fff;stroke-width:3px;stroke-linejoin:round;pointer-events:none}
.sb-note{font-family:var(--f-body);font-weight:700;fill:#16171b;pointer-events:none}
.sb-h{fill:#fff;stroke:#16171b;stroke-width:2.2;cursor:move}.sb-h.mid{fill:#f5c400}
.sb-hint{position:absolute;left:10px;bottom:10px;background:rgba(22,23,27,.82);color:#fff;font:500 12px var(--f-body);padding:5px 10px;border-radius:6px;pointer-events:none;max-width:calc(100% - 20px)}
.sb-hint:empty{display:none}
.sb-side{display:flex;flex-direction:column;gap:10px}
.sb-side section{background:var(--surface);border:1px solid var(--line);border-radius:10px;padding:11px 12px;display:flex;flex-direction:column;gap:8px}
.sb-side h3{margin:0;display:flex;justify-content:space-between;gap:8px;align-items:baseline}.sb-side h3 small{font:400 11px var(--f-body);letter-spacing:0;text-transform:none}
.sb-views,.sb-row,.sb-squad{display:flex;flex-wrap:wrap;gap:5px}
.sb-chip,.sb-pl{border:1px solid var(--line);background:var(--surface2);color:var(--ink);border-radius:6px;padding:5px 9px;font:500 12.5px var(--f-body);cursor:pointer}
.sb-chip:hover,.sb-pl:hover{border-color:var(--muted)}.sb-chip.on,.sb-pl.on{background:var(--accent);border-color:var(--accent);color:var(--accent-ink);font-weight:600}
.sb-pl.used{opacity:.5}.sb-pl.used::after{content:" ✓"}
.sb-sl{display:grid;grid-template-columns:52px 1fr;align-items:center;gap:8px;font:500 12px var(--f-body);color:var(--muted)}.sb-sl input{width:100%;accent-color:var(--accent)}
.sb-sw{width:26px;height:26px;border-radius:50%;border:2px solid var(--surface);outline:1px solid var(--line);background:var(--c);cursor:pointer}.sb-sw.on{outline:3px solid var(--accent)}
.sb-muted{margin:0;font-size:12.5px;color:var(--muted)}
.sb-ink{padding:4px 6px 2px}.sb-ink>span{display:block;font:600 10.5px/1 var(--f-body);letter-spacing:.12em;text-transform:uppercase;color:var(--muted);margin-bottom:7px}
.sb-ink>div{display:grid;grid-template-columns:repeat(4,26px);gap:7px}
@media (max-width:1080px){.sb-main{grid-template-columns:minmax(0,1fr)}.sb-tools{flex-direction:row;flex-wrap:wrap}.sb-tools i{width:1px;height:auto;margin:4px 3px}.sb-t span{display:none}.sb-ink>span{display:none}.sb-ink>div{display:flex}.sb-side{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr))}}
`;

  window.SPBoard = {
    mount(el) {
      host = el; load();
      if (!document.getElementById("sbCss")) { const s = document.createElement("style"); s.id = "sbCss"; s.textContent = CSS; document.head.appendChild(s); }
      board = store.list.find((b) => b.id === store.cur) || store.list[store.list.length - 1] || newBoard(plays()[0].id, guessTemplate(plays()[0].id));
      tool = "select"; armed = null; sel = null;
      redraw(true);
      document.removeEventListener("keydown", keys); document.addEventListener("keydown", keys);
    },
    unmount() { host = null; document.removeEventListener("keydown", keys); },
    dump() { load(); return store; },
    restore(data) { if (data && Array.isArray(data.list)) { store = data; persist(); } },
  };
})();
