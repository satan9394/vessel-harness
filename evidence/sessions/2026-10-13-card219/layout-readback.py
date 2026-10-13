"""Quantitative horizontal overflow check for desktop and narrow navigation."""
import json
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
root=Path(__file__).resolve().parent
meta=json.loads((root/'browser-fixture-meta.json').read_text(encoding='utf-8-sig'))
receipts=[]
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True)
    context=browser.new_context(viewport={'width':1440,'height':900})
    context.add_init_script("localStorage.setItem('vessel.ui.lang','en')")
    page=context.new_page()
    try:
        page.goto(meta['url']);expect(page.locator('.task-composer')).to_be_visible()
        page.locator('.session-navigation').get_by_text('Review workbench navigation',exact=True).click()
        page.locator('.inspector-toolbar button').click()
        page.get_by_role('tab',name='Patch',exact=True).click()
        for width,drawer in [(1440,False),(800,False),(800,True)]:
            if width==800 and page.locator('.docked-inspector').count():page.locator('.inspector-heading button').click()
            page.set_viewport_size({'width':width,'height':900})
            if drawer:page.locator('.navigation-toggle').click();expect(page.locator('.primary-nav')).to_be_visible()
            measured=page.evaluate('({viewport:innerWidth, documentWidth:document.documentElement.scrollWidth})')
            assert measured['documentWidth']<=measured['viewport'],measured
            receipts.append({'status':'PASS','drawer':drawer,**measured})
            print(json.dumps(receipts[-1]),flush=True)
    finally:
        (root/'layout-readback.json').write_text(json.dumps(receipts,indent=2),encoding='utf-8')
        context.close();browser.close()
