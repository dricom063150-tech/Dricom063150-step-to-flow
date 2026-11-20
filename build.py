"""Assemble src/*.js dans un fichier HTML unique et autonome : dist/STEP_vers_Flowmaster.html"""
from pathlib import Path
ROOT = Path(__file__).resolve().parent
s = (ROOT / 'src/shell.html').read_text(encoding='utf-8')
for key, name in [('CORE', 'core.js'), ('DATA', 'data.js'), ('XLSX', 'xlsx.js'), ('APP', 'app.js')]:
    c = (ROOT / 'src' / name).read_text(encoding='utf-8')
    if key == 'CORE':  # l'export CommonJS ne sert qu'aux tests Node
        c = c.replace("if (typeof module !== 'undefined') module.exports = { parseStep, analyze, V };", "")
    assert '</script' not in c.lower(), name
    s = s.replace('/*%s*/' % key, c)
out = ROOT / 'dist/STEP_vers_Flowmaster.html'
out.parent.mkdir(exist_ok=True)
out.write_text(s, encoding='utf-8')
print(out, len(s), 'octets')
