"""Optional authorized live smoke. Supply key via VESSEL_CARD219_KEY, never evidence."""
import json
import os
from datetime import datetime, timezone
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parent
meta = json.loads((ROOT / 'browser-fixture-meta.json').read_text(encoding='utf-8-sig'))
key = os.environ['VESSEL_CARD219_KEY']
result = {'at': datetime.now(timezone.utc).isoformat(), 'endpoint': 'http://127.0.0.1:7863/v1',
          'model': 'deepseek-v4.1-flash', 'checks': [], 'consoleErrors': [], 'pageErrors': [], 'passed': False}

def record(name):
    result['checks'].append({'check': name, 'ok': True})

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    context = browser.new_context(viewport={'width': 1440, 'height': 900})
    context.add_init_script("localStorage.setItem('vessel.ui.lang', 'en')")
    page = context.new_page()
    page.on('console', lambda msg: result['consoleErrors'].append(msg.text.replace(key, '[REDACTED]')) if msg.type == 'error' else None)
    page.on('pageerror', lambda err: result['pageErrors'].append(str(err).replace(key, '[REDACTED]')))
    try:
        page.goto(meta['url'])
        page.locator('.task-composer [data-action="configure-models"]').click()
        modal = page.locator('.provider-modal')
        modal.locator('select').first.select_option('custom')
        modal.locator('input[id$="-name"]').fill('workbuddy-card219-live')
        modal.locator('input[id$="-url"]').fill(result['endpoint'])
        modal.locator('input[id$="-key"]').fill(key)
        modal.locator('input[id$="-models"]').fill('')
        modal.get_by_role('button', name='Test connection', exact=True).click()
        expect(modal.locator('.provider-result.success')).to_be_visible(timeout=40000)
        record('Live connection probe through real local-server')
        modal.get_by_role('button', name='Pull models', exact=True).click()
        expect(modal.locator('input[id$="-models"]')).not_to_have_value('', timeout=40000)
        expect(modal.get_by_role('button', name='Pull models', exact=True)).to_be_enabled(timeout=40000)
        discovered = [model.strip() for model in modal.locator('input[id$="-models"]').input_value().split(',')]
        result['discoveredModels'] = discovered
        record('Live discovery populated model list')
        # This local gateway advertises cn: aliases; use its discovered wire ID.
        requested = result['model']
        result['requestedModel'] = requested
        result['model'] = next((model for model in discovered if model == requested or model.endswith(':' + requested)), requested)
        modal.locator('input[id$="-models"]').fill(result['model'])
        modal.get_by_role('button', name='Save', exact=True).click()
        expect(modal.locator('.provider-card').filter(has_text='workbuddy-card219-live')).to_be_visible(timeout=40000)
        expect(modal.locator('input[id$="-key"]')).to_have_value('')
        record('Saved only to isolated credential-backed provider root')
        modal.get_by_role('button', name='Close', exact=True).click()
        composer = page.locator('.task-composer')
        composer.locator('.model-pill').select_option(label='workbuddy-card219-live / ' + result['model'])
        composer.locator('select').last.select_option('read-only')
        composer.locator('textarea').fill('Reply with exactly VESSEL_CARD219_LIVE_OK. Do not call any tools.')
        with page.expect_response(lambda response: response.request.method == 'POST' and response.url.endswith('/turns'), timeout=120000) as completed:
            composer.locator('button[type="submit"]').click()
        expect(page.locator('.conversation')).to_be_visible(timeout=30000)
        expect(page.locator('.message-list-scroll')).to_contain_text('VESSEL_CARD219_LIVE_OK', timeout=120000)
        expect(page.locator('.composer button[type="submit"]')).to_have_text('Send', timeout=120000)
        # Prompt also contains the marker; require the server's completed assistant result.
        response = completed.value
        turn = response.json()
        result['turnStatus'] = response.status
        result['turnKind'] = turn.get('kind')
        result['assistantText'] = turn.get('finalText', '').replace(key, '[REDACTED]')
        assert response.ok and turn.get('kind') == 'success', 'Live turn did not succeed'
        assert 'VESSEL_CARD219_LIVE_OK' in turn.get('finalText', ''), 'No assistant marker returned'
        record('Live read-only turn completed with actual assistant response')
        page.screenshot(path=str(ROOT / 'live-workbuddy.png'), full_page=True)
        assert not result['consoleErrors'] and not result['pageErrors']
        record('Live browser console errors and uncaught exceptions zero')
        result['passed'] = True
    except Exception as exc:
        result['failure'] = str(exc).replace(key, '[REDACTED]')
    finally:
        # User authorized testing; remove only this fixture provider through its public API.
        response = page.request.delete(meta['url'] + '/api/providers/workbuddy-card219-live', headers={'Origin': meta['url']})
        result['cleanupStatus'] = response.status
        context.close()
        browser.close()
        (ROOT / 'live-workbuddy.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
        print(json.dumps(result, indent=2))
        if not result['passed']:
            raise SystemExit(1)
