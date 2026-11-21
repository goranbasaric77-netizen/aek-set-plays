/* AEK Set - Plays · Drawing board (2026-11-19)
   A third tab next to Week planner and History: draw set plays on a 3D-style half pitch, in the look of the staff's
   current drawings (striped light pitch, dark lines, standing figures with names, dashed runs, ball arcs, zones).
   Everything lives in pitch metres (x along the goal line, y out from the goal line, z up) and is projected to the screen,
   so the same drawing can be viewed from any angle. Drawings are grouped by the app's set-play list (PLAYS) and saved in
   localStorage under BOARD_KEY; they are part of Export / Import backup (see dump / restore).
   21.11.2026: 3D perspective (slider 3D, camDist); every drawing shows the whole pitch (both halves and goals); views are framed on the full 105 x 68 m.
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
  /* The whole first team (platform player list, 19.11.2026), by line, with shirt numbers. Names as in the app's squad list. */
  const TEAM = [
    ["Goalkeepers", [["Strakosha", ""], ["Brignoli", ""], ["Balamotis", ""], ["Angelopoulos", ""]]],
    ["Defenders", [["Moukoudi", "2"], ["Relvas", "44"], ["Vida", "21"], ["Alexiou", "5"], ["Georgiev", "15"], ["Rota", "12"], ["Pilios", "3"], ["Lykogiannis", ""], ["Christakopoulos", "57"]]],
    ["Midfielders", [["Kairinen", "6"], ["Majer", "14"], ["Arriaga", "16"], ["Marin", "18"], ["Mantalos", "20"], ["Vitalis", "27"], ["Kaloskamis", "17"], ["Sahabo", "80"]]],
    ["Forwards", [["Koita", "11"], ["Kutesa", "7"], ["Gacinovic", "8"], ["Zubkov", "10"], ["Joao Mario", ""], ["Jovic", "9"], ["Varga", "19"], ["Argyriou", "99"], ["Zini", "90"]]],
  ];
  const KEEPERS = ["Strakosha", "Brignoli", "Balamotis", "Angelopoulos"];
  const TEAM_NAMES = TEAM.flatMap((g) => g[1].map((x) => x[0]));
  const plannerSquad = () => (typeof roster !== "undefined" ? roster : []).map((r) => String(r).replace(/^\d+\s+/, "").trim()).filter(Boolean);
  const squad = () => [...TEAM_NAMES, ...plannerSquad().filter((n) => !TEAM_NAMES.includes(n))];
  const playName = (id) => { const p = plays().find((x) => x.id === id); return p ? p.n + (p.s ? " · " + p.s : "") : ""; };

  /* ───────── camera views ───────── */
  // 21.11.2026 (Goran): the WHOLE pitch on every drawing. A view is only the camera angle; zoom and centre are computed so that
  // the full 105 x 68 m pitch with both goals fits the board (fitCam). Zoom and pan still allow a close-up.
  const VIEWS = [
    // Set plays (21.11.2026, Goran): the camera stands behind the goal we attack (near the corner flag on the side of the
    // ball) and looks up the pitch, so the action is near and large in 3D and the rest of the pitch goes into the distance.
    // az 0 = straight from behind the goal. "Right" always means the attacking right, so x < 0.
    { id: "corner-r", n: "Corner · right", az: 40, el: 34 },
    { id: "corner-l", n: "Corner · left", az: 320, el: 34 },
    { id: "fk-central", n: "Free kick · central", az: 0, el: 36 },
    { id: "wide-r", n: "Wide · right", az: 28, el: 34 },
    { id: "wide-l", n: "Wide · left", az: 332, el: 34 },
    { id: "behind-goal", n: "Facing the goal", az: 180, el: 35 },
    // Straight views: the camera is square to the pitch, so the lines run level and upright instead of slanted.
    { id: "half-r", n: "Side · goal right", az: 90, el: 48 },
    { id: "half-l", n: "Side · goal left", az: 270, el: 48 },
    { id: "half-up", n: "Front · wide", az: 180, el: 50 },
    { id: "top", n: "Top view", az: 90, el: 90 },
  ];
  const viewOf = (id) => VIEWS.find((v) => v.id === id) || VIEWS[0];
  /* 3D perspective (21.11.2026, Goran): far players, the far goal and lines get smaller, like on TV. cam.p = strength
     0..100 (0 = flat drawing as before); a board without cam.p uses P_DEF. */
  const P_DEF = 55;
  const persp = (c) => (c.p === undefined || c.p === null ? P_DEF : +c.p);
  /* Camera that shows the whole pitch (both goals and the goal frames) at this angle, centred, with a small margin.
     With perspective the picture is not linear, so zoom and centre are refined a few times. */
  function fitCam(az, el, kx, p) {
    const c = { az, el, zoom: 1, tx: 0, ty: HALF_L, kx: kx || 1, p: p === undefined ? P_DEF : p };
    const gh = FIG * 1.3, pts = [];
    for (const x of [-HALF_W, HALF_W]) for (const y of [-4, FULL_L + 4]) pts.push([x, y, 0]);
    for (const x of [-7, 7]) for (const y of [-3.6, FULL_L + 3.6]) pts.push([x, y, gh]);
    const pr = (q) => projWith(c, q[0], q[1], q[2]);
    const box = () => { const q = pts.map(pr), xs = q.map((v) => v[0]), ys = q.map((v) => v[1]);
      return { w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys), cx: (Math.max(...xs) + Math.min(...xs)) / 2, cy: (Math.max(...ys) + Math.min(...ys)) / 2 }; };
    for (let i = 0; i < 5; i++) {
      let b = box(); c.zoom *= Math.min((W * 0.95) / b.w, (H * 0.9) / b.h);
      b = box(); const g = unprojWith(c, b.cx, b.cy); c.tx = g[0]; c.ty = g[1];
    }
    c.tx = +c.tx.toFixed(2); c.ty = +c.ty.toFixed(2); c.zoom = +c.zoom.toFixed(3);
    return c;
  }
  const camFrom = (v, p) => fitCam(v.az, v.el, 1, p === undefined || p === null ? P_DEF : p);
  /* Older drawings (half pitch, flat) get the whole pitch in 3D perspective once, with the same camera angle.
     full = 1: whole pitch (21.11 morning), full = 2: whole pitch with perspective, full = 3: set-play cameras behind the goal. */
  // full = 3: camera of the set-play views moved behind the goal (a view that faced the goal is mirrored over the goal line,
  // so it stays on the same side of the ball).
  function wholePitch(list) { let n = 0; (list || []).forEach((b) => { if (b && b.cam && b.full !== 3) { let az = +b.cam.az || 0; if (az > 100 && az < 260) az = (540 - az) % 360; b.cam = fitCam(az, b.cam.el, 1, P_DEF); b.full = 3; n++; } }); return n; }

  /* ───────── templates: a starting shape for each kind of set play (positions in metres, side = +1 right, -1 left) ───────── */
  const CORE = ["Mantalos", "Majer", "Jovic", "Varga", "Relvas", "Moukoudi", "Arriaga", "Vitalis", "Rota", "Pilios"];
  function names(n) {
    const s = squad(), out = CORE.filter((x) => s.includes(x));
    for (const x of s) { if (out.length >= n) break; if (!out.includes(x) && !KEEPERS.includes(x)) out.push(x); }
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
  let rotSnap = false, otherName = false;
  let board = null, sel = null, tool = "select", armed = null, armedPose = null, curPose = "p00", poseGroup = "Standing", side = 1, host = null, dragging = null, undo = [], redo = [], saveT = null, raf = 0;
  function load() { try { const j = JSON.parse(localStorage.getItem(BOARD_KEY) || "null"); if (j && Array.isArray(j.list)) { store = j; if (wholePitch(store.list)) persist(); } } catch (e) { /* keep empty */ } }
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
  /* Distance of the camera from the point it looks at (metres). Infinity = flat (parallel) drawing. The camera always stays
     far enough back that the whole pitch and its stripes are in front of it. */
  let dCache = { key: "", D: Infinity };
  function camDist(c) {
    const p = persp(c);
    if (!(p > 0)) return Infinity;
    const key = c.az + "|" + c.el + "|" + c.tx + "|" + c.ty + "|" + p;
    if (dCache.key === key) return dCache.D;
    const a = rad(c.az), ce = Math.cos(rad(c.el));
    let near = Infinity;
    for (const x of [-60, 60]) for (const y of [-17, FULL_L + 6]) near = Math.min(near, ((x - c.tx) * Math.sin(a) + (y - c.ty) * Math.cos(a)) * ce);
    const D = Math.max(40 + 260 * Math.pow(1 - p / 100, 2), 14 - near);
    dCache = { key, D };
    return D;
  }
  /* pitch metres -> stage: [x, y, depth for sorting, size factor of things standing there (1 = flat drawing)] */
  function projWith(c, x, y, z) {
    const a = rad(c.az), dx = x - c.tx, dy = y - c.ty, s = 12.5 * c.zoom, se = Math.sin(rad(c.el)), ce = Math.cos(rad(c.el));
    const xr = dx * Math.cos(a) - dy * Math.sin(a), yr = dx * Math.sin(a) + dy * Math.cos(a), up = yr * se + (z || 0) * ce;
    const D = camDist(c), k = D === Infinity ? 1 : D / Math.max(0.5, D + yr * ce - (z || 0) * se);
    return [W / 2 + s * (c.kx || 1) * xr * k, H / 2 - s * up * k, yr, k];
  }
  function unprojWith(c, sx, sy) {                // stage -> ground (z = 0)
    const a = rad(c.az), s = 12.5 * c.zoom, se = Math.sin(rad(c.el)), ce = Math.cos(rad(c.el)), D = camDist(c);
    const u = -(sy - H / 2) / s, v = (sx - W / 2) / (s * (c.kx || 1));
    let xr, yr;
    if (D === Infinity) { yr = u / se; xr = v; }
    else { yr = clamp((u * D) / Math.max(1e-6, D * se - u * ce), -250, 350); xr = (v * (D + yr * ce)) / D; }
    return [c.tx + xr * Math.cos(a) + yr * Math.sin(a), c.ty - xr * Math.sin(a) + yr * Math.cos(a)];
  }
  const proj = (x, y, z) => projWith(board.cam, x, y, z);
  const unproj = (sx, sy) => unprojWith(board.cam, sx, sy);
  const pt = (x, y, z) => { const p = proj(x, y, z); return p[0].toFixed(1) + "," + p[1].toFixed(1); };
  const poly = (pts, z) => pts.map((p) => pt(p[0], p[1], z === undefined ? p[2] : z)).join(" ");

  /* ───────── pitch ───────── */
  function pitchSvg() {
    const paper = board.style !== "grass";
    const C = paper ? { a: "#ffffff", b: "#e7e7e5", line: "#3b3b3d", out: "#f6f6f4", net: "rgba(120,120,125,.34)", post: "#55565a" }
      : { a: "#4f9a4f", b: "#478f48", line: "#f4f7f2", out: "#3f8442", net: "rgba(255,255,255,.3)", post: "#ffffff" };
    let s = `<rect x="0" y="0" width="${W}" height="${H}" fill="${C.out}"/>`;
    for (let i = -3, n = 0; i < 23; i++, n++) {           // mowing stripes parallel to the goal line, 5.5 m wide, over the whole pitch
      const y0 = i * 5.5, y1 = y0 + 5.5;
      s += `<polygon points="${poly([[-60, y0], [60, y0], [60, y1], [-60, y1]], 0)}" fill="${n % 2 ? C.b : C.a}"/>`;
    }
    const L = (pts, extra) => `<polyline points="${poly(pts, 0)}" fill="none" stroke="${C.line}" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round" ${extra || ""}/>`;
    const arc = (cx, cy, r, a0, a1) => { const p = []; for (let i = 0; i <= 28; i++) { const a = rad(a0 + ((a1 - a0) * i) / 28); p.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); } return p; };
    // The whole pitch, 68 x 105 m: our attacking goal on y = 0, the halfway line on y = HALF_L, the other goal on y = FULL_L.
    s += L([[-HALF_W, 0], [HALF_W, 0], [HALF_W, FULL_L], [-HALF_W, FULL_L], [-HALF_W, 0]]) + L([[-HALF_W, HALF_L], [HALF_W, HALF_L]]) + L(arc(0, HALF_L, 9.15, 0, 360));
    const mid = proj(0, HALF_L, 0); s += `<ellipse cx="${mid[0].toFixed(1)}" cy="${mid[1].toFixed(1)}" rx="3.4" ry="1.9" fill="${C.line}"/>`;
    for (const [y0, d] of [[0, 1], [FULL_L, -1]]) {        // at both ends: penalty area, goal area, arc, spot, corner arcs
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
  function drawnSvg(it, selected) {                       // stands in while the pose picture loads
    const [sx, sy, , kp] = proj(it.x, it.y, 0), k = (scale() * FIG * kp) / 104, o = "#26272b", skin = "#ecbf98", kit = KIT[it.team] || KIT.aek, F = FIG_PATH;
    const photo = "", crest = "";
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
    const fs = clamp(scale() * 0.78 * kp, 10, 22);
    const label = nameLabel(it, sx, sy - 122 * k + 6, fs);
    const ring = selected ? `<ellipse cx="${sx.toFixed(1)}" cy="${(sy + 1).toFixed(1)}" rx="${(24 * k).toFixed(1)}" ry="${(7.8 * k).toFixed(1)}" fill="rgba(245,196,0,.35)" stroke="#f5c400" stroke-width="2.4"/>` : "";
    return `<g data-id="${it.id}" class="sb-item sb-fig">${ring}<g transform="translate(${sx.toFixed(1)},${sy.toFixed(1)}) scale(${k.toFixed(3)})">${body}</g>
      <rect x="${(sx - 18 * k).toFixed(1)}" y="${(sy - 119 * k).toFixed(1)}" width="${(36 * k).toFixed(1)}" height="${(121 * k).toFixed(1)}" fill="transparent"/>${label}</g>`;
  }
  /* ───────── player figures: poses (Goran's sheet of 69 figures, 19.11.2026) ─────────
     In a set play what matters is which way a player faces and what the arms and body do, so every figure is a pose picture
     (poses/pNN.webp, AEK kit, transparent background). A player keeps its pose (it.pose) and the way it looks (it.face).
     Other teams get the same picture recoloured in a canvas: the yellow of the kit becomes red (opponent), green (keeper)
     or blue (opponent keeper). Pictures are kept as data URLs, because the exported picture and the PDF can only carry
     embedded images. While a picture loads, the drawn figure stands in. */
  const POSES = [{"id":"p00","w":69,"h":223,"g":"Standing","n":"Front"},{"id":"p01","w":51,"h":220,"g":"Standing","n":"Side right"},{"id":"p02","w":49,"h":220,"g":"Standing","n":"Side right 2"},{"id":"p03","w":73,"h":221,"g":"Standing","n":"Back"},{"id":"p04","w":65,"h":222,"g":"Standing","n":"Back 2"},{"id":"p05","w":55,"h":221,"g":"Standing","n":"Back three-quarter"},{"id":"p06","w":64,"h":220,"g":"Standing","n":"Side three-quarter"},{"id":"p07","w":47,"h":221,"g":"Standing","n":"Side left"},{"id":"p08","w":95,"h":223,"g":"Arms and signals","n":"Hands on hips"},{"id":"p09","w":72,"h":222,"g":"Arms and signals","n":"Arms crossed"},{"id":"p10","w":75,"h":221,"g":"Arms and signals","n":"Thinking"},{"id":"p11","w":111,"h":218,"g":"Arms and signals","n":"Arm out"},{"id":"p12","w":133,"h":212,"g":"Arms and signals","n":"Pointing"},{"id":"p13","w":86,"h":230,"g":"Arms and signals","n":"Arm up"},{"id":"p14","w":92,"h":225,"g":"Arms and signals","n":"Arm up, side"},{"id":"p15","w":141,"h":208,"g":"Arms and signals","n":"Arms open"},{"id":"p16","w":122,"h":171,"g":"Running","n":"Sprint"},{"id":"p17","w":125,"h":177,"g":"Running","n":"Sprint 2"},{"id":"p18","w":90,"h":184,"g":"Running","n":"Run"},{"id":"p19","w":79,"h":184,"g":"On the ball","n":"Ball at feet"},{"id":"p20","w":68,"h":183,"g":"On the ball","n":"Dribble"},{"id":"p21","w":105,"h":175,"g":"On the ball","n":"Dribble 2"},{"id":"p22","w":187,"h":169,"g":"On the ball","n":"Shot"},{"id":"p23","w":94,"h":187,"g":"On the ball","n":"Knee up"},{"id":"p24","w":93,"h":188,"g":"On the ball","n":"Juggling"},{"id":"p25","w":87,"h":172,"g":"On the ball","n":"Juggling knee"},{"id":"p26","w":64,"h":179,"g":"On the ball","n":"Ready"},{"id":"p27","w":58,"h":175,"g":"Jumping","n":"Header"},{"id":"p28","w":113,"h":173,"g":"Jumping","n":"Jump"},{"id":"p29","w":105,"h":179,"g":"Jumping","n":"Jump 2"},{"id":"p30","w":107,"h":145,"g":"Defending","n":"Defensive stance"},{"id":"p31","w":126,"h":137,"g":"Defending","n":"Lunge"},{"id":"p32","w":81,"h":142,"g":"Defending","n":"Hands on knees"},{"id":"p33","w":195,"h":102,"g":"On the ground","n":"Sliding"},{"id":"p34","w":127,"h":98,"g":"On the ground","n":"Sitting"},{"id":"p35","w":109,"h":72,"g":"On the ground","n":"Lying back"},{"id":"p36","w":137,"h":60,"g":"On the ground","n":"Lying side"},{"id":"p37","w":62,"h":81,"g":"On the ground","n":"Hands on head"},{"id":"p38","w":72,"h":111,"g":"On the ground","n":"Kneeling up"},{"id":"p39","w":69,"h":111,"g":"On the ground","n":"Kneeling"},{"id":"p40","w":67,"h":96,"g":"On the ground","n":"Kneeling down"},{"id":"p41","w":77,"h":133,"g":"On the ground","n":"Bent over"},{"id":"p42","w":86,"h":104,"g":"On the ground","n":"Tying boots"},{"id":"p43","w":75,"h":105,"g":"On the ground","n":"Sitting knees"},{"id":"p44","w":104,"h":177,"g":"Arms and signals","n":"Pointing 2"},{"id":"p45","w":108,"h":174,"g":"Arms and signals","n":"Pointing far"},{"id":"p46","w":124,"h":172,"g":"Arms and signals","n":"Arms open 2"},{"id":"p47","w":56,"h":175,"g":"Arms and signals","n":"Clapping"},{"id":"p48","w":56,"h":173,"g":"Arms and signals","n":"Clapping 2"},{"id":"p49","w":73,"h":180,"g":"Arms and signals","n":"Hand up"},{"id":"p50","w":60,"h":193,"g":"Arms and signals","n":"Arm up straight"},{"id":"p51","w":75,"h":198,"g":"Arms and signals","n":"Both arms up"},{"id":"p52","w":68,"h":192,"g":"Arms and signals","n":"Arms over head"},{"id":"p53","w":65,"h":195,"g":"Arms and signals","n":"Arms crossed X"},{"id":"p54","w":78,"h":180,"g":"Arms and signals","n":"Hand on head"},{"id":"p55","w":65,"h":182,"g":"Arms and signals","n":"Hands on face"},{"id":"p56","w":78,"h":189,"g":"Arms and signals","n":"Drinking"},{"id":"p57","w":70,"h":186,"g":"Arms and signals","n":"Towel"},{"id":"p58","w":83,"h":187,"g":"Arms and signals","n":"Ball under arm"},{"id":"p59","w":64,"h":140,"g":"Stretching","n":"Quad stretch"},{"id":"p60","w":82,"h":103,"g":"Stretching","n":"Hamstring"},{"id":"p61","w":143,"h":114,"g":"Stretching","n":"Lunge stretch"},{"id":"p62","w":142,"h":101,"g":"Stretching","n":"Groin stretch"},{"id":"p63","w":76,"h":130,"g":"Stretching","n":"Arm stretch"},{"id":"p64","w":49,"h":128,"g":"Stretching","n":"Triceps"},{"id":"p65","w":82,"h":130,"g":"Stretching","n":"Side stretch"},{"id":"p66","w":176,"h":76,"g":"Stretching","n":"Push-up"},{"id":"p67","w":181,"h":93,"g":"Stretching","n":"Cobra"},{"id":"p68","w":206,"h":47,"g":"Stretching","n":"Lying front"}];
  const POSE = Object.fromEntries(POSES.map((p) => [p.id, p]));
  const POSE_GROUPS = [...new Set(POSES.map((p) => p.g))];
  const POSE_H = 220;                                        // pixel height of a standing figure = FIG metres (plus the head)
  const TINT = { gk: [46, 170, 74], opp: [214, 45, 45], oppgk: [44, 128, 222] };
  const poseImg = {};                                        // "pNN|team" -> data URL | "wait" | "none"
  const poseOf = (it) => (POSE[it.pose] ? it.pose : "p00");
  function tint(img, team) {
    const c = document.createElement("canvas"); c.width = img.naturalWidth; c.height = img.naturalHeight;
    const x = c.getContext("2d"); x.drawImage(img, 0, 0);
    const t = TINT[team];
    if (t) {
      const d = x.getImageData(0, 0, c.width, c.height), a = d.data;
      for (let i = 0; i < a.length; i += 4) {
        const r = a[i], g = a[i + 1], b = a[i + 2];
        if (!a[i + 3] || r < 90 || g < 70 || r - b < 60 || g - b < 45) continue;   // not the yellow of the kit
        const v = Math.min(1.25, (r + g) / 440), m = Math.min(1, (Math.min(r, g) - b) / 150);  // brightness, how yellow it is
        for (let k = 0; k < 3; k++) a[i + k] = Math.round(Math.min(255, (t[k] * v) * m + a[i + k] * (1 - m)));
      }
      x.putImageData(d, 0, 0);
    }
    return c.toDataURL("image/png");
  }
  function loadPose(id, team) {
    const key = id + "|" + (TINT[team] ? team : "aek");
    if (poseImg[key] && poseImg[key] !== "wait") return Promise.resolve();
    poseImg[key] = "wait";
    return new Promise((res) => {
      const img = new Image();
      img.onload = () => { try { poseImg[key] = tint(img, team); } catch (e) { poseImg[key] = "none"; } res(); };
      img.onerror = () => { poseImg[key] = "none"; res(); };
      img.src = "poses/" + id + ".webp";
    });
  }
  function poseUrl(id, team) {
    const key = id + "|" + (TINT[team] ? team : "aek"), v = poseImg[key];
    if (!v) { loadPose(id, team).then(draw); return ""; }
    return v.startsWith("data:") ? v : "";
  }
  const loadPoses = (list) => Promise.all(list.flatMap((b) => b.items.filter((i) => i.t === "p").map((i) => loadPose(poseOf(i), i.team))));

  /* Which way a player faces (it.face, degrees, turning on the spot): 0 = towards the camera, 90 = to the right of the
     screen, 180 = away from the camera, 270 = to the left. A standing player shows the matching view from the sheet
     (front, three-quarter, side, back, and their mirror images: 8 directions). Every other pose has one drawing, made
     facing right, so it is shown as drawn (right) or mirrored (left). Older drawings: it.flip / the chosen standing view. */
  const STAND = ["p00", "p01", "p02", "p03", "p04", "p05", "p06", "p07"];
  const POSE_FACE = { p00: 0, p01: 45, p02: 90, p03: 180, p04: 180, p05: 135, p06: 90, p07: 90 };
  const FACE_POSE = [["p00", 0], ["p01", 0], ["p02", 0], ["p05", 0], ["p03", 0], ["p05", 1], ["p02", 1], ["p01", 1]];
  const FACE_NAME = ["Facing the camera", "Front · right", "Right", "Back · right", "Back to the camera", "Back · left", "Left", "Front · left"];
  function faceOf(it) {
    if (it.face !== undefined && it.face !== null) return ((Math.round(+it.face) % 360) + 360) % 360;
    const p = poseOf(it);
    if (STAND.includes(p)) { const f = POSE_FACE[p]; return it.flip ? (360 - f) % 360 : f; }
    return it.flip ? 270 : 90;
  }
  function look(it) {
    const f = faceOf(it), p = poseOf(it);
    if (STAND.includes(p)) { if (POSE_FACE[p] === f) return { id: p, flip: false }; const [id, fl] = FACE_POSE[Math.round(f / 45) % 8]; return { id, flip: !!fl }; }
    return { id: p, flip: f > 180 };
  }
  /* Where a figure sits on the screen: feet (sx, sy), picture size, top of the figure (for the name). */
  function figGeom(it) {
    const p = POSE[look(it).id], [sx, sy, , kp] = proj(it.x, it.y, 0), k = (scale() * FIG * 1.12 * kp) / POSE_H, w = p.w * k, h = p.h * k;
    return { sx, sy, w, h, k, kp, cx: sx, cy: sy - h / 2, top: sy - h };
  }
  function figureSvg(it, selected) {
    const L = look(it), url = poseUrl(L.id, it.team);
    if (!url) return drawnSvg(it, selected);
    const G = figGeom(it), { sx, sy, w, h } = G;
    const fs = clamp(scale() * 0.78 * G.kp, 10, 22);
    const label = nameLabel(it, sx, G.top, fs);
    const rx = Math.max(w * 0.42, h * 0.16);
    const ring = selected ? `<ellipse cx="${sx.toFixed(1)}" cy="${(sy - 1).toFixed(1)}" rx="${(rx + 6).toFixed(1)}" ry="${((rx + 6) * 0.3).toFixed(1)}" fill="rgba(245,196,0,.35)" stroke="#f5c400" stroke-width="2.4"/>` : "";
    const shadow = `<ellipse cx="${sx.toFixed(1)}" cy="${(sy - 1).toFixed(1)}" rx="${rx.toFixed(1)}" ry="${(rx * 0.26).toFixed(1)}" fill="rgba(0,0,0,.17)"/>`;
    const fl = L.flip ? ` transform="translate(${(sx * 2).toFixed(1)},0) scale(-1,1)"` : "";
    const box = `x="${(sx - w / 2).toFixed(1)}" y="${(sy - h).toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}"`;
    return `<g data-id="${it.id}" class="sb-item sb-fig">${ring}${shadow}<image href="${url}" ${box}${fl}/><rect ${box} fill="transparent"/>${label}</g>`;
  }
  /* Turn handle: a ring on the ground round the player's feet with a point where the player looks. */
  function faceRing(G) { const R = Math.max(G.w * 0.62, G.h * 0.3) + 10; return { R, ry: R * 0.34 }; }
  /* Names: every figure reports its name with the spot just above its head; once all figures are drawn the names are
     laid out so that none covers another (nearest free spot above or to the side, with a thin line back to the player). */
  let labels = null;
  function nameLabel(it, x, top, fs) {
    if (!it.name) return "";
    if (labels) { labels.push({ x, y: top - 6, fs, text: it.name }); return ""; }
    return `<text x="${x.toFixed(1)}" y="${(top - 6).toFixed(1)}" text-anchor="middle" font-size="${fs.toFixed(1)}" class="sb-name">${esc(it.name)}</text>`;
  }
  function labelsSvg(list) {
    const placed = [], out = [];
    const hit = (b) => placed.some((q) => b.x0 < q.x1 && b.x1 > q.x0 && b.y0 < q.y1 && b.y1 > q.y0);
    list.sort((a, b) => b.y - a.y || a.x - b.x);                 // players nearest the camera keep their spot first
    for (const L of list) {
      const w = L.fs * 0.6 * L.text.length + 8, h = L.fs * 1.12;
      const cand = [];
      for (let up = 0; up <= 7; up++) for (const side of [0, -1, 1, -2, 2]) cand.push([side * (w * 0.55), -up * h, Math.abs(side) * 1.25 + up]);
      cand.sort((a, b) => a[2] - b[2]);
      let pick = cand[0];
      for (const c of cand) { const b = { x0: L.x + c[0] - w / 2, x1: L.x + c[0] + w / 2, y0: L.y + c[1] - h * 0.86, y1: L.y + c[1] + h * 0.14 }; if (!hit(b)) { pick = c; break; } }
      const x = L.x + pick[0], y = L.y + pick[1];
      placed.push({ x0: x - w / 2, x1: x + w / 2, y0: y - h * 0.86, y1: y + h * 0.14 });
      if (pick[0] || pick[1]) out.push(`<path d="M${L.x.toFixed(1)} ${(L.y + 4).toFixed(1)} L${x.toFixed(1)} ${(y + 3).toFixed(1)}" stroke="#55585f" stroke-width="1" stroke-dasharray="2 2" fill="none" class="sb-lead"/>`);
      out.push(`<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" text-anchor="middle" font-size="${L.fs.toFixed(1)}" class="sb-name">${esc(L.text)}</text>`);
    }
    return out.join("");
  }
  function posesHtml() {
    const it = board.items.find((i) => i.id === sel && i.t === "p"), cur = it ? (STAND.includes(poseOf(it)) ? look(it).id : poseOf(it)) : curPose;
    return `<div class="sb-row">${POSE_GROUPS.map((g) => `<button class="sb-chip ${poseGroup === g ? "on" : ""}" data-pgroup="${esc(g)}">${esc(g)}</button>`).join("")}</div>
      <div class="sb-poses">${POSES.filter((p) => p.g === poseGroup).map((p) => `<button class="sb-pose ${cur === p.id ? "on" : ""} ${armedPose === p.id ? "armed" : ""}" data-pose="${p.id}" title="${esc(p.n)}" aria-label="${esc(p.n)}"><img src="poses/${p.id}.webp" alt="" loading="lazy" draggable="false"></button>`).join("")}</div>
      <p class="sb-muted">${it ? "Click a figure to change the pose of " + esc(it.name || "the selected player") + "." : "Click a figure, then the pitch to place it. Select a player to change its pose."}</p>`;
  }
  function ballSvg(it, selected) {
    const [sx, sy, , kp] = proj(it.x, it.y, 0), r = clamp(scale() * 0.4 * kp, 3.5, 12);
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
    if (it.t === "p") {                                    // turn handle: drag the point round the ring at the feet (8 directions)
      const G = figGeom(it), { R, ry } = faceRing(G), f = rad(faceOf(it)), hx = G.sx + Math.sin(f) * R, hy = G.sy + Math.cos(f) * ry;
      return `<ellipse cx="${G.sx.toFixed(1)}" cy="${G.sy.toFixed(1)}" rx="${R.toFixed(1)}" ry="${ry.toFixed(1)}" fill="none" stroke="#16171b" stroke-width="1.3" stroke-dasharray="4 4" pointer-events="none"/>
        <path d="M${G.sx.toFixed(1)} ${G.sy.toFixed(1)} L${hx.toFixed(1)} ${hy.toFixed(1)}" stroke="#16171b" stroke-width="1.6" fill="none" pointer-events="none"/>
        <circle data-h="rot" cx="${hx.toFixed(1)}" cy="${hy.toFixed(1)}" r="9" class="sb-h rot"><title>Drag round the ring to turn the player</title></circle>`;
    }
    return "";
  }

  /* ───────── drawing the stage ───────── */
  function stageSvg(forExport, noTitle) {
    const { svg: pitch, C } = pitchSvg(), items = board.items, isSel = (it) => !forExport && sel === it.id;
    let s = DEFS + pitch;
    labels = [];
    s += items.filter((i) => i.t === "z").map((i) => zoneSvg(i, isSel(i))).join("");
    s += items.filter((i) => i.t === "a" && i.kind !== "air").map((i) => arrowSvg(i, isSel(i))).join("");
    // players, balls and both goals in one order, far to near: a goal near the camera covers the players behind it
    const stand = [...items.filter((i) => i.t === "p" || i.t === "b"), { t: "g", x: 0, y: 0, dir: 1 }, { t: "g", x: 0, y: FULL_L, dir: -1 }];
    s += stand.map((i) => [i, proj(i.x, i.y)[2]]).sort((a, b) => b[1] - a[1])
      .map(([i]) => (i.t === "g" ? goalSvg(C, i.y, i.dir) : i.t === "p" ? figureSvg(i, isSel(i)) : ballSvg(i, isSel(i)))).join("");
    s += items.filter((i) => i.t === "a" && i.kind === "air").map((i) => arrowSvg(i, isSel(i))).join("");
    const names = labels; labels = null;
    s += labelsSvg(names);
    s += items.filter((i) => i.t === "t").map((i) => textSvg(i, isSel(i))).join("");
    if (!forExport) { const it = items.find((i) => i.id === sel); if (it) s += handlesSvg(it); }
    if (forExport && !noTitle) {
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
    png: '<path d="M12 3v12M7 10l5 5 5-5M4 20h16"/>', pack: '<path d="M4 8l8-4 8 4-8 4z"/><path d="M4 8v8l8 4 8-4V8M12 12v8"/>', stack: '<rect x="4" y="9" width="16" height="11" rx="1.5"/><path d="M6 6h12M8 3h8"/>', plus: '<path d="M12 5v14M5 12h14"/>', copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 00-1-1H5a1 1 0 00-1 1v10a1 1 0 001 1h3"/>',
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
        <button class="btn sb-ib sb-addpack" id="sbPack" title="Keep a copy of this drawing as it is now in the pack, then go on with the next one">${ic("pack")}<span>Add to pack</span></button>
        <button class="btn sb-ib" id="sbPackOpen" title="The pack: order the drawings and send them as one PDF or one by one">${ic("stack")}<span>Pack</span><b class="sb-badge" id="sbPackN">${pack().length}</b></button>
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
            <label class="sb-sl"><span>Zoom</span><input type="range" id="sbZoom" min="0.25" max="3.2" step="0.02" value="${board.cam.zoom}"></label>
            <label class="sb-sl"><span>3D</span><input type="range" id="sbP" min="0" max="100" step="1" value="${persp(board.cam)}" title="3D perspective: 0 = flat drawing, higher = far players, lines and the far goal get smaller, like on TV"></label>
            <div class="sb-row"><button class="sb-chip ${board.style !== "grass" ? "on" : ""}" data-style="paper">White pitch</button><button class="sb-chip ${board.style === "grass" ? "on" : ""}" data-style="grass">Green pitch</button></div></section>
          <section id="sbInspect"></section>
          <section><h3>Figures <small>R turns · F mirrors</small></h3><div id="sbPoses"></div></section>
          <section><h3>Squad <small>click a name, then the pitch</small></h3><div class="sb-squad" id="sbSquad"></div></section>
          <section><h3>Start from a shape</h3><div class="sb-row"><button class="sb-chip ${side > 0 ? "on" : ""}" data-side="1">Right side</button><button class="sb-chip ${side < 0 ? "on" : ""}" data-side="-1">Left side</button></div>
            <div class="sb-views">${TEMPLATES.map((t) => `<button class="sb-chip" data-tpl="${t.id}">${esc(t.n)}</button>`).join("")}</div></section>
          <section><h3>Notes</h3><textarea id="sbNotes" rows="4" maxlength="1200" placeholder="Roles, signal, timing of the runs">${esc(board.notes)}</textarea></section>
        </aside>
      </div><dialog class="sb-dlg" id="sbPackDlg" aria-label="Pack"></dialog></div>`;
  }
  function squadHtml() {
    const used = new Set(board.items.filter((i) => i.t === "p").map((i) => i.name));
    return squad().map((n) => `<button class="sb-pl ${used.has(n) ? "used" : ""} ${armed === n ? "on" : ""}" data-pl="${esc(n)}">${esc(n)}</button>`).join("") || `<p class="sb-muted">The squad list is empty. Add players in the Week planner.</p>`;
  }
  /* Name of a player: the whole squad in one list (by line, with numbers; ✓ = already on the pitch), "Other name" for anyone else. */
  function nameSelect(it) {
    const used = new Set(board.items.filter((i) => i.t === "p" && i.id !== it.id).map((i) => i.name));
    const opt = (n, num) => `<option value="${esc(n)}" ${it.name === n ? "selected" : ""}>${num ? num + "  " : ""}${esc(n)}${used.has(n) ? "  ✓" : ""}</option>`;
    const extra = plannerSquad().filter((n) => !TEAM_NAMES.includes(n));
    const known = squad().includes(it.name) || !it.name, custom = !known || otherName;
    return `<select id="sbPSel" class="sb-psel" aria-label="Player name"><option value="" ${!it.name && !custom ? "selected" : ""}>No name</option>
      ${TEAM.map(([g, l]) => `<optgroup label="${g}">${l.map(([n, num]) => opt(n, num)).join("")}</optgroup>`).join("")}
      ${extra.length ? `<optgroup label="Squad list">${extra.map((n) => opt(n, "")).join("")}</optgroup>` : ""}
      <option value="__other" ${custom ? "selected" : ""}>Other name…</option></select>
      ${custom ? `<input id="sbPName" maxlength="24" value="${esc(it.name)}" placeholder="Type a name (opponent, trialist…)">` : ""}`;
  }
  function inspectHtml() {
    const it = board.items.find((i) => i.id === sel);
    if (!it) {                                             // nothing selected: the whole squad in one list, pick a name and click the pitch
      const used = new Set(board.items.filter((i) => i.t === "p").map((i) => i.name)), extra = plannerSquad().filter((n) => !TEAM_NAMES.includes(n));
      const opt = (n, num) => `<option value="${esc(n)}" ${armed === n ? "selected" : ""}>${num ? num + "  " : ""}${esc(n)}${used.has(n) ? "  ✓" : ""}</option>`;
      return `<h3>Player</h3><select id="sbAddSel" class="sb-psel" aria-label="Add a player"><option value="">Add a player…</option>
        ${TEAM.map(([g, l]) => `<optgroup label="${g}">${l.map(([n, num]) => opt(n, num)).join("")}</optgroup>`).join("")}
        ${extra.length ? `<optgroup label="Squad list">${extra.map((n) => opt(n, "")).join("")}</optgroup>` : ""}</select>
        <p class="sb-muted">${armed ? "Now click the pitch to place " + esc(armed) + "." : "Pick a name, then click the pitch. Click a player on the pitch to change it."}</p>`;
    }
    const del = `<button class="btn danger sb-ib" data-act="del">${ic("trash")}<span>Delete</span></button>`;
    const sw = (set, cur, attr) => Object.keys(set).map((k) => `<button class="sb-sw ${cur === k ? "on" : ""}" data-${attr}="${k}" style="--c:${Array.isArray(set[k]) ? set[k][1] : set[k]}" aria-label="${k}"></button>`).join("");
    if (it.t === "p") return `<h3>Player</h3>${nameSelect(it)}
      <div class="sb-row">${[["aek", "AEK"], ["gk", "Goalkeeper"], ["opp", "Opponent"], ["oppgk", "Opp. GK"]].map(([k, n]) => `<button class="sb-chip ${it.team === k ? "on" : ""}" data-team="${k}">${n}</button>`).join("")}</div>
      <label class="sb-sl sb-rot"><span>Turn</span><input type="range" id="sbPRot" min="0" max="315" step="45" value="${faceOf(it)}" title="Which way the player looks (R / Shift+R)"></label>
      <div class="sb-face"><output id="sbPRotV">${FACE_NAME[Math.round(faceOf(it) / 45) % 8]}</output></div>
      <div class="sb-row"><button class="sb-chip" data-rot="-45" title="Shift+R">↺ Turn left</button><button class="sb-chip" data-rot="45" title="R">Turn right ↻</button></div>
      <div class="sb-row"><button class="sb-chip" data-act="flip" title="Mirror (F)">⇆ Other way</button><button class="sb-chip" data-rot="0">Face camera</button><span class="sb-muted sb-pn">${esc(POSE[poseOf(it)].n)}</span></div>${del}`;
    if (it.t === "a") return `<h3>Arrow</h3><div class="sb-row">${Object.keys(KINDS).map((k) => `<button class="sb-chip ${it.kind === k ? "on" : ""}" data-kind="${k}">${KINDS[k].n}</button>`).join("")}</div>
      <div class="sb-row">${sw(INK, it.color, "color")}</div><p class="sb-muted">Drag the middle point to bend the line.</p>${del}`;
    if (it.t === "z") return `<h3>Zone</h3><div class="sb-row">${sw(ZONE, it.color, "zcolor")}</div><p class="sb-muted">Drag the two points to change its size.</p>${del}`;
    if (it.t === "t") return `<h3>Text</h3><input id="sbText" maxlength="40" value="${esc(it.text)}">${del}`;
    return `<h3>Ball</h3>${del}`;
  }
  let lastSel = null;
  function refreshSide() {
    if (!host) return;
    if (sel !== lastSel) { otherName = false; lastSel = sel; }
    host.querySelector("#sbInspect").innerHTML = inspectHtml();
    host.querySelector("#sbSquad").innerHTML = squadHtml();
    host.querySelector("#sbPoses").innerHTML = posesHtml();
    host.querySelectorAll("[data-tool]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.tool === tool)));
    const picked = board.items.find((i) => i.id === sel); if (picked && picked.t === "a") ink = picked.color;
    host.querySelectorAll("[data-ink]").forEach((b) => b.classList.toggle("on", b.dataset.ink === ink));
    const t = TOOLS.find((x) => x && x[0] === tool);
    host.querySelector("#sbHint").textContent = armed ? `Click the pitch to place ${armed}` : armedPose ? `Click the pitch to place the figure (${POSE[armedPose].n})` : t ? t[2] : "";
  }
  function redraw(full) { if (!host) return; if (full) { host.innerHTML = shell(); bind(); } refreshSide(); draw(); }
  function setTool(t) { tool = t; armed = null; armedPose = null; if (t !== "select") sel = null; refreshSide(); draw(); }

  /* ───────── pointer work ───────── */
  function stagePoint(e) { const r = host.querySelector("#sbSvg").getBoundingClientRect(); return [((e.clientX - r.left) / r.width) * W, ((e.clientY - r.top) / r.height) * H]; }
  const ground = (e) => { const [sx, sy] = stagePoint(e); const g = unproj(sx, sy); return [clamp(g[0], -45, 45), clamp(g[1], -8, 62)]; };
  function down(e) {
    if (e.button && e.button !== 0) return;
    const svg = host.querySelector("#sbSvg"), g = ground(e), h = e.target.closest("[data-h]"), node = e.target.closest("[data-id]");
    try { svg.setPointerCapture(e.pointerId); } catch (g) { /* pointer already gone: dragging still works while it stays over the pitch */ }
    if (armed || armedPose) { snapshot(); const it = P("aek", g[0], g[1], armed || nextName()); it.pose = curPose; it.face = STAND.includes(curPose) ? POSE_FACE[curPose] : 90; board.items.push(it); armedPose = null; sel = it.id; armed = null; tool = "select"; touch(); refreshSide(); draw(); return; }
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
      const it = P(tool, g[0], g[1], n); it.pose = curPose; it.face = STAND.includes(curPose) ? POSE_FACE[curPose] : 90; board.items.push(it); sel = it.id; dragging = { kind: "move", id: it.id, g0: g, orig: { ...it }, moved: true }; touch(); refreshSide(); draw(); return;
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
      board.cam.tx = clamp(board.cam.tx + (a[0] - b[0]), -40, 40); board.cam.ty = clamp(board.cam.ty + (a[1] - b[1]), -10, 115); dragging.s0 = s; return draw();
    }
    if (!it) return;
    if (dragging.kind === "move") {
      const dx = g[0] - dragging.g0[0], dy = g[1] - dragging.g0[1], o = dragging.orig; dragging.moved = dragging.moved || Math.hypot(dx, dy) > 0.15;
      if (it.t === "a") { it.a = [o.a[0] + dx, o.a[1] + dy]; it.b = [o.b[0] + dx, o.b[1] + dy]; it.c = [o.c[0] + dx, o.c[1] + dy]; } else { it.x = o.x + dx; it.y = o.y + dy; }
    } else if (dragging.kind === "arrow") { it.b = g; it.c = [(it.a[0] + g[0]) / 2, (it.a[1] + g[1]) / 2]; }
    else if (dragging.kind === "zone") { it.w = Math.max(0.6, Math.abs(g[0] - dragging.g0[0])); it.h = Math.max(0.6, Math.abs(g[1] - dragging.g0[1])); }
    else if (dragging.kind === "handle" && dragging.key === "rot") {
      const G = figGeom(it), { R, ry } = faceRing(G), [px, py] = stagePoint(e);
      const a = ((Math.atan2((px - G.sx) / R, (py - G.sy) / ry) * 180) / Math.PI + 360) % 360;
      it.face = (Math.round(a / 45) * 45) % 360; delete it.flip; syncRot(it);
    }
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
  function nextName() { const used = new Set(board.items.filter((i) => i.t === "p").map((i) => i.name)); return squad().find((n) => !used.has(n) && !KEEPERS.includes(n)) || ""; }
  function syncSliders() { const c = board.cam; [["#sbAz", c.az], ["#sbEl", c.el], ["#sbZoom", c.zoom], ["#sbKx", c.kx || 1], ["#sbP", persp(c)]].forEach(([q, v]) => { const el = host.querySelector(q); if (el) el.value = v; }); }
  function turn(it, deg) { it.face = (((Math.round((faceOf(it) + deg) / 45) * 45) % 360) + 360) % 360; delete it.flip; touch(); syncRot(it); draw(); }
  function syncRot(it) { const f = faceOf(it), s = host && host.querySelector("#sbPRot"), o = host && host.querySelector("#sbPRotV"); if (s) s.value = f; if (o) o.textContent = FACE_NAME[Math.round(f / 45) % 8]; }
  function flip() { const it = board.items.find((i) => i.id === sel && i.t === "p"); if (!it) return; snapshot(); it.face = (360 - faceOf(it)) % 360; delete it.flip; touch(); refreshSide(); draw(); }
  function remove() { if (!sel) return; snapshot(); board.items = board.items.filter((i) => i.id !== sel); sel = null; touch(); refreshSide(); draw(); }
  function step(from, to) { if (!from.length) return; to.push(JSON.stringify(board.items)); board.items = JSON.parse(from.pop()); sel = null; touch(); refreshSide(); draw(); }
  function keys(e) {
    if (!host || !host.isConnected || /INPUT|TEXTAREA|SELECT/.test((e.target.tagName || ""))) return;
    if (e.key === "Delete" || e.key === "Backspace") { if (sel) { e.preventDefault(); remove(); } }
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { e.preventDefault(); step(undo, redo); }
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") { e.preventDefault(); step(redo, undo); }
    else if (e.key.toLowerCase() === "f" && !e.ctrlKey && !e.metaKey) { flip(); }
    else if (e.key.toLowerCase() === "r" && !e.ctrlKey && !e.metaKey) { const it = board.items.find((i) => i.id === sel && i.t === "p"); if (it) { e.preventDefault(); snapshot(); turn(it, e.shiftKey ? -45 : 45); } }
    else if (e.key === "Escape") { sel = null; armed = null; armedPose = null; tool = "select"; refreshSide(); draw(); }
  }

  /* ───────── picture ───────── */
  async function picture() {
    await loadPoses([board]);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W * 2}" height="${H * 2}"><style>.sb-name{font-family:Arial,Helvetica,sans-serif;fill:#2b2c30;paint-order:stroke;stroke:#fff;stroke-width:3px}.sb-note{font-family:Arial,Helvetica,sans-serif;font-weight:700;fill:#16171b}</style>${stageSvg(true)}</svg>`;
    const img = new Image();
    img.onload = () => {
      const c = document.createElement("canvas"); c.width = W * 2; c.height = H * 2; c.getContext("2d").drawImage(img, 0, 0);
      c.toBlob((blob) => { const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = ("set-play " + playName(board.play) + " " + (board.name || "")).trim().replace(/[^\w\- ]+/g, "").replace(/\s+/g, "-") + ".png"; document.body.appendChild(a); a.click(); a.remove(); }, "image/png");
    };
    img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  }

  /* ───────── PDF of the drawings (the "PDF report" button on the Drawing board tab) ─────────
     One A4 landscape page per variation of the selected set play: club header, the drawing, the notes. Same fonts and crest
     as the app's Set Plays Report (PDF_FONT_R, PDF_FONT_B, PDF_LOGO from index.html, when present). */
  function boardPng(b, s = 2) {
    const keep = board; board = b;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${Math.round(W * s)}" height="${Math.round(H * s)}"><style>.sb-name{font-family:Arial,Helvetica,sans-serif;fill:#2b2c30;paint-order:stroke;stroke:#fff;stroke-width:3px}.sb-note{font-family:Arial,Helvetica,sans-serif;font-weight:700;fill:#16171b}</style>${stageSvg(true, true)}</svg>`;
    board = keep;
    return new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => { const c = document.createElement("canvas"); c.width = Math.round(W * s); c.height = Math.round(H * s); c.getContext("2d").drawImage(img, 0, 0); res(c.toDataURL("image/jpeg", s < 1 ? 0.8 : 0.92)); };
      img.onerror = () => rej(new Error("the drawing could not be turned into a picture"));
      img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
    });
  }
  /* ───────── PDF ─────────
     One A4 landscape page per drawing: club header, the drawing, the notes. Same fonts and crest as the app's Set Plays
     Report (PDF_FONT_R, PDF_FONT_B, PDF_LOGO from index.html, when present). pages = [{ b: drawing, title }]. */
  const say = (s) => { if (typeof setStatus === "function") setStatus(s); };
  const fileName = (s) => String(s).replace(/[^\w\- ]+/g, "").replace(/\s+/g, " ").trim().slice(0, 80) + ".pdf";
  async function pdfBlob(pages) {
    if (!window.jspdf) throw new Error("PDF library missing");
    await loadPoses(pages.map((p) => p.b));
    const { jsPDF } = window.jspdf, doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
    let F = "helvetica";
    if (typeof PDF_FONT_R !== "undefined" && typeof PDF_FONT_B !== "undefined") {
      doc.addFileToVFS("LS-R.ttf", PDF_FONT_R); doc.addFont("LS-R.ttf", "LS", "normal");
      doc.addFileToVFS("LS-B.ttf", PDF_FONT_B); doc.addFont("LS-B.ttf", "LS", "bold"); F = "LS";
    }
    const T = (s, x, y, o = {}) => { doc.setFont(F, o.b ? "bold" : "normal"); doc.setFontSize(o.s || 9); doc.setTextColor(o.c || "#16171B"); doc.text(String(s), x, y, { align: o.a || "left", maxWidth: o.w }); };
    const made = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
    for (let i = 0; i < pages.length; i++) {
      const { b, title } = pages[i], play = playName(b.play), group = groups()[(plays().find((p) => p.id === b.play) || {}).g] || "";
      if (i) doc.addPage();
      if (typeof PDF_LOGO !== "undefined") { try { doc.addImage(PDF_LOGO, "PNG", 10, 7, 10.5, 14); } catch (e) { /* no crest */ } }
      T("AEK ATHENS FC  ·  PERFORMANCE DEPARTMENT", 24, 11, { s: 7.5, b: 1, c: "#5F636B" });
      T("SET PLAY  ·  " + play.toUpperCase(), 24, 19, { s: 16, b: 1 });
      T(group, 287, 11, { s: 7.5, b: 1, c: "#5F636B", a: "right" });
      T((title || b.name || "Variation") + (b.opponent ? "  ·  vs " + b.opponent : ""), 287, 18.5, { s: 11, b: 1, a: "right" });
      doc.setFillColor("#F5C400"); doc.rect(10, 23.5, 277, 1.1, "F");
      const png = await boardPng(b), h = (277 * H) / W;
      doc.addImage(png, "JPEG", 10, 27, 277, h);
      doc.setDrawColor("#D3D6DA"); doc.setLineWidth(0.25); doc.rect(10, 27, 277, h, "S");
      const y = 27 + h + 6;
      if (b.notes && b.notes.trim()) { T("NOTES", 10, y, { s: 7.5, b: 1, c: "#5F636B" }); T(b.notes.trim(), 10, y + 5, { s: 9.5, w: 277 }); }
      T("AEK Athens FC · Set plays · " + made + (pages.length > 1 ? "  ·  " + (i + 1) + " / " + pages.length : ""), 287, 203, { s: 7, c: "#5F636B", a: "right" });
    }
    return doc.output("blob");
  }
  function download(blob, name) {
    const url = URL.createObjectURL(blob), a = document.createElement("a");
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
  async function pdf() {                                    // "PDF drawings": every variation of the selected set play
    const list = store.list.filter((b) => b.play === board.play);
    if (!list.length) return say("There is no drawing for this set play yet.");
    say("Creating the PDF…");
    try {
      const name = fileName("AEK Set play " + playName(board.play));
      download(await pdfBlob(list.map((b, i) => ({ b, title: b.name || "Variation " + (i + 1) }))), name);
      say("PDF created: " + name + " · " + list.length + (list.length === 1 ? " drawing" : " drawings"));
    } catch (e) { console.error(e); say("Could not create the PDF (" + e.message + ")."); }
  }

  /* ───────── the pack ─────────
     "Add to pack" keeps a frozen copy of the drawing as it is now (store.pack), so the same drawing can be changed for the
     next step and packed again. The pack is sent as one PDF (all pages in order) or one PDF per drawing; on a phone or
     tablet the files can go straight to WhatsApp, Viber or mail (Share). The pack is saved with the drawings and in the backup. */
  const pack = () => (store.pack = Array.isArray(store.pack) ? store.pack : []);
  function packTitle(b) { const same = store.list.filter((x) => x.play === b.play); return b.name || "Variation " + (same.indexOf(b) + 1); }
  const packFile = (p) => playName(p.b.play) + " " + p.title;
  async function addToPack() {
    const copy = JSON.parse(JSON.stringify(board)), n = pack().filter((p) => p.src === board.id).length;
    const item = { id: uid(), src: board.id, title: packTitle(board) + (n ? " (" + (n + 1) + ")" : ""), at: new Date().toISOString(), b: copy, thumb: "" };
    pack().push(item); persist(); refreshPack();
    say("Added to the pack · " + pack().length + (pack().length === 1 ? " drawing" : " drawings"));
    const btn = host && host.querySelector("#sbPack"); if (btn) { btn.classList.add("done"); setTimeout(() => btn.classList.remove("done"), 1400); }
    try { await loadPoses([copy]); item.thumb = await boardPng(copy, 0.42); persist(); refreshPack(); } catch (e) { /* the list works without the small picture */ }
  }
  function refreshPack() {
    if (!host) return;
    const c = host.querySelector("#sbPackN"); if (c) c.textContent = pack().length;
    const d = host.querySelector("#sbPackDlg"); if (d && d.open) d.innerHTML = packHtml();
  }
  function packHtml() {
    const P = pack(), share = !!(navigator.canShare && navigator.share);
    const li = P.map((p, i) => `<li><span class="sb-pk-n">${i + 1}</span>${p.thumb ? `<img src="${p.thumb}" alt="">` : `<i class="sb-pk-ph"></i>`}
      <div class="sb-pk-t"><input data-pkname="${i}" maxlength="80" value="${esc(p.title)}" aria-label="Title of page ${i + 1}"><small>${esc(playName(p.b.play))} · packed ${new Date(p.at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</small></div>
      <div class="sb-pk-b"><button data-pk="up" data-i="${i}" title="Move up" ${i ? "" : "disabled"}>↑</button><button data-pk="down" data-i="${i}" title="Move down" ${i < P.length - 1 ? "" : "disabled"}>↓</button>
      <button data-pk="open" data-i="${i}" title="Open this copy as a new drawing">Edit</button><button data-pk="one" data-i="${i}" title="PDF of this drawing only">PDF</button><button data-pk="del" data-i="${i}" title="Take out of the pack" class="x">✕</button></div></li>`).join("");
    return `<div class="sb-dlg-h"><h3>Pack <small>${P.length} ${P.length === 1 ? "drawing" : "drawings"} · pages in this order</small></h3><button class="sb-dlg-x" data-pk="close" aria-label="Close">✕</button></div>
      ${P.length ? `<ol class="sb-pk">${li}</ol>` : `<p class="sb-muted sb-pk-empty">The pack is empty. Finish a drawing and press <b>Add to pack</b>, then the next one, and so on.</p>`}
      <div class="sb-pk-act">
        <button class="btn primary" data-pk="pdf" ${P.length ? "" : "disabled"}>One document · all ${P.length || ""} in one PDF</button>
        <button class="btn" data-pk="each" ${P.length ? "" : "disabled"}>One by one · a PDF for each</button>
        ${share ? `<button class="btn" data-pk="share" ${P.length ? "" : "disabled"}>Share…</button>` : ""}
        <span class="grow"></span><button class="btn danger" data-pk="clear" ${P.length ? "" : "disabled"}>Empty the pack</button></div>`;
  }
  function openPack() { const d = host.querySelector("#sbPackDlg"); d.innerHTML = packHtml(); if (!d.open) d.showModal(); }
  async function packAction(e) {
    const t = e.target.closest("[data-pk]"); if (!t) return;
    const P = pack(), i = +t.dataset.i, k = t.dataset.pk, d = host.querySelector("#sbPackDlg");
    if (k === "close") return d.close();
    if (k === "up" || k === "down") { const j = k === "up" ? i - 1 : i + 1; [P[i], P[j]] = [P[j], P[i]]; persist(); return refreshPack(); }
    if (k === "del") { P.splice(i, 1); persist(); return refreshPack(); }
    if (k === "clear") { if (!confirm("Empty the pack? The drawings themselves stay.")) return; P.length = 0; persist(); return refreshPack(); }
    if (k === "open") { const b = JSON.parse(JSON.stringify(P[i].b)); b.id = uid(); b.name = P[i].title; b.items.forEach((x) => (x.id = uid())); store.list.push(b); d.close(); return open(b); }
    const pages = (k === "one" ? [P[i]] : P).map((p) => ({ b: p.b, title: p.title }));
    const stamp = new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
    try {
      t.disabled = true; say("Creating the PDF…");
      if (k === "pdf" || k === "one") {
        const name = fileName(k === "one" ? "AEK " + packFile(P[i]) : "AEK Set plays " + stamp + " (" + P.length + ")");
        download(await pdfBlob(pages), name); say("PDF created: " + name);
      } else if (k === "each") {
        for (let n = 0; n < P.length; n++) { download(await pdfBlob([pages[n]]), fileName(String(n + 1).padStart(2, "0") + " AEK " + packFile(P[n]))); await new Promise((r) => setTimeout(r, 400)); }
        say(P.length + " PDF files created, one for each drawing.");
      } else if (k === "share") {
        const one = confirm("Share as ONE document with all drawings?\n\nOK = one PDF · Cancel = a PDF for each drawing");
        const files = one ? [new File([await pdfBlob(pages)], fileName("AEK Set plays " + stamp), { type: "application/pdf" })]
          : await Promise.all(pages.map(async (p, n) => new File([await pdfBlob([p])], fileName(String(n + 1).padStart(2, "0") + " AEK " + packFile(P[n])), { type: "application/pdf" })));
        if (navigator.canShare({ files })) await navigator.share({ files, title: "AEK set plays" }); else { files.forEach((f) => download(f, f.name)); }
        say("Ready to send.");
      }
    } catch (err) { if (err && err.name !== "AbortError") { console.error(err); say("Could not create the PDF (" + err.message + ")."); } }
    finally { t.disabled = false; }
  }

  /* ───────── wiring ───────── */
  function open(b) { board = b; store.cur = b.id; sel = null; undo = []; redo = []; persist(); redraw(true); }
  function bind() {
    const q = (s) => host.querySelector(s), svg = q("#sbSvg");
    svg.addEventListener("pointerdown", down); svg.addEventListener("pointermove", move); svg.addEventListener("pointerup", up); svg.addEventListener("pointercancel", up);
    svg.addEventListener("dblclick", (e) => { const n = e.target.closest("[data-id]"); const it = n && board.items.find((i) => i.id === n.dataset.id); if (it && it.t === "p") { sel = it.id; refreshSide(); draw(); const f = q("#sbPName") || q("#sbPSel"); if (f) f.focus(); } });
    svg.addEventListener("wheel", (e) => { e.preventDefault(); board.cam.zoom = clamp(board.cam.zoom * (e.deltaY < 0 ? 1.08 : 0.926), 0.25, 3.2); syncSliders(); touch(); draw(); }, { passive: false });
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
    q("#sbPack").onclick = addToPack; q("#sbPackOpen").onclick = openPack;
    const dlg = q("#sbPackDlg");
    dlg.addEventListener("click", (e) => { if (e.target === dlg) return dlg.close(); packAction(e); });
    dlg.addEventListener("input", (e) => { const n = e.target.dataset.pkname; if (n !== undefined && pack()[+n]) { pack()[+n].title = e.target.value; clearTimeout(saveT); saveT = setTimeout(persist, 400); } });
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
    q("#sbP").oninput = (e) => { board.cam.p = +e.target.value; touch(); draw(); };
    q("#sbKx").oninput = (e) => { board.cam.kx = +e.target.value; touch(); draw(); };
    q(".sb-side").addEventListener("click", (e) => {
      const b = e.target.closest("button"); if (!b) return;
      const it = board.items.find((i) => i.id === sel), d = b.dataset;
      if (d.view) { board.cam = camFrom(viewOf(d.view), persp(board.cam)); syncSliders(); touch(); return draw(); }
      if (d.style) { board.style = d.style; touch(); return redraw(true); }
      if (d.pgroup) { poseGroup = d.pgroup; return refreshSide(); }
      if (d.pose) {
        curPose = d.pose; const p = board.items.find((i) => i.id === sel && i.t === "p");
        if (p) { if (p.pose !== d.pose || STAND.includes(d.pose)) { snapshot(); const f = faceOf(p); p.pose = d.pose; p.face = STAND.includes(d.pose) ? POSE_FACE[d.pose] : f; delete p.flip; touch(); } armedPose = null; }
        else { armedPose = armedPose === d.pose ? null : d.pose; armed = null; tool = "select"; }
        refreshSide(); return draw();
      }
      if (d.act === "flip") return flip();
      if (d.rot !== undefined && it && it.t === "p") { snapshot(); if (+d.rot === 0) { it.face = 0; delete it.flip; touch(); refreshSide(); return draw(); } return turn(it, +d.rot); }
      if (d.side) { side = +d.side; return redraw(true); }
      if (d.tpl) {
        if (board.items.length && !confirm("Replace what is on the pitch with this shape?")) return;
        const t = TEMPLATES.find((x) => x.id === d.tpl); snapshot(); board.items = t.build(-side); board.cam = camFrom(viewOf(t.view(side)), persp(board.cam)); sel = null; touch(); return redraw(true);
      }
      if (d.pl) { armed = armed === d.pl ? null : d.pl; armedPose = null; tool = "select"; sel = null; refreshSide(); return draw(); }
      if (d.act === "del") return remove();
      if (!it) return;
      snapshot();
      if (d.team) it.team = d.team; if (d.kind) { it.kind = d.kind; if (d.kind === "block" && it.color === "k") it.color = "r"; } if (d.color) it.color = d.color; if (d.zcolor) it.color = d.zcolor;
      touch(); refreshSide(); draw();
    });
    q(".sb-side").addEventListener("change", () => { rotSnap = false; });
    q(".sb-side").addEventListener("input", (e) => {
      if (e.target.id === "sbAddSel") { armed = e.target.value || null; armedPose = null; tool = "select"; refreshSide(); return draw(); }
      const it = board.items.find((i) => i.id === sel); if (!it) return;
      if (e.target.id === "sbPSel") {
        if (e.target.value === "__other") { otherName = true; refreshSide(); const f = host.querySelector("#sbPName"); if (f) { f.focus(); f.select(); } return; }
        otherName = false; snapshot(); it.name = e.target.value; touch(); refreshSide(); return draw();
      }
      if (e.target.id === "sbPName") { it.name = e.target.value; touch(); draw(); host.querySelector("#sbSquad").innerHTML = squadHtml(); }
      if (e.target.id === "sbText") { it.text = e.target.value; touch(); draw(); }
      if (e.target.id === "sbPRot") { if (!rotSnap) { snapshot(); rotSnap = true; } it.face = +e.target.value; delete it.flip; touch(); syncRot(it); draw(); }
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
.sb-poses{display:grid;grid-template-columns:repeat(auto-fill,minmax(44px,1fr));gap:5px;max-height:236px;overflow:auto;padding:2px}
.sb-pose{height:62px;border:1px solid var(--line);background:#eef2ea;border-radius:7px;padding:3px;cursor:pointer;display:flex;align-items:flex-end;justify-content:center}
.sb-pose img{max-width:100%;max-height:100%;object-fit:contain;pointer-events:none}
.sb-pose:hover{border-color:var(--muted)}.sb-pose.on{outline:2px solid var(--accent);border-color:var(--accent);background:#fff6cc}
.sb-pose.armed{outline:3px solid #16171b}
.sb-pn{align-self:center}
.sb-badge{min-width:20px;height:20px;border-radius:10px;background:var(--accent);color:var(--accent-ink);font:700 11.5px/20px var(--f-body);text-align:center;padding:0 5px}
.sb-addpack.done{background:#2bb24c;border-color:#2bb24c;color:#fff}.sb-addpack.done span::after{content:" ✓"}
.sb-dlg{width:min(860px,calc(100vw - 32px));max-height:calc(100vh - 60px);border:1px solid var(--line);border-radius:14px;background:var(--surface);color:var(--ink);padding:16px 18px;box-shadow:0 20px 60px rgba(0,0,0,.45)}
.sb-dlg::backdrop{background:rgba(10,11,13,.6)}
.sb-dlg-h{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:12px}
.sb-dlg-h h3{margin:0;font:700 18px var(--f-body)}.sb-dlg-h h3 small{font:400 13px var(--f-body);color:var(--muted);margin-left:8px}
.sb-dlg-x{border:0;background:var(--surface2);color:var(--ink);width:34px;height:34px;border-radius:8px;cursor:pointer;font-size:15px}
.sb-pk{list-style:none;margin:0 0 14px;padding:0;display:flex;flex-direction:column;gap:8px;max-height:56vh;overflow:auto}
.sb-pk li{display:grid;grid-template-columns:26px 150px minmax(0,1fr) auto;gap:12px;align-items:center;border:1px solid var(--line);border-radius:10px;padding:8px 10px;background:var(--surface2)}
.sb-pk-n{font:700 15px var(--f-body);color:var(--muted);text-align:center}
.sb-pk img,.sb-pk-ph{width:150px;height:87px;object-fit:cover;border-radius:6px;border:1px solid var(--line);background:#e9ece6;display:block}
.sb-pk-t{display:flex;flex-direction:column;gap:4px;min-width:0}.sb-pk-t input{width:100%;border:1px solid var(--line);background:var(--surface);color:var(--ink);border-radius:6px;padding:7px 9px;font:600 14px var(--f-body)}
.sb-pk-t small{color:var(--muted);font-size:12px}
.sb-pk-b{display:flex;gap:4px;flex-wrap:wrap;justify-content:flex-end}
.sb-pk-b button{border:1px solid var(--line);background:var(--surface);color:var(--ink);border-radius:6px;padding:5px 9px;font:600 12.5px var(--f-body);cursor:pointer}
.sb-pk-b button:disabled{opacity:.35;cursor:default}.sb-pk-b .x{color:#e5484d}
.sb-pk-empty{padding:18px 4px 22px}
.sb-pk-act{display:flex;flex-wrap:wrap;gap:8px;align-items:center}.sb-pk-act .grow{flex:1}
@media (max-width:640px){.sb-pk li{grid-template-columns:22px 92px minmax(0,1fr)}.sb-pk img,.sb-pk-ph{width:92px;height:54px}.sb-pk-b{grid-column:1/-1}}
.sb-psel{width:100%;border:1px solid var(--line);background:var(--surface);color:var(--ink);border-radius:6px;padding:8px 10px;font:600 14px var(--f-body)}
.sb-psel option,.sb-psel optgroup{background:#fff;color:#16171b}
.sb-h.rot{fill:#fff;stroke:#16171b;cursor:grab}
.sb-face output{font:600 12.5px var(--f-body);color:var(--ink)}
.sb-lead{pointer-events:none}
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
    pdf() { if (!board) { load(); board = store.list.find((b) => b.id === store.cur) || store.list[store.list.length - 1]; } return board ? pdf() : setStatus("There is no drawing yet."); },
    restore(data) { if (data && Array.isArray(data.list)) { store = data; wholePitch(store.list); persist(); } },
  };
})();
