import os
import time
from playwright.sync_api import sync_playwright

BASE_URL = "http://localhost:5173"
OUT_DIR = os.path.abspath("docs/screenshots")

def capture_lang(browser, lang):
    print(f"\n==========================================")
    print(f"=== Capturing screenshots for language: {lang} ===")
    print(f"==========================================")
    sub_dir = f"{OUT_DIR}/{lang}"
    os.makedirs(sub_dir, exist_ok=True)
    
    def make_page(viewport={"width": 1440, "height": 900}):
        ctx = browser.new_context(viewport=viewport, device_scale_factor=2)
        p = ctx.new_page()
        p.goto(BASE_URL)
        p.evaluate(f"localStorage.setItem('vessel.ui.lang', '{lang}')")
        p.reload()
        p.wait_for_load_state("domcontentloaded")
        p.wait_for_selector(".app, .topbar, .sidebar", timeout=10000)
        time.sleep(0.8)
        return ctx, p

    # 1. Overview
    ctx, page = make_page()
    page.screenshot(path=f"{sub_dir}/01-workbench-overview.png")
    print(f"[OK] {lang}/01-workbench-overview.png")
    ctx.close()

    # 2. Provider Settings Modal
    ctx, page = make_page()
    settings_btn = page.locator("button.btn:has-text('模型设置'), button.btn:has-text('Model settings')").first
    if settings_btn.count() > 0:
        settings_btn.click()
        page.wait_for_selector(".modal-backdrop, .provider-settings-modal, [role='dialog']", timeout=5000)
        time.sleep(0.8)
        page.screenshot(path=f"{sub_dir}/02-provider-settings.png")
        print(f"[OK] {lang}/02-provider-settings.png")
    ctx.close()

    # 3. Command Palette (Ctrl+K)
    ctx, page = make_page()
    page.keyboard.press("Control+k")
    time.sleep(0.8)
    page.screenshot(path=f"{sub_dir}/03-command-palette.png")
    print(f"[OK] {lang}/03-command-palette.png")
    ctx.close()

    # 4. New Session Form
    ctx, page = make_page()
    new_btn = page.locator("button:has-text('新建会话'), button:has-text('New session')").first
    if new_btn.count() > 0:
        new_btn.click()
        page.wait_for_selector(".overlay[role='dialog'], form.modal", timeout=5000)
        time.sleep(0.8)
        page.screenshot(path=f"{sub_dir}/04-new-session.png")
        print(f"[OK] {lang}/04-new-session.png")
    ctx.close()

    # 5. Customize Panel
    ctx, page = make_page()
    customize_btn = page.locator("button.customize-toggle, button:has-text('自定义'), button:has-text('Customize')").first
    if customize_btn.count() > 0:
        customize_btn.click()
        time.sleep(0.8)
        page.screenshot(path=f"{sub_dir}/05-customize-modules.png")
        print(f"[OK] {lang}/05-customize-modules.png")
    ctx.close()

    # 6. Responsive Mobile (800px width)
    ctx, page = make_page(viewport={"width": 800, "height": 850})
    time.sleep(0.8)
    page.screenshot(path=f"{sub_dir}/06-mobile-responsive-800px.png")
    print(f"[OK] {lang}/06-mobile-responsive-800px.png")
    ctx.close()

def run():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        capture_lang(browser, "zh")
        capture_lang(browser, "en")
        browser.close()
    print("\n[SUCCESS] All screenshots generated successfully in docs/screenshots/{zh,en}!")

if __name__ == "__main__":
    run()
