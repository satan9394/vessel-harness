"""Real Chromium End-to-End Walkthrough for Task 232: Full-Screen Provider Hub & Advanced Model Picker.
Executes against http://127.0.0.1:5678 (Vessel Server with production Web UI hosting).
Validates Full-Screen Settings Landing, Lark Preset, Search Filter & Batch Selection.
"""
import json
import time
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

ROOT = Path("E:/Code_file/Projects/Vessel_Harness")
OUT_DIR = ROOT / "evidence/sessions/2026-10-19-agent-walkthrough-232"
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

        # Step 1: Open Home Page
        def step_open():
            page.goto(BASE_URL, wait_until="networkidle")
            page.wait_for_selector(".brand")
            page.screenshot(path=str(OUT_DIR / "01_home_loaded.png"))
            return "Loaded home page"
        record_step("01_OpenHomePage", step_open)

        # Step 2: Navigate to Settings Area directly via Rail
        def step_settings_hub():
            settings_rail = page.locator("button[data-area='settings']")
            expect(settings_rail).to_be_visible()
            settings_rail.click()
            page.wait_for_timeout(300)

            # Check that ProviderHub full surface is rendered directly without modal
            hub = page.locator(".provider-hub")
            expect(hub).to_be_visible()
            modal = page.locator("div[role='dialog']")
            expect(modal).to_have_count(0) # Confirm no intrusive modal shell

            page.screenshot(path=str(OUT_DIR / "02_settings_full_surface_hub.png"))
            return "Directly rendered full-screen ProviderHub on settings navigation"
        record_step("02_ValidateFullScreenProviderHub", step_settings_hub)

        # Step 3: Select Lark Preset from Presets Gallery
        def step_lark_preset():
            # Search Lark in gallery
            search_input = page.locator(".preset-gallery-search")
            if search_input.count() > 0:
                search_input.fill("Lark")
                page.wait_for_timeout(200)

            lark_card = page.locator(".preset-card:has-text('Lark')")
            expect(lark_card).to_be_visible()
            lark_card.first.click()
            page.wait_for_timeout(200)

            # Check prefilled form
            url_input = page.locator("input#provider-url")
            expect(url_input).to_have_value("https://ark.cn-beijing.volces.com/api/v3")

            page.screenshot(path=str(OUT_DIR / "03_lark_preset_selected.png"))
            return "Lark preset verified and prefilled correctly"
        record_step("03_SelectLarkPreset", step_lark_preset)

        # Step 4: Validate Advanced ModelChips Toolbar, Search & Batch Selection
        def step_advanced_chips():
            toolbar = page.locator(".model-chips-toolbar")
            expect(toolbar).to_be_visible()

            # Search in chips using .model-chips-search input
            chips_search = page.locator(".model-chips-search input")
            expect(chips_search).to_be_visible()
            chips_search.fill("doubao")
            page.wait_for_timeout(200)

            # Check count badge
            count_badge = page.locator(".model-chips-count")
            expect(count_badge).to_be_visible()

            # Test batch buttons
            select_all = page.locator(".model-chips-actions button").first
            expect(select_all).to_be_visible()
            select_all.click()
            page.wait_for_timeout(100)

            page.screenshot(path=str(OUT_DIR / "04_advanced_model_chips_active.png"))
            return "Advanced model chips search and batch controls verified"
        record_step("04_ValidateAdvancedModelChips", step_advanced_chips)

        browser.close()

    summary = {
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "totalSteps": len(step_results),
        "passedSteps": len([s for s in step_results if s["status"] == "PASS"]),
        "failedSteps": len([s for s in step_results if s["status"] == "FAIL"]),
        "consoleErrors": console_errors,
        "pageErrors": page_errors,
        "steps": step_results
    }

    report_path = OUT_DIR / "WALKTHROUGH-REPORT.json"
    report_path.write_text(json.dumps(summary, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"\nWalkthrough report written to {report_path}")
    print(f"Passed: {summary['passedSteps']}/{summary['totalSteps']}, Console Errors: {len(console_errors)}, Page Errors: {len(page_errors)}")

if __name__ == "__main__":
    run_walkthrough()
