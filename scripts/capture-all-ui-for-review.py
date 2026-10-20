import os
import time
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path("E:/Code_file/Projects/Vessel_Harness")
OUT_DIR = ROOT / "export-for-gpt-review" / "screenshots"
OUT_DIR.mkdir(parents=True, exist_ok=True)

BASE_URL = "http://127.0.0.1:5678"

def set_theme(page, theme: str):
    page.evaluate(f"""
        (theme) => {{
            localStorage.setItem('vessel-theme', theme);
            document.documentElement.setAttribute('data-theme', theme);
            if (theme === 'dark') {{
                document.documentElement.classList.add('dark');
            }} else {{
                document.documentElement.classList.remove('dark');
            }}
        }}
    """, theme)
    page.wait_for_timeout(300)

def main():
    print(f"Starting complete UI capture against {BASE_URL}...")
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        # Desktop context 1440x900 (High-DPI Retina scale 2)
        context = browser.new_context(viewport={"width": 1440, "height": 900}, device_scale_factor=2)
        page = context.new_page()

        # 1. Workbench Home
        print("Capturing 01_workbench_home...")
        page.goto(BASE_URL, wait_until="networkidle")
        page.wait_for_timeout(1000)

        set_theme(page, "dark")
        page.screenshot(path=str(OUT_DIR / "01_workbench_home_dark.png"), full_page=False)
        set_theme(page, "light")
        page.screenshot(path=str(OUT_DIR / "01_workbench_home_light.png"), full_page=False)
        set_theme(page, "dark")

        # 2. TaskComposer with active input
        print("Capturing 02_task_composer_focused...")
        composer_input = page.locator("textarea").first
        if composer_input.is_visible():
            composer_input.fill("审查当前工程架构中的 Policy 引擎拦截链路、执行凭证审计逻辑以及 Edge-to-Edge 全屏通栏界面布局。")
            page.wait_for_timeout(400)
            page.screenshot(path=str(OUT_DIR / "02_task_composer_focused_dark.png"), full_page=False)
            set_theme(page, "light")
            page.screenshot(path=str(OUT_DIR / "02_task_composer_focused_light.png"), full_page=False)
            set_theme(page, "dark")
            composer_input.fill("")

        # 3. Conversation View (Load real session with history)
        print("Capturing 03_conversation_view...")
        page.goto(f"{BASE_URL}/?session=sess_1792469141159_8ff9e639", wait_until="networkidle")
        page.wait_for_timeout(1500)
        set_theme(page, "dark")
        page.screenshot(path=str(OUT_DIR / "03_conversation_view_dark.png"), full_page=False)
        set_theme(page, "light")
        page.screenshot(path=str(OUT_DIR / "03_conversation_view_light.png"), full_page=False)
        set_theme(page, "dark")

        # 4. Settings (Provider Hub Full-Screen)
        print("Capturing 04_provider_hub_settings...")
        page.goto(BASE_URL, wait_until="networkidle")
        page.wait_for_timeout(500)
        settings_btn = page.locator('button[data-area="settings"]')
        if settings_btn.is_visible():
            settings_btn.click()
            page.wait_for_timeout(1000)
            set_theme(page, "dark")
            page.screenshot(path=str(OUT_DIR / "04_provider_hub_settings_dark.png"), full_page=False)
            set_theme(page, "light")
            page.screenshot(path=str(OUT_DIR / "04_provider_hub_settings_light.png"), full_page=False)
            set_theme(page, "dark")

            # 5. Provider Hub Preset selection (Lark or DeepSeek)
            print("Capturing 05_provider_hub_preset_cards...")
            preset_btn = page.locator('button.preset-card').first
            if preset_btn.is_visible():
                preset_btn.click()
                page.wait_for_timeout(800)
                page.screenshot(path=str(OUT_DIR / "05_provider_hub_preset_detail_dark.png"), full_page=False)
                set_theme(page, "light")
                page.screenshot(path=str(OUT_DIR / "05_provider_hub_preset_detail_light.png"), full_page=False)
                set_theme(page, "dark")

        # 6. Activity Tab
        print("Capturing 06_activity_tab...")
        activity_btn = page.locator('button[data-area="activity"]')
        if activity_btn.is_visible():
            activity_btn.click()
            page.wait_for_timeout(1000)
            set_theme(page, "dark")
            page.screenshot(path=str(OUT_DIR / "06_activity_tab_dark.png"), full_page=False)
            set_theme(page, "light")
            page.screenshot(path=str(OUT_DIR / "06_activity_tab_light.png"), full_page=False)
            set_theme(page, "dark")

        # 7. Agent Studio Tab
        print("Capturing 07_agent_studio_tab...")
        studio_btn = page.locator('button[data-area="studio"]')
        if studio_btn.is_visible():
            studio_btn.click()
            page.wait_for_timeout(1000)
            set_theme(page, "dark")
            page.screenshot(path=str(OUT_DIR / "07_agent_studio_tab_dark.png"), full_page=False)
            set_theme(page, "light")
            page.screenshot(path=str(OUT_DIR / "07_agent_studio_tab_light.png"), full_page=False)
            set_theme(page, "dark")

        # 8. Command Palette (Ctrl+K)
        print("Capturing 08_command_palette...")
        wb_btn = page.locator('button[data-area="workbench"]')
        if wb_btn.is_visible():
            wb_btn.click()
            page.wait_for_timeout(500)
        page.keyboard.press("Control+k")
        page.wait_for_timeout(600)
        page.screenshot(path=str(OUT_DIR / "08_command_palette_ctrl_k_dark.png"), full_page=False)
        page.keyboard.press("Escape")
        page.wait_for_timeout(400)

        # 9. Model Quick Switcher Popover
        print("Capturing 09_model_quick_switcher...")
        switcher = page.locator('.model-switcher-trigger').first
        if switcher.is_visible():
            switcher.click()
            page.wait_for_timeout(500)
            page.screenshot(path=str(OUT_DIR / "09_model_quick_switcher_popover_dark.png"), full_page=False)
            page.keyboard.press("Escape")
            page.wait_for_timeout(300)

        context.close()

        # 10. Mobile Responsive (800x900)
        print("Capturing 10_mobile_responsive_800px...")
        m_context = browser.new_context(viewport={"width": 800, "height": 900}, device_scale_factor=2)
        m_page = m_context.new_page()
        m_page.goto(BASE_URL, wait_until="networkidle")
        m_page.wait_for_timeout(1000)
        set_theme(m_page, "dark")
        m_page.screenshot(path=str(OUT_DIR / "10_mobile_responsive_800px_dark.png"), full_page=False)
        set_theme(m_page, "light")
        m_page.screenshot(path=str(OUT_DIR / "10_mobile_responsive_800px_light.png"), full_page=False)
        m_context.close()

        browser.close()
        print(f"All UI modules successfully captured to: {OUT_DIR}")

if __name__ == "__main__":
    main()
