"""Supplement: switching away/back must load completed historical message tree.
No API replacement, product changes, or dependency installs. Run with fresh fixture.
"""
import json
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

ROOT=Path(__file__).resolve().parent
meta=json.loads((ROOT/'browser-fixture-meta.json').read_text(encoding='utf-8-sig'))
(ROOT/'history-fixture-meta.json').write_text(json.dumps(meta,indent=2),encoding='utf-8')
result={'url':meta['url'],'receipts':[],'consoleErrors':[],'pageErrors':[]}
def receipt(name,**data):
    result['receipts'].append({'step':name,**data})
    print(json.dumps(result['receipts'][-1]),flush=True)

with sync_playwright() as p:
    browser=p.chromium.launch(headless=True)
    ctx=browser.new_context(viewport={'width':1440,'height':900})
    ctx.add_init_script("localStorage.setItem('vessel.ui.lang','en')")
    page=ctx.new_page()
    page.on('console',lambda msg:result['consoleErrors'].append(msg.text) if msg.type=='error' else None)
    page.on('pageerror',lambda err:result['pageErrors'].append(str(err)))
    try:
        page.goto(meta['url'])
        page.locator('#taskProject').select_option(meta['workspaceRoot'])
        prompt='Card219 historical message readback sentinel'
        page.locator('#taskInput').fill(prompt)
        page.locator('.task-composer button[type="submit"]').click()
        expect(page.locator('.message-list-scroll')).to_contain_text('Local fixture response',timeout=30000)
        expect(page.locator('.conversation .composer button').nth(1)).to_be_disabled()
        created=page.locator('.dual-surface').get_attribute('data-session-id')
        before=page.locator('.message-list-scroll').inner_text()
        assert prompt in before
        receipt('Create and complete actual turn',status='PASS',sessionId=created,userPresent=True,assistantPresent=True)
        page.locator('.session-navigation').get_by_text('Review workbench navigation',exact=True).click()
        expect(page.locator('.dual-surface')).not_to_have_attribute('data-session-id',created)
        receipt('Click away to another historical session',status='PASS')
        page.locator('.session-navigation').get_by_text(prompt,exact=True).click()
        expect(page.locator('.dual-surface')).to_have_attribute('data-session-id',created)
        receipt('Click back restores selected exact ID',status='PASS',sessionId=created)
        try:
            expect(page.locator('.message-list-scroll')).to_contain_text(prompt,timeout=5000)
            expect(page.locator('.message-list-scroll')).to_contain_text('Local fixture response',timeout=5000)
            receipt('Historical user and assistant message tree readback',status='PASS')
        except AssertionError:
            text=page.locator('.message-list-scroll').inner_text()
            receipt('Historical user and assistant message tree readback',status='FAIL',userPresent=prompt in text,assistantPresent='Local fixture response' in text,visibleMessageText=text)
            page.screenshot(path=str(ROOT/'history-readback-failure.png'),full_page=True)
            result['status']='FAIL'
            raise AssertionError('Selected session ID restored but historical user/assistant message tree absent')
        assert not result['consoleErrors'] and not result['pageErrors']
        result['status']='PASS'
    finally:
        (ROOT/'history-readback.json').write_text(json.dumps(result,indent=2),encoding='utf-8')
        ctx.close();browser.close()
