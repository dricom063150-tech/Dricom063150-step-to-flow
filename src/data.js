/* =====================================================================
   DONNÉES DE RÉFÉRENCE
   - REF : référentiel des données d'entrée Flowmaster (livrable 1)
     Besoin par analyse : B = bloquant, P = améliore la précision, '' = non utilisé
     Origine possible : a = extrait du STEP, b = calculé, c = défaut sourcé, d = saisie utilisateur
   - Matériaux, fluides, normes de tubes, coefficients K indicatifs (Crane TP-410)
   ===================================================================== */
const ANALYSES = { P: 'Permanent incompressible', T: 'Transitoire (coup de bélier)', Th: 'Thermique couplée', C: 'Compressible (extension)' };
const ORIGINS = { a: 'Extrait STEP', b: 'Calculé', c: 'Par défaut (source)', d: 'Saisie utilisateur' };
const REF = [
  // composant, paramètre, nom Flowmaster, unité, P, T, Th, C, origine, méthode
  ['Tube', 'Diamètre intérieur', 'Diameter', 'mm', 'B', 'B', 'B', 'B', 'a (c si De seul)', "Rayon du cylindre intérieur coaxial (CYLINDRICAL_SURFACE, face d'orientation inverse)"],
  ['Tube', 'Longueur', 'Length', 'm', 'B', 'B', 'B', 'B', 'a', "Bornes des faces projetées sur l'axe ; mesurée jusqu'au point d'intersection des axes aux tés et onglets"],
  ['Tube', 'Altitude des nœuds / dénivelé', 'Node elevation', 'm', 'B', 'B', 'P', 'B', 'a / b', "Coordonnée du nœud selon l'axe vertical choisi"],
  ['Tube', 'Rugosité absolue', 'Absolute roughness', 'mm', 'B', 'B', 'P', 'B', 'c', 'Table matériau (Moody 1944 / Crane TP-410), modifiable'],
  ['Tube', 'Diamètre extérieur', 'Outside diameter', 'mm', '', 'B', 'B', '', 'a', 'Rayon du cylindre extérieur coaxial'],
  ['Tube', 'Épaisseur de paroi', 'Wall thickness', 'mm', '', 'B', 'B', '', 'b (c si De seul)', '(De − Di)/2 ; sinon classe normalisée ASME B36.10 / EN 10255 / EN 1057'],
  ['Tube', 'Matériau', 'Material', '–', 'P', 'B', 'B', '', 'd', 'Défaut global modifiable par tube'],
  ['Tube', "Module d'Young", "Young's modulus", 'GPa', '', 'B', '', '', 'c', 'Table matériau'],
  ['Tube', 'Coefficient de Poisson', "Poisson's ratio", '–', '', 'B', '', '', 'c', 'Table matériau'],
  ['Tube', 'Ancrage / supportage', 'Pipe constraint', '–', '', 'B', '', '', 'd', 'Ancré amont / ancré partout / joints de dilatation'],
  ['Tube', 'Conductivité de paroi', 'Wall conductivity', 'W/(m·K)', '', '', 'B', '', 'c', 'Table matériau'],
  ['Tube', "Isolant (épaisseur, conductivité)", 'Insulation', 'mm ; W/(m·K)', '', '', 'B', '', 'd', ''],
  ['Tube', "Coefficient d'échange externe", 'External HTC', 'W/(m²·K)', '', '', 'B', '', 'd', ''],
  ['Tube', 'Température ambiante', 'Ambient temperature', '°C', '', '', 'B', '', 'd', ''],
  ['Coude', 'Diamètre intérieur', 'Diameter', 'mm', 'B', 'B', 'B', 'B', 'a', 'Rayon mineur du tore intérieur (TOROIDAL_SURFACE)'],
  ['Coude', 'Rayon de cintrage', 'Bend radius', 'mm', 'B', 'P', 'P', 'B', 'a', 'Rayon majeur du tore ; 0 pour un coude à onglet'],
  ['Coude', 'Rapport R/D', 'Radius ratio r/d', '–', 'B', 'P', '', 'B', 'b', 'R / Di'],
  ['Coude', 'Angle', 'Bend angle', '°', 'B', 'P', '', 'B', 'a / b', "Azimuts balayés par les faces du tore ; angle entre axes pour un onglet"],
  ['Coude', 'Longueur développée', 'Length', 'm', 'P', 'B', 'B', 'P', 'b', 'R × θ'],
  ['Coude', 'Rugosité', 'Roughness', 'mm', 'P', 'P', '', 'P', 'c', 'Table matériau'],
  ['Coude', 'Corrélation de pertes', 'Loss data source', '–', 'B', '', '', 'B', 'b (suggestion)', 'Miller : coude circulaire (R/D, θ, Re) ou onglet'],
  ['Té', 'Diamètres des 3 bras', 'Arm diameters', 'mm', 'B', 'B', 'P', 'B', 'a', 'Di des primitives raccordées au point de jonction des axes'],
  ['Té', 'Angle du piquage', 'Branch angle', '°', 'B', 'P', '', 'B', 'b', 'Angle entre axes'],
  ['Té', 'Rapports de sections', 'Area ratios', '–', 'B', '', '', 'B', 'b', 'A_dérivé/A_principal, A_principal2/A_principal1'],
  ['Té', 'Rayon de raccordement r/D', 'Junction radius ratio', '–', 'P', '', '', 'P', 'd', "Non extrait (congé d'intersection) ; 0 = arête vive"],
  ['Té', 'Configuration (convergent/divergent)', 'Flow configuration', '–', 'P', '', '', 'P', 'd', "Dépend du sens réel d'écoulement, évalué par le solveur ; à confirmer"],
  ['Variation de section', 'Diamètres D1 / D2', 'Diameters', 'mm', 'B', 'B', 'P', 'B', 'a', 'Rayons du cône intérieur aux bornes ou des cylindres adjacents'],
  ['Variation de section', 'Angle de cône (total)', 'Cone angle', '°', 'B', 'P', '', 'B', 'a', '2 × demi-angle (CONICAL_SURFACE) ; 180° si brusque'],
  ['Variation de section', 'Longueur', 'Length', 'mm', 'P', 'P', '', 'P', 'a', ''],
  ['Variation de section', 'Type (brusque / progressive)', 'Type', '–', 'B', '', '', 'B', 'b', 'Cône présent ou non'],
  ['Pompe', 'DN aspiration / refoulement', 'Inlet / outlet diameter', 'mm', 'P', 'P', '', 'P', 'a / b', 'Alésage de la tubulure ; sinon Di du tube raccordé'],
  ['Pompe', 'Courbe H-Q (≥ 3 points)', 'Head vs flow', 'm ; m³/h', 'B', 'B', '', 'B', 'd', 'Fiche constructeur — jamais inventée'],
  ['Pompe', 'Vitesse nominale', 'Speed', 'tr/min', 'B', 'B', '', 'B', 'd', ''],
  ['Pompe', 'Courbe de rendement / puissance', 'Efficiency / power', '% ; kW', 'P', 'P', 'B', 'P', 'd', 'Échauffement du fluide en thermique'],
  ['Pompe', 'NPSH requis', 'NPSHr', 'm', 'P', 'P', '', '', 'd', ''],
  ['Pompe', 'Inertie rotor + moteur', 'Inertia', 'kg·m²', '', 'B', '', '', 'd', 'Démarrage / disjonction'],
  ['Pompe', 'Loi de démarrage / arrêt', 'Start-up / trip', '–', '', 'B', '', '', 'd', ''],
  ['Vanne', 'DN', 'Diameter', 'mm', 'P', 'P', '', 'P', 'a / b', ''],
  ['Vanne', 'Kv, Cv ou K (fonction de l\'ouverture)', 'Loss coefficient', '–', 'B', 'B', '', 'B', 'd', 'Fiche constructeur'],
  ['Vanne', 'Ouverture en régime permanent', 'Opening', '%', 'B', 'B', '', 'B', 'd', ''],
  ['Vanne', 'Loi et temps de manœuvre', 'Opening vs time', 's', '', 'B', '', '', 'd', ''],
  ['Clapet anti-retour', 'K ou ΔP-Q, pression d\'ouverture', 'Loss / cracking pressure', '– ; bar', 'B', 'B', '', 'B', 'd', ''],
  ['Clapet anti-retour', 'Temps de fermeture / inertie', 'Closing time', 's', '', 'B', '', '', 'd', ''],
  ['Filtre', 'Courbe ΔP-Q ou K', 'Pressure drop', 'bar ; m³/h', 'B', 'B', '', 'B', 'd', ''],
  ['Filtre', 'État de colmatage', 'Clogging', '%', 'P', '', '', '', 'd', ''],
  ['Échangeur', 'ΔP-Q côté circuit', 'Pressure drop', 'bar ; m³/h', 'B', 'B', 'P', 'B', 'd', ''],
  ['Échangeur', 'Performance thermique (UA, efficacité ou puissance)', 'Heat transfer', 'W/K ; – ; kW', '', '', 'B', '', 'd', ''],
  ['Échangeur', 'Côté secondaire (débit, T entrée)', 'Secondary side', 'kg/s ; °C', '', '', 'B', '', 'd', ''],
  ['Échangeur', 'Volume interne', 'Volume', 'L', '', 'P', 'P', '', 'd', ''],
  ['Réservoir', 'Niveau de liquide', 'Liquid height', 'm', 'B', 'B', 'P', 'B', 'd', ''],
  ['Réservoir', 'Pression du ciel gazeux', 'Surface pressure', 'bar abs', 'B', 'B', '', 'B', 'd', ''],
  ['Réservoir', 'Section / volume', 'Cross-section area', 'm²', '', 'B', 'P', '', 'd', ''],
  ['Réservoir', 'Altitude du fond', 'Base elevation', 'm', 'P', 'P', '', 'P', 'b', 'Boîte englobante du corps'],
  ['Débitmètre', 'K ou ΔP-Q', 'Loss coefficient', '–', 'P', 'P', '', 'P', 'd', ''],
  ['Orifice / diaphragme', "Diamètre d'orifice, épaisseur", 'Orifice diameter', 'mm', 'B', 'B', '', 'B', 'd', ''],
  ['Fluide', 'Masse volumique', 'Density', 'kg/m³', 'B', 'B', 'B', 'B', 'c / d', 'Bibliothèque (source citée) ou saisie'],
  ['Fluide', 'Viscosité dynamique', 'Dynamic viscosity', 'Pa·s', 'B', 'B', 'B', 'B', 'c / d', ''],
  ['Fluide', 'Capacité thermique massique', 'Specific heat', 'J/(kg·K)', '', '', 'B', 'B', 'c / d', ''],
  ['Fluide', 'Conductivité thermique', 'Thermal conductivity', 'W/(m·K)', '', '', 'B', '', 'c / d', ''],
  ['Fluide', 'Module de compressibilité', 'Bulk modulus', 'GPa', '', 'B', '', '', 'c / d', ''],
  ['Fluide', 'Pression de vapeur saturante', 'Vapour pressure', 'kPa', 'P', 'B', '', '', 'c / d', 'Cavitation, NPSH disponible'],
  ['Fluide', 'Constante du gaz, γ', 'Gas constant, γ', 'J/(kg·K) ; –', '', '', '', 'B', 'c / d', ''],
  ['Fluide', 'Température et pression de référence', 'Reference T, P', '°C ; bar', 'B', 'B', 'B', 'B', 'd', ''],
  ['Conditions aux limites', 'Type et valeur par extrémité libre', 'Pressure / flow source, reservoir', 'bar ; m³/h ; m', 'B', 'B', 'B', 'B', 'd', ''],
  ['Conditions aux limites', "Température d'entrée", 'Source temperature', '°C', '', '', 'B', 'B', 'd', ''],
  ['Simulation', 'Pas de temps', 'Time step', 's', '', 'B', '', '', 'd (b : suggestion ≤ L/a)', 'Vitesse d\'onde calculée si données disponibles'],
  ['Simulation', 'Durée simulée', 'Simulation time', 's', '', 'B', '', '', 'd', ''],
  ['Simulation', 'Lois temporelles / événements', 'Time-dependent controllers', '–', '', 'B', '', '', 'd', ''],
  ['Thermique', 'Sources de chaleur', 'Heat sources', 'W', '', '', 'P', '', 'd', ''],
  ['Contrôle', 'Débit nominal', '—', 'm³/h', 'P', '', '', '', 'd', 'Uniquement pour le contrôle de vraisemblance']
];

/* Paramètres propres à chaque type d'équipement (onglet Équipements) */
const EQ_PARAMS = {
  'Pompe': [['hq', 'Courbe H-Q (Q m³/h : H m ; …)', 'Head vs flow', 'm³/h : m', { P: 'B', T: 'B', C: 'B' }], ['speed', 'Vitesse nominale', 'Speed', 'tr/min', { P: 'B', T: 'B', C: 'B' }], ['eff', 'Rendement (ou courbe P-Q)', 'Efficiency', '%', { P: 'P', T: 'P', Th: 'B' }], ['npsh', 'NPSH requis', 'NPSHr', 'm', { P: 'P', T: 'P' }], ['inertia', 'Inertie rotor + moteur', 'Inertia', 'kg·m²', { T: 'B' }], ['startup', 'Loi de démarrage / arrêt', 'Start-up / trip', '–', { T: 'B' }]],
  'Vanne': [['kv', 'Kv, Cv ou K (préciser)', 'Loss coefficient / Kv', '–', { P: 'B', T: 'B', C: 'B' }], ['open', 'Ouverture en régime permanent', 'Opening', '%', { P: 'B', T: 'B', C: 'B' }], ['law', "Loi d'ouverture / fermeture", 'Opening vs time', '–', { T: 'B' }], ['tman', 'Temps de manœuvre', 'Operating time', 's', { T: 'B' }]],
  'Clapet anti-retour': [['kv', 'K ou ΔP-Q', 'Loss coefficient', '–', { P: 'B', T: 'B', C: 'B' }], ['pcrack', "Pression d'ouverture", 'Cracking pressure', 'bar', { P: 'P', T: 'P' }], ['tclose', 'Temps de fermeture / inertie', 'Closing time', 's', { T: 'B' }]],
  'Filtre': [['dpq', 'Courbe ΔP-Q (Q m³/h : ΔP bar ; …) ou K', 'Pressure drop vs flow', 'm³/h : bar', { P: 'B', T: 'B', C: 'B' }], ['clog', 'État de colmatage retenu', 'Clogging', '%', { P: 'P' }]],
  'Échangeur': [['dpq', 'ΔP-Q côté circuit', 'Pressure drop vs flow', 'm³/h : bar', { P: 'B', T: 'B', Th: 'P', C: 'B' }], ['ua', 'Performance thermique (UA, efficacité ou puissance)', 'Heat transfer', 'W/K ; – ; kW', { Th: 'B' }], ['sec', 'Côté secondaire (débit ; T entrée)', 'Secondary side', 'kg/s ; °C', { Th: 'B' }], ['vol', 'Volume interne', 'Volume', 'L', { T: 'P', Th: 'P' }]],
  'Réservoir': [['level', 'Niveau de liquide', 'Liquid height', 'm', { P: 'B', T: 'B', Th: 'P', C: 'B' }], ['psurf', 'Pression du ciel gazeux', 'Surface pressure', 'bar abs', { P: 'B', T: 'B', C: 'B' }], ['area', 'Section du réservoir', 'Cross-section area', 'm²', { T: 'B', Th: 'P' }]],
  'Débitmètre': [['k', 'K ou ΔP-Q', 'Loss coefficient', '–', { P: 'P', T: 'P', C: 'P' }]],
  'Orifice / diaphragme': [['dor', "Diamètre d'orifice", 'Orifice diameter', 'mm', { P: 'B', T: 'B', C: 'B' }], ['tor', 'Épaisseur / type de bord', 'Thickness / edge', 'mm', { P: 'P' }]],
  'Équipement (autre)': [['type', 'Type réel à identifier', 'Component type', '–', { P: 'B', T: 'B', Th: 'B', C: 'B' }], ['dpq', 'Caractéristique ΔP-Q ou K', 'Pressure drop vs flow', '–', { P: 'B', T: 'B', C: 'B' }]]
};

/* Matériaux : rugosité (mm) + source, E (GPa), ν, λ (W/(m·K)) — valeurs usuelles à confirmer selon la nuance */
const MATERIALS = [
  ['Acier carbone commercial neuf', 0.045, 'Moody (1944) / Crane TP-410', 207, 0.30, 50],
  ['Acier carbone légèrement corrodé', 0.15, "Idel'chik, valeur usuelle", 207, 0.30, 50],
  ['Acier galvanisé', 0.15, 'Moody (1944)', 207, 0.30, 50],
  ['Acier inoxydable, tube étiré', 0.0015, 'Moody (1944), tube étiré', 193, 0.30, 16],
  ['Acier inoxydable, tube soudé', 0.045, 'Crane TP-410 (assimilé acier commercial)', 193, 0.30, 16],
  ['Cuivre étiré', 0.0015, 'Moody (1944), tube étiré', 117, 0.33, 390],
  ['Aluminium étiré', 0.0015, 'Moody (1944), tube étiré', 69, 0.33, 205],
  ['Titane, tube étiré', 0.0015, 'Moody (1944), tube étiré', 110, 0.32, 7],
  ['Fonte', 0.26, 'Moody (1944)', 100, 0.26, 50],
  ['PVC', 0.0015, 'Moody (1944), surfaces lisses', 3.0, 0.40, 0.19],
  ['PEHD', 0.0015, 'Moody (1944), surfaces lisses', 1.0, 0.45, 0.40]
];
const MAT = Object.fromEntries(MATERIALS.map(m => [m[0], { eps: m[1], src: m[2], E: m[3], nu: m[4], k: m[5] }]));

/* Fluides : propriétés en fonction de T (°C). Retourne {rho kg/m³, mu Pa·s, cp J/(kg·K), lam W/(m·K), K GPa, pv kPa, src} ; null = non fourni */
function interp(tab, T, col) {
  if (T <= tab[0][0]) return tab[0][col]; const l = tab[tab.length - 1]; if (T >= l[0]) return l[col];
  for (let i = 1; i < tab.length; i++) if (T <= tab[i][0]) { const a = tab[i - 1], b = tab[i]; return a[col] + (b[col] - a[col]) * (T - a[0]) / (b[0] - a[0]); }
}
// T °C | ρ | μ mPa·s | cp kJ/(kg·K) | λ | K GPa | pv kPa
const WATER = [[0, 999.8, 1.792, 4.217, 0.561, 1.97, 0.611], [10, 999.7, 1.306, 4.192, 0.580, 2.09, 1.228], [20, 998.2, 1.002, 4.182, 0.598, 2.18, 2.339], [30, 995.7, 0.798, 4.178, 0.615, 2.25, 4.247], [40, 992.2, 0.653, 4.179, 0.631, 2.28, 7.384], [50, 988.0, 0.547, 4.181, 0.644, 2.29, 12.35], [60, 983.2, 0.467, 4.185, 0.654, 2.28, 19.95], [70, 977.8, 0.404, 4.190, 0.663, 2.25, 31.20], [80, 971.8, 0.355, 4.196, 0.670, 2.21, 47.41], [90, 965.3, 0.315, 4.205, 0.675, 2.16, 70.18], [100, 958.4, 0.282, 4.216, 0.679, 2.09, 101.3]];
const EG30 = [[-10, 1049, 4.5, 3.56, 0.437], [0, 1046, 3.14, 3.58, 0.447], [20, 1040, 1.86, 3.63, 0.468], [40, 1032, 1.22, 3.68, 0.484], [60, 1022, 0.87, 3.73, 0.496], [80, 1011, 0.66, 3.78, 0.503]];
const EG50 = [[-20, 1080, 11.0, 3.20, 0.360], [0, 1072, 5.5, 3.28, 0.375], [20, 1062, 3.0, 3.36, 0.390], [40, 1050, 1.8, 3.44, 0.400], [60, 1037, 1.2, 3.52, 0.405], [80, 1022, 0.85, 3.60, 0.410]];
function walther(T, T1, n1, T2, n2) { // ASTM D341 : log log(ν+0,7) = A − B log T(K)
  const f = (n) => Math.log10(Math.log10(n + 0.7)); const x1 = Math.log10(T1 + 273.15), x2 = Math.log10(T2 + 273.15);
  const B = (f(n1) - f(n2)) / (x2 - x1), A = f(n1) + B * x1; return Math.pow(10, Math.pow(10, A - B * Math.log10(T + 273.15))) - 0.7;
}
const FLUIDS = {
  water: { name: 'Eau', range: [0, 100], f: (T) => ({ rho: interp(WATER, T, 1), mu: interp(WATER, T, 2) / 1000, cp: interp(WATER, T, 3) * 1000, lam: interp(WATER, T, 4), K: interp(WATER, T, 5), pv: interp(WATER, T, 6), src: 'Eau pure — valeurs tabulées IAPWS-IF97 (interpolation linéaire)' }) },
  eg30: { name: 'Eau glycolée 30 % (éthylène glycol)', range: [-10, 80], f: (T) => ({ rho: interp(EG30, T, 1), mu: interp(EG30, T, 2) / 1000, cp: interp(EG30, T, 3) * 1000, lam: interp(EG30, T, 4), K: null, pv: null, src: 'ASHRAE Handbook Fundamentals, valeurs approchées — module et Pv non fournis' }) },
  eg50: { name: 'Eau glycolée 50 % (éthylène glycol)', range: [-20, 80], f: (T) => ({ rho: interp(EG50, T, 1), mu: interp(EG50, T, 2) / 1000, cp: interp(EG50, T, 3) * 1000, lam: interp(EG50, T, 4), K: null, pv: null, src: 'ASHRAE Handbook Fundamentals, valeurs approchées — module et Pv non fournis' }) },
  vg32: { name: 'Huile hydraulique minérale ISO VG 32', range: [-10, 100], f: (T) => { const rho = 870 * (1 - 0.00065 * (T - 15)); return { rho, mu: walther(T, 40, 32, 100, 5.4) * 1e-6 * rho, cp: 1880 + 3.6 * (T - 15), lam: 0.13, K: 1.6, pv: 0, src: 'Valeurs typiques (ISO 3448, Walther ASTM D341 : 32 cSt à 40 °C, 5,4 cSt à 100 °C) — à confirmer avec la fiche produit' }; } },
  vg46: { name: 'Huile hydraulique minérale ISO VG 46', range: [-10, 100], f: (T) => { const rho = 875 * (1 - 0.00065 * (T - 15)); return { rho, mu: walther(T, 40, 46, 100, 6.8) * 1e-6 * rho, cp: 1880 + 3.6 * (T - 15), lam: 0.13, K: 1.6, pv: 0, src: 'Valeurs typiques (ISO 3448, Walther ASTM D341 : 46 cSt à 40 °C, 6,8 cSt à 100 °C) — à confirmer avec la fiche produit' }; } },
  jet: { name: 'Kérosène Jet A-1', range: [-40, 60], f: (T) => { const rho = 800 * (1 - 0.00093 * (T - 15)); return { rho, mu: walther(T, -20, 4.0, 40, 1.3) * 1e-6 * rho, cp: 2000, lam: 0.115, K: 1.4, pv: 1.0, src: 'Valeurs typiques (CRC Handbook of Aviation Fuel Properties) — ρ15 réel entre 775 et 840 kg/m³, à confirmer' }; } },
  air: { name: 'Air (gaz parfait)', range: [-50, 200], gas: true, f: (T, Pbar) => { const Tk = T + 273.15; return { rho: Pbar * 1e5 / (287.05 * Tk), mu: 1.716e-5 * Math.pow(Tk / 273.15, 1.5) * (273.15 + 110.4) / (Tk + 110.4), cp: 1006, lam: 0.0241 * Math.pow(Tk / 273.15, 0.81), K: null, pv: null, R: 287.05, gamma: 1.4, src: 'Gaz parfait, Sutherland pour μ — écoulement compressible : extension optionnelle' }; } },
  manual: { name: 'Propriétés saisies manuellement', range: null }
};

/* Épaisseurs normalisées pour un tube modélisé par son seul De : [De mm, e mm] */
const PIPE_STD = {
  ASME40: { name: 'ASME B36.10M Schedule 40', t: [[10.3, 1.73], [13.7, 2.24], [17.1, 2.31], [21.3, 2.77], [26.7, 2.87], [33.4, 3.38], [42.2, 3.56], [48.3, 3.68], [60.3, 3.91], [73.0, 5.16], [88.9, 5.49], [114.3, 6.02], [141.3, 6.55], [168.3, 7.11], [219.1, 8.18], [273.0, 9.27], [323.8, 10.31], [355.6, 11.13], [406.4, 12.70], [457.0, 14.27], [508.0, 15.09], [610.0, 17.48]] },
  ASME80: { name: 'ASME B36.10M Schedule 80', t: [[10.3, 2.41], [13.7, 3.02], [17.1, 3.20], [21.3, 3.73], [26.7, 3.91], [33.4, 4.55], [42.2, 4.85], [48.3, 5.08], [60.3, 5.54], [73.0, 7.01], [88.9, 7.62], [114.3, 8.56], [141.3, 9.53], [168.3, 10.97], [219.1, 12.70], [273.0, 15.09], [323.8, 17.48], [355.6, 19.05], [406.4, 21.44], [457.0, 23.83], [508.0, 26.19], [610.0, 30.96]] },
  ASME10: { name: 'ASME B36.19M Schedule 10S', t: [[10.3, 1.24], [13.7, 1.65], [17.1, 1.65], [21.3, 2.11], [26.7, 2.11], [33.4, 2.77], [42.2, 2.77], [48.3, 2.77], [60.3, 2.77], [73.0, 3.05], [88.9, 3.05], [114.3, 3.05], [141.3, 3.40], [168.3, 3.40], [219.1, 3.76], [273.0, 4.19], [323.8, 4.57]] },
  EN10255: { name: 'EN 10255 série M (≤ 165,1) / EN 10220 (au-delà)', t: [[10.2, 2.0], [13.5, 2.3], [17.2, 2.3], [21.3, 2.6], [26.9, 2.6], [33.7, 3.2], [42.4, 3.2], [48.3, 3.2], [60.3, 3.6], [76.1, 3.6], [88.9, 4.0], [114.3, 4.5], [139.7, 5.0], [165.1, 5.0], [168.3, 4.5], [219.1, 6.3], [273.0, 6.3], [323.9, 7.1]] },
  EN1057: { name: 'EN 1057 (tubes cuivre)', t: [[6, 1.0], [8, 1.0], [10, 1.0], [12, 1.0], [14, 1.0], [15, 1.0], [16, 1.0], [18, 1.0], [22, 1.0], [28, 1.0], [35, 1.2], [42, 1.2], [54, 1.5], [64, 2.0], [76.1, 2.0], [88.9, 2.0], [108, 2.5]] }
};
function stdThickness(De, std) {
  const s = PIPE_STD[std]; if (!s) return null; let best = null;
  for (const [d, e] of s.t) { const err = Math.abs(d - De); if (err <= Math.max(0.3, 0.01 * d) && (!best || err < best.err)) best = { err, e, d }; }
  return best ? { e: best.e, src: s.name + ' — De ' + best.d + ' mm' } : null;
}

/* Coefficients K indicatifs (Crane TP-410, méthode K = fT·L/D) — contrôle de vraisemblance uniquement */
const fT = (epsmm, Dmm) => 0.25 / Math.pow(Math.log10(epsmm / (3.7 * Dmm)), 2);
const BEND_LD = [[1, 20], [1.5, 14], [2, 12], [3, 12], [4, 14], [6, 17], [8, 24], [10, 30], [12, 34], [14, 38], [16, 42], [20, 50]];
const MITRE_LD = [[0, 2], [15, 4], [30, 8], [45, 15], [60, 25], [75, 40], [90, 60]];
function KBend(rd, theta, ft) {
  const LD = interp(BEND_LD, Math.max(1, rd), 1); const K1 = ft * LD; const n = theta / 90;
  return (n - 1) * (0.25 * Math.PI * ft * rd + 0.5 * K1) + K1;
}
const KMitre = (theta, ft) => ft * interp(MITRE_LD, Math.min(90, theta), 1);
function KRed(Dsmall, Dlarge, angleDeg, contraction) { // rapporté à la vitesse dans le petit diamètre
  const b = Dsmall / Dlarge, t = Math.min(180, angleDeg) / DEG, s = Math.sin(t / 2), b2 = b * b;
  if (contraction) return angleDeg <= 45 ? 0.8 * s * (1 - b2) : 0.5 * (1 - b2) * Math.sqrt(s);
  return angleDeg <= 45 ? 2.6 * s * (1 - b2) * (1 - b2) : (1 - b2) * (1 - b2);
}
function colebrook(Re, rel) {
  if (Re < 2300) return 64 / Re;
  let f = 0.25 / Math.pow(Math.log10(rel / 3.7 + 5.74 / Math.pow(Re, 0.9)), 2);
  for (let i = 0; i < 20; i++) f = Math.pow(-2 * Math.log10(rel / 3.7 + 2.51 / (Re * Math.sqrt(f))), -2);
  return f;
}
const DEFAULT_KEYWORDS = `Pompe: POMPE, PUMP, CIRCULATEUR, CIRCULATOR
Vanne: VANNE, VALVE, ROBINET, VLV
Clapet anti-retour: CLAPET, CHECK_VALVE, NRV
Filtre: FILTRE, FILTER, STRAINER, CREPINE
Échangeur: ECHANGEUR, EXCHANGER, HX, RADIATEUR, RADIATOR, COOLER, REFROIDISSEUR
Réservoir: RESERVOIR, TANK, BACHE, CUVE, VESSEL
Débitmètre: DEBITMETRE, FLOWMETER, FLOW_METER
Orifice / diaphragme: ORIFICE, DIAPHRAGME
Ignorer: BOLT, BOULON, VIS, SCREW, ECROU, NUT, WASHER, RONDELLE, GOUJON, STUD, SUPPORT, COLLIER, CLAMP, BRACKET`;
