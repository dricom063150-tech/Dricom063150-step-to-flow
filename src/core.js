/* =====================================================================
   MOTEUR D'ANALYSE STEP → RÉSEAU FLUIDIQUE
   Exécuté dans un Web Worker (ou dans le fil principal en repli).
   Aucune dépendance, aucun appel réseau.
   Sections :
     1. Outils vectoriels / matrices
     2. Analyseur ISO 10303-21 (section DATA, lecture paresseuse)
     3. Unités (LENGTH_UNIT, PLANE_ANGLE_UNIT) par contexte de représentation
     4. Arbre produit, assemblage, transformations → corps instanciés
     5. Extraction des faces analytiques (cylindre, tore, cône…)
     6. Reconnaissance des primitives (tube, coude, réduction)
     7. Jonctions (tés, onglets), nœuds, équipements, composants de longueur nulle
     8. Numérotation stable, topologie (boucles, sous-réseaux), alertes
   ===================================================================== */
'use strict';

/* ---------- 1. Outils vectoriels ---------- */
const V = {
  add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  mul: (a, s) => [a[0] * s, a[1] * s, a[2] * s],
  dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  len: (a) => Math.hypot(a[0], a[1], a[2]),
  dist: (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]),
  norm: (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; },
  perp: (d) => { const t = Math.abs(d[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]; return V.norm(V.cross(d, t)); },
  angle: (a, b) => { const c = V.dot(V.norm(a), V.norm(b)); return Math.acos(Math.max(-1, Math.min(1, c))); }
};
const DEG = 180 / Math.PI;
// Matrice rigide 3x4 : {r:[9] (lignes), t:[3]}
const M = {
  id: () => ({ r: [1, 0, 0, 0, 1, 0, 0, 0, 1], t: [0, 0, 0] }),
  fromFrame: (f) => ({ r: [f.x[0], f.y[0], f.z[0], f.x[1], f.y[1], f.z[1], f.x[2], f.y[2], f.z[2]], t: f.o.slice() }),
  ap: (m, p) => [m.r[0] * p[0] + m.r[1] * p[1] + m.r[2] * p[2] + m.t[0], m.r[3] * p[0] + m.r[4] * p[1] + m.r[5] * p[2] + m.t[1], m.r[6] * p[0] + m.r[7] * p[1] + m.r[8] * p[2] + m.t[2]],
  apd: (m, p) => [m.r[0] * p[0] + m.r[1] * p[1] + m.r[2] * p[2], m.r[3] * p[0] + m.r[4] * p[1] + m.r[5] * p[2], m.r[6] * p[0] + m.r[7] * p[1] + m.r[8] * p[2]],
  mul: (a, b) => {
    const r = new Array(9);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) r[i * 3 + j] = a.r[i * 3] * b.r[j] + a.r[i * 3 + 1] * b.r[3 + j] + a.r[i * 3 + 2] * b.r[6 + j];
    return { r, t: M.ap(a, b.t) };
  },
  inv: (m) => { // rigide : R^T, -R^T t
    const r = [m.r[0], m.r[3], m.r[6], m.r[1], m.r[4], m.r[7], m.r[2], m.r[5], m.r[8]];
    const t = [-(r[0] * m.t[0] + r[1] * m.t[1] + r[2] * m.t[2]), -(r[3] * m.t[0] + r[4] * m.t[1] + r[5] * m.t[2]), -(r[6] * m.t[0] + r[7] * m.t[1] + r[8] * m.t[2])];
    return { r, t };
  },
  isId: (m) => m.r.every((v, i) => Math.abs(v - [1, 0, 0, 0, 1, 0, 0, 0, 1][i]) < 1e-12) && m.t.every(v => Math.abs(v) < 1e-12)
};

/* ---------- 2. Analyseur STEP (ISO 10303-21) ---------- */
const STAR = { star: true };
function decodeStepString(s) {
  return s.replace(/''/g, "'")
    .replace(/\\X2\\([0-9A-F]+)\\X0\\/gi, (m, h) => { let r = ''; for (let i = 0; i + 3 < h.length; i += 4) r += String.fromCharCode(parseInt(h.substr(i, 4), 16)); return r; })
    .replace(/\\X4\\([0-9A-F]+)\\X0\\/gi, (m, h) => { let r = ''; for (let i = 0; i + 7 < h.length; i += 8) r += String.fromCodePoint(parseInt(h.substr(i, 8), 16)); return r; })
    .replace(/\\X\\([0-9A-F]{2})/gi, (m, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\S\\(.)/g, (m, c) => String.fromCharCode(c.charCodeAt(0) + 128))
    .replace(/\\P.\\/g, '').replace(/\\\\/g, '\\');
}
// Analyse le membre droit d'une instance : "NOM(args)" ou "(A(..) B(..))"
function parseRHS(s) {
  let p = 0; const n = s.length;
  const ws = () => { while (p < n) { const c = s.charCodeAt(p); if (c <= 32) p++; else if (c === 47 && s.charCodeAt(p + 1) === 42) { const e = s.indexOf('*/', p + 2); p = e < 0 ? n : e + 2; } else break; } };
  const kw = () => { const st = p; while (p < n) { const c = s.charCodeAt(p); if ((c >= 65 && c <= 90) || (c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c === 95 || c === 45) p++; else break; } return s.slice(st, p).toUpperCase(); };
  function val() {
    ws(); const c = s.charCodeAt(p);
    if (c === 35) { p++; let id = 0, d; while ((d = s.charCodeAt(p)) >= 48 && d <= 57) { id = id * 10 + d - 48; p++; } return { r: id }; }
    if (c === 39) { let st = ++p, out = ''; while (p < n) { if (s.charCodeAt(p) === 39) { if (s.charCodeAt(p + 1) === 39) { p += 2; continue; } break; } p++; } out = s.slice(st, p); p++; return decodeStepString(out); }
    if (c === 40) return list();
    if (c === 46) { const e = s.indexOf('.', p + 1); const v = s.slice(p + 1, e).toUpperCase(); p = e + 1; return { en: v }; }
    if (c === 36) { p++; return null; }
    if (c === 42) { p++; return STAR; }
    if (c === 34) { const e = s.indexOf('"', p + 1); const v = s.slice(p + 1, e); p = e + 1; return { bin: v }; }
    if (c === 45 || c === 43 || (c >= 48 && c <= 57)) { const st = p; p++; while (p < n) { const d = s.charCodeAt(p); if ((d >= 48 && d <= 57) || d === 46 || d === 69 || d === 101 || d === 45 || d === 43) p++; else break; } return parseFloat(s.slice(st, p)); }
    const k = kw(); ws(); if (s.charCodeAt(p) === 40) return { tp: k, a: list() };
    throw new Error('Syntaxe STEP inattendue près de « ' + s.slice(Math.max(0, p - 20), p + 20) + ' »');
  }
  function list() {
    p++; const arr = []; ws(); if (s.charCodeAt(p) === 41) { p++; return arr; }
    for (;;) { arr.push(val()); ws(); const c = s.charCodeAt(p); if (c === 44) { p++; continue; } if (c === 41) { p++; break; } throw new Error('Liste STEP mal formée près de « ' + s.slice(Math.max(0, p - 20), p + 20) + ' »'); }
    return arr;
  }
  ws();
  if (s.charCodeAt(p) === 40) { p++; const parts = []; ws(); while (p < n && s.charCodeAt(p) !== 41) { const k = kw(); ws(); parts.push({ t: k, a: list() }); ws(); } return { t: '*COMPLEX', parts }; }
  const k = kw(); ws(); return { t: k, a: list() };
}

function parseStep(text, progress) {
  const head = text.slice(0, Math.min(text.length, 60000));
  if (!/ISO-10303-21/i.test(head)) throw new Error("Ce fichier n'est pas un fichier STEP (en-tête ISO-10303-21 absent).");
  const header = {
    schema: ((/FILE_SCHEMA\s*\(\s*\(\s*'([^']*)'/i.exec(head) || [])[1] || 'inconnu'),
    fileName: ((/FILE_NAME\s*\(\s*'([^']*)'/i.exec(head) || [])[1] || ''),
    system: ((/FILE_NAME\s*\([^;]*?'[^']*'\s*,\s*'[^']*'\s*,\s*\([^)]*\)\s*,\s*\([^)]*\)\s*,\s*'([^']*)'/i.exec(head) || [])[1] || '')
  };
  const ds = /\bDATA\b[^;]*;/i.exec(text);
  if (!ds) throw new Error('Section DATA introuvable.');
  let i = ds.index + ds[0].length; const n = text.length;
  const raw = new Map(), byType = new Map(); let last = i;
  const idx = (t, id) => { let a = byType.get(t); if (!a) byType.set(t, a = []); a.push(id); };
  while (i < n) {
    let c = text.charCodeAt(i);
    if (c === 35) {
      let j = i + 1, id = 0;
      while ((c = text.charCodeAt(j)) >= 48 && c <= 57) { id = id * 10 + c - 48; j++; }
      while (j < n && text.charCodeAt(j) <= 32) j++;
      if (text.charCodeAt(j) !== 61) { i = j; continue; }
      j++; let k = j, inStr = false;
      for (; k < n; k++) {
        c = text.charCodeAt(k);
        if (inStr) { if (c === 39) { if (text.charCodeAt(k + 1) === 39) k++; else inStr = false; } }
        else if (c === 39) inStr = true; else if (c === 59) break;
        else if (c === 47 && text.charCodeAt(k + 1) === 42) { const e = text.indexOf('*/', k + 2); k = e < 0 ? n : e + 1; }
      }
      const body = text.slice(j, k);
      let p = 0; while (p < body.length && body.charCodeAt(p) <= 32) p++;
      if (body.charCodeAt(p) === 40) {
        const e = parseRHS(body); e.complex = true; raw.set(id, e);
        for (const pt of e.parts) idx(pt.t, id);
      } else {
        let q = p; while (q < body.length) { const cc = body.charCodeAt(q); if (cc === 40 || cc <= 32) break; q++; }
        const t = body.slice(p, q).toUpperCase();
        raw.set(id, { t, s: body, a: undefined }); idx(t, id);
      }
      i = k + 1;
      if (progress && i - last > 1500000) { last = i; progress(i / n); }
    } else if (c === 47 && text.charCodeAt(i + 1) === 42) { const e = text.indexOf('*/', i + 2); i = e < 0 ? n : e + 2; }
    else if (c === 69 && text.startsWith('ENDSEC', i)) break;
    else i++;
  }
  const db = {
    header, raw, byType,
    get(id) {
      const e = raw.get(id); if (!e) return null;
      if (e.a === undefined && !e.complex) { const r = parseRHS(e.s); e.a = r.a; e.s = null; }
      return e;
    },
    ref(v) { return v && v.r !== undefined ? this.get(v.r) : null; },
    part(e, t) { if (!e) return null; if (!e.complex) return e.t === t ? e.a : null; const p = e.parts.find(x => x.t === t); return p ? p.a : null; },
    has(e, t) { return !!e && (e.complex ? e.parts.some(x => x.t === t) : e.t === t); },
    ids(t) { return byType.get(t) || []; },
    typeName(id) { const e = raw.get(id); return e ? (e.complex ? '(' + e.parts.map(x => x.t).join(' ') + ')' : e.t) : '?'; }
  };
  return db;
}

/* ---------- 3. Unités ---------- */
const SI_PREFIX = { EXA: 1e18, PETA: 1e15, TERA: 1e12, GIGA: 1e9, MEGA: 1e6, KILO: 1e3, HECTO: 1e2, DECA: 10, DECI: 0.1, CENTI: 0.01, MILLI: 1e-3, MICRO: 1e-6, NANO: 1e-9, PICO: 1e-12 };
function unitInfo(db, ref, depth = 0) {
  const u = db.ref(ref); if (!u || depth > 5) return null;
  const kind = db.has(u, 'LENGTH_UNIT') ? 'len' : db.has(u, 'PLANE_ANGLE_UNIT') ? 'ang' : db.has(u, 'SOLID_ANGLE_UNIT') ? 'solid' : 'autre';
  const si = db.part(u, 'SI_UNIT');
  if (si) {
    const pf = si[0] && si[0].en ? (SI_PREFIX[si[0].en] || 1) : 1; const nm = si[1] && si[1].en;
    if (nm === 'METRE') return { kind, scale: 1000 * pf, label: (si[0] && si[0].en ? si[0].en + ' ' : '') + 'METRE' };
    if (nm === 'RADIAN') return { kind, scale: pf, label: 'RADIAN' };
    return { kind, scale: null, label: nm || '?' };
  }
  const cb = db.part(u, 'CONVERSION_BASED_UNIT');
  if (cb) {
    const m = db.ref(cb[1]); if (!m) return { kind, scale: null, label: cb[0] };
    const a = m.complex ? (db.part(m, 'MEASURE_WITH_UNIT') || []) : m.a;
    const vc = a[0]; const val = typeof vc === 'number' ? vc : (vc && vc.a ? vc.a[0] : null);
    const base = unitInfo(db, a[1], depth + 1);
    return { kind, scale: (val != null && base && base.scale != null) ? val * base.scale : null, label: cb[0] };
  }
  return { kind, scale: null, label: '?' };
}
function contextUnits(db, ctxRef, cache) {
  const key = ctxRef && ctxRef.r; if (cache.has(key)) return cache.get(key);
  const res = { len: null, ang: null, lenLabel: null, angLabel: null };
  const c = db.ref(ctxRef);
  const g = c && db.part(c, 'GLOBAL_UNIT_ASSIGNED_CONTEXT');
  if (g) for (const ur of g[0] || []) {
    const ui = unitInfo(db, ur); if (!ui) continue;
    if (ui.kind === 'len') { res.len = ui.scale; res.lenLabel = ui.label; }
    if (ui.kind === 'ang') { res.ang = ui.scale; res.angLabel = ui.label; }
  }
  cache.set(key, res); return res;
}

/* ---------- 4. Arbre produit et corps instanciés ---------- */
const SOLID_TYPES = new Set(['MANIFOLD_SOLID_BREP', 'BREP_WITH_VOIDS', 'SHELL_BASED_SURFACE_MODEL', 'FACETED_BREP']);
const TESS_TYPES = ['TRIANGULATED_FACE', 'COMPLEX_TRIANGULATED_FACE', 'TESSELLATED_SOLID', 'TESSELLATED_SHELL', 'TRIANGULATED_SURFACE_SET', 'COMPLEX_TRIANGULATED_SURFACE_SET', 'TESSELLATED_SHAPE_REPRESENTATION'];

function frameOf(db, ref, lenScale) {
  const a = db.ref(ref); const f = { o: [0, 0, 0], z: [0, 0, 1], x: [1, 0, 0] };
  if (!a || !a.a) return finishFrame(f);
  const pa = a.a;
  const pt = db.ref(pa[1]); if (pt) f.o = V.mul(pt.a[1].slice(0, 3).concat([0, 0, 0]).slice(0, 3), lenScale);
  const z = db.ref(pa[2]); if (z && pa[2]) f.z = V.norm(z.a[1].slice(0, 3));
  const x = db.ref(pa[3]); if (x && pa[3]) f.x = x.a[1].slice(0, 3);
  return finishFrame(f);
}
function finishFrame(f) {
  let x = V.sub(f.x, V.mul(f.z, V.dot(f.x, f.z)));
  if (V.len(x) < 1e-9) x = V.perp(f.z);
  f.x = V.norm(x); f.y = V.cross(f.z, f.x); return f;
}

function extractBodies(db, S, progress) {
  const alerts = [];
  const ctxCache = new Map();
  const isRep = (t) => t.indexOf('SHAPE_REPRESENTATION') >= 0 && t !== 'SHAPE_DEFINITION_REPRESENTATION' && t !== 'CONTEXT_DEPENDENT_SHAPE_REPRESENTATION' && t.indexOf('RELATIONSHIP') < 0;
  const repIds = []; for (const [t, ids] of db.byType) if (isRep(t)) for (const id of ids) { const e = db.get(id); if (!e.complex) repIds.push(id); }
  // Liens entre représentations sans transformation (SRR simple)
  const repLinks = new Map(); const link = (a, b) => { if (!repLinks.has(a)) repLinks.set(a, []); repLinks.get(a).push(b); };
  for (const t of ['SHAPE_REPRESENTATION_RELATIONSHIP', 'REPRESENTATION_RELATIONSHIP']) for (const id of db.ids(t)) {
    const e = db.get(id); if (e.complex) continue; const a = e.a; if (a[2] && a[3]) { link(a[2].r, a[3].r); link(a[3].r, a[2].r); }
  }
  // Unité de chaque représentation
  const unitsOfRep = (rid) => { const r = db.get(rid); return contextUnits(db, r && r.a ? r.a[2] : null, ctxCache); };
  const unitSeen = new Map(); const angSeen = new Map();
  const lenScaleOf = (rid) => {
    const u = unitsOfRep(rid);
    const key = u.lenLabel || 'non trouvée'; unitSeen.set(key, (unitSeen.get(key) || 0) + 1);
    if (S.unitOverride && S.unitOverride !== 'auto') return { mm: { mm: 1, m: 1000, in: 25.4, cm: 10 }[S.unitOverride], found: u.len != null };
    return { mm: u.len != null ? u.len : 1, found: u.len != null };
  };
  const angScaleOf = (rid) => { const u = unitsOfRep(rid); angSeen.set(u.angLabel || 'non trouvée', 1); return u.ang != null ? u.ang : 1; };
  // Représentation(s) de chaque PRODUCT_DEFINITION
  const sdrByPD = new Map();
  for (const id of db.ids('SHAPE_DEFINITION_REPRESENTATION')) {
    const e = db.get(id); const pds = db.ref(e.a[0]); if (!pds || pds.t !== 'PRODUCT_DEFINITION_SHAPE') continue;
    const def = pds.a[2]; if (!def) continue; const d = db.get(def.r); if (!d) continue;
    if (d.t.indexOf('PRODUCT_DEFINITION') === 0 && d.t !== 'PRODUCT_DEFINITION_SHAPE') { if (!sdrByPD.has(def.r)) sdrByPD.set(def.r, []); sdrByPD.get(def.r).push(e.a[1].r); }
  }
  const pdName = (pdId) => {
    const pd = db.get(pdId); if (!pd || !pd.a) return '';
    const pdf = db.ref(pd.a[2]); const pr = pdf && db.ref(pdf.a[2]);
    if (pr && pr.t === 'PRODUCT') return (pr.a[1] || pr.a[0] || '').trim();
    return (pd.a[0] || '').trim();
  };
  // NAUO et transformations d'assemblage
  const children = new Map(); const relatedSet = new Set(); const relatingSet = new Set();
  for (const id of db.ids('NEXT_ASSEMBLY_USAGE_OCCURRENCE')) {
    const e = db.get(id); const pa = e.a[3] && e.a[3].r, ch = e.a[4] && e.a[4].r; if (!pa || !ch) continue;
    if (!children.has(pa)) children.set(pa, []); children.get(pa).push({ id, child: ch, name: (e.a[1] || e.a[0] || '').trim() });
    relatedSet.add(ch); relatingSet.add(pa);
  }
  const cdsrByNauo = new Map();
  for (const id of db.ids('CONTEXT_DEPENDENT_SHAPE_REPRESENTATION')) {
    const e = db.get(id); const pds = db.ref(e.a[1]); if (pds && pds.a && pds.a[2]) cdsrByNauo.set(pds.a[2].r, e.a[0].r);
  }
  const repClosure = (rid) => { const out = new Set([rid]); const st = [rid]; while (st.length) { const r = st.pop(); for (const o of repLinks.get(r) || []) if (!out.has(o)) { out.add(o); st.push(o); } } return out; };
  const placementMatrix = (ref, rid) => M.fromFrame(frameOf(db, ref, lenScaleOf(rid).mm));
  const nauoTransform = (nauo, childPD) => {
    const relId = cdsrByNauo.get(nauo.id);
    if (!relId) { alerts.push({ lvl: 'warn', msg: `Occurrence « ${nauo.name} » (#${nauo.id}) sans transformation d'assemblage (CONTEXT_DEPENDENT_SHAPE_REPRESENTATION absente) : position identité supposée.` }); return M.id(); }
    const rr = db.get(relId);
    const base = db.part(rr, 'REPRESENTATION_RELATIONSHIP') || (rr.complex ? null : rr.a);
    const wt = db.part(rr, 'REPRESENTATION_RELATIONSHIP_WITH_TRANSFORMATION');
    if (!base || !wt) return M.id();
    const op = db.ref(wt[0]); if (!op) return M.id();
    const rep1 = base[2].r, rep2 = base[3].r;
    const childReps = new Set(); for (const r of sdrByPD.get(childPD) || []) for (const x of repClosure(r)) childReps.add(x);
    if (op.t === 'ITEM_DEFINED_TRANSFORMATION') {
      const m1 = placementMatrix(op.a[2], rep1), m2 = placementMatrix(op.a[3], rep2);
      if (childReps.has(rep1) || !childReps.has(rep2)) return M.mul(m2, M.inv(m1));
      return M.mul(m1, M.inv(m2));
    }
    if (op.t === 'CARTESIAN_TRANSFORMATION_OPERATOR_3D') {
      const s = lenScaleOf(rep2).mm; const a = op.a;
      const f = { o: db.ref(a[4]) ? V.mul(db.ref(a[4]).a[1], s) : [0, 0, 0], x: db.ref(a[2]) ? db.ref(a[2]).a[1] : [1, 0, 0], z: db.ref(a[6]) ? db.ref(a[6]).a[1] : [0, 0, 1] };
      if (a[5] != null && Math.abs(a[5] - 1) > 1e-9) alerts.push({ lvl: 'warn', msg: `Transformation avec facteur d'échelle ${a[5]} ignoré (#${wt[0].r}).` });
      return M.fromFrame(finishFrame(f));
    }
    alerts.push({ lvl: 'warn', msg: `Type de transformation non pris en charge : ${op.t} (#${wt[0].r}).` }); return M.id();
  };
  // Collecte des solides d'une représentation (avec MAPPED_ITEM)
  const bodies = []; const reached = new Set();
  const collect = (rid, m, info, seen) => {
    if (seen.has(rid)) return; seen.add(rid);
    const r = db.get(rid); if (!r || !r.a) return;
    for (const it of r.a[1] || []) {
      if (!it || it.r === undefined) continue; const e = db.get(it.r); if (!e) continue;
      if (SOLID_TYPES.has(e.t)) {
        reached.add(it.r);
        bodies.push({ brep: it.r, m, rep: rid, len: lenScaleOf(rid), ang: angScaleOf(rid), name: info.name, path: info.path, pd: info.pd, brepName: (e.a[0] || '').trim() });
      } else if (e.t === 'MAPPED_ITEM') {
        const map = db.ref(e.a[1]); if (!map) continue; const mrep = map.a[1].r;
        const T = M.mul(placementMatrix(e.a[2], rid), M.inv(placementMatrix(map.a[0], mrep)));
        collect(mrep, M.mul(m, T), info, new Set());
      }
    }
    for (const o of repLinks.get(rid) || []) collect(o, m, info, seen);
  };
  const visit = (pd, m, path, depth) => {
    if (depth > 30) return;
    const name = pdName(pd);
    for (const rid of sdrByPD.get(pd) || []) collect(rid, m, { name, path, pd }, new Set());
    for (const ch of children.get(pd) || []) {
      const T = nauoTransform(ch, ch.child);
      visit(ch.child, M.mul(m, T), path + ' / ' + (pdName(ch.child) || ch.name), depth + 1);
    }
  };
  const allPD = new Set([...sdrByPD.keys(), ...relatingSet]);
  const roots = [...allPD].filter(pd => !relatedSet.has(pd)).sort((a, b) => a - b);
  for (const r of roots) visit(r, M.id(), pdName(r), 0);
  // Solides hors arbre produit
  for (const t of SOLID_TYPES) for (const id of db.ids(t)) if (!reached.has(id)) {
    const rid = repIds.find(r => (db.get(r).a[1] || []).some(x => x && x.r === id));
    if (rid === undefined && reached.size) continue;
    const e = db.get(id);
    bodies.push({ brep: id, m: M.id(), rep: rid, len: rid !== undefined ? lenScaleOf(rid) : { mm: 1, found: false }, ang: rid !== undefined ? angScaleOf(rid) : 1, name: (e.a[0] || '').trim(), path: '(hors arbre produit)', pd: null, brepName: (e.a[0] || '').trim() });
    alerts.push({ lvl: 'info', msg: `Solide #${id} hors arbre produit : position identité.` });
  }
  return { bodies, alerts, unitSeen: [...unitSeen.entries()], angSeen: [...angSeen.keys()] };
}

/* ---------- 5. Faces analytiques ---------- */
function makeFaceExtractor(db) {
  const ptCache = new Map(), edgeCache = new Map(), faceCache = new Map();
  const P = (ref) => { const id = ref.r; let p = ptCache.get(id); if (!p) { const e = db.get(id); const c = e && e.a ? e.a[1] : [0, 0, 0]; p = [c[0] || 0, c[1] || 0, c[2] || 0]; ptCache.set(id, p); } return p; };
  const vtx = (ref) => { const v = db.ref(ref); if (!v) return null; if (v.t === 'VERTEX_POINT') return P(v.a[1]); return null; };
  const baseCurve = (ref, d = 0) => { const c = db.ref(ref); if (!c || d > 5) return c; if (c.t === 'SURFACE_CURVE' || c.t === 'SEAM_CURVE' || c.t === 'INTERSECTION_CURVE' || c.t === 'BOUNDED_SURFACE_CURVE') return baseCurve(c.a[1], d + 1); if (c.t === 'TRIMMED_CURVE') return baseCurve(c.a[1], d + 1); return c; };
  // Points caractéristiques d'une arête : sommets + milieu d'arc + points de contrôle B-spline
  const edgePts = (ref) => {
    const id = ref.r; if (edgeCache.has(id)) return edgeCache.get(id);
    const e = db.get(id); const out = []; let kind = 'other';
    if (e && e.t === 'EDGE_CURVE') {
      const a = vtx(e.a[1]), b = vtx(e.a[2]); if (a) out.push(a); if (b) out.push(b);
      const c = baseCurve(e.a[3]);
      if (c && c.t === 'CIRCLE') {
        kind = 'circle';
        const f = frameOf(db, c.a[1], 1); const r = c.a[2];
        const angOf = (p) => { const w = V.sub(p, f.o); return Math.atan2(V.dot(w, f.y), V.dot(w, f.x)); };
        let a0, a1;
        if (a && b) { if (e.a[4] && e.a[4].en === 'F') { a0 = angOf(b); a1 = angOf(a); } else { a0 = angOf(a); a1 = angOf(b); } } else { a0 = 0; a1 = 0; }
        let sw = a1 - a0; while (sw <= 1e-9) sw += 2 * Math.PI; if (sw > 2 * Math.PI + 1e-9) sw -= 2 * Math.PI;
        const k = sw > Math.PI ? 4 : 2;
        for (let i = 1; i < k; i++) { const t = a0 + sw * i / k; out.push(V.add(f.o, V.add(V.mul(f.x, r * Math.cos(t)), V.mul(f.y, r * Math.sin(t))))); }
      } else if (c && (c.t === 'B_SPLINE_CURVE_WITH_KNOTS' || c.t === 'B_SPLINE_CURVE')) {
        kind = 'bspline'; for (const pr of c.a[2] || []) out.push(P(pr));
      } else if (c && c.complex) {
        const bs = db.part(c, 'B_SPLINE_CURVE'); if (bs) { kind = 'bspline'; for (const pr of bs[1] || []) out.push(P(pr)); }
      } else if (c && c.t === 'LINE') kind = 'line';
      else if (c && c.t === 'ELLIPSE') kind = 'ellipse';
    }
    const res = { pts: out, kind }; edgeCache.set(id, res); return res;
  };
  const surfInfo = (sref) => {
    const s = db.ref(sref); if (!s) return { st: 'AUTRE', tn: '?' };
    const tn = s.complex ? 'COMPLEXE(' + s.parts.map(x => x.t).join(',') + ')' : s.t;
    switch (s.t) {
      case 'CYLINDRICAL_SURFACE': return { st: 'CYL', tn, pos: s.a[1], r: s.a[2] };
      case 'TOROIDAL_SURFACE': case 'DEGENERATE_TOROIDAL_SURFACE': return { st: 'TOR', tn, pos: s.a[1], R: s.a[2], r: s.a[3] };
      case 'CONICAL_SURFACE': return { st: 'CON', tn, pos: s.a[1], r: s.a[2], semi: s.a[3] };
      case 'PLANE': return { st: 'PLN', tn, pos: s.a[1] };
      case 'SPHERICAL_SURFACE': return { st: 'SPH', tn, pos: s.a[1], r: s.a[2] };
    }
    if (tn.indexOf('B_SPLINE') >= 0 || tn.indexOf('BEZIER') >= 0) return { st: 'BSP', tn };
    if (tn.indexOf('SURFACE_OF_REVOLUTION') >= 0 || tn.indexOf('SURFACE_OF_LINEAR_EXTRUSION') >= 0 || tn.indexOf('OFFSET_SURFACE') >= 0) return { st: 'SWEPT', tn };
    return { st: 'AUTRE', tn };
  };
  // Faces brutes (repère du fichier) d'un solide, mises en cache
  const brepFaces = (brepId) => {
    if (faceCache.has(brepId)) return faceCache.get(brepId);
    const e = db.get(brepId); const shells = []; let solid = false, faceted = false;
    if (e.t === 'MANIFOLD_SOLID_BREP') { shells.push([e.a[1], false]); solid = true; }
    else if (e.t === 'BREP_WITH_VOIDS') { shells.push([e.a[1], false]); for (const v of e.a[2] || []) shells.push([v, false]); solid = true; }
    else if (e.t === 'SHELL_BASED_SURFACE_MODEL') for (const s of e.a[1] || []) shells.push([s, false]);
    else if (e.t === 'FACETED_BREP') { shells.push([e.a[1], false]); solid = true; faceted = true; }
    const faces = [];
    const doShell = (ref, flip) => {
      const s = db.ref(ref); if (!s) return;
      if (s.t === 'ORIENTED_CLOSED_SHELL' || s.t === 'ORIENTED_OPEN_SHELL') return doShell(s.a[2], flip !== (s.a[3] && s.a[3].en === 'F'));
      for (const fr of s.a[1] || []) doFace(fr, flip);
    };
    const doFace = (ref, flip) => {
      const f = db.ref(ref); if (!f) return;
      if (f.t === 'ORIENTED_FACE') return doFace(f.a[2], flip !== (f.a[3] && f.a[3].en === 'F'));
      if (f.t !== 'ADVANCED_FACE' && f.t !== 'FACE_SURFACE') return;
      const si = surfInfo(f.a[2]);
      const sense = (f.a[3] && f.a[3].en === 'F') ? !true : true;
      const pts = []; let nb = 0;
      for (const br of f.a[1] || []) {
        const b = db.ref(br); if (!b) continue; const loop = db.ref(b.a[1]); if (!loop) continue;
        if (loop.t === 'EDGE_LOOP') for (const oer of loop.a[1] || []) { const oe = db.ref(oer); if (!oe) continue; const ec = oe.t === 'ORIENTED_EDGE' ? oe.a[3] : oer; const ep = edgePts(ec); for (const p of ep.pts) pts.push(p); if (ep.kind === 'bspline') nb++; }
        else if (loop.t === 'VERTEX_LOOP') { const p = vtx(loop.a[1]); if (p) pts.push(p); }
        else if (loop.t === 'POLY_LOOP') for (const pr of loop.a[1] || []) pts.push(P(pr));
      }
      faces.push({ fid: ref.r, sid: f.a[2] && f.a[2].r, st: si.st, tn: si.tn, sense: flip ? !sense : sense, si, pts, nbspl: nb });
    };
    for (const [s, fl] of shells) doShell(s, fl);
    const res = { faces, solid, faceted }; faceCache.set(brepId, res); return res;
  };
  // Faces d'une instance (mm, repère global)
  const instanceFaces = (body) => {
    const raw = brepFaces(body.brep); const s = body.len.mm; const m = body.m; const out = [];
    for (const f of raw.faces) {
      const g = { fid: f.fid, sid: f.sid, st: f.st, tn: f.tn, sense: f.sense, nbspl: f.nbspl };
      g.pts = f.pts.map(p => M.ap(m, V.mul(p, s)));
      if (f.si.pos) { const fr = frameOf(db, f.si.pos, s); g.o = M.ap(m, fr.o); g.z = V.norm(M.apd(m, fr.z)); g.x = V.norm(M.apd(m, fr.x)); g.y = V.cross(g.z, g.x); }
      if (f.si.r != null) g.r = f.si.r * s;
      if (f.si.R != null) g.R = f.si.R * s;
      if (f.si.semi != null) g.semi = f.si.semi * body.ang;
      out.push(g);
    }
    return { faces: out, solid: raw.solid, faceted: raw.faceted };
  };
  return { instanceFaces };
}

/* ---------- 6. Reconnaissance des primitives ---------- */
function azCoverage(angles) {
  if (angles.length < 2) return { cov: 0, start: 0 };
  const T = 2 * Math.PI; const a = angles.map(x => ((x % T) + T) % T).sort((p, q) => p - q);
  let gap = a[0] + T - a[a.length - 1], start = a[0];
  for (let i = 1; i < a.length; i++) { const g = a[i] - a[i - 1]; if (g > gap) { gap = g; start = a[i]; } }
  return { cov: T - gap, start };
}
function clusterValues(items, key, tolFn) {
  const s = items.slice().sort((p, q) => key(p) - key(q)); const out = [];
  for (const it of s) { const k = key(it); const last = out[out.length - 1]; if (last && Math.abs(k - last.v) <= tolFn(last.v)) { last.items.push(it); } else out.push({ v: k, items: [it] }); }
  for (const c of out) c.v = c.items.reduce((x, i) => x + key(i), 0) / c.items.length;
  return out;
}
// Regroupement de faces par axe (droite) commun
function groupByAxis(faces, tol) {
  const lines = [];
  for (const f of faces) {
    let d = f.z.slice(); const ax = [Math.abs(d[0]), Math.abs(d[1]), Math.abs(d[2])]; const mi = ax.indexOf(Math.max(...ax)); if (d[mi] < 0) d = V.mul(d, -1);
    let L = lines.find(l => V.len(V.cross(l.d, d)) < 1e-4 && V.len(V.cross(V.sub(f.o, l.o), l.d)) < tol);
    if (!L) { L = { o: f.o, d, faces: [] }; L.x = V.perp(d); L.y = V.cross(d, L.x); lines.push(L); }
    L.faces.push(f);
  }
  for (const L of lines) for (const f of L.faces) {
    let t0 = Infinity, t1 = -Infinity; const az = [];
    for (const p of f.pts) { const w = V.sub(p, L.o); const t = V.dot(w, L.d); if (t < t0) t0 = t; if (t > t1) t1 = t; const r = V.sub(w, V.mul(L.d, t)); if (V.len(r) > 1e-9) az.push(Math.atan2(V.dot(r, L.y), V.dot(r, L.x))); }
    f.t0 = t0; f.t1 = t1; f.az = az;
  }
  return lines;
}
function mergeIntervals(faces, tol) {
  const s = faces.filter(f => isFinite(f.t0)).sort((a, b) => a.t0 - b.t0); const out = [];
  for (const f of s) { const l = out[out.length - 1]; if (l && f.t0 <= l.t1 + tol) { l.t1 = Math.max(l.t1, f.t1); l.faces.push(f); } else out.push({ t0: f.t0, t1: f.t1, faces: [f] }); }
  for (const iv of out) iv.cov = azCoverage([].concat(...iv.faces.map(f => f.az))).cov;
  return out;
}
const MIN_COV = 200 / DEG;
const src = (f) => '#' + f.sid + ' (' + f.tn + ')';

function recognizeBody(body, S, alerts) {
  const prims = []; const tol = S.tol; const notes = [];
  const fs = body.faces;
  const cyl = fs.filter(f => f.st === 'CYL' && f.r > 0), tor = fs.filter(f => f.st === 'TOR' && f.R > 0), con = fs.filter(f => f.st === 'CON');
  const hasBore = body.solid && [...cyl, ...tor, ...con].some(f => !f.sense);
  const mode = !body.solid ? 'pair' : (hasBore ? 'bore' : 'single');
  body.mode = mode;
  const singleAs = S.singleAs || 'OD';
  const rtol = (r) => Math.max(1e-4, r * 1e-4);
  // ---- Cylindres → tronçons droits
  const lines = groupByAxis(cyl, tol); const segs = [];
  for (const L of lines) {
    const cls = clusterValues(L.faces, f => f.r, rtol);
    let bores = [], outers = [];
    if (mode === 'bore') { for (const c of cls) { const b = c.items.filter(f => !f.sense), o = c.items.filter(f => f.sense); if (b.length) bores.push({ v: c.v, items: b }); if (o.length) outers.push({ v: c.v, items: o }); } }
    else if (mode === 'pair') { if (cls.length >= 2) { bores = [cls[0]]; outers = cls.slice(1); } else outers = cls; }
    else outers = cls;
    const passage = bores.length ? bores : (mode !== 'bore' && outers.length ? [outers[0]] : []);
    const isSingle = !bores.length;
    for (const c of passage) {
      for (const iv of mergeIntervals(c.items, tol)) {
        if (iv.cov < MIN_COV) { notes.push(`cylindre partiel R=${c.v.toFixed(2)} mm ignoré (couverture ${(iv.cov * DEG).toFixed(0)}° : congé ou méplat probable)`); continue; }
        if (iv.t1 - iv.t0 < tol) continue;
        const sg = { type: 'PIPE', line: L, t0: iv.t0, t1: iv.t1, r: c.v, src: src(iv.faces[0]), faces: iv.faces };
        if (isSingle) { sg.single = true; sg.singleR = c.v; sg.singleSrc = sg.src; }
        else {
          let best = null, bestOv = 0;
          for (const o of outers) { if (o.v <= c.v + 1e-6) continue; for (const oi of mergeIntervals(o.items, tol)) { const ov = Math.min(oi.t1, iv.t1) - Math.max(oi.t0, iv.t0); if (ov > bestOv + 1e-6 || (Math.abs(ov - bestOv) <= 1e-6 && best && o.v < best.v)) { bestOv = ov; best = { v: o.v, f: oi.faces[0] }; } } }
          if (best && bestOv > 0) { sg.ro = best.v; sg.roSrc = src(best.f); if (bestOv < 0.5 * (iv.t1 - iv.t0)) notes.push(`paroi extérieure partielle sur le tronçon Ø${(2 * c.v).toFixed(2)}`); }
        }
        segs.push(sg);
      }
    }
  }
  // Filtre « perçage » : alésage parallèle, extérieur à un alésage plus grand du même corps
  for (const s of segs) {
    if (s.single) continue;
    const big = segs.find(q => q !== s && !q.single && q.r > s.r && V.len(V.cross(q.line.d, s.line.d)) < 1e-4 && V.len(V.cross(V.sub(s.line.o, q.line.o), q.line.d)) > q.r);
    if (big) { s.drop = 'perçage'; }
  }
  const drilled = segs.filter(s => s.drop).length;
  if (drilled) notes.push(`${drilled} perçage(s) parallèle(s) écarté(s) (trous de bride probables)`);
  for (const s of segs.filter(s => !s.drop)) {
    const a = V.add(s.line.o, V.mul(s.line.d, s.t0)), b = V.add(s.line.o, V.mul(s.line.d, s.t1));
    const p = { type: 'PIPE', a, b, dir: s.line.d, L: s.t1 - s.t0, src: s.src, faceIds: s.faces.map(f => f.fid) };
    setDiam(p, s, singleAs);
    prims.push(p);
  }
  // ---- Tores → coudes cintrés
  const tg = [];
  for (const f of tor) {
    let g = tg.find(g => V.dist(g.o, f.o) < tol && V.len(V.cross(g.z, f.z)) < 1e-4 && Math.abs(g.R - f.R) < tol);
    if (!g) { g = { o: f.o, z: f.z, x: f.x, y: f.y, R: f.R, faces: [] }; tg.push(g); }
    g.faces.push(f);
  }
  for (const g of tg) {
    const phi = [], psi = [];
    for (const f of g.faces) for (const p of f.pts) {
      const w = V.sub(p, g.o); const ph = Math.atan2(V.dot(w, g.y), V.dot(w, g.x)); phi.push(ph);
      const rad = V.add(V.mul(g.x, Math.cos(ph)), V.mul(g.y, Math.sin(ph))); const q = V.sub(w, V.mul(rad, g.R));
      psi.push(Math.atan2(V.dot(q, g.z), V.dot(q, rad)));
    }
    const cv = azCoverage(phi), cm = azCoverage(psi);
    if (cv.cov > 2 * Math.PI - 0.02) { notes.push(`tore complet R=${g.R.toFixed(2)} ignoré (congé de révolution probable)`); continue; }
    if (cm.cov < MIN_COV) { notes.push(`tore partiel R=${g.R.toFixed(2)} ignoré (congé probable)`); continue; }
    const cls = clusterValues(g.faces, f => f.r, rtol);
    let bores = [], outers = [];
    if (mode === 'bore') { for (const c of cls) { const b = c.items.filter(f => !f.sense), o = c.items.filter(f => f.sense); if (b.length) bores.push({ v: c.v, items: b }); if (o.length) outers.push({ v: c.v, items: o }); } }
    else if (mode === 'pair' && cls.length >= 2) { bores = [cls[0]]; outers = cls.slice(1); } else outers = cls;
    const a0 = cv.start, a1 = cv.start + cv.cov;
    const P = (ph) => V.add(g.o, V.mul(V.add(V.mul(g.x, Math.cos(ph)), V.mul(g.y, Math.sin(ph))), g.R));
    const T = (ph) => V.add(V.mul(g.x, -Math.sin(ph)), V.mul(g.y, Math.cos(ph)));
    const p = { type: 'BEND', a: P(a0), b: P(a1), ta: T(a0), tb: T(a1), C: g.o, n: g.z, ex: g.x, ey: g.y, phi0: a0, R: g.R, theta: cv.cov * DEG, src: src(g.faces[0]), faceIds: g.faces.map(f => f.fid) };
    const s = { r: bores.length ? bores[0].v : null, src: bores.length ? src(bores[0].items[0]) : null };
    if (bores.length) { const o = outers.filter(o => o.v > s.r).sort((x, y) => x.v - y.v)[0]; if (o) { s.ro = o.v; s.roSrc = src(o.items[0]); } }
    else if (outers.length) { s.single = true; s.singleR = outers[0].v; s.singleSrc = src(outers[0].items[0]); }
    setDiam(p, s, singleAs);
    p.L = g.R * cv.cov;
    if (p.theta > 181) notes.push(`coude de ${p.theta.toFixed(1)}° (> 180°) : vérifier`);
    prims.push(p);
  }
  // ---- Cônes → réductions / élargissements progressifs
  if (con.length) {
    const cl = groupByAxis(con, tol);
    for (const L of cl) {
      const ivs = mergeIntervals(L.faces, tol);
      for (const iv of ivs) {
        if (iv.cov < MIN_COV) { notes.push('cône partiel ignoré (chanfrein probable)'); continue; }
        if (iv.t1 - iv.t0 < tol) continue;
        const rAt = (f, t) => { const A = V.add(L.o, V.mul(L.d, t)); const tf = V.dot(V.sub(A, f.o), f.z); return f.r + tf * Math.tan(f.semi); };
        let fsel = iv.faces;
        let bset = mode === 'bore' ? fsel.filter(f => !f.sense) : [];
        let oset = mode === 'bore' ? fsel.filter(f => f.sense) : fsel;
        if (mode === 'pair') { const mid = (iv.t0 + iv.t1) / 2; const srt = fsel.slice().sort((x, y) => rAt(x, mid) - rAt(y, mid)); const r0 = rAt(srt[0], mid); bset = srt.filter(f => Math.abs(rAt(f, mid) - r0) < tol); oset = srt.filter(f => Math.abs(rAt(f, mid) - r0) >= tol); if (!oset.length) { oset = bset; bset = []; } }
        if (fsel.some(f => f.semi > Math.PI / 2)) { notes.push('demi-angle de cône > 90° : unité d\'angle douteuse'); }
        const ref = bset.length ? bset : oset; if (!ref.length) continue;
        const f0 = ref[0];
        const t0 = Math.min(...ref.map(f => f.t0)), t1 = Math.max(...ref.map(f => f.t1));
        const p = { type: 'RED', a: V.add(L.o, V.mul(L.d, t0)), b: V.add(L.o, V.mul(L.d, t1)), dir: L.d, L: t1 - t0, src: src(f0), faceIds: iv.faces.map(f => f.fid) };
        const ra = Math.abs(rAt(f0, t0)), rb = Math.abs(rAt(f0, t1));
        p.angle = 2 * Math.abs(f0.semi) * DEG;
        if (bset.length) { p.Da = 2 * ra; p.Db = 2 * rb; p.diSrc = src(f0); const o = oset[0]; if (o) { p.Dea = 2 * Math.abs(rAt(o, t0)); p.Deb = 2 * Math.abs(rAt(o, t1)); p.deSrc = src(o); } }
        else { p.single = true; if (singleAs === 'ID') { p.Da = 2 * ra; p.Db = 2 * rb; p.diSrc = src(f0); } else { p.Dea = 2 * ra; p.Deb = 2 * rb; p.deSrc = src(f0); p.odOnly = true; } }
        prims.push(p);
      }
    }
  }
  return { prims, notes };
}
function setDiam(p, s, singleAs) {
  if (s.r != null && !s.single) { p.Di = 2 * s.r; p.diSrc = s.src; if (s.ro != null) { p.De = 2 * s.ro; p.deSrc = s.roSrc; } }
  else if (s.single) { if (singleAs === 'ID') { p.Di = 2 * s.singleR; p.diSrc = s.singleSrc; p.idOnly = true; } else { p.De = 2 * s.singleR; p.deSrc = s.singleSrc; p.odOnly = true; } }
}

/* ---------- 7. Réseau ---------- */
const EQ_TYPES = ['Pompe', 'Vanne', 'Clapet anti-retour', 'Filtre', 'Échangeur', 'Réservoir', 'Débitmètre', 'Orifice / diaphragme', 'Équipement (autre)'];
function normName(s) { return (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase(); }
function classifyName(name, S) {
  const n = normName(name);
  for (const [type, kws] of S.keywords) for (const k of kws) { const K = normName(k).trim(); if (K.length < 2) continue; const re = new RegExp('(^|[^A-Z])' + K.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')); if (re.test(n)) return { type, kw: k }; }
  return null;
}

function analyze(db, S, progress) {
  const t0 = Date.now();
  const res = extractBodies(db, S); const alerts = res.alerts.slice();
  const fx = makeFaceExtractor(db);
  const bodies = [];
  const tessCount = TESS_TYPES.reduce((s, t) => s + db.ids(t).length, 0);
  if (tessCount) alerts.push({ lvl: 'err', msg: `${tessCount} entité(s) de géométrie tessellée (maillage) détectée(s) : aucune cote ne peut en être extraite, seules les surfaces analytiques sont utilisées.` });
  if (!res.bodies.length) alerts.push({ lvl: 'err', msg: 'Aucun solide ni modèle surfacique B-rep trouvé dans le fichier.' });
  const curveSets = db.ids('GEOMETRIC_CURVE_SET').length;
  if (curveSets && !res.bodies.length) alerts.push({ lvl: 'err', msg: `Le fichier ne contient que des courbes (${curveSets} GEOMETRIC_CURVE_SET : lignes d'axe filaires ?). Ce cas n'est pas traité.` });
  // Corps instanciés
  res.bodies.forEach((b, i) => {
    const inst = fx.instanceFaces(b);
    const counts = {}; for (const f of inst.faces) counts[f.st] = (counts[f.st] || 0) + 1;
    let bb = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
    for (const f of inst.faces) for (const p of f.pts) for (let k = 0; k < 3; k++) { if (p[k] < bb[k]) bb[k] = p[k]; if (p[k] > bb[k + 3]) bb[k + 3] = p[k]; }
    const name = b.name || b.brepName || '';
    bodies.push({ idx: i, key: b.brep + '@' + b.path, name, path: b.path, brep: b.brep, faces: inst.faces, solid: inst.solid, faceted: inst.faceted, counts, bbox: bb, unitFound: b.len.found });
    if (progress && i % 20 === 0) progress(i / res.bodies.length);
  });
  // Classement des corps
  for (const b of bodies) {
    const ov = S.bodyOverrides && S.bodyOverrides[b.key];
    const auto = classifyName(b.name, S);
    b.autoClass = auto ? auto.type : 'Tuyauterie'; b.kw = auto ? auto.kw : '';
    b.cls = ov && ov !== 'Auto' ? ov : b.autoClass;
    b.unnamed = !b.name || /^(SOLID|BODY|CORPS|PART|PIECE|PIÈCE|COMPONENT|OPEN CASCADE STEP TRANSLATOR.*|NONE|UNNAMED)\s*[-_]?\d*$/i.test(b.name);
  }
  // Reconnaissance
  let prims = [];
  for (const b of bodies) {
    b.nPrims = 0; b.notes = [];
    const nb = b.faces.length; const nbs = (b.counts.BSP || 0) + (b.counts.SWEPT || 0);
    if (b.faceted) alerts.push({ lvl: 'err', msg: `Corps « ${b.name || '#' + b.brep} » : B-rep à facettes (géométrie maillée), pas de cotes analytiques.` });
    if (b.cls === 'Ignorer') continue;
    if (b.cls !== 'Tuyauterie') continue;
    const r = recognizeBody(b, S, alerts);
    for (const p of r.prims) { p.body = b.idx; prims.push(p); }
    b.nPrims = r.prims.length; b.notes = r.notes;
    if (nbs > 0 && nbs >= 0.3 * nb) alerts.push({ lvl: 'warn', msg: `Corps « ${b.name || '#' + b.brep} » : ${nbs} face(s) B-spline/balayée(s) sur ${nb} — tuyauterie flexible ou cintrage libre probable, non reconnue analytiquement.` });
    if (!b.solid) alerts.push({ lvl: 'info', msg: `Corps « ${b.name || '#' + b.brep} » : modèle surfacique (pas un solide), intérieur/extérieur déduits des rayons.` });
    if (b.mode === 'single' && r.prims.length) alerts.push({ lvl: 'warn', msg: `Corps « ${b.name || '#' + b.brep} » : un seul cylindre par tronçon (pas d'alésage) — interprété comme ${S.singleAs === 'ID' ? 'diamètre intérieur (volume fluide)' : 'diamètre extérieur ; épaisseur proposée selon la norme choisie (statut « par défaut »)'}.` });
  }
  // Filtre « enveloppe » (collier/support) : alésage = De d'un tube coaxial d'un autre corps
  for (const p of prims) {
    if (p.type !== 'PIPE' || p.Di == null) continue;
    const host = prims.find(q => q !== p && q.type === 'PIPE' && q.body !== p.body && q.De != null && Math.abs(q.De - p.Di) < Math.max(S.tol, 0.01 * q.De) && V.len(V.cross(q.dir, p.dir)) < 1e-3 && V.len(V.cross(V.sub(p.a, q.a), q.dir)) < S.tol * 5);
    if (host) { p.drop = true; alerts.push({ lvl: 'info', msg: `Corps « ${bodies[p.body].name} » : cylindre Ø${p.Di.toFixed(2)} enveloppant un tube (collier/support/manchon probable) écarté.` }); }
  }
  prims = prims.filter(p => !p.drop);
  // Extrémités
  const ends = (p) => {
    if (p.type === 'BEND') return [{ p: p.a, out: V.mul(p.ta, -1) }, { p: p.b, out: p.tb }];
    return [{ p: p.a, out: V.mul(p.dir, -1) }, { p: p.b, out: p.dir }];
  };
  for (const p of prims) p.ends = ends(p);
  const tol = S.tol;
  const near = (a, b) => V.dist(a, b) <= tol;
  // Extrémités déjà raccordées (pour ne pas les prendre pour un piquage)
  const allEnds = []; prims.forEach((p, i) => p.ends.forEach((e, k) => allEnds.push({ i, k, p: e.p })));
  const attached = (i, k) => allEnds.some(e => e.i !== i && near(e.p, prims[i].ends[k].p));
  // ---- Jonctions (tés, onglets, croix) entre tronçons droits
  const pipes = prims.map((p, i) => ({ p, i })).filter(x => x.p.type === 'PIPE');
  const Ro = (p) => (p.De || (p.Di || 0) * 1.15) / 2;
  const cand = [];
  for (let u = 0; u < pipes.length; u++) for (let w = u + 1; w < pipes.length; w++) {
    const A = pipes[u].p, B = pipes[w].p;
    if (V.len(V.cross(A.dir, B.dir)) < Math.sin(1 / DEG)) continue;
    const ra = Ro(A), rb = Ro(B);
    // Test rapide de boîtes
    let skip = false; for (let k = 0; k < 3; k++) { const amin = Math.min(A.a[k], A.b[k]) - ra - rb, amax = Math.max(A.a[k], A.b[k]) + ra + rb; if (Math.max(B.a[k], B.b[k]) < amin || Math.min(B.a[k], B.b[k]) > amax) skip = true; } if (skip) continue;
    // Points les plus proches des deux axes
    const d1 = A.dir, d2 = B.dir, r = V.sub(A.a, B.a); const a = V.dot(d1, d1), b = V.dot(d1, d2), c = V.dot(d2, d2), d = V.dot(d1, r), e = V.dot(d2, r);
    const den = a * c - b * b; if (Math.abs(den) < 1e-12) continue;
    const s = (b * e - c * d) / den, t = (a * e - b * d) / den;
    const pa = V.add(A.a, V.mul(d1, s)), pb = V.add(B.a, V.mul(d2, t));
    if (V.dist(pa, pb) > Math.max(tol, 0.02 * Math.min(ra, rb))) continue;
    const C = V.mul(V.add(pa, pb), 0.5);
    const role = (P, idx, tt, m) => { if (tt > m && tt < P.L - m) return 'mid'; if (Math.abs(tt) <= m && !attached(idx, 0)) return 'end0'; if (Math.abs(tt - P.L) <= m && !attached(idx, 1)) return 'end1'; return null; };
    const rA = role(A, pipes[u].i, s, rb * 1.15 + tol), rB = role(B, pipes[w].i, t, ra * 1.15 + tol);
    if (!rA || !rB) continue;
    cand.push({ C, m: [[pipes[u].i, rA, s], [pipes[w].i, rB, t]], r: Math.min(ra, rb) });
  }
  const clusters = [];
  for (const c of cand) { let k = clusters.find(k => V.dist(k.C, c.C) < Math.max(tol, 0.1 * c.r)); if (!k) { k = { C: c.C, m: [] }; clusters.push(k); } for (const m of c.m) if (!k.m.some(x => x[0] === m[0])) k.m.push(m); }
  // Découpage des tronçons aux points de jonction
  const cuts = new Map();
  for (const k of clusters) for (const [i, role, t] of k.m) { if (!cuts.has(i)) cuts.set(i, []); cuts.get(i).push({ role, t, C: k.C }); }
  const newPrims = [];
  prims.forEach((p, i) => {
    if (!cuts.has(i)) { newPrims.push(p); return; }
    const cs = cuts.get(i); const pts = [];
    const e0 = cs.find(c => c.role === 'end0'), e1 = cs.find(c => c.role === 'end1');
    pts.push(e0 ? { t: e0.t, P: e0.C } : { t: 0, P: p.a });
    for (const c of cs.filter(c => c.role === 'mid').sort((x, y) => x.t - y.t)) pts.push({ t: c.t, P: c.C });
    pts.push(e1 ? { t: e1.t, P: e1.C } : { t: p.L, P: p.b });
    for (let j = 0; j + 1 < pts.length; j++) {
      const L = pts[j + 1].t - pts[j].t; if (L < tol) continue;
      const q = Object.assign({}, p, { a: pts[j].P, b: pts[j + 1].P, L: V.dist(pts[j].P, pts[j + 1].P), cutFrom: true });
      q.ends = ends(q); newPrims.push(q);
    }
  });
  prims = newPrims;
  // ---- Nœuds par coïncidence des extrémités (grille + union-find)
  const E = []; prims.forEach((p, i) => p.ends.forEach((e, k) => E.push({ prim: i, k, p: e.p, out: e.out })));
  const parent = E.map((_, i) => i); const find = (x) => { while (parent[x] !== x) x = parent[x] = parent[parent[x]]; return x; };
  const cell = Math.max(tol, 1e-6); const grid = new Map(); const key = (p) => p.map(v => Math.floor(v / cell)).join(',');
  E.forEach((e, i) => { const k = key(e.p); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(i); });
  E.forEach((e, i) => {
    const c = e.p.map(v => Math.floor(v / cell));
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) for (const j of grid.get([c[0] + dx, c[1] + dy, c[2] + dz].join(',')) || []) if (j > i && near(e.p, E[j].p)) parent[find(i)] = find(j);
  });
  const nodeMap = new Map(); const nodes = [];
  E.forEach((e, i) => { const r = find(i); if (!nodeMap.has(r)) { nodeMap.set(r, nodes.length); nodes.push({ pts: [], atts: [] }); } const n = nodes[nodeMap.get(r)]; n.pts.push(e.p); n.atts.push({ c: e.prim, k: e.k, out: e.out }); e.node = nodeMap.get(r); });
  for (const n of nodes) n.p = V.mul(n.pts.reduce((s, p) => V.add(s, p), [0, 0, 0]), 1 / n.pts.length);
  // Composants
  const comps = prims.map((p, i) => ({ kind: p.type, prim: p, nodes: [null, null] }));
  E.forEach(e => { comps[e.prim].nodes[e.k] = e.node; });
  // ---- Équipements : raccordement aux extrémités libres situées dans leur boîte englobante
  const eqBodies = bodies.filter(b => b.cls !== 'Tuyauterie' && b.cls !== 'Ignorer');
  const unknownBodies = bodies.filter(b => b.cls === 'Tuyauterie' && b.nPrims === 0 && b.faces.length);
  const inBox = (p, bb, m) => p[0] >= bb[0] - m && p[1] >= bb[1] - m && p[2] >= bb[2] - m && p[0] <= bb[3] + m && p[1] <= bb[4] + m && p[2] <= bb[5] + m;
  const freeNodes = () => nodes.map((n, i) => i).filter(i => nodes[i].atts.length === 1 && !nodes[i].eq);
  const portDiam = (b, n) => {
    const at = n.atts[0]; const dir = at.out; let best = null;
    for (const f of b.faces) {
      if (f.st !== 'CYL' || (b.solid && f.sense)) continue;
      if (V.len(V.cross(f.z, dir)) > Math.sin(2 / DEG)) continue;
      const off = V.len(V.cross(V.sub(n.p, f.o), f.z)); if (off > Math.max(tol, 0.05 * f.r)) continue;
      let dmin = Infinity; for (const p of f.pts) dmin = Math.min(dmin, Math.abs(V.dot(V.sub(p, n.p), f.z)));
      if (!best || dmin < best.d) best = { d: dmin, D: 2 * f.r, src: src(f) };
    }
    return best;
  };
  const attachEq = (b, typ, unknown) => {
    const m = Math.max(2 * tol, 0.5);
    const ports = freeNodes().filter(i => inBox(nodes[i].p, b.bbox, m));
    const comp = { kind: 'EQ', body: b.idx, eqType: typ, unknown, nodes: ports, ports: [] };
    for (const i of ports) {
      const n = nodes[i]; const pd = portDiam(b, n); const pc = comps[n.atts[0].c].prim;
      comp.ports.push({ node: i, D: pd ? pd.D : (pc.Di != null ? pc.Di : null), src: pd ? pd.src : null, pipeD: pc.Di });
      n.eq = true; n.atts.push({ c: comps.length, k: comp.ports.length - 1, out: V.mul(n.atts[0].out, -1), eq: true });
    }
    comps.push(comp); return comp;
  };
  for (const b of eqBodies) { const c = attachEq(b, b.cls, false); if (!c.nodes.length) alerts.push({ lvl: 'warn', msg: `Équipement « ${b.name} » (${b.cls}) : aucun tube raccordé détecté (aucune extrémité libre dans sa boîte englobante). Augmentez la tolérance ou vérifiez la maquette.` }); }
  for (const b of unknownBodies) {
    const m = Math.max(2 * tol, 0.5); const has = freeNodes().some(i => inBox(nodes[i].p, b.bbox, m));
    if (has) { attachEq(b, 'Équipement (autre)', true); alerts.push({ lvl: 'warn', msg: `Corps non reconnu « ${b.name || '#' + b.brep} » raccordé au réseau : inséré comme boîte noire de type « à identifier ».` }); }
    else if (!b.unnamedBolt) alerts.push({ lvl: 'info', msg: `Corps « ${b.name || '#' + b.brep} » : aucune primitive de tuyauterie reconnue (${b.faces.length} faces), ignoré.` });
  }
  // ---- Composants de longueur nulle aux nœuds : tés, croix, onglets, variations brusques
  const Dat = (att) => { const c = comps[att.c]; if (c.kind === 'EQ') return c.ports[att.k] ? c.ports[att.k].D : null; const p = c.prim; if (p.type === 'RED') return att.k === 0 ? (p.Da != null ? p.Da : p.Dea) : (p.Db != null ? p.Db : p.Deb); return p.Di != null ? p.Di : p.De; };
  const splitNode = (ni, comp) => {
    const n = nodes[ni]; const ids = [];
    n.atts.forEach((att, j) => {
      const nid = j === 0 ? ni : nodes.length; if (j > 0) nodes.push({ p: n.p.slice(), atts: [att], split: true });
      const c = comps[att.c]; c.nodes[att.k] = nid; if (c.kind === 'EQ' && c.ports[att.k]) c.ports[att.k].node = nid; ids.push(nid);
    });
    n.atts = [n.atts[0]];
    const ci = comps.length; comp.nodes = ids; comps.push(comp);
    ids.forEach((nid, j) => nodes[nid].atts.push({ c: ci, k: j, zero: true }));
  };
  const N0 = nodes.length;
  for (let ni = 0; ni < N0; ni++) {
    const n = nodes[ni]; const at = n.atts.slice(); const deg = at.length;
    if (deg >= 3) {
      const arms = at.map(a => ({ D: Dat(a), out: a.out, c: a.c }));
      let best = null; for (let i = 0; i < 3 && i < arms.length; i++) for (let j = i + 1; j < arms.length; j++) { const an = V.angle(arms[i].out, arms[j].out); if (!best || an > best.an) best = { i, j, an }; }
      const comp = { kind: deg === 3 ? 'TEE' : 'JCT', arms, main: [best.i, best.j], p: n.p };
      if (deg === 3) { const k = [0, 1, 2].find(x => x !== best.i && x !== best.j); comp.branch = k; const mainDir = V.sub(arms[best.j].out, arms[best.i].out); let ang = V.angle(arms[k].out, mainDir) * DEG; if (ang > 90) ang = 180 - ang; comp.angle = ang; comp.colin = best.an * DEG; }
      else alerts.push({ lvl: 'warn', msg: `Jonction à ${deg} branches détectée : à modéliser manuellement (croix ou collecteur).` });
      splitNode(ni, comp);
    } else if (deg === 2) {
      const [a, b] = at; const ca = comps[a.c], cb = comps[b.c];
      if (ca.kind === 'EQ' || cb.kind === 'EQ') continue;
      const defl = V.angle(a.out, V.mul(b.out, -1)) * DEG;
      const Da = Dat(a), Db = Dat(b);
      if (defl > 1 && ca.kind === 'PIPE' && cb.kind === 'PIPE') {
        splitNode(ni, { kind: 'MITRE', angle: defl, D: Math.min(Da || Infinity, Db || Infinity), p: n.p, Da, Db });
        if (Da && Db && Math.abs(Da - Db) / Math.max(Da, Db) > 0.01) alerts.push({ lvl: 'warn', msg: 'Coude à onglet avec changement de diamètre : vérifier.' });
      } else if (Da && Db && Math.abs(Da - Db) / Math.max(Da, Db) > 0.01) {
        splitNode(ni, { kind: 'SUDDEN', Da, Db, p: n.p });
      } else if (defl > 1) alerts.push({ lvl: 'warn', msg: `Discontinuité de tangence de ${defl.toFixed(1)}° entre deux éléments (nœud à ${n.p.map(v => v.toFixed(1)).join(', ')} mm).` });
    }
  }
  // ---- Numérotation stable (parcours en profondeur depuis l'extrémité libre la plus basse/ordonnée)
  const vax = S.vertical || 'Z+'; const vi = 'XYZ'.indexOf(vax[0]); const vs = vax[1] === '-' ? -1 : 1;
  const nodeComps = nodes.map(() => []); comps.forEach((c, ci) => c.nodes.forEach((ni, k) => { if (ni != null) nodeComps[ni].push({ ci, k }); }));
  const coordKey = (p) => p.map(v => Math.round(v * 100) / 100);
  const lex = (a, b) => { const A = coordKey(a), B = coordKey(b); for (let k = 0; k < 3; k++) if (A[k] !== B[k]) return A[k] - B[k]; return 0; };
  const order = nodes.map((n, i) => i).sort((a, b) => { const fa = nodeComps[a].length === 1 ? 0 : 1, fb = nodeComps[b].length === 1 ? 0 : 1; if (fa !== fb) return fa - fb; return lex(nodes[a].p, nodes[b].p); });
  const nodeId = new Array(nodes.length).fill(null); const compSeen = new Array(comps.length).fill(false); const compOrder = [];
  let nCount = 0; let sub = 0;
  for (const start of order) {
    if (nodeId[start] != null) continue; sub++;
    const st = [start];
    while (st.length) {
      const ni = st.pop(); if (nodeId[ni] == null) { nodeId[ni] = ++nCount; nodes[ni].sub = sub; }
      const nxt = [];
      const cs = nodeComps[ni].slice().sort((x, y) => { const cx = comps[x.ci], cy = comps[y.ci]; const px = cx.nodes.map(i => nodes[i] ? nodes[i].p : [0, 0, 0]), py = cy.nodes.map(i => nodes[i] ? nodes[i].p : [0, 0, 0]); return lex(px.reduce((s, p) => V.add(s, p), [0, 0, 0]), py.reduce((s, p) => V.add(s, p), [0, 0, 0])); });
      for (const { ci, k } of cs) {
        if (compSeen[ci]) continue; compSeen[ci] = true; compOrder.push(ci); comps[ci].fromNode = ni; comps[ci].sub = sub;
        // Orientation : le nœud d'arrivée devient « amont »
        const c = comps[ci];
        if ((c.kind === 'PIPE' || c.kind === 'BEND' || c.kind === 'RED') && k === 1) c.reversed = true;
        for (const nj of c.nodes) if (nj != null && nodeId[nj] == null) nxt.push(nj);
      }
      for (let j = nxt.length - 1; j >= 0; j--) st.push(nxt[j]);
    }
  }
  comps.forEach((c, ci) => { if (!compSeen[ci]) { compOrder.push(ci); c.sub = 0; } });
  const prefix = { PIPE: 'P', BEND: 'B', MITRE: 'B', RED: 'R', SUDDEN: 'R', TEE: 'T', JCT: 'J', EQ: 'EQ' };
  const counters = {}; const pad = (n) => String(n).padStart(3, '0');
  for (const ci of compOrder) { const c = comps[ci]; const pf = prefix[c.kind]; counters[pf] = (counters[pf] || 0) + 1; c.id = pf + pad(counters[pf]); }
  // Topologie : boucles = E - V + C (hubs pour composants ≠ 2 nœuds)
  let Vn = nodes.length, En = 0; for (const c of comps) { const k = c.nodes.filter(x => x != null).length; if (k === 2) En++; else if (k > 0) { Vn++; En += k; } }
  const subs = sub; const loops = En - Vn + subs;
  // ---- Sérialisation du modèle
  const nid = (i) => i == null ? null : 'N' + pad(nodeId[i]);
  const outNodes = nodes.map((n, i) => ({ i, id: nid(i), p: n.p, deg: nodeComps[i].length, sub: n.sub, eq: !!n.eq, split: !!n.split })).sort((a, b) => nodeId[a.i] - nodeId[b.i]);
  const outComps = compOrder.map(ci => {
    const c = comps[ci]; const o = { id: c.id, kind: c.kind, sub: c.sub };
    let ns = c.nodes.slice(); if (c.reversed) ns = ns.slice().reverse();
    o.nodes = ns.map(nid);
    if (c.prim) {
      const p = c.prim; o.body = p.body; o.bodyName = bodies[p.body].name;
      for (const k of ['Di', 'De', 'diSrc', 'deSrc', 'odOnly', 'idOnly', 'L', 'src', 'R', 'theta', 'angle', 'faceIds']) if (p[k] !== undefined) o[k] = p[k];
      const pa = c.reversed ? p.b : p.a, pb = c.reversed ? p.a : p.b; o.a = pa; o.b = pb;
      if (p.cutFrom) o.cut = true;
      if (p.type === 'BEND') { o.C = p.C; o.n = p.n; o.ex = p.ex; o.ey = p.ey; o.phi0 = p.phi0; o.sub2 = 'cintré'; }
      if (p.type === 'RED') { o.D1 = c.reversed ? p.Db : p.Da; o.D2 = c.reversed ? p.Da : p.Db; o.De1 = c.reversed ? p.Deb : p.Dea; o.De2 = c.reversed ? p.Dea : p.Deb; o.diSrc = p.diSrc; o.deSrc = p.deSrc; o.single = !!p.single; o.odOnly = !!p.odOnly; o.sub2 = 'progressive'; }
    }
    if (c.kind === 'MITRE') { o.kind = 'BEND'; o.sub2 = 'onglet'; o.theta = c.angle; o.R = 0; o.Di = c.D; o.p = c.p; o.L = 0; }
    if (c.kind === 'SUDDEN') { o.kind = 'RED'; o.sub2 = 'brusque'; const fr = nodes[c.nodes[0]]; o.D1 = c.Da; o.D2 = c.Db; o.angle = 180; o.L = 0; o.p = c.p; }
    if (c.kind === 'TEE' || c.kind === 'JCT') {
      o.p = c.p; o.arms = c.arms.map((a, j) => ({ node: nid(c.nodes[j]), D: a.D, dir: a.out }));
      o.main = c.main; o.branch = c.branch; o.angle = c.angle;
    }
    if (c.kind === 'EQ') { const b = bodies[c.body]; o.body = c.body; o.bodyName = b.name; o.eqType = c.eqType; o.unknown = c.unknown; o.kw = b.kw; o.bbox = b.bbox; o.ports = c.ports.map(pt => ({ node: nid(pt.node), D: pt.D, src: pt.src, pipeD: pt.pipeD })); o.nodes = o.ports.map(pt => pt.node); }
    return o;
  });
  // Alertes topologiques
  const free = outNodes.filter(n => n.deg === 1);
  for (let i = 0; i < free.length; i++) for (let j = i + 1; j < free.length; j++) { const d = V.dist(free[i].p, free[j].p); if (d <= Math.max(5, 20 * tol) && d > tol) alerts.push({ lvl: 'warn', msg: `Extrémités libres proches non raccordées : ${free[i].id} ↔ ${free[j].id} (${d.toFixed(2)} mm). Augmenter la tolérance de raccordement ?` }); }
  if (subs > 1) alerts.push({ lvl: 'warn', msg: `${subs} sous-réseaux déconnectés détectés.` });
  const odOnly = outComps.filter(c => c.odOnly).length; if (odOnly) alerts.push({ lvl: 'warn', msg: `${odOnly} composant(s) modélisé(s) avec le seul diamètre extérieur : épaisseur et Di proposés « par défaut ».` });
  for (const b of bodies) if (b.unnamed && (b.nPrims || b.cls !== 'Tuyauterie')) alerts.push({ lvl: 'info', msg: `Pièce non nommée ou nom générique : « ${b.name || '(vide)'} » (#${b.brep}).` });
  for (const b of bodies) if (b.cls !== 'Tuyauterie' && b.cls !== 'Ignorer' && b.kw) alerts.push({ lvl: 'info', msg: `Corps « ${b.name} » classé ${b.cls} (mot-clé « ${b.kw} »).` });
  const unit = res.unitSeen; const unitFound = unit.some(([k]) => k !== 'non trouvée');
  if (!unitFound && (!S.unitOverride || S.unitOverride === 'auto')) alerts.push({ lvl: 'err', msg: "Unité de longueur introuvable dans le STEP : millimètre utilisé PAR DÉFAUT. Choisissez l'unité dans les réglages." });
  if (unit.length > 1) alerts.push({ lvl: 'warn', msg: 'Plusieurs unités de longueur dans le fichier : ' + unit.map(u => u[0]).join(', ') + ' (converties par contexte).' });
  return {
    header: db.header, nEntities: db.raw.size, unit: unit.map(u => u[0]).join(', ') || 'non trouvée', angUnit: res.angSeen.join(', '),
    bodies: bodies.map(b => ({ idx: b.idx, key: b.key, name: b.name, path: b.path, brep: b.brep, solid: b.solid, counts: b.counts, cls: b.cls, autoClass: b.autoClass, kw: b.kw, nPrims: b.nPrims, notes: b.notes, bbox: b.bbox, mode: b.mode, unnamed: b.unnamed, nFaces: b.faces.length })),
    nodes: outNodes.map(n => ({ id: n.id, p: n.p, deg: n.deg, sub: n.sub, eq: n.eq, split: n.split })), comps: outComps, alerts,
    topo: { nodes: outNodes.length, comps: outComps.length, free: free.length, loops, subs }, ms: Date.now() - t0
  };
}

if (typeof module !== 'undefined') module.exports = { parseStep, analyze, V };
