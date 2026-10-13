"""Capture the bilingual UI; VESSEL_SCREENSHOT_URL selects an isolated fixture.

Run the card218 browser fixture first for deterministic project/model/session data.
All requested views must exist: missing selectors or horizontal overflow fail closed.
"""
import json
import os
from pathlib import Path
from playwright.sync_api import sync_playwright

BASE_URL = os.environ.get("VESSEL_SCREENSHOT_URL", "http://localhost:5173")
OUT_DIR = Path("docs/screenshots").resolve()
EVIDENCE = Path(os.environ.get("VESSEL_SCREENSHOT_EVIDENCE", "evidence/sessions/2026-10-12-card218")).resolve()


def capture_lang(browser, lang, checks):
    target = OUT_DIR / lang
    target.mkdir(parents=True, exist_ok=True)

    def make_page(width=1440, height=900):
        ctx = browser.new_context(viewport={"width": width, "height": height}, device_scale_factor=2)
        ctx.add_init_script("localStorage.setItem('vessel.ui.lang', " + json.dumps(lang) + ")")
        page = ctx.new_page()
        page.goto(BASE_URL)
        page.locator(".task-composer").wait_for()
        page.wait_for_function("!document.querySelector('.task-composer select:disabled')")
        return ctx, page

    def capture(name, action=None):
        ctx, page = make_page()
        try:
            if action:
                action(page)
            page.screenshot(path=str(target / name))
            checks.append({"lang": lang, "view": name, "ok": True})
            print(f"[OK] {lang}/{name}", flush=True)
        finally:
            ctx.close()

    capture("01-workbench-overview.png")

    def providers(page):
        page.locator('[data-area="settings"]').click()
        page.locator('[data-action="configure-models"]').first.click()
        page.locator(".provider-modal").wait_for()
    capture("02-provider-settings.png", providers)

    def palette(page):
        page.keyboard.press("Control+k")
        page.locator(".command-dialog").wait_for()
        assert "sess_" not in page.locator('[role="listbox"]').inner_text()
    capture("03-command-palette.png", palette)

    def advanced(page):
        page.locator('[data-action="advanced-session"]').click()
        page.locator("form.modal").wait_for()
    capture("04-new-session.png", advanced)

    def layout(page):
        page.locator('[data-area="settings"]').click()
        page.locator(".main-body .customize-toggle").click()
        page.locator(".main-body .customize-popover").wait_for()
    capture("05-customize-modules.png", layout)

    for width, height in [(375, 812), (390, 844), (768, 1024), (800, 900), (1024, 768), (1280, 800), (1440, 900)]:
        ctx, page = make_page(width, height)
        try:
            dimensions = page.evaluate("({scroll: document.documentElement.scrollWidth, viewport: innerWidth})")
            assert dimensions["scroll"] <= dimensions["viewport"], dimensions
            if width == 800:
                page.screenshot(path=str(target / "06-mobile-responsive-800px.png"))
            checks.append({"lang": lang, "viewport": [width, height], "overflow": dimensions, "ok": True})
        finally:
            ctx.close()


def run():
    checks = []
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        try:
            for lang in ["zh", "en"]:
                capture_lang(browser, lang, checks)
        finally:
            browser.close()
    EVIDENCE.mkdir(parents=True, exist_ok=True)
    (EVIDENCE / "screenshot-checks.json").write_text(json.dumps({"url": BASE_URL, "checks": checks}, indent=2), encoding="utf-8")
    print("[SUCCESS] All 12 bilingual Retina screenshots refreshed; responsive checks passed.")


if __name__ == "__main__":
    run()
