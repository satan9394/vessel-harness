"""Card 218 browser interaction checks against the isolated real server fixture."""
import json
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

ROOT = Path('evidence/sessions/2026-10-12-card218')
META = json.loads((ROOT / 'browser-fixture-meta.json').read_text(encoding='utf-8-sig'))
checks = []
with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    ctx = browser.new_context(viewport={'width': 1440, 'height': 900})
    ctx.add_init_script("localStorage.setItem('vessel.ui.lang', 'en')")
    page = ctx.new_page()
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    mutations = []
    page.on('request', lambda req: mutations.append({'url': req.url, 'method': req.method, 'body': req.post_data}) if req.method in ['POST', 'PATCH', 'DELETE'] else None)
    page.goto(META['url'])
    expect(page.locator('.task-composer')).to_be_visible()
    expect(page.locator('.task-composer button[type="submit"]')).to_be_disabled()
    expect(page.locator('[role="dialog"]')).to_have_count(0)
    page.locator('.task-composer textarea').fill('Inspect the workbench fixture without writing files')
    permission = page.locator('.task-composer select').last
    permission.select_option('read-only')
    expect(page.locator('.task-composer button[type="submit"]')).to_be_enabled()
    page.locator('.task-composer button[type="submit"]').click()
    expect(page.locator('.conversation')).to_be_visible()
    expect(page.locator('.message-list-scroll')).to_contain_text('Local fixture response', timeout=30000)
    turns = [item for item in mutations if item['url'].endswith('/turns')]
    sessions = [item for item in mutations if item['url'].endswith('/api/sessions')]
    assert len(turns) == 1 and len(sessions) == 1, mutations
    assert json.loads(sessions[0]['body'])['permission'] == 'read-only'
    checks.append({'check': 'inline start, exactly one session/turn, chosen backend permission', 'ok': True})
    before = page.locator('.message-list-scroll').inner_text()
    page.locator('[data-area="activity"]').click()
    expect(page.locator('.main-body .subagent-list')).to_be_visible()
    page.locator('[data-area="workbench"]').click()
    expect(page.locator('.message-list-scroll')).to_contain_text('Inspect the workbench fixture without writing files')
    expect(page.locator('.message-list-scroll')).to_contain_text('Local fixture response')
    checks.append({'check': 'area navigation retains conversation', 'ok': True})
    page.locator('[data-area="settings"]').click()
    baseline = len(mutations)
    page.locator('.main-body .customize-toggle').click()
    page.locator('.main-body .customize-popover input[type="checkbox"]').last.click()
    assert len(mutations) == baseline
    checks.append({'check': 'layout visibility never mutates backend policy', 'ok': True})
    page.keyboard.press('Escape')
    page.keyboard.press('Control+k')
    expect(page.locator('.command-dialog')).to_be_visible()
    palette_text = page.locator('[role="listbox"]').inner_text()
    assert 'sess_' not in palette_text and META['workspaceRoot'] not in palette_text
    page.locator('.command-dialog input').fill('Review workbench')
    page.keyboard.press('ArrowDown')
    page.keyboard.press('Enter')
    expect(page.locator('.conversation')).to_be_visible()
    checks.append({'check': 'semantic palette search and keyboard execution', 'ok': True})
    page.set_viewport_size({'width': 800, 'height': 900})
    expect(page.locator('.navigation-toggle')).to_be_visible()
    expect(page.locator('.primary-nav')).not_to_be_visible()
    page.locator('.navigation-toggle').click()
    expect(page.locator('.primary-nav')).to_be_visible()
    assert page.evaluate("document.querySelector('.navigation-shell').contains(document.activeElement)")
    for _ in range(100):
        page.keyboard.press('Tab')
        assert page.evaluate("document.querySelector('.navigation-shell').contains(document.activeElement)")
    for _ in range(100):
        page.keyboard.press('Shift+Tab')
        assert page.evaluate("document.querySelector('.navigation-shell').contains(document.activeElement)")
    page.keyboard.press('Escape')
    expect(page.locator('.primary-nav')).not_to_be_visible()
    expect(page.locator('.navigation-toggle')).to_be_focused()
    checks.append({'check': '800px navigation drawer and Escape', 'ok': True})
    page.set_viewport_size({'width': 1440, 'height': 900})
    page.locator('.sidebar > button').click()
    held = []
    def hold_creation(route):
        if route.request.method == 'POST':
            held.append(route)
        else:
            route.continue_()
    page.route('**/api/sessions', hold_creation)
    page.locator('.task-composer textarea').fill('Pending creation must keep its navigation ownership')
    expect(page.locator('.task-composer button[type="submit"]')).to_be_enabled()
    page.locator('.task-composer button[type="submit"]').click()
    expect(page.locator('.session-navigation')).to_have_attribute('inert', '')
    assert len(held) == 1
    page.keyboard.press('Control+k')
    page.locator('.command-dialog input').fill('Review workbench navigation')
    page.keyboard.press('Enter')
    expect(page.locator('.task-composer')).to_be_visible()
    expect(page.locator('.task-composer button[type="submit"]')).to_be_disabled()
    assert len(held) == 1
    held[0].fulfill(status=500, content_type='application/json', body='{"error":"fixture_creation_denied"}')
    expect(page.locator('.task-composer [role="alert"]')).to_be_visible()
    expect(page.locator('.task-composer textarea')).to_have_value('Pending creation must keep its navigation ownership')
    expect(page.locator('.session-navigation')).not_to_have_attribute('inert', '')
    page.unroute('**/api/sessions', hold_creation)
    checks.append({'check': 'pending creation owns navigation; failure retains draft; no duplicate create', 'ok': True})
    def fail_turn(route):
        route.fulfill(status=500, content_type='application/json', body='{"error":"fixture_turn_denied"}')
    page.route('**/turns', fail_turn)
    page.locator('.task-composer textarea').fill('Failed first task remains recoverable')
    page.locator('.task-composer button[type="submit"]').click()
    expect(page.locator('.conversation .composer-input')).to_have_value('Failed first task remains recoverable')
    assert sum(item['url'].endswith('/turns') and 'Failed first task' in (item['body'] or '') for item in mutations) == 1
    page.unroute('**/turns', fail_turn)
    checks.append({'check': 'first turn failure retains task without automatic retry', 'ok': True})
    assert not errors, errors
    checks.append({'check': 'no browser runtime errors', 'ok': True})
    ctx.close()
    browser.close()
(ROOT / 'browser-checks.json').write_text(json.dumps({'checks': checks, 'mutations': mutations}, indent=2), encoding='utf-8')
print(json.dumps(checks, indent=2))


