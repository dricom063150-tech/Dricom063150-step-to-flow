// Tests du moteur d'analyse STEP → réseau (Node ≥ 18, sans dépendance) : node --test tests/
// Compare les cotes extraites aux cotes connues des STEP de référence (écart cible < 0,1 %).
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parseStep, analyze } = require('../src/core.js');

const FIX = path.join(__dirname, 'fixtures');
const S = {
  tol: 0.1, singleAs: 'OD', vertical: 'Z+', unitOverride: 'auto', bodyOverrides: {},
  keywords: [['Pompe', ['POMPE', 'PUMP']], ['Vanne', ['VANNE', 'VALVE']], ['Réservoir', ['RESERVOIR', 'TANK']], ['Ignorer', ['BOLT', 'COLLIER']]]
};
const run = (f, s = S) => analyze(parseStep(fs.readFileSync(path.join(FIX, f), 'utf8')), s);
const near = (got, exp, msg) => assert.ok(Math.abs(got - exp) <= Math.max(1e-6, Math.abs(exp) * 1e-3), `${msg} : obtenu ${got}, attendu ${exp}`);
const of = (m, kind, sub) => m.comps.filter(c => c.kind === kind && (!sub || c.sub2 === sub));

test('réf. 1 — tube droit', () => {
  const m = run('ref1_tube_droit.stp');
  const p = of(m, 'PIPE');
  assert.equal(p.length, 1);
  near(p[0].Di, 52.48, 'Di'); near(p[0].De, 60.3, 'De'); near(p[0].L, 1000, 'L');
  assert.match(p[0].diSrc, /^#\d+ \(CYLINDRICAL_SURFACE\)$/);
  assert.deepEqual([m.topo.nodes, m.topo.free, m.topo.subs, m.topo.loops], [2, 2, 1, 0]);
  assert.match(m.unit, /MILLI METRE/);
});

test('réf. 2 — coudes 90°/45°, réduction, té (fichier en mètres)', () => {
  const m = run('ref2_circuit_coudes_te.stp');
  assert.match(m.unit, /^METRE/);
  const b = of(m, 'BEND', 'cintré').sort((x, y) => y.theta - x.theta);
  assert.equal(b.length, 2);
  near(b[0].theta, 90, 'angle coude 1'); near(b[1].theta, 45, 'angle coude 2');
  for (const x of b) { near(x.R, 78.72, 'R'); near(x.Di, 52.48, 'Di coude'); }
  const r = of(m, 'RED', 'progressive');
  assert.equal(r.length, 1);
  const [d1, d2] = [Math.max(r[0].D1, r[0].D2), Math.min(r[0].D1, r[0].D2)];
  near(d1, 52.48, 'D1'); near(d2, 26.64, 'D2'); near(r[0].L, 76, 'L réduction');
  near(r[0].angle, 2 * Math.atan(((52.48 - 26.64) / 2) / 76) * 180 / Math.PI, 'angle de cône');
  const t = of(m, 'TEE');
  assert.equal(t.length, 1);
  near(t[0].angle, 90, 'angle té');
  for (const a of t[0].arms) near(a.D, 26.64, 'Di bras du té');
  const L = of(m, 'PIPE').map(p => p.L).sort((x, y) => x - y);
  const exp = [38, 38, 38, 200, 250, 300, 300, 400, 500];
  assert.equal(L.length, exp.length);
  exp.forEach((e, i) => near(L[i], e, 'longueur tube ' + i));
  assert.deepEqual([m.topo.free, m.topo.subs, m.topo.loops], [3, 1, 0]);
});

test('réf. 3 — assemblage pompe + vanne, sous-ensemble transformé, instances multiples', () => {
  const m = run('ref3_assemblage_pompe_vanne.stp');
  const L = of(m, 'PIPE').map(p => [p.L, p.Di]).sort((x, y) => x[0] - y[0]);
  assert.equal(L.length, 3);
  near(L[0][0], 300, 'L tube 1'); near(L[1][0], 300, 'L tube 2'); near(L[2][0], 850, 'L aspiration');
  near(L[0][1], 52.5, 'Di DN50'); near(L[2][1], 68.9, 'Di DN65');
  const eq = of(m, 'EQ');
  const pompe = eq.find(e => e.eqType === 'Pompe'), vanne = eq.find(e => e.eqType === 'Vanne');
  assert.ok(pompe && vanne, 'pompe et vanne identifiées');
  assert.deepEqual(pompe.ports.map(p => +p.D.toFixed(3)).sort(), [52.5, 68.9]);
  assert.ok(pompe.ports.every(p => /CYLINDRICAL_SURFACE/.test(p.src)), 'DN pompe lus sur les alésages');
  vanne.ports.forEach(p => near(p.D, 52.5, 'DN vanne'));
  assert.deepEqual([m.topo.free, m.topo.subs], [2, 1]);
});

test('réf. 4 — cas avancés (monobloc, piquage, onglet, brusque, perçages, De seul, rotation)', () => {
  const m = run('ref4_cas_avances.stp');
  assert.equal(of(m, 'BEND', 'onglet').length, 1, 'un coude à onglet');
  near(of(m, 'BEND', 'onglet')[0].theta, 90, 'angle onglet');
  assert.equal(of(m, 'RED', 'brusque').length, 1, 'une variation brusque');
  const t = of(m, 'TEE'); assert.equal(t.length, 1, 'piquage reconnu comme té');
  near(t[0].angle, 90, 'angle piquage');
  assert.equal(of(m, 'BEND', 'cintré').length, 1, 'coude du tube monobloc');
  assert.equal(of(m, 'PIPE').filter(p => p.odOnly).length, 1, 'tube plein signalé De seul');
  const bride = m.bodies.find(b => b.name === 'BRIDE_DN100');
  assert.ok(bride.notes.some(n => /perçage/.test(n)), 'perçages de bride écartés');
  // sous-ensemble tourné de 30° autour de Z puis translaté de 2000 mm
  const rot = m.comps.find(c => c.bodyName === 'TUBE_TOURNE');
  const ends = [rot.a, rot.b].sort((x, y) => x[0] - y[0]);
  near(ends[1][0], 2000 + 500 * Math.cos(Math.PI / 6), 'X extrémité tournée');
  near(ends[1][1], 500 * Math.sin(Math.PI / 6), 'Y extrémité tournée');
  assert.ok(of(m, 'EQ').some(e => e.eqType === 'Réservoir' && e.ports.length === 1), 'réservoir raccordé');
});

test('réf. 5 — serpentin de 199 composants (charge, coudes à 180°)', () => {
  const t0 = Date.now(); const m = run('ref5_serpentin_199.stp');
  assert.equal(of(m, 'PIPE').length, 100); assert.equal(of(m, 'BEND').length, 99);
  of(m, 'BEND').forEach(b => near(b.theta, 180, 'angle coude 180'));
  assert.deepEqual([m.topo.comps, m.topo.free, m.topo.subs, m.topo.loops], [199, 2, 1, 0]);
  assert.ok(Date.now() - t0 < 10000, 'analyse en moins de 10 s');
});

test('fichier sain : aucune alerte bloquante', () => {
  const m = run('ref1_tube_droit.stp', Object.assign({}, S, { tol: 0.1 }));
  assert.ok(m.alerts.every(a => a.lvl !== 'err'), 'aucune alerte bloquante sur un fichier sain');
});

test('fichier non STEP refusé avec un message clair', () => {
  assert.throws(() => parseStep('pas un step'), /ISO-10303-21/);
});

test('unité forcée : la même maquette lue en pouces est 25,4 fois plus grande', () => {
  const m = run('ref1_tube_droit.stp', Object.assign({}, S, { unitOverride: 'in' }));
  near(of(m, 'PIPE')[0].L, 25400, 'L en pouces forcés');
});
