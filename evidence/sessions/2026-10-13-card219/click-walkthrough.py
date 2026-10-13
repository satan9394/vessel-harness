"""Real Chromium clicks against a test-owned Vessel server; no API interception.
Run fixture first with npx tsx, then Anaconda claude Python this script.
Native select choices use Playwright's select_option after a real click.
"""
import json, traceback, time, re
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parent
META = json.loads((ROOT / 'browser-fixture-meta.json').read_text(encoding='utf-8-sig'))
PROVIDER='click-fixture-'+str(int(time.time()))
expect.set_options(timeout=30000)
receipts, errors, mutations = [], [], []
gaps = ['Inspector has five current tabs, not the four historical tabs in the card.',
        'Task permission offers read-only and workspace-write; no full-access preset.',
        'Empty task is blocked with disabled Start, without a validation alert.',
        'Customize has no reset-to-default control.']
gaps.append('ChangedFiles, Cost, ToolActivity toggles persist but current ModuleSection returns null; no separate module visibility exists.')
def save():
    (ROOT / 'click-results.json').write_text(json.dumps({'receipts': receipts, 'errors': errors, 'mutations': mutations, 'matrix_gaps': gaps}, indent=2), encoding='utf-8')
def step(name, action):
    start = time.monotonic()
    try:
        action()
        receipts.append({'step': name, 'status': 'PASS', 'durationMs': round((time.monotonic()-start)*1000)})
    except Exception as error:
        receipts.append({'step': name, 'status': 'FAIL', 'error': str(error)})
        page.screenshot(path=str(ROOT / 'failure.png'), full_page=True)
        raise
    finally:
        save()
        print(json.dumps(receipts[-1]), flush=True)
def click(selector):
    page.locator(selector).click()
def choose(selector, value):
    page.locator(selector).click()
    page.locator(selector).select_option(value)
def palette():
    page.keyboard.press('Control+k')
    expect(page.locator('.command-dialog')).to_be_visible()
def nav(area):
    click(f'[data-area="{area}"]')
    expect(page.locator(f'[data-area="{area}"]')).to_have_attribute('aria-current', 'page')
    if area=='workbench': expect(page.locator('.workbench-region')).to_be_visible()
    else: expect(page.locator('.main-body > h2')).to_have_text({'activity':'Activity','studio':'Agent Studio','settings':'Settings'}[area])
def screenshot(name):
    page.screenshot(path=str(ROOT / f'{name}.png'), full_page=True)
def observe_request(req):
    if req.method not in ['POST','PATCH','DELETE']: return
    body=req.post_data
    if body:
        try:
            data=json.loads(body)
            if 'apiKey' in data: data['apiKey']='[redacted]'
            body=json.dumps(data)
        except ValueError: body='[non-json omitted]'
    mutations.append({'url':req.url,'method':req.method,'body':body})
def credential_present():
    store=Path(META['fixtureRoot'])/'provider'/'secrets.json'
    return store.exists() and any(x['service']=='vessel' and x['account']==PROVIDER for x in json.loads(store.read_text())['secrets'])
def require(condition, message):
    assert condition, message
def send_message(text, enter=False):
    previous=page.locator('.message-list-scroll').inner_text().count('Local fixture response')
    page.locator('.conversation .composer-input').fill(text)
    if enter: page.locator('.conversation .composer-input').press('Enter')
    else: click('.conversation .composer button[type="submit"]')
    expect(page.locator('.message-list-scroll')).to_contain_text(text)
    expect(page.locator('.conversation .composer button').nth(1)).to_be_disabled()
    require(page.locator('.message-list-scroll').inner_text().count('Local fixture response')==previous+1,'Assistant response must complete for this turn')
def customize_toggle(index,key):
    box=page.locator('main > .main-body .customize-popover input').nth(index)
    original=box.is_checked();box.click()
    require(page.evaluate("JSON.parse(localStorage.getItem('vessel.ui.modules'))")[key]==(not original),'Module preference must persist')
    nav('workbench')
    selectors={'Swarm':'.module-sections section[aria-label="Swarm topology"]','CognitiveRules':'.module-sections section[aria-label="Cognitive rules"]','Team':'.module-card-team','Tasks':'.module-card-goal'}
    if key in ['Context','Logs','MCP','Policy']:
        module=page.locator('.module-card').filter(has=page.locator('.module-card-title',has_text={'Context':'Context','Logs':'Logs','MCP':'MCP','Policy':'Policy'}[key]))
    elif key in selectors: module=page.locator(selectors[key])
    else: module=None
    if module is not None:
        if not original:expect(module).to_be_visible()
        else:expect(module).to_have_count(0)
    nav('settings');click('main > .main-body .customize-toggle')
    page.locator('main > .main-body .customize-popover input').nth(index).click()
    require(page.evaluate("JSON.parse(localStorage.getItem('vessel.ui.modules'))")[key]==original,'Preference restore')

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    context = browser.new_context(viewport={'width': 1440, 'height': 900})
    context.add_init_script("localStorage.setItem('vessel.ui.lang', 'en')")
    page = context.new_page()
    page.on('pageerror', lambda error: errors.append({'type':'pageerror','text':str(error)}))
    page.on('console', lambda message: errors.append({'type':'console.error','text':message.text}) if message.type == 'error' else None)
    page.on('request', observe_request)
    try:
        page.goto(META['url'])
        expect(page.locator('.task-composer')).to_be_visible()
        for area in ['activity','studio','settings','workbench']:
            step(f'Navigation: {area}', lambda area=area: nav(area))
        step('Empty task cannot create session', lambda: expect(page.locator('.task-composer button[type="submit"]')).to_be_disabled())
        step('Project selector click and choose fixture', lambda: choose('#taskProject', META['workspaceRoot']))
        step('Task input focus and typing', lambda: (click('#taskInput'), expect(page.locator('#taskInput')).to_be_focused(), page.locator('#taskInput').fill('Card 219 real click task')))
        models = page.locator('.model-pill option').evaluate_all('(items) => items.map(x => x.value)')
        for model in models:
            step('Model pill switch: '+model, lambda model=model: (choose('.model-pill',model), expect(page.locator('.model-pill')).to_have_value(model)))
        for permission in ['read-only','workspace-write']:
            step('Permission pill: '+permission, lambda permission=permission: (choose('.composer-options select:not(.model-pill)',permission), expect(page.locator('.composer-options select:not(.model-pill)')).to_have_value(permission)))
        step('Start task creates session and real streamed response', lambda: (click('.task-composer button[type="submit"]'), expect(page.locator('.message-list-scroll')).to_contain_text('Local fixture response',timeout=30000)))
        createdSession=page.locator('.dual-surface').get_attribute('data-session-id')
        step('Streamed thinking expand', lambda: (click('.thinking-block summary'), expect(page.locator('.thinking-content')).to_be_visible()))
        step('Streamed thinking collapse', lambda: (click('.thinking-block summary'), expect(page.locator('.thinking-content')).not_to_be_visible()))
        step('Send input by button and assistant completion', lambda:send_message('Button send click'))
        expect(page.locator('.conversation .composer button[type="submit"]')).to_be_disabled()
        expect(page.locator('.conversation .composer button').nth(1)).to_be_disabled(timeout=30000)
        step('Send input by Enter and assistant completion', lambda:send_message('Enter send click',True))
        expect(page.locator('.conversation .composer button').nth(1)).to_be_disabled(timeout=30000)
        sessions=page.request.get(META['url']+'/api/sessions').json()['sessions']
        historical=next(x['id'] for x in sessions if x.get('topic',{}).get('title')=='Review workbench navigation')
        step('History session click selects exact ID', lambda: (page.locator('.session-navigation').get_by_text('Review workbench navigation',exact=True).click(),expect(page.locator('.dual-surface')).to_have_attribute('data-session-id',historical)))
        step('History click back restores observed user and assistant message tree',lambda:(page.locator('.session-navigation').get_by_text('Card 219 real click task',exact=True).click(),expect(page.locator('.dual-surface')).to_have_attribute('data-session-id',createdSession),expect(page.locator('.message-list-scroll')).to_contain_text('Card 219 real click task'),expect(page.locator('.message-list-scroll')).to_contain_text('Button send click'),expect(page.locator('.message-list-scroll')).to_contain_text('Enter send click'),require(page.locator('.message-list-scroll').inner_text().count('Local fixture response')==3,'All three completed assistant messages replay once')))
        page.locator('.session-navigation').get_by_text('Review workbench navigation',exact=True).click()
        expect(page.locator('.dual-surface')).to_have_attribute('data-session-id',historical)
        step('Inspector open', lambda: click('.inspector-toolbar button'))
        step('Inspector exposes exactly five current tabs',lambda:expect(page.locator('[role="tab"]')).to_have_count(5))
        tabs = page.locator('[role="tab"]').all()
        for tab in tabs:
            label=tab.inner_text()
            heading={'Swarm':'Swarm topology','Cognition':'Cognitive rules','KV Cache':'KV Cache economics','AST':'AST symbol dependencies','Patch':'Patch workbench'}[label]
            step('Inspector tab: '+label, lambda tab=tab,heading=heading: (tab.click(),expect(tab).to_have_attribute('aria-selected','true'),expect(page.locator('[role="tabpanel"] h2').first).to_have_text(heading)))
        patch = page.locator('.docked-inspector article[aria-label="a.txt#hunk-0"]')
        if patch.get_by_role('status').inner_text() == 'accepted':
            patch.get_by_role('button',name='Revert hunk',exact=True).click()
            expect(patch.get_by_role('status')).to_have_text('rejected')
        step('Patch accept persists file', lambda: (patch.get_by_role('button',name=re.compile('Accept hunk|Reapply hunk')).click(),expect(patch.get_by_role('status')).to_have_text('accepted')))
        step('Patch accepted bytes readback',lambda:require((Path(META['workspaceRoot'])/'a.txt').read_text() == 'A\nb\nc\n','Accepted patch file bytes'))
        second=page.locator('.docked-inspector article[aria-label="a.txt#hunk-1"]')
        step('Patch discard pending second hunk', lambda: (expect(second.get_by_role('status')).to_have_text('pending'),second.get_by_role('button',name='Discard hunk',exact=True).click(),expect(second.get_by_role('status')).to_have_text('rejected')))
        step('Patch revert accepted hunk', lambda: (patch.get_by_role('button',name='Revert hunk',exact=True).click(),expect(patch.get_by_role('status')).to_have_text('rejected')))
        step('Patch rejected bytes readback',lambda:require((Path(META['workspaceRoot'])/'a.txt').read_text() == 'a\nb\nc\n','Rejected patch original bytes'))
        screenshot('conversation-patch')
        nav('settings')
        step('Provider drawer open',lambda:click('main > .main-body [data-action="configure-models"]'))
        dialog=page.locator('.provider-modal')
        for preset,url,protocol in [('DeepSeek','https://api.deepseek.com/v1','openai-compatible'),('OpenAI','https://api.openai.com/v1','openai-compatible'),('Claude','https://api.anthropic.com','anthropic'),('Ollama','http://localhost:11434/v1','openai-compatible')]:
            step('Provider preset '+preset,lambda preset=preset,url=url,protocol=protocol:(dialog.get_by_label('Preset',exact=True).click(),dialog.get_by_label('Preset',exact=True).select_option(preset),expect(dialog.get_by_label('Base URL',exact=True)).to_have_value(url),expect(dialog.get_by_label('Protocol',exact=True)).to_have_value(protocol)))
        step('Provider local form entry',lambda:(dialog.get_by_label('Provider name',exact=True).fill(PROVIDER),dialog.get_by_label('Base URL',exact=True).fill(META['modelBaseUrl']),dialog.get_by_label('API Key',exact=True).fill('card219-test-only-placeholder'),dialog.get_by_label('Models (comma separated)',exact=True).fill('')))
        step('Provider test connection busy and latency result',lambda:(dialog.get_by_role('button',name='Test connection',exact=True).click(),expect(dialog.get_by_role('button',name='Testing connection…',exact=True)).to_be_disabled(),expect(dialog.locator('.provider-result')).to_contain_text('Connected',timeout=30000)))
        step('Provider pull models busy and result',lambda:(dialog.get_by_role('button',name='Pull models',exact=True).click(),expect(dialog.get_by_role('button',name='Pulling models…',exact=True)).to_be_disabled(),expect(dialog.get_by_label('Models (comma separated)',exact=True)).to_have_value('fixture-a, fixture-b',timeout=30000),expect(dialog.get_by_role('button',name='Pull models',exact=True)).to_be_enabled()))
        step('Provider save and API readback',lambda:(dialog.get_by_role('button',name='Save',exact=True).click(),expect(dialog.locator('.provider-card').filter(has_text=PROVIDER)).to_be_visible()))
        step('Provider server and credential metadata saved',lambda:(require(any(x['name']==PROVIDER for x in page.request.get(META['url']+'/api/providers').json()['providers']),'Saved provider API'),require(credential_present(),'Credential metadata saved')))
        screenshot('provider-saved')
        step('Provider close',lambda:dialog.get_by_role('button',name='Close',exact=True).click())
        nav('workbench')
        page.locator('.sidebar > button').click()
        expect(page.locator('.model-pill')).to_contain_text(PROVIDER)
        nav('settings');click('main > .main-body [data-action="configure-models"]')
        card=page.locator('.provider-card').filter(has_text=PROVIDER)
        step('Provider delete confirmation',lambda:(card.get_by_role('button',name='Delete',exact=True).click(),expect(card.get_by_role('button',name='Confirm',exact=True)).to_be_visible()))
        step('Provider confirmed delete and API readback',lambda:(card.get_by_role('button',name='Confirm',exact=True).click(),expect(card).to_have_count(0)))
        step('Provider credential cascade removal (metadata only)',lambda:(require(not any(x['name']==PROVIDER for x in page.request.get(META['url']+'/api/providers').json()['providers']),'Provider deleted API'),require(not credential_present(),'Credential removed')))
        dialog.get_by_role('button',name='Close',exact=True).click()
        nav('workbench')
        page.locator('.session-navigation').get_by_text('Review workbench navigation',exact=True).click()
        expect(page.locator('.dual-surface')).to_have_attribute('data-session-id',historical)
        nav('settings')
        step('Customize open',lambda:click('main > .main-body .customize-toggle'))
        boxes=page.locator('main > .main-body .customize-popover input').all()
        baseline=len(mutations)
        keys=['Swarm','CognitiveRules','Team','Tasks','ChangedFiles','Context','ToolActivity','Logs','Cost','MCP','Policy']
        for index,key in enumerate(keys):
            step('Customize persistence'+(' and visibility: ' if key not in ['ChangedFiles','Cost','ToolActivity'] else ' (no independent module): ')+key,lambda index=index,key=key:customize_toggle(index,key))
        assert len(mutations)==baseline
        step('Customize no backend policy mutations',lambda:None)
        page.keyboard.press('Escape')
        trigger=page.locator('main > .main-body .customize-toggle');trigger.focus()
        step('Ctrl+K auto focuses input',lambda:(palette(),expect(page.locator('.command-dialog input')).to_be_focused()))
        selected=page.locator('.command-dialog input').get_attribute('aria-activedescendant')
        page.keyboard.press('ArrowDown');assert page.locator('.command-dialog input').get_attribute('aria-activedescendant')!=selected
        page.keyboard.press('ArrowUp');assert page.locator('.command-dialog input').get_attribute('aria-activedescendant')==selected
        step('Command arrow navigation receipt',lambda:None)
        step('Command Escape restores focus',lambda:(page.keyboard.press('Escape'),expect(page.locator('.command-dialog')).to_have_count(0),expect(trigger).to_be_focused()))
        for group in ['system','project','session']:
            palette()
            section=page.locator('.command-group').nth({'system':0,'project':1,'session':2}[group])
            step('Command category collapse '+group,lambda section=section:(section.locator('.command-group-toggle').click(),expect(section.locator('[role="option"]')).to_have_count(0),section.locator('.command-group-toggle').click()))
            option=section.locator('[role="option"]').first
            title=option.inner_text()
            step('Command category execute '+group+': '+title,lambda option=option:(option.click(),expect(page.locator('.command-dialog')).to_have_count(0)))
            if group=='system':step('System action opens provider settings',lambda:expect(page.locator('.provider-modal')).to_be_visible())
            elif group=='project':step('Recent project action selects composer project',lambda:expect(page.locator('#taskProject')).to_have_value(META['workspaceRoot']))
            else:step('Active session action opens matching session',lambda:require(page.locator('.dual-surface').get_attribute('data-session-id') in [x['id'] for x in page.request.get(META['url']+'/api/sessions').json()['sessions'] if x.get('topic',{}).get('title')==title.split(' · ')[0]],'Matching command session ID'))
            if page.locator('.provider-modal').count():page.locator('.provider-modal').get_by_role('button',name='Close',exact=True).click()
        screenshot('desktop-final')
        if page.locator('.docked-inspector').count():
            step('Close inspector before navigation drawer scenario',lambda:page.locator('.inspector-heading button').click())
        page.set_viewport_size({'width':800,'height':900})
        step('800px navigation collapses',lambda:(expect(page.locator('.navigation-toggle')).to_be_visible(),expect(page.locator('.primary-nav')).not_to_be_visible()))
        step('800px drawer open and main inert',lambda:(click('.navigation-toggle'),expect(page.locator('.primary-nav')).to_be_visible(),expect(page.locator('main')).to_have_attribute('inert','')))
        for key in ['Tab','Shift+Tab']:
            for _ in range(60):
                page.keyboard.press(key)
                assert page.evaluate("document.querySelector('.navigation-shell').contains(document.activeElement)")
            step('800px focus loop '+key+' 60 times',lambda:None)
        screenshot('narrow-drawer')
        step('800px Escape restores main and focus',lambda:(page.keyboard.press('Escape'),expect(page.locator('.primary-nav')).not_to_be_visible(),expect(page.locator('main')).not_to_have_attribute('inert',''),expect(page.locator('.navigation-toggle')).to_be_focused()))
        step('800px backdrop closes drawer',lambda:(click('.navigation-toggle'),page.locator('.navigation-backdrop').click(position={'x':790,'y':450}),expect(page.locator('.primary-nav')).not_to_be_visible()))
        screenshot('narrow-final')
        step('Hard gate console errors and uncaught exceptions zero',lambda:(_ for _ in ()).throw(AssertionError(errors)) if errors else None)
    finally:
        save();context.close();browser.close()





