import sys, asyncio, os
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'tests/out'; OUT.mkdir(exist_ok=True)
import os
CHROME = os.environ.get('CHROME_PATH')
f=sys.argv[1]; shot=sys.argv[2]
with sync_playwright() as p:
    b=p.chromium.launch(executable_path=CHROME, args=['--allow-file-access-from-files'])
    pg=b.new_page(viewport={'width':1500,'height':900}, accept_downloads=True)
    logs=[]; pg.on('console', lambda m: logs.append(m.type+': '+m.text)); pg.on('pageerror', lambda e: logs.append('PAGEERROR: '+str(e)))
    pg.goto((ROOT / 'dist/STEP_vers_Flowmaster.html').as_uri())
    pg.set_input_files('#file', f)
    pg.wait_for_function("document.querySelector('#status').className.includes('ok') || document.querySelector('#status').className.includes('err')", timeout=60000)
    print('STATUS:', pg.inner_text('#status'))
    print('WORKER:', pg.evaluate("App.worker ? 'worker' : 'main'"))
    # régler analyses + fluide + débit
    pg.click('.tab[data-t=data]')
    for k in ['T','Th']: pg.check(f'[data-an={k}]')
    pg.fill('[data-f=Q]','12'); pg.press('[data-f=Q]','Tab')
    pg.select_option('[data-f=anchor]', index=2)
    pg.click('.tab[data-t=set]')
    pg.wait_for_timeout(300)
    pg.screenshot(path=shot+'_synth.png')
    pg.click('.tab[data-t=comp]'); pg.wait_for_timeout(200)
    pg.click('#panel tr[data-id]:nth-child(2)')
    pg.wait_for_timeout(200)
    pg.screenshot(path=shot+'_comp.png')
    with pg.expect_download() as d: pg.click('#btnExport')
    dl=d.value; out=shot+'.xlsx'; dl.save_as(out); print('XLSX', out, os.path.getsize(out))
    print('\n'.join(logs[:20]))
    b.close()
