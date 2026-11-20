from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'tests/out'; OUT.mkdir(exist_ok=True)
import os
CHROME = os.environ.get('CHROME_PATH')
with sync_playwright() as p:
    b=p.chromium.launch(executable_path=CHROME)
    pg=b.new_page(viewport={'width':1500,'height':900}); errs=[]
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto((ROOT / 'dist/STEP_vers_Flowmaster.html').as_uri())
    pg.set_input_files('#file',str(ROOT / 'tests/fixtures' / 'ref4_cas_avances.stp'))
    pg.wait_for_function("document.querySelector('#status').className.includes('ok')")
    pg.wait_for_timeout(300); pg.screenshot(path=str(OUT / 't4.png'))
    pg.set_input_files('#file',str(ROOT / 'tests/fixtures' / 'ref3_assemblage_pompe_vanne.stp'))
    pg.wait_for_function("document.querySelector('#status').textContent.includes('ref3')")
    pg.click('.tab[data-t=eq]'); pg.wait_for_timeout(300); pg.screenshot(path=str(OUT / 't3eq.png'))
    # fichier invalide
    open('/tmp/bad.stp','w').write('pas un step')
    pg.set_input_files('#file','/tmp/bad.stp'); pg.wait_for_timeout(1500); print('BAD:', pg.inner_text('#status'))
    print('ERRS', errs); b.close()
