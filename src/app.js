/* =====================================================================
   APPLICATION : état, matérialisation des valeurs (origine), interface,
   vue 3D filaire, export Excel.
   ===================================================================== */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const num = (x) => { if (x === null || x === undefined || x === '') return null; const v = parseFloat(String(x).replace(',', '.')); return isFinite(v) ? v : null; };
const rnd = (v, n) => v == null ? null : Math.round(v * Math.pow(10, n)) / Math.pow(10, n);
const fmt = (v, n = 2) => v == null || v === '' ? '' : (typeof v === 'number' ? v.toLocaleString('fr-FR', { maximumFractionDigits: n, minimumFractionDigits: 0 }) : String(v));

const App = {
  model: null, fileName: '', worker: null, sel: null, filter: 'Tous', showLabels: true, showTodo: true,
  S: { tol: 0.1, vertical: 'Z+', unitOverride: 'auto', singleAs: 'OD', thkStd: 'ASME40', keywordsText: DEFAULT_KEYWORDS, bodyOverrides: {} },
  F: { an: { P: true, T: false, Th: false, C: false }, fluid: 'water', T: 20, P: 1.013, man: { rho: '', mu: '', cp: '', lam: '', K: '', pv: '', R: '', gamma: '' }, mat: 'Acier carbone commercial neuf', matSet: false, epsGlobal: '', Q: '', anchor: '', dt: '', dur: '', events: '', Tin: '', h: '', Tamb: '', insE: '', insL: '', heat: '' },
  ov: {}, bc: {}, eqType: {}
};

/* ---------- Besoins par paramètre (B bloquant, P précision) ---------- */
const ALL = { P: 'B', T: 'B', Th: 'B', C: 'B' };
const NEED = {
  Di: ALL, L: ALL, dz: { P: 'B', T: 'B', Th: 'P', C: 'B' }, eps: { P: 'B', T: 'B', Th: 'P', C: 'B' }, De: { T: 'B', Th: 'B' }, e: { T: 'B', Th: 'B' }, mat: { P: 'P', T: 'B', Th: 'B' },
  E: { T: 'B' }, nu: { T: 'B' }, anchor: { T: 'B' }, kw: { Th: 'B' }, insE: { Th: 'B' }, insL: { Th: 'B' }, h: { Th: 'B' }, Tamb: { Th: 'B' }, heat: { Th: 'P' },
  R: { P: 'B', T: 'P', Th: 'P', C: 'B' }, RD: { P: 'B', T: 'P', C: 'B' }, theta: { P: 'B', T: 'P', C: 'B' }, Ldev: { P: 'P', T: 'B', Th: 'B', C: 'P' },
  Darm: { P: 'B', T: 'B', Th: 'P', C: 'B' }, tang: { P: 'B', T: 'P', C: 'B' }, ratio: { P: 'B', C: 'B' }, rj: { P: 'P', C: 'P' }, cfg: { P: 'P', C: 'P' },
  D12: { P: 'B', T: 'B', Th: 'P', C: 'B' }, cone: { P: 'B', T: 'P', C: 'B' }, Lred: { P: 'P', T: 'P', C: 'P' },
  DN: { P: 'P', T: 'P', C: 'P' }, eqtype: ALL, zb: { P: 'P', T: 'P', C: 'P' },
  rho: ALL, mu: ALL, cp: { Th: 'B', C: 'B' }, lam: { Th: 'B' }, K: { T: 'B' }, pv: { P: 'P', T: 'B' }, gR: { C: 'B' }, gamma: { C: 'B' }, Tref: ALL, Pref: ALL,
  bc: ALL, bcv: ALL, Tin: { Th: 'B', C: 'B' }, dt: { T: 'B' }, dur: { T: 'B' }, events: { T: 'B' }, none: {}
};
function needLvl(need) { let l = null; for (const a in App.F.an) if (App.F.an[a] && need && need[a]) { if (need[a] === 'B') return 'B'; l = 'P'; } return l; }
const mk = (key, v, o, s) => ({ v, o, s: s || '', need: NEED[key] || {} });
const miss = (key, s) => { const need = NEED[key] || {}; const l = needLvl(need); return { v: null, o: l ? 'TODO' : 'NA', s: s || '', need, crit: l }; };
const ORIG_LABEL = { STEP: 'Extrait STEP', CALC: 'Calculé', DEF: 'Par défaut', USER: 'Saisi utilisateur', TODO: 'À COMPLÉTER', NA: 'Non requis (analyse non cochée)', INFO: 'Information' };
const origText = (x) => { if (!x) return ''; const b = ORIG_LABEL[x.o] || x.o; return x.s ? b + ' – ' + x.s : b; };

/* ---------- Matérialisation : chaque valeur avec son origine ---------- */
function altOf(p) { const v = App.S.vertical; const i = 'XYZ'.indexOf(v[0]); return (v[1] === '-' ? -1 : 1) * p[i] / 1000; }
function fluidProps() {
  const F = App.F; const fl = FLUIDS[F.fluid]; const out = {};
  const keys = [['rho', 'Masse volumique (kg/m³) (Density)', 1], ['mu', 'Viscosité dynamique (Pa·s) (Dynamic viscosity)', 1], ['cp', 'Capacité thermique massique (J/(kg·K)) (Specific heat)', 1], ['lam', 'Conductivité thermique (W/(m·K)) (Thermal conductivity)', 1], ['K', 'Module de compressibilité (GPa) (Bulk modulus)', 1], ['pv', 'Pression de vapeur saturante (kPa) (Vapour pressure)', 1]];
  if (fl.gas || App.F.an.C) keys.push(['gR', 'Constante du gaz (J/(kg·K)) (Gas constant)', 1], ['gamma', 'Rapport des capacités γ (–) (Ratio of specific heats)', 1]);
  let lib = null; if (F.fluid !== 'manual') lib = fl.f(+F.T, +F.P);
  for (const [k, label] of keys) {
    const mv = num(F.man[k === 'gR' ? 'R' : k]);
    if (mv != null) out[k] = mk(k, mv, 'USER');
    else if (lib) { const lv = k === 'gR' ? lib.R : lib[k]; out[k] = lv != null ? mk(k, rnd(lv, k === 'mu' ? 9 : 4), 'DEF', lib.src + (fl.range && (F.T < fl.range[0] || F.T > fl.range[1]) ? ' — T HORS PLAGE ' + fl.range.join('…') + ' °C' : '')) : miss(k, 'non fourni par la bibliothèque'); }
    else out[k] = miss(k);
    out[k].label = label;
  }
  out.Tref = num(F.T) != null ? mk('Tref', +F.T, 'USER') : miss('Tref'); out.Tref.label = 'Température de référence (°C)';
  out.Pref = num(F.P) != null ? mk('Pref', +F.P, 'USER') : miss('Pref'); out.Pref.label = 'Pression de référence (bar abs)';
  return out;
}
function globalMat() { return App.F.matSet ? mk('mat', App.F.mat, 'USER', 'réglage global') : mk('mat', App.F.mat, 'DEF', "matériau par défaut de l'outil, à confirmer"); }
function matVals(ov, Dref) {
  const r = {};
  r.mat = ov.mat ? mk('mat', ov.mat, 'USER') : globalMat();
  const m = MAT[r.mat.v];
  r.eps = num(ov.eps) != null ? mk('eps', +ov.eps, 'USER') : num(App.F.epsGlobal) != null ? mk('eps', +App.F.epsGlobal, 'USER', 'réglage global') : m ? mk('eps', m.eps, 'DEF', m.src + ' – ' + r.mat.v) : miss('eps');
  r.epsRel = (r.eps.v != null && Dref) ? mk('none', rnd(r.eps.v / Dref, 7), 'CALC', 'ε / Di') : miss('none');
  r.E = m ? mk('E', m.E, 'DEF', 'valeur usuelle – ' + r.mat.v) : miss('E');
  r.nu = m ? mk('nu', m.nu, 'DEF', 'valeur usuelle – ' + r.mat.v) : miss('nu');
  r.kw = m ? mk('kw', m.k, 'DEF', 'valeur usuelle – ' + r.mat.v) : miss('kw');
  return r;
}
function globalOrMiss(key, ovv, gv, note) { if (num(ovv) != null || (ovv && key === 'anchor')) return mk(key, key === 'anchor' ? ovv : +ovv, 'USER'); if (num(gv) != null || (gv && key === 'anchor')) return mk(key, key === 'anchor' ? gv : +gv, 'USER', note || 'réglage global'); return miss(key); }
function thermVals(ov) {
  return { insE: globalOrMiss('insE', ov.insE, App.F.insE), insL: globalOrMiss('insL', ov.insL, App.F.insL), h: globalOrMiss('h', ov.h, App.F.h), Tamb: globalOrMiss('Tamb', ov.Tamb, App.F.Tamb), heat: globalOrMiss('heat', ov.heat, App.F.heat) };
}
function materialize() {
  const m = App.model; if (!m) return null;
  const nodeById = Object.fromEntries(m.nodes.map(n => [n.id, n]));
  const atNode = {}; for (const c of m.comps) for (const n of c.nodes) if (n) (atNode[n] = atNode[n] || []).push(c);
  const other = (nid, self) => (atNode[nid] || []).find(c => c !== self);
  const R = { pipes: [], bends: [], tees: [], reds: [], eqs: [], nodes: [], free: [], all: [] };
  const fp = fluidProps(); R.fluid = fp;
  const Qg = num(App.F.Q);
  for (const c of m.comps) {
    const ov = App.ov[c.id] || {}; const v = {};
    const na = nodeById[c.nodes[0]], nb = nodeById[c.nodes[c.nodes.length - 1]];
    if (c.kind === 'PIPE') {
      let De = num(ov.De) != null ? mk('De', +ov.De, 'USER') : c.De != null ? mk('De', rnd(c.De, 4), 'STEP', c.deSrc) : null;
      let e = num(ov.e) != null ? mk('e', +ov.e, 'USER') : null;
      let Di = num(ov.Di) != null ? mk('Di', +ov.Di, 'USER') : (c.Di != null) ? mk('Di', rnd(c.Di, 4), 'STEP', c.diSrc) : null;
      if (!e && Di && De) e = mk('e', rnd((De.v - Di.v) / 2, 4), 'CALC', '(De − Di)/2');
      if (!e && De && !Di) { const st = stdThickness(De.v, App.S.thkStd); if (st) e = mk('e', st.e, 'DEF', st.src); }
      if (!Di && De && e) Di = mk('Di', rnd(De.v - 2 * e.v, 4), e.o === 'DEF' ? 'DEF' : 'CALC', e.o === 'DEF' ? 'De − 2e (épaisseur normalisée, tube modélisé par son seul De)' : 'De − 2e');
      if (!De && Di && e && e.o === 'USER') De = mk('De', rnd(Di.v + 2 * e.v, 4), 'CALC', 'Di + 2e');
      v.Di = Di || miss('Di', c.odOnly ? 'De seul modélisé, aucune classe normalisée trouvée' : ''); v.De = De || miss('De', c.idOnly ? 'cylindre unique interprété comme Di' : 'pas de paroi extérieure coaxiale'); v.e = e || miss('e');
      v.L = num(ov.L) != null ? mk('L', +ov.L, 'USER') : mk('L', rnd(c.L / 1000, 6), 'STEP', c.src + " — bornes des faces le long de l'axe" + (c.cut ? ", mesuré jusqu'au point de jonction" : ''));
      v.dz = mk('dz', rnd(altOf(nb.p) - altOf(na.p), 5), 'CALC', 'altitude aval − amont');
      v.A = v.Di.v != null ? mk('none', rnd(Math.PI * v.Di.v * v.Di.v / 4, 3), 'CALC', 'π·Di²/4') : miss('none');
      Object.assign(v, matVals(ov, v.Di.v));
      v.anchor = globalOrMiss('anchor', ov.anchor, App.F.anchor);
      Object.assign(v, thermVals(ov));
      v.vol = (v.Di.v != null) ? mk('none', rnd(Math.PI * v.Di.v * v.Di.v / 4 * c.L * 1e-6, 4), 'CALC', 'section × longueur') : miss('none');
      R.pipes.push({ c, v });
    } else if (c.kind === 'BEND') {
      const mitre = c.sub2 === 'onglet';
      v.type = mk('none', mitre ? 'À onglet (mitre)' : 'Cintré', 'CALC', mitre ? "angle d'axes au nœud" : 'surface torique');
      v.Di = num(ov.Di) != null ? mk('Di', +ov.Di, 'USER') : c.Di != null ? mk('Di', rnd(c.Di, 4), mitre ? 'CALC' : 'STEP', mitre ? '= Di des tubes raccordés' : c.diSrc) : null;
      v.De = c.De != null ? mk('De', rnd(c.De, 4), 'STEP', c.deSrc) : miss('De');
      if (!v.Di && c.De) { const st = stdThickness(c.De, App.S.thkStd); if (st) v.Di = mk('Di', rnd(c.De - 2 * st.e, 4), 'DEF', 'De − 2e, ' + st.src); }
      v.Di = v.Di || miss('Di');
      v.R = num(ov.R) != null ? mk('R', +ov.R, 'USER') : mitre ? mk('R', 0, 'CALC', 'coude à onglet') : mk('R', rnd(c.R, 4), 'STEP', c.src + ' (rayon majeur)');
      v.RD = v.Di.v ? mk('RD', rnd(v.R.v / v.Di.v, 4), 'CALC', 'R / Di') : miss('RD');
      v.theta = num(ov.theta) != null ? mk('theta', +ov.theta, 'USER') : mk('theta', rnd(c.theta, 3), mitre ? 'CALC' : 'STEP', mitre ? 'angle entre les axes des tubes' : c.src + ' (azimuts balayés)');
      v.Ldev = mk('Ldev', rnd(v.R.v * v.theta.v / DEG / 1000, 6), 'CALC', 'R × θ');
      Object.assign(v, matVals(ov, v.Di.v));
      v.corr = mk('none', mitre ? 'Miller – coude à onglet (angle, Re)' : 'Miller – coude circulaire (R/D, angle, Re)', 'CALC', 'suggestion');
      Object.assign(v, thermVals(ov));
      if (v.Di.v && v.eps.v != null) { const ft = fT(v.eps.v, v.Di.v); const K = mitre ? KMitre(v.theta.v, ft) : KBend(Math.max(v.RD.v, 1), v.theta.v, ft); v.K = mk('none', rnd(K, 4), 'CALC', 'indicatif Crane TP-410' + (!mitre && v.RD.v < 1 ? ' (R/D < 1 : extrapolé)' : '')); v.Le = mk('none', rnd(K * v.Di.v / ft / 1000, 4), 'CALC', 'K·Di/fT'); } else { v.K = miss('none'); v.Le = miss('none'); }
      R.bends.push({ c, v });
    } else if (c.kind === 'TEE' || c.kind === 'JCT') {
      const arms = c.arms; const iA = c.main[0], iB = c.main[1], iC = c.branch;
      const D = (i) => { const a = arms[i]; if (!a) return miss('Darm'); const o = other(a.node, c); return a.D != null ? mk('Darm', rnd(a.D, 4), 'STEP', 'Di de ' + (o ? o.id : '?')) : miss('Darm'); };
      v.n1 = arms[iA] ? arms[iA].node : ''; v.n2 = arms[iB] ? arms[iB].node : ''; v.n3 = iC != null && arms[iC] ? arms[iC].node : '';
      v.D1 = D(iA); v.D2 = D(iB); v.D3 = iC != null ? D(iC) : miss('Darm');
      if (c.kind === 'JCT') v.D3 = mk('none', arms.length + ' branches', 'INFO', 'jonction multiple : à modéliser manuellement');
      const sq = (x) => x.v * x.v;
      v.r31 = (v.D1.v && v.D3.v && c.kind === 'TEE') ? mk('ratio', rnd(sq(v.D3) / sq(v.D1), 4), 'CALC', 'A_dérivé / A_principal1') : miss('ratio');
      v.r21 = (v.D1.v && v.D2.v) ? mk('ratio', rnd(sq(v.D2) / sq(v.D1), 4), 'CALC', 'A_principal2 / A_principal1') : miss('ratio');
      v.ang = c.angle != null ? mk('tang', rnd(c.angle, 2), 'CALC', 'angle entre axes') : miss('tang');
      v.rj = num(ov.rj) != null ? mk('rj', +ov.rj, 'USER') : miss('rj', "rayon du congé d'intersection non extrait");
      v.cfg = ov.cfg ? mk('cfg', ov.cfg, 'USER') : miss('cfg', "dépend du sens d'écoulement réel");
      v.corr = mk('none', 'Miller – té (rapports de sections et de débits, angle)', 'CALC', 'suggestion');
      const mt = matVals({}, v.D1.v); if (v.D1.v && mt.eps.v != null) { const ft = fT(mt.eps.v, v.D1.v); v.Krun = mk('none', rnd(20 * ft, 4), 'CALC', 'indicatif Crane : 20·fT (passage direct)'); v.Kbr = mk('none', rnd(60 * ft, 4), 'CALC', 'indicatif Crane : 60·fT (dérivation)'); } else { v.Krun = miss('none'); v.Kbr = miss('none'); }
      R.tees.push({ c, v });
    } else if (c.kind === 'RED') {
      const brusque = c.sub2 === 'brusque';
      const dsrc = brusque ? '= Di des composants raccordés' : c.diSrc;
      const dget = (k, Dv, Dev) => {
        if (num(ov[k]) != null) return mk('D12', +ov[k], 'USER');
        if (Dv != null) return mk('D12', rnd(Dv, 4), brusque ? 'CALC' : 'STEP', dsrc);
        if (Dev != null) { const st = stdThickness(Dev, App.S.thkStd); if (st) return mk('D12', rnd(Dev - 2 * st.e, 4), 'DEF', 'De − 2e, ' + st.src); }
        return miss('D12');
      };
      v.D1 = dget('D1', c.D1, c.De1); v.D2 = dget('D2', c.D2, c.De2);
      v.type = mk('none', brusque ? 'Brusque' : 'Progressive (conique)', 'CALC', brusque ? 'cylindres coaxiaux sans cône' : 'surface conique');
      v.sens = (v.D1.v && v.D2.v) ? mk('none', v.D2.v < v.D1.v ? 'Réduction' : 'Élargissement', 'CALC', 'dans le sens de numérotation (à confirmer avec le sens d\'écoulement)') : miss('none');
      v.ratio = (v.D1.v && v.D2.v) ? mk('ratio', rnd((v.D2.v * v.D2.v) / (v.D1.v * v.D1.v), 4), 'CALC', 'A2 / A1') : miss('ratio');
      v.beta = (v.D1.v && v.D2.v) ? mk('none', rnd(Math.min(v.D1.v, v.D2.v) / Math.max(v.D1.v, v.D2.v), 4), 'CALC', 'D petit / D grand') : miss('none');
      v.cone = brusque ? mk('cone', 180, 'CALC', 'variation brusque') : mk('cone', rnd(c.angle, 3), 'STEP', c.src + ' (2 × demi-angle)');
      v.L = brusque ? mk('Lred', 0, 'CALC', 'longueur nulle') : mk('Lred', rnd(c.L, 4), 'STEP', c.src);
      if (v.beta.v != null) { const Ks = KRed(Math.min(v.D1.v, v.D2.v), Math.max(v.D1.v, v.D2.v), v.cone.v, v.D2.v < v.D1.v); v.K = mk('none', rnd(Ks, 4), 'CALC', 'indicatif Crane TP-410, rapporté à la vitesse dans le petit diamètre'); } else v.K = miss('none');
      R.reds.push({ c, v });
    } else if (c.kind === 'EQ') {
      const t = App.eqType[c.id] || c.eqType;
      v.type = App.eqType[c.id] ? mk('eqtype', t, 'USER') : c.unknown ? miss('eqtype', 'corps non identifié par son nom') : mk('eqtype', t, 'STEP', 'nom de produit CAO, mot-clé « ' + c.kw + ' »');
      v.ports = c.ports.map((p, i) => { const k = 'DN' + (i + 1); if (num(ov[k]) != null) return mk('DN', +ov[k], 'USER'); if (p.src) return mk('DN', rnd(p.D, 4), 'STEP', p.src + ' (alésage de la tubulure)'); if (p.pipeD != null) return mk('DN', rnd(p.pipeD, 4), 'CALC', '= Di du tube raccordé'); return miss('DN'); });
      if (t === 'Pompe' && c.ports.length === 2 && v.ports[0].v && v.ports[1].v && v.ports[0].v !== v.ports[1].v) { const ia = v.ports[0].v > v.ports[1].v ? 0 : 1; v.suggest = mk('none', 'Aspiration probable : ' + c.ports[ia].node + ' (plus grand DN)', 'CALC', 'suggestion, à confirmer'); }
      v.params = (EQ_PARAMS[t] || EQ_PARAMS['Équipement (autre)']).map(([k, label, fm, unit, need]) => { NEED['eq_' + k] = need; const x = ov[k] ? mk('eq_' + k, ov[k], 'USER') : miss('eq_' + k, 'performance constructeur — jamais estimée'); x.label = label; x.fm = fm; x.unit = unit; x.key = k; return x; });
      if (t === 'Réservoir' && c.bbox) { const zb = Math.min(altOf([c.bbox[0], c.bbox[1], c.bbox[2]]), altOf([c.bbox[3], c.bbox[4], c.bbox[5]])); v.zb = mk('zb', rnd(zb, 4), 'CALC', 'boîte englobante du corps'); }
      v.t = t;
      if (!c.nodes.length) v.warn = 'Non raccordé au réseau';
      R.eqs.push({ c, v });
    }
  }
  // Nœuds et conditions aux limites
  for (const n of m.nodes) {
    const cs = (atNode[n.id] || []);
    const type = n.deg === 1 ? 'Extrémité libre' : n.eq ? 'Raccord équipement' : n.split ? 'Bras de composant (té / onglet / variation)' : n.deg >= 3 ? 'Jonction' : 'Raccord';
    const r = { n, type, comps: cs.map(c => c.id).join(', '), alt: mk('none', rnd(altOf(n.p), 5), 'CALC', 'axe vertical ' + App.S.vertical) };
    if (n.deg === 1) {
      const b = App.bc[n.id] || {};
      r.bct = b.type ? mk('bc', b.type, 'USER') : miss('bc', 'pression, débit ou réservoir');
      r.bcv = num(b.val) != null ? mk('bcv', +b.val, 'USER') : miss('bcv');
      r.bcu = b.type ? BC_UNITS[b.type] || '' : '';
      r.Tin = num(b.T) != null ? mk('Tin', +b.T, 'USER') : num(App.F.Tin) != null ? mk('Tin', +App.F.Tin, 'USER', 'réglage global') : miss('Tin');
      if (b.type === 'Bouchon / extrémité fermée') { r.bcv = mk('none', '—', 'CALC', 'sans valeur'); }
      R.free.push(r);
    }
    R.nodes.push(r);
  }
  // Scénario / simulation
  R.sim = {
    dt: globalOrMiss('dt', null, App.F.dt, 'saisi'), dur: globalOrMiss('dur', null, App.F.dur, 'saisi'),
    events: App.F.events ? mk('events', App.F.events, 'USER') : miss('events', "ex. fermeture de V001 en 2 s à t = 1 s"),
    anchor: globalOrMiss('anchor', null, App.F.anchor), Q: num(App.F.Q) != null ? mk('none', +App.F.Q, 'USER', 'contrôle uniquement') : miss('none')
  };
  // Contrôle de vraisemblance + vitesse d'onde
  R.ctrl = []; let amin = null;
  const rho = fp.rho.v, mu = fp.mu.v, Kf = fp.K.v;
  for (const grp of [R.pipes, R.bends, R.reds, R.tees]) for (const it of grp) {
    const c = it.c, v = it.v; const ovq = num((App.ov[c.id] || {}).Q); const Q = ovq != null ? ovq : Qg;
    const D = c.kind === 'RED' ? (v.D1.v && v.D2.v ? Math.min(v.D1.v, v.D2.v) : null) : (c.kind === 'TEE' || c.kind === 'JCT') ? v.D1.v : v.Di.v;
    const row = { c, Q, D };
    if (c.kind === 'PIPE' && App.F.an.T && Kf && rho && v.E.v && v.e.v && v.Di.v) {
      const an = (v.anchor.v || ''); const nu = v.nu.v; const c1 = /amont/i.test(an) ? 1 - nu / 2 : /dilatation/i.test(an) ? 1 : 1 - nu * nu;
      row.a = Math.sqrt((Kf * 1e9 / rho) / (1 + c1 * (Kf / v.E.v) * (v.Di.v / v.e.v))); row.tL = (v.L.v) / row.a; if (amin == null || row.tL < amin) amin = row.tL;
      row.aNote = an ? '' : 'ancrage non renseigné : c1 = 1 − ν² supposé';
    }
    if (Q != null && D && rho && mu) {
      const A = Math.PI * D * D / 4e6; row.vel = Q / 3600 / A; row.Re = rho * row.vel * D / 1000 / mu;
      const eps = (v.eps && v.eps.v != null) ? v.eps.v : matVals({}, D).eps.v; row.rel = eps / D; row.f = colebrook(row.Re, row.rel);
      const q = rho * row.vel * row.vel / 2;
      if (c.kind === 'PIPE') { row.dpf = row.f * v.L.v / (D / 1000) * q; row.K = 0; }
      else if (c.kind === 'BEND') { row.K = v.K.v || 0; row.dpf = 0; }
      else if (c.kind === 'RED') { row.K = v.K.v || 0; row.dpf = 0; }
      else { row.K = v.Krun.v || 0; row.dpf = 0; row.note = 'K passage direct, répartition des débits inconnue'; }
      row.dps = row.K * q; row.dp = row.dpf + row.dps;
      row.dzst = c.kind === 'PIPE' ? rho * 9.80665 * v.dz.v : null;
      if (row.vel > 3) row.note = (row.note ? row.note + ' ; ' : '') + 'vitesse > 3 m/s';
      if (row.Re > 2300 && row.Re < 4000) row.note = (row.note ? row.note + ' ; ' : '') + 'régime de transition';
    }
    R.ctrl.push(row);
  }
  R.dtSuggest = amin;
  // Agrégats
  const tot = { L: 0, Vol: 0 };
  for (const it of R.pipes) { tot.L += it.c.L; if (it.v.Di.v) tot.Vol += Math.PI * it.v.Di.v * it.v.Di.v / 4 * it.c.L; }
  for (const it of R.bends) { const L = (it.v.R.v || 0) * (it.v.theta.v || 0) / DEG; tot.L += L; if (it.v.Di.v) tot.Vol += Math.PI * it.v.Di.v * it.v.Di.v / 4 * L; }
  for (const it of R.reds) { const L = it.v.L.v || 0; tot.L += L; if (it.v.D1.v && it.v.D2.v) { const r1 = it.v.D1.v / 2, r2 = it.v.D2.v / 2; tot.Vol += Math.PI * L / 3 * (r1 * r1 + r1 * r2 + r2 * r2); } }
  R.tot = tot;
  // Liste « à compléter » + complétude
  const todo = []; let req = 0, ok = 0;
  const scan = (sheet, id, label, x) => { if (!x || typeof x !== 'object' || !('o' in x)) return; const l = needLvl(x.need); if (l === 'B') { req++; if (x.o !== 'TODO') ok++; } if (x.o === 'TODO') todo.push({ sheet, id, label, crit: x.crit, note: x.s }); };
  const LBL = { Di: 'Diamètre intérieur', De: 'Diamètre extérieur', e: 'Épaisseur', L: 'Longueur', eps: 'Rugosité', mat: 'Matériau', E: "Module d'Young", nu: 'Coefficient de Poisson', anchor: 'Ancrage', kw: 'Conductivité paroi', insE: 'Épaisseur isolant', insL: 'Conductivité isolant', h: "Coefficient d'échange externe", Tamb: 'Température ambiante', heat: 'Source de chaleur', R: 'Rayon de cintrage', RD: 'R/D', theta: 'Angle', D1: 'Diamètre bras / D1', D2: 'Diamètre bras / D2', D3: 'Diamètre dérivation', rj: 'Rayon de raccordement r/D', cfg: 'Configuration convergent/divergent', r31: 'Rapport de sections', r21: 'Rapport de sections', ang: 'Angle du piquage', cone: 'Angle de cône', type: "Type d'équipement" };
  const scanGroup = (sheet, arr) => { for (const it of arr) for (const k in it.v) { const x = it.v[k]; if (Array.isArray(x)) x.forEach((p, i) => scan(sheet, it.c.id, p.label || ('DN raccord ' + (i + 1)), p)); else scan(sheet, it.c.id, LBL[k] || k, x); } };
  scanGroup('Tubes', R.pipes); scanGroup('Coudes', R.bends); scanGroup('Tés et jonctions', R.tees); scanGroup('Variations de section', R.reds); scanGroup('Équipements', R.eqs);
  for (const r of R.free) { scan('Conditions aux limites', r.n.id, 'Condition aux limites (type)', r.bct); scan('Conditions aux limites', r.n.id, 'Condition aux limites (valeur)', r.bcv); scan('Conditions aux limites', r.n.id, "Température d'entrée", r.Tin); }
  for (const k in fp) scan('Fluide', '—', fp[k].label, fp[k]);
  for (const [k, l] of [['dt', 'Pas de temps'], ['dur', 'Durée simulée'], ['events', 'Lois temporelles / événements']]) scan('Conditions aux limites', '—', l, R.sim[k]);
  todo.sort((a, b) => (a.crit === 'B' ? 0 : 1) - (b.crit === 'B' ? 0 : 1));
  R.todo = todo; R.req = req; R.ok = ok; R.compl = req ? ok / req : 1;
  // Statut par composant
  R.status = {};
  for (const t of todo) { if (!R.status[t.id]) R.status[t.id] = { B: 0, P: 0 }; R.status[t.id][t.crit]++; }
  return R;
}
const BC_UNITS = { 'Pression imposée': 'bar abs', 'Débit imposé': 'm³/h', 'Réservoir (niveau)': 'm', 'Bouchon / extrémité fermée': '—' };
const ANCHORS = ['Ancré à l\'amont uniquement', 'Ancré sur toute la longueur', 'Joints de dilatation'];
const statusText = (R, id) => { const s = R.status[id]; if (!s) return 'Complet'; if (s.B) return `À compléter (${s.B} bloquant${s.B > 1 ? 's' : ''})`; return `Complet (${s.P} optionnel${s.P > 1 ? 's' : ''})`; };

/* ---------- Analyse : Web Worker (repli : fil principal) ---------- */
function workerGlue() {
  let db = null;
  self.onmessage = async (ev) => {
    const m = ev.data;
    try {
      if (m.cmd === 'load') {
        const text = await m.file.text(); self.postMessage({ type: 'progress', phase: 'Lecture du STEP', pct: 0 });
        db = parseStep(text, p => self.postMessage({ type: 'progress', phase: 'Lecture du STEP', pct: p }));
        self.postMessage({ type: 'loaded', n: db.raw.size, header: db.header });
      } else if (m.cmd === 'analyze') {
        const model = analyze(db, m.S, p => self.postMessage({ type: 'progress', phase: 'Reconnaissance des corps', pct: p }));
        self.postMessage({ type: 'result', model });
      }
    } catch (err) { self.postMessage({ type: 'error', msg: err && err.message ? err.message : String(err) }); }
  };
}
let mainDb = null;
function getWorker() {
  if (App.worker !== null) return App.worker;
  try {
    const src = $('#core-src').textContent + '\n(' + workerGlue.toString() + ')();';
    const w = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
    w.onmessage = (e) => onWorkerMsg(e.data);
    w.onerror = (e) => { e.preventDefault(); App.worker = false; setStatus('Web Worker indisponible : analyse dans le fil principal.', 'warn'); if (App.pendingFile) runMain(App.pendingFile); };
    App.worker = w; return w;
  } catch (e) { App.worker = false; return false; }
}
function settingsForCore() {
  const kw = []; for (const line of App.S.keywordsText.split(/\n/)) { const m = /^\s*([^:]+):(.*)$/.exec(line); if (!m) continue; kw.push([m[1].trim(), m[2].split(',').map(s => s.trim()).filter(Boolean)]); }
  return { tol: Math.max(1e-4, num(App.S.tol) || 0.1), vertical: App.S.vertical, unitOverride: App.S.unitOverride, singleAs: App.S.singleAs, keywords: kw, bodyOverrides: App.S.bodyOverrides };
}
function loadFile(file) {
  App.fileName = file.name; App.pendingFile = file; App.ov = {}; App.bc = {}; App.eqType = {}; App.S.bodyOverrides = {}; App.sel = null;
  setStatus('Lecture de « ' + file.name + ' » (' + (file.size / 1048576).toFixed(1) + ' Mo)…'); setProgress(0.01, 'Lecture du STEP');
  const w = getWorker();
  if (w) w.postMessage({ cmd: 'load', file }); else runMain(file);
}
async function runMain(file) {
  try {
    const text = await file.text(); setProgress(0.1, 'Lecture du STEP (fil principal)');
    await new Promise(r => setTimeout(r, 30));
    mainDb = parseStep(text); onWorkerMsg({ type: 'loaded', n: mainDb.raw.size, header: mainDb.header });
  } catch (e) { onWorkerMsg({ type: 'error', msg: e.message }); }
}
function reanalyze() {
  if (!App.pendingFile) return; setProgress(0.05, 'Reconnaissance des corps');
  const S = settingsForCore();
  if (App.worker) App.worker.postMessage({ cmd: 'analyze', S });
  else setTimeout(() => { try { onWorkerMsg({ type: 'result', model: analyze(mainDb, S) }); } catch (e) { onWorkerMsg({ type: 'error', msg: e.message }); } }, 20);
}
function onWorkerMsg(m) {
  if (m.type === 'progress') setProgress(m.pct, m.phase);
  else if (m.type === 'loaded') { setStatus(`${m.n.toLocaleString('fr-FR')} entités lues — schéma ${m.header.schema}. Analyse en cours…`); reanalyze(); }
  else if (m.type === 'result') { App.model = m.model; setProgress(null); setStatus(`« ${App.fileName} » analysé en ${m.model.ms} ms : ${m.model.topo.comps} composants, ${m.model.topo.nodes} nœuds.`, 'ok'); $('#btnExport').disabled = false; viewer.fit(); refresh(); }
  else if (m.type === 'error') { setProgress(null); setStatus('Erreur : ' + m.msg, 'err'); }
}
function setStatus(t, cls) { const e = $('#status'); e.textContent = t; e.className = 'status ' + (cls || ''); }
function setProgress(p, phase) { const b = $('#prog'); if (p == null) { b.style.display = 'none'; return; } b.style.display = 'block'; $('#progBar').style.width = Math.round(Math.max(0.02, Math.min(1, p)) * 100) + '%'; $('#progTxt').textContent = phase || ''; }

/* ---------- Rendu de l'interface ---------- */
let MAT_R = null;
function refresh() { MAT_R = materialize(); renderTab(); renderInspector(); viewer.draw(); }
const badge = (x) => x ? `<span class="o o-${x.o}" title="${esc(origText(x))}">${{ STEP: 'STEP', CALC: 'calc', DEF: 'déf', USER: 'saisi', TODO: 'à compl.', NA: 'n.r.', INFO: 'info' }[x.o] || ''}</span>` : '';
const cellV = (x, n = 3) => !x ? '' : (x.v == null ? `<span class="todo">${x.o === 'NA' ? '—' : 'À COMPLÉTER'}</span>` : esc(fmt(x.v, n))) + ' ' + badge(x);
const TYPE_LABEL = { PIPE: 'Tube', BEND: 'Coude', TEE: 'Té', JCT: 'Jonction multiple', RED: 'Variation de section', EQ: 'Équipement' };
function renderTab() {
  const t = $('.tab.on').dataset.t; const box = $('#panel'); const m = App.model, R = MAT_R;
  if (t === 'help') { box.innerHTML = HELP_HTML; return; }
  if (t === 'ref') { box.innerHTML = refTableHtml(); return; }
  if (t === 'data') { box.innerHTML = dataFormHtml(); bindDataForm(); return; }
  if (t === 'set') { box.innerHTML = settingsHtml() + (m ? synthHtml() : '<p class="hint">Chargez un fichier STEP (bouton en haut ou glisser-déposer) pour lancer l\'analyse.</p>'); bindSettings(); return; }
  if (!m) { box.innerHTML = '<p class="hint">Aucun fichier analysé.</p>'; return; }
  if (t === 'comp') {
    const types = ['Tous', 'Tube', 'Coude', 'Té', 'Variation de section', 'Équipement', 'À compléter'];
    let h = `<div class="bar">Afficher : <select id="flt">${types.map(x => `<option${x === App.filter ? ' selected' : ''}>${x}</option>`).join('')}</select> <span class="hint">Cliquez une ligne pour l'éditer et la repérer en 3D.</span></div>`;
    h += '<table class="grid"><thead><tr><th>ID</th><th>Type</th><th>Nœuds</th><th>Di / D1 (mm)</th><th>L (m) / angle</th><th>Corps CAO</th><th>Statut</th></tr></thead><tbody>';
    const rows = [...R.pipes.map(x => ['Tube', x]), ...R.bends.map(x => ['Coude', x]), ...R.tees.map(x => ['Té', x]), ...R.reds.map(x => ['Variation de section', x]), ...R.eqs.map(x => ['Équipement', x])];
    rows.sort((a, b) => m.comps.indexOf(a[1].c) - m.comps.indexOf(b[1].c));
    for (const [ty, it] of rows) {
      const st = statusText(R, it.c.id);
      if (App.filter === 'À compléter' ? !/bloquant/.test(st) : (App.filter !== 'Tous' && App.filter !== ty)) continue;
      const v = it.v; const d = v.Di || v.D1 || (v.ports && v.ports[0]);
      const l = ty === 'Tube' ? cellV(v.L, 4) : ty === 'Coude' ? fmt(v.theta.v, 1) + '° · R/D ' + fmt(v.RD.v, 2) + ' ' + badge(v.theta) : ty === 'Té' ? fmt(v.ang.v, 1) + '° ' + badge(v.ang) : ty === 'Variation de section' ? fmt(v.D2.v, 2) + ' mm, ' + v.type.v : esc(v.t);
      h += `<tr data-id="${it.c.id}" class="${App.sel === it.c.id ? 'sel' : ''}"><td><b>${it.c.id}</b></td><td>${ty}${it.c.sub2 ? ' ' + it.c.sub2 : ''}</td><td>${it.c.nodes.join(' → ')}</td><td>${cellV(d, 2)}</td><td>${l}</td><td class="sm">${esc(it.c.bodyName || '')}</td><td class="${/bloquant/.test(st) ? 'bad' : 'good'}">${st}</td></tr>`;
    }
    box.innerHTML = h + '</tbody></table>';
    $('#flt').onchange = (e) => { App.filter = e.target.value; renderTab(); };
    $$('#panel tr[data-id]').forEach(tr => tr.onclick = () => select(tr.dataset.id));
  }
  if (t === 'nodes') {
    let h = `<h3>Extrémités libres : conditions aux limites (${R.free.length})</h3><p class="hint">Chaque extrémité libre doit recevoir une condition aux limites dans Flowmaster (source de pression, de débit ou réservoir).</p>`;
    h += '<table class="grid"><thead><tr><th>Nœud</th><th>Altitude (m)</th><th>Composant</th><th>Type de condition</th><th>Valeur</th><th>Unité</th><th>T entrée (°C)</th></tr></thead><tbody>';
    for (const r of R.free) { const b = App.bc[r.n.id] || {}; h += `<tr data-node="${r.n.id}"><td><b>${r.n.id}</b></td><td>${fmt(r.alt.v, 3)}</td><td>${r.comps}</td><td><select data-bc="type"><option value="">— à compléter —</option>${Object.keys(BC_UNITS).map(k => `<option${b.type === k ? ' selected' : ''}>${k}</option>`).join('')}</select></td><td><input data-bc="val" value="${esc(b.val || '')}" size="7"></td><td>${r.bcu || ''}</td><td><input data-bc="T" value="${esc(b.T || '')}" size="5"></td></tr>`; }
    h += '</tbody></table><h3>Tous les nœuds</h3><table class="grid"><thead><tr><th>ID</th><th>X (mm)</th><th>Y (mm)</th><th>Z (mm)</th><th>Altitude (m)</th><th>Type</th><th>Composants</th></tr></thead><tbody>';
    for (const r of R.nodes) h += `<tr data-nsel="${r.n.id}"><td>${r.n.id}</td><td>${fmt(r.n.p[0], 2)}</td><td>${fmt(r.n.p[1], 2)}</td><td>${fmt(r.n.p[2], 2)}</td><td>${fmt(r.alt.v, 3)}</td><td>${r.type}</td><td>${r.comps}</td></tr>`;
    box.innerHTML = h + '</tbody></table>';
    $$('#panel tr[data-node]').forEach(tr => { $$('[data-bc]', tr).forEach(inp => inp.onchange = () => { const id = tr.dataset.node; App.bc[id] = App.bc[id] || {}; App.bc[id][inp.dataset.bc] = inp.value; refresh(); }); });
    $$('#panel tr[data-nsel]').forEach(tr => tr.onclick = () => select(tr.dataset.nsel));
  }
  if (t === 'eq') {
    let h = '<p class="hint">Les caractéristiques de performance ne sont jamais estimées : elles doivent venir des fiches constructeur. Saisie libre (ex. courbe H-Q : « 0:32 ; 10:30 ; 20:25 »).</p>';
    if (!R.eqs.length) h += '<p>Aucun équipement identifié. Vérifiez les mots-clés (onglet Réglages) ou classez les corps dans l\'onglet « Corps CAO ».</p>';
    for (const it of R.eqs) {
      const c = it.c, v = it.v;
      h += `<div class="card" data-eq="${c.id}"><div class="card-h"><b>${c.id}</b> — « ${esc(c.bodyName)} » <select data-eqtype>${EQ_TYPES.map(x => `<option${x === v.t ? ' selected' : ''}>${x}</option>`).join('')}</select> ${badge(v.type)} <span class="sm">Nœuds : ${c.nodes.join(' → ') || '—'}</span> ${v.warn ? `<span class="bad">${v.warn}</span>` : ''}</div>`;
      h += '<table class="kv">';
      v.ports.forEach((p, i) => h += `<tr><td>DN raccord ${i + 1} — ${c.ports[i].node} (mm)</td><td><input data-k="DN${i + 1}" value="${p.o === 'USER' ? p.v : ''}" placeholder="${p.v != null ? fmt(p.v, 2) : ''}" size="8"> ${badge(p)}</td></tr>`);
      if (v.suggest) h += `<tr><td>Sens</td><td>${esc(v.suggest.v)} ${badge(v.suggest)}</td></tr>`;
      if (v.zb) h += `<tr><td>Altitude du fond (m)</td><td>${fmt(v.zb.v, 3)} ${badge(v.zb)}</td></tr>`;
      for (const p of v.params) h += `<tr><td>${esc(p.label)} (${esc(p.fm)}) [${esc(p.unit)}]</td><td><input data-k="${p.key}" value="${esc(p.o === 'USER' ? p.v : '')}" size="28" placeholder="${p.o === 'NA' ? 'non requis' : 'À COMPLÉTER'}"> ${badge(p)}</td></tr>`;
      h += '</table></div>';
    }
    box.innerHTML = h;
    $$('#panel .card').forEach(card => {
      const id = card.dataset.eq;
      $('[data-eqtype]', card).onchange = (e) => { App.eqType[id] = e.target.value; refresh(); };
      $$('input[data-k]', card).forEach(inp => inp.onchange = () => { (App.ov[id] = App.ov[id] || {})[inp.dataset.k] = inp.value; refresh(); });
      card.onclick = (e) => { if (e.target.tagName !== 'INPUT' && e.target.tagName !== 'SELECT') select(id); };
    });
  }
  if (t === 'bodies') {
    let h = '<p class="hint">Classement automatique par mots-clés du nom CAO. Modifiez le classement puis cliquez « Relancer l\'analyse ».</p><div class="bar"><button id="btnRe2">Relancer l\'analyse</button></div>';
    h += '<table class="grid"><thead><tr><th>Corps (produit)</th><th>Chemin</th><th>Faces</th><th>Primitives</th><th>Classement</th><th>Remarques</th></tr></thead><tbody>';
    for (const b of m.bodies) {
      const cnt = Object.entries(b.counts).map(([k, n]) => `${k} ${n}`).join(' · ');
      const cur = App.S.bodyOverrides[b.key] || 'Auto';
      h += `<tr><td><b>${esc(b.name || '(sans nom)')}</b><br><span class="sm">#${b.brep} ${b.solid ? 'solide' : 'surfacique'}</span></td><td class="sm">${esc(b.path)}</td><td class="sm">${cnt}</td><td>${b.nPrims}</td><td><select data-body="${esc(b.key)}"><option${cur === 'Auto' ? ' selected' : ''}>Auto</option>${['Tuyauterie', ...EQ_TYPES, 'Ignorer'].map(x => `<option${cur === x ? ' selected' : ''}>${x}</option>`).join('')}</select><br><span class="sm">auto : ${esc(b.autoClass)}${b.kw ? ' (« ' + esc(b.kw) + ' »)' : ''}</span></td><td class="sm">${esc((b.notes || []).join(' ; '))}</td></tr>`;
    }
    box.innerHTML = h + '</tbody></table>';
    $$('#panel select[data-body]').forEach(s => s.onchange = () => { if (s.value === 'Auto') delete App.S.bodyOverrides[s.dataset.body]; else App.S.bodyOverrides[s.dataset.body] = s.value; });
    $('#btnRe2').onclick = reanalyze;
  }
}
function settingsHtml() {
  const S = App.S;
  return `<h3>Réglages de reconnaissance</h3><div class="form">
  <label>Tolérance de raccordement (mm)<input id="sTol" value="${esc(S.tol)}" size="6"></label>
  <label>Axe vertical<select id="sVert">${['Z+', 'Z-', 'Y+', 'Y-', 'X+', 'X-'].map(x => `<option${x === S.vertical ? ' selected' : ''}>${x}</option>`).join('')}</select></label>
  <label>Unité de longueur<select id="sUnit">${[['auto', 'Lue dans le STEP'], ['mm', 'Forcer : mm'], ['m', 'Forcer : m'], ['in', 'Forcer : pouce']].map(([k, l]) => `<option value="${k}"${k === S.unitOverride ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
  <label>Corps à un seul cylindre<select id="sSingle"><option value="OD"${S.singleAs === 'OD' ? ' selected' : ''}>= diamètre extérieur (tube plein)</option><option value="ID"${S.singleAs === 'ID' ? ' selected' : ''}>= diamètre intérieur (volume fluide)</option></select></label>
  <label>Norme d'épaisseur (De seul)<select id="sStd">${Object.entries(PIPE_STD).map(([k, s]) => `<option value="${k}"${k === S.thkStd ? ' selected' : ''}>${s.name}</option>`).join('')}</select></label>
  </div><details><summary>Mots-clés d'identification des équipements (FR/EN, un type par ligne)</summary><textarea id="sKw" rows="9">${esc(S.keywordsText)}</textarea></details>
  <div class="bar"><button id="btnRe">Relancer l'analyse</button> <span class="hint">L'axe vertical et la norme d'épaisseur s'appliquent sans relance.</span></div>`;
}
function bindSettings() {
  const on = (id, f) => { const e = $(id); if (e) e.onchange = f; };
  on('#sTol', e => App.S.tol = e.target.value); on('#sUnit', e => App.S.unitOverride = e.target.value); on('#sSingle', e => App.S.singleAs = e.target.value); on('#sKw', e => App.S.keywordsText = e.target.value);
  on('#sVert', e => { App.S.vertical = e.target.value; viewer.fit(); refresh(); }); on('#sStd', e => { App.S.thkStd = e.target.value; refresh(); });
  const b = $('#btnRe'); if (b) b.onclick = reanalyze;
}
function synthHtml() {
  const m = App.model, R = MAT_R; const cnt = { Tubes: R.pipes.length, Coudes: R.bends.length, 'Tés / jonctions': R.tees.length, 'Variations de section': R.reds.length, 'Équipements': R.eqs.length };
  const al = m.alerts; const lv = { err: 'Bloquant', warn: 'Attention', info: 'Info' };
  const blk = R.todo.filter(t => t.crit === 'B').length;
  return `<h3>Synthèse</h3><div class="kpis">
   <div><b>${m.topo.comps}</b>composants</div><div><b>${m.topo.nodes}</b>nœuds</div><div><b>${m.topo.free}</b>extrémités libres</div><div><b>${m.topo.loops}</b>boucle(s)</div><div><b>${m.topo.subs}</b>sous-réseau(x)</div><div class="${R.compl < 1 ? 'kbad' : 'kgood'}"><b>${Math.round(R.compl * 100)} %</b>complétude (${blk} bloquant${blk > 1 ? 's' : ''})</div></div>
   <table class="kv"><tr><td>Fichier</td><td>${esc(App.fileName)} — ${esc(m.header.schema)} — ${m.nEntities.toLocaleString('fr-FR')} entités</td></tr><tr><td>Unité CAO</td><td>${esc(m.unit)}${App.S.unitOverride !== 'auto' ? ' (forcée : ' + App.S.unitOverride + ')' : ''} ; angles : ${esc(m.angUnit)}</td></tr>
   <tr><td>Composants</td><td>${Object.entries(cnt).map(([k, n]) => k + ' : ' + n).join(' · ')}</td></tr><tr><td>Longueur développée</td><td>${fmt(R.tot.L / 1000, 3)} m</td></tr><tr><td>Volume interne</td><td>${fmt(R.tot.Vol / 1e6, 3)} L</td></tr></table>
   <h3>Alertes (${al.length})</h3><ul class="alerts">${al.map(a => `<li class="a-${a.lvl}"><b>${lv[a.lvl]}</b> ${esc(a.msg)}</li>`).join('') || '<li>Aucune.</li>'}</ul>`;
}
function dataFormHtml() {
  const F = App.F; const inp = (k, v, sz = 8, ph = '') => `<input data-f="${k}" value="${esc(v)}" size="${sz}" placeholder="${ph}">`;
  const fl = FLUIDS[F.fluid]; const lib = F.fluid !== 'manual' ? fl.f(+F.T || 20, +F.P || 1) : null;
  const pr = [['rho', 'ρ (kg/m³)'], ['mu', 'μ (Pa·s)'], ['cp', 'Cp (J/(kg·K))'], ['lam', 'λ (W/(m·K))'], ['K', 'Module de compressibilité (GPa)'], ['pv', 'Pression de vapeur (kPa)'], ['R', 'Constante du gaz (J/(kg·K))'], ['gamma', 'γ (–)']];
  return `<h3>Type(s) d'analyse visé(s)</h3><div class="form">${Object.entries(ANALYSES).map(([k, l]) => `<label class="chk"><input type="checkbox" data-an="${k}"${F.an[k] ? ' checked' : ''}> ${l}</label>`).join('')}</div>
  ${F.an.C ? '<p class="warn">Compressible : extension optionnelle. Vérifier dans Flowmaster les composants gaz et les données propres (γ, R, conditions d\'arrêt).</p>' : ''}
  <h3>Fluide</h3><div class="form"><label>Fluide<select data-f="fluid">${Object.entries(FLUIDS).map(([k, f]) => `<option value="${k}"${k === F.fluid ? ' selected' : ''}>${f.name}</option>`).join('')}</select></label>
  <label>Température de référence (°C)${inp('T', F.T, 5)}</label><label>Pression de référence (bar abs)${inp('P', F.P, 6)}</label></div>
  <p class="sm">${lib ? 'Source : ' + esc(lib.src) : 'Toutes les propriétés sont à saisir.'} — une valeur saisie ci-dessous remplace la bibliothèque.</p>
  <div class="form">${pr.map(([k, l]) => `<label>${l}<input data-m="${k}" value="${esc(F.man[k])}" size="9" placeholder="${lib && lib[k === 'R' ? 'R' : k] != null ? fmt(lib[k === 'R' ? 'R' : k], k === 'mu' ? 7 : 4) : ''}"></label>`).join('')}</div>
  <h3>Matériau et rugosité (global)</h3><div class="form"><label>Matériau par défaut des tubes<select data-f="mat">${MATERIALS.map(m => `<option${m[0] === F.mat ? ' selected' : ''}>${m[0]}</option>`).join('')}</select></label><label>Rugosité imposée à tous (mm)${inp('epsGlobal', F.epsGlobal, 7, 'table')}</label></div>
  <p class="sm">Le matériau et la rugosité se modifient aussi composant par composant (clic sur un élément).</p>
  <h3>Contrôle de vraisemblance</h3><div class="form"><label>Débit nominal (m³/h)${inp('Q', F.Q, 7)}</label></div><p class="sm">Utilisé seulement pour l'onglet de contrôle (vitesse, Re, ΔP indicatives). Débit identique supposé dans chaque branche sauf saisie par composant.</p>
  ${F.an.T ? `<h3>Transitoire</h3><div class="form"><label>Ancrage des tubes<select data-f="anchor"><option value="">— à compléter —</option>${ANCHORS.map(a => `<option${a === F.anchor ? ' selected' : ''}>${esc(a)}</option>`).join('')}</select></label><label>Pas de temps (s)${inp('dt', F.dt, 7, MAT_R && MAT_R.dtSuggest ? '≤ ' + fmt(MAT_R.dtSuggest, 5) : '')}</label><label>Durée simulée (s)${inp('dur', F.dur, 7)}</label><label class="wide">Événements / lois temporelles${inp('events', F.events, 40, 'ex. fermeture EQ002 de 100 % à 0 % en 2 s à t = 1 s')}</label></div>${MAT_R && MAT_R.dtSuggest ? `<p class="sm">Suggestion calculée : Δt ≤ L/a minimal = ${fmt(MAT_R.dtSuggest, 5)} s (vitesse d'onde estimée par tube, voir onglet Contrôle de l'Excel).</p>` : '<p class="sm">La suggestion de pas de temps apparaît quand le module de compressibilité du fluide et les données de paroi sont connus.</p>'}` : ''}
  ${F.an.Th ? `<h3>Thermique</h3><div class="form"><label>Température d'entrée (°C)${inp('Tin', F.Tin, 6)}</label><label>Épaisseur d'isolant (mm)${inp('insE', F.insE, 6)}</label><label>Conductivité isolant (W/(m·K))${inp('insL', F.insL, 6)}</label><label>Coefficient d'échange externe (W/(m²·K))${inp('h', F.h, 6)}</label><label>Température ambiante (°C)${inp('Tamb', F.Tamb, 6)}</label><label>Source de chaleur par tube (W)${inp('heat', F.heat, 6)}</label></div>` : ''}`;
}
function bindDataForm() {
  $$('#panel [data-an]').forEach(c => c.onchange = () => { App.F.an[c.dataset.an] = c.checked; refresh(); });
  $$('#panel [data-f]').forEach(c => c.onchange = () => { App.F[c.dataset.f] = c.value; if (c.dataset.f === 'mat') App.F.matSet = true; refresh(); });
  $$('#panel [data-m]').forEach(c => c.onchange = () => { App.F.man[c.dataset.m] = c.value; refresh(); });
}
function refTableHtml() {
  return `<h3>Référentiel des données d'entrée Flowmaster</h3><p class="sm">B = bloquant pour l'analyse, P = améliore la précision. Origine : a = extrait du STEP, b = calculé, c = défaut sourcé, d = saisie obligatoire. Ce référentiel pilote la colonne « Criticité » de l'onglet « À compléter ».</p>
  <table class="grid ref"><thead><tr><th>Composant</th><th>Paramètre</th><th>Nom Flowmaster</th><th>Unité</th><th>Perm.</th><th>Trans.</th><th>Therm.</th><th>Comp.</th><th>Origine</th><th>Méthode / source</th></tr></thead><tbody>${REF.map(r => `<tr>${r.map((x, i) => `<td class="${i >= 4 && i <= 7 ? 'c ' + (x === 'B' ? 'bB' : x === 'P' ? 'bP' : '') : ''}">${esc(x)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
}
/* ---------- Inspecteur (élément sélectionné) ---------- */
function select(id) { App.sel = id; renderInspector(); viewer.draw(); $$('#panel tr[data-id]').forEach(tr => tr.classList.toggle('sel', tr.dataset.id === id)); }
function findItem(id) { const R = MAT_R; if (!R) return null; for (const g of ['pipes', 'bends', 'tees', 'reds', 'eqs']) { const it = R[g].find(x => x.c.id === id); if (it) return [g, it]; } const n = R.nodes.find(x => x.n.id === id); return n ? ['node', n] : null; }
function renderInspector() {
  const box = $('#insp'); const f = App.sel && findItem(App.sel);
  if (!f) { box.innerHTML = '<p class="hint">Cliquez un élément dans la vue 3D ou dans la liste des composants.</p>'; return; }
  const [g, it] = f;
  if (g === 'node') { const r = it; box.innerHTML = `<h4>${r.n.id} — ${r.type}</h4><table class="kv"><tr><td>X ; Y ; Z (mm)</td><td>${r.n.p.map(v => fmt(v, 2)).join(' ; ')}</td></tr><tr><td>Altitude (m)</td><td>${fmt(r.alt.v, 4)}</td></tr><tr><td>Composants</td><td>${r.comps}</td></tr>${r.bct ? `<tr><td>Condition aux limites</td><td>${cellV(r.bct)} ${r.bcv && r.bcv.v != null ? fmt(r.bcv.v) + ' ' + r.bcu : ''}</td></tr>` : ''}</table>${r.bct ? '<p class="sm">Saisie dans l\'onglet « Nœuds & CL ».</p>' : ''}`; return; }
  const c = it.c, v = it.v; const ov = App.ov[c.id] || {};
  const EDIT = { pipes: ['Di', 'De', 'e', 'L', 'mat', 'eps', 'Q'], bends: ['Di', 'R', 'theta', 'mat', 'eps', 'Q'], tees: ['rj', 'cfg'], reds: ['D1', 'D2', 'Q'], eqs: [] }[g];
  const LAB = { Di: 'Diamètre intérieur (mm) (Diameter)', De: 'Diamètre extérieur (mm)', e: 'Épaisseur (mm) (Wall thickness)', L: 'Longueur (m) (Length)', dz: 'Dénivelé (m)', A: 'Section (mm²)', mat: 'Matériau (Material)', eps: 'Rugosité absolue (mm)', epsRel: 'Rugosité relative (–)', E: "Module d'Young (GPa)", nu: 'Poisson (–)', anchor: 'Ancrage', kw: 'Conductivité paroi (W/(m·K))', R: 'Rayon de cintrage (mm) (Bend radius)', RD: 'R/D (–)', theta: 'Angle (°) (Bend angle)', Ldev: 'Longueur développée (m)', type: 'Type', corr: 'Corrélation suggérée', K: 'K indicatif (–)', Le: 'Longueur équivalente (m)', D1: 'D1 (mm)', D2: 'D2 (mm)', D3: 'D dérivation (mm)', r31: 'A_dériv./A_princ. (–)', r21: 'A_princ.2/A_princ.1 (–)', ang: 'Angle du piquage (°)', rj: 'Rayon de raccordement r/D (–)', cfg: 'Configuration', Krun: 'K passage direct (–)', Kbr: 'K dérivation (–)', sens: 'Sens', ratio: 'A2/A1 (–)', beta: 'β (–)', cone: 'Angle de cône (°)', vol: 'Volume (L)', n1: 'Nœud principal 1', n2: 'Nœud principal 2', n3: 'Nœud dérivé' };
  let h = `<h4>${c.id} — ${TYPE_LABEL[c.kind] || c.kind}${c.sub2 ? ' ' + c.sub2 : ''} <span class="sm">${esc(c.bodyName || '')}</span></h4><div class="sm">Nœuds : ${c.nodes.join(' → ')} · ${statusText(MAT_R, c.id)}</div><table class="kv">`;
  if (g === 'eqs') { h += `<tr><td colspan="2">Éditer dans l'onglet « Équipements ».</td></tr>`; v.ports.forEach((p, i) => h += `<tr><td>DN ${c.ports[i].node}</td><td>${cellV(p, 2)}</td></tr>`); for (const p of v.params) h += `<tr><td>${esc(p.label)}</td><td>${cellV(p)}</td></tr>`; }
  else for (const k of Object.keys(v)) {
    if (['insE', 'insL', 'h', 'Tamb', 'heat'].includes(k) && !App.F.an.Th) continue;
    if (['E', 'nu', 'anchor'].includes(k) && !App.F.an.T) continue;
    const x = v[k]; if (typeof x !== 'object' && !EDIT.includes(k)) { h += `<tr><td>${LAB[k] || k}</td><td>${esc(x)}</td></tr>`; continue; }
    if (EDIT.includes(k)) {
      if (k === 'mat') h += `<tr><td>${LAB[k]}</td><td><select data-ov="mat"><option value="">(global : ${esc(App.F.mat)})</option>${MATERIALS.map(m => `<option${ov.mat === m[0] ? ' selected' : ''}>${m[0]}</option>`).join('')}</select> ${badge(x)}</td></tr>`;
      else if (k === 'cfg') h += `<tr><td>${LAB[k]}</td><td><select data-ov="cfg"><option value="">— à préciser —</option>${['Convergent', 'Divergent', 'Variable (selon le solveur)'].map(o => `<option${ov.cfg === o ? ' selected' : ''}>${o}</option>`).join('')}</select> ${badge(x)}</td></tr>`;
      else h += `<tr><td>${LAB[k] || k}</td><td><input data-ov="${k}" value="${esc(ov[k] || '')}" placeholder="${x && x.v != null ? fmt(x.v, 4) : 'À COMPLÉTER'}" size="9"> ${badge(x)}</td></tr>`;
    } else h += `<tr><td>${LAB[k] || k}</td><td>${cellV(x, 4)}</td></tr>`;
  }
  if (EDIT.includes('Q')) h += `<tr><td>Débit de contrôle (m³/h)</td><td><input data-ov="Q" value="${esc(ov.Q || '')}" placeholder="${App.F.Q ? 'global ' + App.F.Q : ''}" size="9"></td></tr>`;
  h += '</table><p class="sm">Survolez une pastille pour voir l\'origine et l\'entité STEP. Un champ vide reprend la valeur extraite/par défaut.</p>';
  box.innerHTML = h;
  $$('#insp [data-ov]').forEach(inp => inp.onchange = () => { const o = (App.ov[c.id] = App.ov[c.id] || {}); if (inp.value === '') delete o[inp.dataset.ov]; else o[inp.dataset.ov] = inp.value; refresh(); });
}

/* ---------- Vue 3D filaire (canvas 2D, sans dépendance) ---------- */
const viewer = (() => {
  const cv = () => $('#view'); let yaw = -0.6, pitch = 0.45, scale = 1, center = [0, 0, 0], pan = [0, 0], prims = [];
  const COL = { PIPE: '#2f7fc1', BEND: '#e08a1e', TEE: '#8e44ad', JCT: '#c0392b', RED: '#16a085', EQ: '#c0392b' };
  const basis = () => { const v = App.S.vertical; const i = 'XYZ'.indexOf(v[0]); const U = [0, 0, 0]; U[i] = v[1] === '-' ? -1 : 1; const E = [0, 0, 0]; E[(i + 1) % 3] = 1; const N = V.cross(U, E); return { U, E, N }; };
  function proj(p) {
    const c = cv(); const B = basis(); const q = V.sub(p, center); const a = V.dot(q, B.E), b = V.dot(q, B.N), u = V.dot(q, B.U);
    const x1 = a * Math.cos(yaw) - b * Math.sin(yaw), y1 = a * Math.sin(yaw) + b * Math.cos(yaw);
    const sx = x1, sy = u * Math.cos(pitch) - y1 * Math.sin(pitch), d = y1 * Math.cos(pitch) + u * Math.sin(pitch);
    return [c.width / 2 + pan[0] + sx * scale, c.height / 2 + pan[1] - sy * scale, d];
  }
  function geom() {
    const m = App.model; prims = []; if (!m) return;
    const byId = Object.fromEntries(m.nodes.map(n => [n.id, n]));
    for (const c of m.comps) {
      let pts = [];
      if (c.kind === 'PIPE' || (c.kind === 'RED' && c.sub2 !== 'brusque')) pts = [c.a, c.b];
      else if (c.kind === 'BEND' && c.sub2 === 'cintré') { const n = Math.max(4, Math.ceil(c.theta / 7.5)); for (let i = 0; i <= n; i++) { const ph = c.phi0 + c.theta / DEG * i / n; pts.push(V.add(c.C, V.mul(V.add(V.mul(c.ex, Math.cos(ph)), V.mul(c.ey, Math.sin(ph))), c.R))); } }
      else if (c.p) pts = [c.p];
      else if (c.kind === 'EQ' && c.bbox) { const b = c.bbox; const C = [[b[0], b[1], b[2]], [b[3], b[1], b[2]], [b[3], b[4], b[2]], [b[0], b[4], b[2]], [b[0], b[1], b[5]], [b[3], b[1], b[5]], [b[3], b[4], b[5]], [b[0], b[4], b[5]]]; prims.push({ c, box: C }); continue; }
      prims.push({ c, pts });
    }
    for (const n of m.nodes) prims.push({ node: n });
  }
  function fit() {
    geom(); const m = App.model; const cc = cv(); const dpr0 = window.devicePixelRatio || 1; cc.width = Math.round(cc.clientWidth * dpr0); cc.height = Math.round(cc.clientHeight * dpr0); if (!m || !m.nodes.length) return;
    let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    const acc = (p) => { for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], p[k]); hi[k] = Math.max(hi[k], p[k]); } };
    m.nodes.forEach(n => acc(n.p)); m.comps.forEach(c => { if (c.bbox) { acc(c.bbox.slice(0, 3)); acc(c.bbox.slice(3)); } });
    center = V.mul(V.add(lo, hi), 0.5); const ext = Math.max(1, V.dist(lo, hi)); const c = cv(); scale = 0.8 * Math.min(c.width, c.height) / ext; pan = [0, 0];
  }
  function draw() {
    const c = cv(); if (!c) return; const ctx = c.getContext('2d'); const W = c.clientWidth, H = c.clientHeight; const dpr = window.devicePixelRatio || 1;
    if (c.width !== Math.round(W * dpr)) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); }
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, c.width, c.height); ctx.scale(dpr, dpr);
    const m = App.model; const R = MAT_R;
    if (!m) { ctx.fillStyle = '#889'; ctx.font = '14px system-ui'; ctx.fillText('Vue 3D de contrôle — chargez un STEP', 20, 30); return; }
    const P = (p) => { const q = proj(p); return [q[0] / dpr, q[1] / dpr]; };
    // axes
    const B = basis(); const o = [14 * dpr, (H - 14) * dpr];
    ctx.lineWidth = 1; ctx.font = '10px system-ui';
    [['X', [1, 0, 0], '#c33'], ['Y', [0, 1, 0], '#3a3'], ['Z', [0, 0, 1], '#33c']].forEach(([l, d, col]) => { const a = proj(center), b = proj(V.add(center, V.mul(d, 30 / scale))); ctx.strokeStyle = col; ctx.beginPath(); ctx.moveTo(30, H - 30); ctx.lineTo(30 + (b[0] - a[0]) / dpr, H - 30 + (b[1] - a[1]) / dpr); ctx.stroke(); ctx.fillStyle = col; ctx.fillText(l, 32 + (b[0] - a[0]) / dpr, H - 30 + (b[1] - a[1]) / dpr); });
    for (const pr of prims) {
      if (pr.node) continue; const c2 = pr.c; const sel = App.sel === c2.id; const st = R && R.status[c2.id]; const bad = App.showTodo && st && st.B;
      const col = COL[c2.kind] || '#555';
      if (pr.box) { const S = pr.box.map(P); ctx.strokeStyle = sel ? '#f1c40f' : col; ctx.lineWidth = sel ? 3 : 1.5; ctx.setLineDash(c2.unknown ? [4, 3] : []); ctx.beginPath(); [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]].forEach(([a, b]) => { ctx.moveTo(...S[a]); ctx.lineTo(...S[b]); }); ctx.stroke(); ctx.setLineDash([]); const cc = P(V.mul(V.add(pr.box[0], pr.box[6]), 0.5)); ctx.fillStyle = col; ctx.font = 'bold 11px system-ui'; ctx.fillText(c2.id + ' ' + (App.eqType[c2.id] || c2.eqType), cc[0] + 4, cc[1]); continue; }
      const S = pr.pts.map(P);
      if (S.length === 1) { const [x, y] = S[0]; ctx.fillStyle = sel ? '#f1c40f' : col; ctx.beginPath(); ctx.moveTo(x, y - 6); ctx.lineTo(x + 6, y); ctx.lineTo(x, y + 6); ctx.lineTo(x - 6, y); ctx.closePath(); ctx.fill(); if (bad) { ctx.strokeStyle = '#e74c3c'; ctx.lineWidth = 2; ctx.stroke(); } }
      else {
        const w = c2.Di ? Math.max(2, Math.min(9, c2.Di * scale / dpr * 0.25)) : 2.5;
        if (bad) { ctx.strokeStyle = 'rgba(231,76,60,.35)'; ctx.lineWidth = w + 7; ctx.beginPath(); S.forEach((p, i) => i ? ctx.lineTo(...p) : ctx.moveTo(...p)); ctx.stroke(); }
        ctx.strokeStyle = sel ? '#f1c40f' : col; ctx.lineWidth = sel ? w + 2 : w; ctx.lineCap = 'round'; ctx.setLineDash(c2.odOnly ? [6, 4] : []);
        ctx.beginPath(); S.forEach((p, i) => i ? ctx.lineTo(...p) : ctx.moveTo(...p)); ctx.stroke(); ctx.setLineDash([]);
      }
      if (App.showLabels) { const mid = S[Math.floor(S.length / 2)]; const mid2 = S.length > 1 ? [(S[0][0] + S[S.length - 1][0]) / 2, (S[0][1] + S[S.length - 1][1]) / 2] : mid; const q = c2.kind === 'BEND' ? mid : mid2; ctx.fillStyle = '#334'; ctx.font = '10px system-ui'; ctx.fillText(c2.id, q[0] + 5, q[1] - 5); }
    }
    for (const pr of prims) {
      if (!pr.node) continue; const n = pr.node; const [x, y] = P(n.p); const sel = App.sel === n.id;
      if (n.deg === 1) { const b = App.bc[n.id]; ctx.fillStyle = b && b.type ? '#27ae60' : '#fff'; ctx.strokeStyle = '#e74c3c'; ctx.lineWidth = 2; ctx.fillRect(x - 5, y - 5, 10, 10); ctx.strokeRect(x - 5, y - 5, 10, 10); }
      else { ctx.fillStyle = sel ? '#f1c40f' : '#222'; ctx.beginPath(); ctx.arc(x, y, sel ? 4 : 2.3, 0, 7); ctx.fill(); }
      if (App.showLabels && !n.split) { ctx.fillStyle = '#666'; ctx.font = '9px system-ui'; ctx.fillText(n.id, x + 5, y + 11); }
    }
  }
  function pick(mx, my) {
    let best = null; const dpr = window.devicePixelRatio || 1; const P = (p) => { const q = proj(p); return [q[0] / dpr, q[1] / dpr]; };
    const segD = (p, a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1]; const l = dx * dx + dy * dy; let t = l ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l : 0; t = Math.max(0, Math.min(1, t)); return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy); };
    for (const pr of prims) {
      let d = Infinity, id;
      if (pr.node) { const s = P(pr.node.p); d = Math.hypot(s[0] - mx, s[1] - my) - 2; id = pr.node.id; }
      else if (pr.box) { const S = pr.box.map(P); [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]].forEach(([a, b]) => d = Math.min(d, segD([mx, my], S[a], S[b]))); id = pr.c.id; }
      else { const S = pr.pts.map(P); if (S.length === 1) d = Math.hypot(S[0][0] - mx, S[0][1] - my) - 3; else for (let i = 0; i + 1 < S.length; i++) d = Math.min(d, segD([mx, my], S[i], S[i + 1])); id = pr.c.id; }
      if (d < 8 && (!best || d < best.d)) best = { d, id };
    }
    return best && best.id;
  }
  function init() {
    const c = cv(); let drag = null;
    c.addEventListener('mousedown', e => { drag = { x: e.clientX, y: e.clientY, b: e.button, shift: e.shiftKey, moved: false }; });
    window.addEventListener('mouseup', e => { if (drag && !drag.moved) { const r = c.getBoundingClientRect(); const id = pick(e.clientX - r.left, e.clientY - r.top); if (id) select(id); } drag = null; });
    window.addEventListener('mousemove', e => { if (!drag) return; const dx = e.clientX - drag.x, dy = e.clientY - drag.y; if (Math.abs(dx) + Math.abs(dy) > 2) drag.moved = true; drag.x = e.clientX; drag.y = e.clientY; const dpr = window.devicePixelRatio || 1; if (drag.b === 2 || drag.shift) { pan[0] += dx * dpr; pan[1] += dy * dpr; } else { yaw += dx * 0.01; pitch = Math.max(-1.55, Math.min(1.55, pitch + dy * 0.01)); } draw(); });
    c.addEventListener('contextmenu', e => e.preventDefault());
    c.addEventListener('wheel', e => { e.preventDefault(); const f = Math.exp(-e.deltaY * 0.0015); const r = c.getBoundingClientRect(); const dpr = window.devicePixelRatio || 1; const mx = (e.clientX - r.left) * dpr - c.width / 2 - pan[0], my = (e.clientY - r.top) * dpr - c.height / 2 - pan[1]; pan[0] -= mx * (f - 1); pan[1] -= my * (f - 1); scale *= f; draw(); }, { passive: false });
    window.addEventListener('resize', () => draw());
  }
  const views = { iso: [-0.6, 0.45], top: [0, 1.5707], front: [0, 0], side: [Math.PI / 2, 0] };
  return { fit: () => { fit(); draw(); }, draw: () => { geom(); draw(); }, init, setView: (k) => { [yaw, pitch] = views[k]; draw(); } };
})();

/* ---------- Export Excel ---------- */
function exportXlsx() {
  const m = App.model, R = materialize(); if (!m) return;
  const hdr = (arr) => arr.map(x => ({ v: x, s: 'hdr' }));
  const V2 = (x) => x ? { v: x.v == null ? (x.o === 'NA' ? '' : 'À COMPLÉTER') : x.v, s: x.o } : '';
  const O2 = (x) => x ? { v: origText(x), s: x.o === 'TODO' ? 'TODO' : 'txt' } : '';
  const pairs = (cols) => { const h = []; for (const [, label] of cols) h.push(label, 'Origine'); return h; };
  const vals = (v, cols) => { const r = []; for (const [k] of cols) { r.push(V2(v[k]), O2(v[k])); } return r; };
  const widths = (base, cols) => base.concat(...cols.map(() => [14, 34]));
  const sheets = [];
  const an = Object.entries(ANALYSES).filter(([k]) => App.F.an[k]).map(([, l]) => l).join(' ; ') || 'aucune';
  const lists = { mat: "'Listes'!$A$2:$A$" + (MATERIALS.length + 1), anc: "'Listes'!$B$2:$B$4", bc: "'Listes'!$C$2:$C$5", eq: "'Listes'!$D$2:$D$" + (EQ_TYPES.length + 1), cfg: "'Listes'!$E$2:$E$4" };
  // 1. Synthèse
  const cnt = [['Tubes (Pipe)', R.pipes.length], ['Coudes (Bend)', R.bends.length], ['Tés et jonctions (Tee/Junction)', R.tees.length], ['Variations de section', R.reds.length], ['Équipements', R.eqs.length], ['Nœuds', m.nodes.length], ['Extrémités libres', m.topo.free], ['Boucles indépendantes', m.topo.loops], ['Sous-réseaux', m.topo.subs]];
  const syn = [[{ v: 'Dossier de données d\'entrée Simcenter Flowmaster', s: 'title' }], [{ v: 'Généré depuis la maquette STEP — ceci n\'est pas un fichier réseau natif Flowmaster : les valeurs sont à saisir ou à importer par script.', s: 'sub' }], [],
    ['Fichier source', App.fileName], ['Schéma STEP', m.header.schema], ['Système d\'origine', m.header.system || '—'], ['Date de génération', new Date().toLocaleString('fr-FR')], ['Unité de longueur CAO', m.unit + (App.S.unitOverride !== 'auto' ? ' — FORCÉE : ' + App.S.unitOverride : '')], ['Unité d\'angle CAO', m.angUnit], ['Axe vertical', App.S.vertical], ['Tolérance de raccordement (mm)', +App.S.tol], ['Type(s) d\'analyse', an], ['Fluide', FLUIDS[App.F.fluid].name + ' à ' + App.F.T + ' °C, ' + App.F.P + ' bar abs'], ['Longueur développée totale (m)', rnd(R.tot.L / 1000, 4)], ['Volume interne (L)', rnd(R.tot.Vol / 1e6, 4)],
    ['Taux de complétude (paramètres bloquants renseignés)', { v: Math.round(R.compl * 1000) / 10 + ' %  (' + R.ok + ' / ' + R.req + ')', s: R.compl < 1 ? 'TODO' : 'STEP' }], [],
    [{ v: 'Nombre de composants', s: 'sub' }], ...cnt.map(([a, b]) => [a, b]), [],
    [{ v: 'Code couleur', s: 'sub' }], [{ v: 'Extrait STEP', s: 'STEP' }, 'valeur lue sur une surface analytique ; l\'entité #n est indiquée dans la colonne Origine'], [{ v: 'Calculé', s: 'CALC' }, 'déduit par calcul de valeurs extraites ou saisies'], [{ v: 'Par défaut', s: 'DEF' }, 'valeur proposée avec sa source, à confirmer'], [{ v: 'Saisi utilisateur', s: 'USER' }, 'renseigné dans l\'outil'], [{ v: 'À COMPLÉTER', s: 'TODO' }, 'manquant et requis par une analyse cochée'], [{ v: 'Non requis', s: 'NA' }, 'non nécessaire pour les analyses cochées'], [],
    [{ v: 'Conventions', s: 'sub' }], ['Longueurs des tubes', 'mesurées jusqu\'au point d\'intersection des axes aux tés et coudes à onglet (composants de longueur nulle)'], ['Amont / aval', 'sens de parcours de la numérotation (depuis l\'extrémité libre de coordonnées minimales) — à confirmer avec le sens réel d\'écoulement'], ['Coudes', 'la longueur développée R·θ n\'est pas incluse dans les tubes adjacents : selon le composant Flowmaster utilisé, l\'ajouter aux tubes voisins en transitoire / thermique'], ['Nœuds coïncidents', 'les bras des tés, onglets et variations brusques ont des nœuds distincts aux mêmes coordonnées'], [],
    [{ v: 'Alertes (' + m.alerts.length + ')', s: 'sub' }], ...m.alerts.map(a => [{ v: { err: 'Bloquant', warn: 'Attention', info: 'Info' }[a.lvl], s: a.lvl === 'err' ? 'TODO' : a.lvl === 'warn' ? 'DEF' : 'txt' }, a.msg])];
  sheets.push({ name: 'Synthèse', cols: [46, 120], rows: syn });
  // 2. Nœuds
  const nr = [hdr(['ID', 'X (mm)', 'Y (mm)', 'Z (mm)', 'Altitude (m) (Elevation)', 'Origine', 'Type', 'Composants raccordés', 'Condition aux limites', 'Valeur', 'Unité', 'Sous-réseau'])];
  for (const r of R.nodes) nr.push([r.n.id, { v: rnd(r.n.p[0], 4), s: 'STEP' }, { v: rnd(r.n.p[1], 4), s: 'STEP' }, { v: rnd(r.n.p[2], 4), s: 'STEP' }, V2(r.alt), { v: 'Coordonnées : extrait STEP (coïncidence des extrémités d\'axe) ; altitude calculée', s: 'txt' }, r.type, r.comps, r.bct ? V2(r.bct) : '', r.bcv ? V2(r.bcv) : '', r.bcu || '', r.n.sub]);
  sheets.push({ name: 'Nœuds', cols: [9, 12, 12, 12, 13, 40, 30, 26, 24, 12, 9, 10], rows: nr, freeze: 1, header: 1, filter: true, lists: [{ col: 8, from: 2, to: nr.length, ref: lists.bc }] });
  // 3. Tubes
  const PC = [['Di', 'Diamètre intérieur Di (mm) (Diameter)'], ['De', 'Diamètre extérieur De (mm)'], ['e', 'Épaisseur e (mm) (Wall thickness)'], ['L', 'Longueur (m) (Length)'], ['dz', 'Dénivelé aval − amont (m)'], ['A', 'Section (mm²) (Area)'], ['vol', 'Volume interne (L)'], ['mat', 'Matériau (Material)'], ['eps', 'Rugosité absolue (mm) (Absolute roughness)'], ['epsRel', 'Rugosité relative ε/Di (–)'], ['E', "Module d'Young (GPa) (Young's modulus)"], ['nu', "Coefficient de Poisson (–) (Poisson's ratio)"], ['anchor', 'Ancrage (Pipe constraint)'], ['insE', "Épaisseur d'isolant (mm) (Insulation)"], ['insL', 'Conductivité isolant (W/(m·K))']];
  const pr = [hdr(['ID', 'Nœud amont', 'Nœud aval', 'Corps CAO', ...pairs(PC), 'Statut'])];
  for (const it of R.pipes) pr.push([it.c.id, it.c.nodes[0], it.c.nodes[1], it.c.bodyName, ...vals(it.v, PC), statusText(R, it.c.id)]);
  if (pr.length === 1) pr.push([{ v: 'Aucun tube reconnu.', s: 'NA' }]);
  sheets.push({ name: 'Tubes', cols: widths([8, 10, 10, 24], PC).concat([24]), rows: pr, freeze: 1, header: 1, filter: true, lists: [{ col: 4 + 2 * 7, from: 2, to: pr.length, ref: lists.mat }, { col: 4 + 2 * 12, from: 2, to: pr.length, ref: lists.anc }] });
  // 4. Coudes
  const BC = [['type', 'Type'], ['Di', 'Diamètre intérieur Di (mm) (Diameter)'], ['De', 'Diamètre extérieur De (mm)'], ['R', 'Rayon de cintrage R (mm) (Bend radius)'], ['RD', 'R/D (–) (Radius ratio)'], ['theta', 'Angle (°) (Bend angle)'], ['Ldev', 'Longueur développée (m)'], ['mat', 'Matériau'], ['eps', 'Rugosité (mm) (Roughness)'], ['corr', 'Corrélation suggérée'], ['K', 'K indicatif (–)'], ['Le', 'Longueur équivalente indicative (m)']];
  const br = [hdr(['ID', 'Nœud amont', 'Nœud aval', 'Corps CAO', ...pairs(BC), 'Statut'])];
  for (const it of R.bends) br.push([it.c.id, it.c.nodes[0], it.c.nodes[1], it.c.bodyName || '', ...vals(it.v, BC), statusText(R, it.c.id)]);
  if (br.length === 1) br.push([{ v: 'Aucun coude reconnu dans la maquette.', s: 'NA' }]);
  sheets.push({ name: 'Coudes', cols: widths([8, 10, 10, 24], BC).concat([24]), rows: br, freeze: 1, header: 1, filter: true, lists: [{ col: 4 + 2 * 7, from: 2, to: br.length, ref: lists.mat }] });
  // 5. Tés
  const TC = [['D1', 'Di principal 1 (mm)'], ['D2', 'Di principal 2 (mm)'], ['D3', 'Di dérivé (mm)'], ['r31', 'A dérivé / A principal 1 (–) (Area ratio)'], ['r21', 'A principal 2 / A principal 1 (–)'], ['ang', 'Angle du piquage (°) (Branch angle)'], ['rj', 'Rayon de raccordement r/D (–)'], ['cfg', 'Configuration (convergent / divergent)'], ['corr', 'Corrélation suggérée'], ['Krun', 'K passage direct indicatif (–)'], ['Kbr', 'K dérivation indicatif (–)']];
  const tr = [hdr(['ID', 'Nœud principal 1', 'Nœud principal 2', 'Nœud dérivé', ...pairs(TC), 'Statut'])];
  for (const it of R.tees) tr.push([it.c.id, it.v.n1, it.v.n2, it.v.n3, ...vals(it.v, TC), statusText(R, it.c.id)]);
  if (tr.length === 1) tr.push([{ v: 'Aucun té ni jonction reconnu.', s: 'NA' }]);
  sheets.push({ name: 'Tés et jonctions', cols: widths([8, 11, 11, 11], TC).concat([24]), rows: tr, freeze: 1, header: 1, filter: true, lists: [{ col: 4 + 2 * 7, from: 2, to: tr.length, ref: lists.cfg }] });
  // 6. Variations de section
  const RC = [['type', 'Type (brusque / progressive)'], ['sens', 'Sens'], ['D1', 'D1 amont (mm) (Inlet diameter)'], ['D2', 'D2 aval (mm) (Outlet diameter)'], ['ratio', 'Rapport de sections A2/A1 (–)'], ['beta', 'β = D petit / D grand (–)'], ['cone', 'Angle de cône total (°) (Cone angle)'], ['L', 'Longueur (mm) (Length)'], ['K', 'K indicatif (–)']];
  const rr = [hdr(['ID', 'Nœud amont', 'Nœud aval', 'Corps CAO', ...pairs(RC), 'Statut'])];
  for (const it of R.reds) rr.push([it.c.id, it.c.nodes[0], it.c.nodes[1], it.c.bodyName || '', ...vals(it.v, RC), statusText(R, it.c.id)]);
  if (rr.length === 1) rr.push([{ v: 'Aucune variation de section reconnue.', s: 'NA' }]);
  sheets.push({ name: 'Variations de section', cols: widths([8, 10, 10, 24], RC).concat([24]), rows: rr, freeze: 1, header: 1, filter: true });
  // 7. Équipements (format long : une ligne par paramètre)
  const er = [hdr(['ID', 'Nom CAO', 'Type identifié', 'Origine du type', 'Nœuds', 'Paramètre', 'Nom Flowmaster', 'Unité', 'Valeur', 'Origine', 'Criticité'])];
  for (const it of R.eqs) {
    const c = it.c, v = it.v; const base = [c.id, c.bodyName, V2(v.type), O2(v.type), c.nodes.join(' → ') || 'non raccordé'];
    v.ports.forEach((p, i) => er.push([...base, 'DN raccord ' + (i + 1) + ' (' + c.ports[i].node + ')', 'Inlet/outlet diameter', 'mm', V2(p), O2(p), '']));
    if (v.suggest) er.push([...base, 'Sens', '—', '—', V2(v.suggest), O2(v.suggest), '']);
    if (v.zb) er.push([...base, 'Altitude du fond', 'Base elevation', 'm', V2(v.zb), O2(v.zb), '']);
    for (const p of v.params) er.push([...base, p.label, p.fm, p.unit, V2(p), O2(p), p.crit === 'B' ? 'Bloquant' : p.crit === 'P' ? 'Améliore la précision' : '']);
  }
  if (er.length === 1) er.push([{ v: 'Aucun équipement identifié (vérifier les mots-clés ou le classement des corps).', s: 'NA' }]);
  sheets.push({ name: 'Équipements', cols: [8, 26, 20, 34, 16, 40, 24, 12, 26, 40, 20], rows: er, freeze: 1, header: 1, filter: true, lists: [{ col: 2, from: 2, to: er.length, ref: lists.eq }] });
  // 8. Fluide
  const fr = [hdr(['Paramètre', 'Valeur', 'Origine'])];
  for (const k in R.fluid) fr.push([R.fluid[k].label, V2(R.fluid[k]), O2(R.fluid[k])]);
  fr.push([], [{ v: 'Dépendance à la température — ' + FLUIDS[App.F.fluid].name, s: 'sub' }]);
  if (App.F.fluid !== 'manual') {
    const fl = FLUIDS[App.F.fluid]; const [t0, t1] = fl.range; const step = (t1 - t0) <= 100 ? 10 : 20;
    fr.push(hdr(['T (°C)', 'ρ (kg/m³)', 'μ (Pa·s)', 'Cp (J/(kg·K))', 'λ (W/(m·K))', 'K (GPa)', 'Pv (kPa)']));
    for (let T = t0; T <= t1 + 1e-9; T += step) { const p = fl.f(T, +App.F.P || 1); fr.push([T, ...['rho', 'mu', 'cp', 'lam', 'K', 'pv'].map(k => p[k] == null ? { v: 'non fourni', s: 'NA' } : { v: rnd(p[k], k === 'mu' ? 8 : 4), s: 'DEF' })]); }
    fr.push(['Source', { v: fl.f(t0, 1).src, s: 'txt' }]);
  } else fr.push(['Propriétés saisies manuellement : renseigner la dépendance en température dans Flowmaster si nécessaire.']);
  sheets.push({ name: 'Fluide', cols: [52, 16, 60, 14, 14, 12, 12], rows: fr, freeze: 1, header: 1 });
  // 9. Conditions aux limites et scénarios
  const cr = [hdr(['Nœud', 'Altitude (m)', 'Composant raccordé', 'Type de condition (Boundary)', 'Origine', 'Valeur', 'Unité', 'Origine', "Température d'entrée (°C)", 'Origine'])];
  for (const r of R.free) cr.push([r.n.id, rnd(r.alt.v, 5), r.comps, V2(r.bct), O2(r.bct), V2(r.bcv), r.bcu, O2(r.bcv), V2(r.Tin), O2(r.Tin)]);
  const cfrom = 2, cto = cr.length;
  cr.push([], [{ v: 'Scénario / simulation', s: 'sub' }], hdr(['Paramètre', 'Valeur', 'Origine']));
  cr.push(['Type(s) d\'analyse', an, 'Saisi utilisateur']);
  if (App.F.an.T) { cr.push(['Pas de temps (s) (Time step)', V2(R.sim.dt), O2(R.sim.dt)]); if (R.dtSuggest) cr.push(['Suggestion : Δt ≤ min(L/a) (s)', { v: rnd(R.dtSuggest, 6), s: 'CALC' }, 'Calculé – vitesse d\'onde par tube, voir onglet Contrôle']); cr.push(['Durée simulée (s) (Simulation time)', V2(R.sim.dur), O2(R.sim.dur)], ['Événements / lois temporelles', V2(R.sim.events), O2(R.sim.events)], ['Ancrage des tubes (global)', V2(R.sim.anchor), O2(R.sim.anchor)]); }
  else cr.push(['Transitoire', { v: 'non coché', s: 'NA' }, '']);
  cr.push(['Débit nominal de contrôle (m³/h)', V2(R.sim.Q), O2(R.sim.Q)]);
  sheets.push({ name: 'CL et scénarios', cols: [30, 16, 22, 26, 30, 14, 10, 30, 16, 30], rows: cr, freeze: 1, header: 1, lists: [{ col: 3, from: cfrom, to: cto, ref: lists.bc }] });
  // 10. Thermique (si coché)
  if (App.F.an.Th) {
    const HC = [['kw', 'Conductivité paroi (W/(m·K))'], ['e', 'Épaisseur paroi (mm)'], ['insE', "Épaisseur d'isolant (mm)"], ['insL', 'Conductivité isolant (W/(m·K))'], ['h', "Coef. d'échange externe (W/(m²·K)) (External HTC)"], ['Tamb', 'Température ambiante (°C)'], ['heat', 'Source de chaleur (W)']];
    const hr = [hdr(['ID', 'Type', 'Nœud amont', 'Nœud aval', ...pairs(HC)])];
    for (const it of [...R.pipes, ...R.bends]) hr.push([it.c.id, TYPE_LABEL[it.c.kind], it.c.nodes[0], it.c.nodes[1], ...vals(it.v, HC)]);
    sheets.push({ name: 'Thermique', cols: widths([8, 10, 10, 10], HC), rows: hr, freeze: 1, header: 1, filter: true });
  }
  // 11. À compléter
  const tr2 = [hdr(['Criticité', 'Onglet', 'ID', 'Paramètre', 'Remarque'])];
  for (const t of R.todo) tr2.push([{ v: t.crit === 'B' ? 'Bloquant pour le calcul' : 'Améliore la précision', s: t.crit === 'B' ? 'TODO' : 'DEF' }, t.sheet, t.id, t.label, t.note || '']);
  if (!R.todo.length) tr2.push(['Aucune donnée manquante pour les analyses cochées.']);
  sheets.push({ name: 'À compléter', cols: [24, 24, 9, 42, 60], rows: tr2, freeze: 1, header: 1, filter: true });
  // 12. Contrôle de vraisemblance
  const hasQ = R.ctrl.some(x => x.vel != null), hasA = R.ctrl.some(x => x.a != null);
  if (hasQ || hasA) {
    const kr = [[{ v: 'CONTRÔLE DE VRAISEMBLANCE — estimation de premier niveau (Colebrook + K Crane TP-410), ce n\'est PAS un résultat Flowmaster', s: 'sub' }], hdr(['ID', 'Type', 'Débit (m³/h)', 'D réf. (mm)', 'Vitesse (m/s)', 'Re (–)', 'ε/D (–)', 'f Darcy (–)', 'K (–)', 'ΔP frottement (kPa)', 'ΔP singulière (kPa)', 'ΔP totale (kPa)', 'ρ·g·Δz (kPa)', "Vitesse d'onde a (m/s)", 'L/a (s)', 'Remarque'])];
    let tot = 0;
    for (const x of R.ctrl) { if (x.vel == null && x.a == null) continue; if (x.dp) tot += x.dp; const C = (v, n) => v == null ? '' : { v: rnd(v, n), s: 'CALC' }; kr.push([x.c.id, TYPE_LABEL[x.c.kind] + (x.c.sub2 ? ' ' + x.c.sub2 : ''), x.Q, rnd(x.D, 3), C(x.vel, 3), C(x.Re, 0), C(x.rel, 7), C(x.f, 5), C(x.K, 4), C(x.dpf != null ? x.dpf / 1000 : null, 4), C(x.dps != null ? x.dps / 1000 : null, 4), C(x.dp != null ? x.dp / 1000 : null, 4), C(x.dzst != null ? x.dzst / 1000 : null, 4), C(x.a, 1), C(x.tL, 6), [x.note, x.aNote].filter(Boolean).join(' ; ')]); }
    if (hasQ) kr.push([], ['Somme des ΔP (kPa, composants en série supposés)', '', '', '', '', '', '', '', '', '', '', { v: rnd(tot / 1000, 3), s: 'CALC' }]);
    sheets.push({ name: 'Contrôle', cols: [10, 18, 11, 11, 11, 11, 11, 11, 9, 13, 13, 13, 12, 13, 11, 44], rows: kr, freeze: 2, header: 2, filter: false });
  }
  // 13. Corps CAO (traçabilité) + Référentiel + Listes
  const cb = [hdr(['Corps (produit)', 'Chemin d\'assemblage', 'Entité solide', 'Type', 'Faces par type', 'Primitives reconnues', 'Classement', 'Remarques'])];
  for (const b of m.bodies) cb.push([b.name || '(sans nom)', b.path, '#' + b.brep, b.solid ? 'Solide' : 'Surfacique', Object.entries(b.counts).map(([k, n]) => k + ' ' + n).join(' · '), b.nPrims, b.cls + (b.kw ? ' (mot-clé « ' + b.kw + ' »)' : ''), (b.notes || []).join(' ; ')]);
  sheets.push({ name: 'Corps CAO', cols: [28, 40, 10, 11, 34, 11, 28, 60], rows: cb, freeze: 1, header: 1, filter: true });
  const rf = [hdr(['Composant', 'Paramètre', 'Nom Flowmaster', 'Unité', 'Permanent', 'Transitoire', 'Thermique', 'Compressible', 'Origine possible', 'Méthode / source'])];
  for (const r of REF) rf.push(r.map((x, i) => i >= 4 && i <= 7 ? { v: x, s: x === 'B' ? 'TODO' : x === 'P' ? 'DEF' : '' } : x));
  rf.push([], ['B = bloquant, P = améliore la précision ; a = extrait STEP, b = calculé, c = défaut sourcé, d = saisie utilisateur']);
  sheets.push({ name: 'Référentiel', cols: [20, 38, 26, 14, 11, 11, 11, 12, 18, 70], rows: rf, freeze: 1, header: 1, filter: true });
  const L = [hdr(['Matériaux', 'Ancrage', 'Conditions aux limites', "Types d'équipement", 'Configuration té'])];
  const nL = Math.max(MATERIALS.length, EQ_TYPES.length); const bcs = Object.keys(BC_UNITS); const cf = ['Convergent', 'Divergent', 'Variable (selon le solveur)'];
  for (let i = 0; i < nL; i++) L.push([MATERIALS[i] ? MATERIALS[i][0] : '', ANCHORS[i] || '', bcs[i] || '', EQ_TYPES[i] || '', cf[i] || '']);
  sheets.push({ name: 'Listes', cols: [34, 30, 26, 24, 24], rows: L, freeze: 1, header: 1 });
  const blob = buildXlsx(sheets);
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = App.fileName.replace(/\.(stp|step|p21)$/i, '') + '_donnees_Flowmaster.xlsx';
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  setStatus('Excel généré : ' + a.download + ' (' + sheets.length + ' onglets).', 'ok');
  return blob;
}

const HELP_HTML = `<h3>Mode d'emploi</h3><ol class="help">
<li>Ouvrez un fichier STEP (AP203/AP214/AP242) : bouton « Ouvrir un STEP » ou glisser-déposer. Rien n'est envoyé sur un réseau.</li>
<li>Contrôlez la synthèse et les alertes (onglet Réglages) ; réglez axe vertical, tolérance et unité si besoin.</li>
<li>Vérifiez la vue 3D : bleu tube, orange coude, vert réduction, violet té, rouge équipement ; halo rouge = données bloquantes manquantes ; carré = extrémité libre.</li>
<li>Corrigez le classement des corps (onglet Corps CAO) puis « Relancer l'analyse » si un équipement est mal reconnu.</li>
<li>Cochez le ou les types d'analyse et renseignez fluide, matériau, données transitoires/thermiques (onglet Données de calcul).</li>
<li>Saisissez les conditions aux limites des extrémités libres (onglet Nœuds & CL).</li>
<li>Saisissez les caractéristiques des équipements à partir des fiches constructeur (onglet Équipements).</li>
<li>Cliquez un composant pour corriger ses valeurs (Di, matériau, rugosité…) : l'origine passe à « saisi ».</li>
<li>Exportez l'Excel ; l'onglet « À compléter » liste ce qui reste à fournir, trié par criticité.</li>
<li>Saisissez ou importez par script les données dans Flowmaster ; le contrôle de vraisemblance n'est pas un résultat Flowmaster.</li></ol>
<h3>Limites connues</h3><ul class="help">
<li>Géométrie maillée (tessellée, B-rep à facettes) et surfaces B-spline : aucune cote n'en est extraite — signalé, jamais masqué. Les flexibles et cintrages libres en B-spline ne sont pas reconnus.</li>
<li>Tés reconnus par intersection d'axes de cylindres ; le congé de raccordement (r/D) n'est pas extrait. Les jonctions à 4 branches et plus sont signalées sans modèle.</li>
<li>Coudes : surfaces toriques uniquement ; les coudes « segmentés » en plusieurs onglets sont vus comme une suite d'onglets.</li>
<li>Réductions excentrées : reconnues comme concentriques si le cône est de révolution, sinon non reconnues.</li>
<li>Équipements : rattachés aux extrémités libres situées dans leur boîte englobante ; leur sens (aspiration/refoulement) est à confirmer.</li>
<li>Brides : comptées comme tubes courts (épaisseur = diamètre de bride) ; trous de boulons écartés automatiquement.</li>
<li>Amont/aval suivent la numérotation, pas le sens réel d'écoulement.</li>
<li>Pas de lecture des transformations d'échelle, ni des pièces miroir en assemblage hors transformations rigides.</li>
<li>Propriétés de fluides et matériaux : valeurs usuelles sourcées, à confirmer selon la nuance et la fiche produit ; module de compressibilité et pression de vapeur non fournis pour les eaux glycolées.</li>
<li>Compressible : traité comme extension (propriétés gaz seulement) ; pas de fichier réseau natif Flowmaster produit (format non public).</li></ul>`;

/* ---------- Démarrage ---------- */
function init() {
  $$('.tab').forEach(t => t.onclick = () => { $$('.tab').forEach(x => x.classList.toggle('on', x === t)); renderTab(); });
  $('#file').onchange = (e) => { if (e.target.files[0]) loadFile(e.target.files[0]); };
  $('#btnOpen').onclick = () => $('#file').click();
  $('#btnExport').onclick = exportXlsx;
  document.addEventListener('dragover', e => { e.preventDefault(); document.body.classList.add('drag'); });
  document.addEventListener('dragleave', e => { if (e.target === document.documentElement || e.clientX <= 0) document.body.classList.remove('drag'); });
  document.addEventListener('drop', e => { e.preventDefault(); document.body.classList.remove('drag'); const f = e.dataTransfer.files[0]; if (f) loadFile(f); });
  $('#chkLbl').onchange = (e) => { App.showLabels = e.target.checked; viewer.draw(); };
  $('#chkTodo').onchange = (e) => { App.showTodo = e.target.checked; viewer.draw(); };
  $$('[data-view]').forEach(b => b.onclick = () => viewer.setView(b.dataset.view));
  $('#btnFit').onclick = () => viewer.fit();
  viewer.init(); renderTab(); renderInspector(); viewer.draw();
}
window.addEventListener('DOMContentLoaded', init);
