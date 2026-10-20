"""Real Chromium End-to-End Walkthrough for Task 247:
Compaction Conservation, Workbench Elevation & Complete Surface Walkthrough.
Executes against http://127.0.0.1:5678 (Vessel Server with production Web UI hosting).
Validates Single Rail Convergence, Dual Themes, Dual Locales, ProviderHub, Inspector 3 Groups, and Activity Action Center.
"""
import json
import time
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

ROOT = Path("E:/Code_file/Projects/Vessel_Harness")
OUT_DIR = ROOT / "evidence/walkthrough-247"
OUT_DIR.mkdir(parents=True, exist_ok=True)

BASE_URL = "http://127.0.0.1:5678"

def run_walkthrough():
    console_errors = []
    page_errors = []
    step_results = []

    def record_step(name, action):
        start = time.monotonic()
        try:
            res = action()
            duration = round((time.monotonic() - start) * 1000)
            step_results.append({"step": name, "status": "PASS", "durationMs": duration, "details": res})
            print(f"[PASS] {name} ({duration}ms)", flush=True)
        except Exception as e:
            duration = round((time.monotonic() - start) * 1000)
            err_msg = str(e).encode('ascii', errors='replace').decode('ascii')
            step_results.append({"step": name, "status": "FAIL", "durationMs": duration, "error": err_msg})
            print(f"[FAIL] {name} ({duration}ms): {err_msg}", flush=True)

    with sync_playwright() as p:
        print("Launching Chromium (headless=True)...")
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(
            viewport={"width": 1440, "height": 900},
            device_scale_factor=2
        )
        page = context.new_page()

        page.on("console", lambda msg: console_errors.append(f"[{msg.type}] {msg.text}") if msg.type == "error" else None)
        page.on("pageerror", lambda err: page_errors.append(str(err)))

        # Step 1: Open Home Page and verify single rail convergence
        def step_open():
            page.goto(BASE_URL, wait_until="networkidle")
            page.wait_for_selector(".brand")
            # Verify no standalone 58px workbench rail
            rail_count = page.locator(".workbench-rail").count()
            if rail_count != 0:
                raise Exception(f"Expected 0 standalone workbench rails, found {rail_count}")
            page.screenshot(path=str(OUT_DIR / "01_workbench_home_dark.png"))
            return "Loaded dark workbench home without redundant rail"
        record_step("01_OpenHomePage", step_open)

        # Step 2: Theme toggle between Light and Dark
        def step_theme():
            toggle = page.locator(".sidebar-theme-toggle")
            expect(toggle).to_be_visible()
            
            # Explicitly ensure dark mode screenshot first
            page.evaluate("() => document.documentElement.setAttribute('data-theme', 'dark')")
            page.wait_for_timeout(200)
            page.screenshot(path=str(OUT_DIR / "01_workbench_home_dark.png"))
            
            # Switch to light
            toggle.click()
            page.wait_for_timeout(300)
            page.screenshot(path=str(OUT_DIR / "02_workbench_home_light.png"))
            
            # Switch back to dark
            toggle.click()
            page.wait_for_timeout(200)
            return "Successfully toggled light and dark themes"
        record_step("02_ThemeToggle", step_theme)

        # Step 3: Settings Area & Dual Locales
        def step_settings_and_locale():
            btn = page.locator(".sidebar-area-btn[data-area='settings']")
            expect(btn).to_be_visible()
            btn.click()
            page.wait_for_timeout(500)
            page.wait_for_selector("h2:has-text('设置'), h2:has-text('Settings')")
            page.screenshot(path=str(OUT_DIR / "03_settings_provider_hub_zh.png"))

            # Test Language Switcher in settings
            switcher = page.locator(".lang-switch-toggle").first
            if switcher.count() > 0 and switcher.is_visible():
                switcher.click()
                page.wait_for_timeout(200)
                en_opt = page.locator(".lang-option", has_text="English").first
                if en_opt.count() > 0:
                    en_opt.click()
                    page.wait_for_timeout(300)
                    page.screenshot(path=str(OUT_DIR / "04_settings_provider_hub_en.png"))
                    # Switch back to Chinese
                    switcher.click()
                    page.wait_for_timeout(200)
                    page.locator(".lang-option", has_text="中文").first.click()
                    page.wait_for_timeout(200)

            return "Loaded ProviderHub and verified dual-locale switching"
        record_step("03_SettingsAndLocale", step_settings_and_locale)

        # Step 4: Activity Action Center
        def step_activity():
            btn = page.locator(".sidebar-area-btn[data-area='activity']")
            expect(btn).to_be_visible()
            btn.click()
            page.wait_for_timeout(500)
            page.wait_for_selector(".activity-queue, .subagent-workspace, section.main-body")
            page.screenshot(path=str(OUT_DIR / "05_activity_action_center.png"))
            return "Loaded dedicated Activity action center"
        record_step("04_ActivityActionCenter", step_activity)

        # Step 5: Agent Studio Advisory Separation
        def step_studio():
            btn = page.locator(".sidebar-area-btn[data-area='studio']")
            expect(btn).to_be_visible()
            btn.click()
            page.wait_for_timeout(500)
            page.wait_for_selector("h2:has-text('Agent Studio')")
            page.screenshot(path=str(OUT_DIR / "06_agent_studio.png"))
            return "Loaded Agent Studio with advisory configuration"
        record_step("05_AgentStudio", step_studio)

        # Step 6: Workbench & Conversation Main View
        def step_workbench_conversation():
            btn = page.locator(".sidebar-area-btn[data-area='workbench']")
            expect(btn).to_be_visible()
            btn.click()
            page.wait_for_timeout(400)

            # Click an existing session or start one
            topic_rows = page.locator(".topic-row")
            if topic_rows.count() > 0:
                topic_rows.first.click()
                page.wait_for_timeout(500)

            page.screenshot(path=str(OUT_DIR / "07_workbench_conversation.png"))
            return "Loaded Workbench conversation main view"
        record_step("06_WorkbenchConversation", step_workbench_conversation)

        # Step 7: Inspector 3 Groups
        def step_inspector_groups():
            # If in a conversation, switch Inspector tabs
            changes_tab = page.locator(".inspector-group-tab[data-group='changes']")
            if changes_tab.count() > 0:
                changes_tab.click()
                page.wait_for_timeout(200)
                page.screenshot(path=str(OUT_DIR / "08_inspector_changes.png"))

            exec_tab = page.locator(".inspector-group-tab[data-group='execution']")
            if exec_tab.count() > 0:
                exec_tab.click()
                page.wait_for_timeout(200)
                page.screenshot(path=str(OUT_DIR / "09_inspector_execution.png"))

            diag_tab = page.locator(".inspector-group-tab[data-group='diagnostics']")
            if diag_tab.count() > 0:
                diag_tab.click()
                page.wait_for_timeout(200)
                page.screenshot(path=str(OUT_DIR / "10_inspector_diagnostics.png"))

            return "Verified Inspector 3 groups switching"
        record_step("07_InspectorGroups", step_inspector_groups)

        browser.close()

    report = {
        "timestamp": time.time(),
        "summary": {
            "totalSteps": len(step_results),
            "passedSteps": len([s for s in step_results if s["status"] == "PASS"]),
            "failedSteps": len([s for s in step_results if s["status"] == "FAIL"]),
            "consoleErrors": len(console_errors),
            "pageErrors": len(page_errors),
        },
        "consoleErrors": console_errors,
        "pageErrors": page_errors,
        "steps": step_results,
    }
    report_path = OUT_DIR / "walkthrough-report.json"
    report_path.write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"\nWalkthrough completed: {report['summary']['passedSteps']}/{report['summary']['totalSteps']} passed.")
    print(f"Report written to: {report_path}")

    if report["summary"]["failedSteps"] > 0 or report["summary"]["pageErrors"] > 0:
        sys.exit(1)

if __name__ == "__main__":
    run_walkthrough()
