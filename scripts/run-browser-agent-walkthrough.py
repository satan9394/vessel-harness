"""Real Chromium End-to-End Walkthrough for Task 228/229/230 CDS UI Elevation.
Executes against http://127.0.0.1:5678 (Vessel Server with production Web UI hosting).
Captures screenshots and validates DOM contracts, zero console errors, and interaction flows.
"""
import json
import os
import sys
import time
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

ROOT = Path("E:/Code_file/Projects/Vessel_Harness")
OUT_DIR = ROOT / "evidence/sessions/2026-10-19-agent-walkthrough"
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
            step_results.append({"step": name, "status": "FAIL", "durationMs": duration, "error": str(e)})
            print(f"[FAIL] {name} ({duration}ms): {e}", flush=True)

    with sync_playwright() as p:
        print(f"Launching Chromium (headless=True)...")
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
            return "Loaded brand and navigation"
        record_step("01_OpenHomePage", step_open)

        # Step 2: Validate Sidebar & Date Grouping
        def step_sidebar():
            sidebar = page.locator(".sidebar")
            expect(sidebar).to_be_visible()
            
            # Check search capsule
            search_input = page.locator(".topic-search")
            expect(search_input).to_be_visible()
            search_input.fill("test")
            time.sleep(0.2)
            search_input.fill("")
            
            # Check period labels or groups
            period_labels = page.locator(".topic-period-label")
            count = period_labels.count()
            
            # Hover over a topic row to test inline action reveal
            topic_heading = page.locator(".topic-heading").first
            if topic_heading.count() > 0:
                topic_heading.hover()
                time.sleep(0.15)

            # Screenshot Sidebar area
            page.screenshot(path=str(OUT_DIR / "01-sidebar-cds.png"))
            return f"Sidebar verified, {count} period labels found"
        record_step("02_ValidateSidebar", step_sidebar)

        # Step 3: Validate TaskComposer & CDS Concentric Surface
        def step_composer():
            composer = page.locator(".task-composer")
            expect(composer).to_be_visible()

            # Check textarea
            textarea = page.locator("#taskInput")
            expect(textarea).to_be_visible()
            
            # Focus textarea to trigger focus-within shadow & hairline
            textarea.focus()
            textarea.fill("深度优化界面结构，对齐 Claude Design System 规范")
            time.sleep(0.2)

            # Check capsule selects
            capsules = page.locator(".capsule-select")
            capsule_count = capsules.count()

            # Submit button
            submit_btn = page.locator('button[type="submit"]').first
            expect(submit_btn).to_be_visible()
            expect(submit_btn).to_be_enabled()

            # Screenshot Composer
            page.screenshot(path=str(OUT_DIR / "02-task-composer-cds.png"))
            return f"Composer verified with {capsule_count} capsule selects"
        record_step("03_ValidateTaskComposer", step_composer)

        # Step 4: Command Palette (Ctrl+K)
        def step_palette():
            page.keyboard.press("Control+k")
            palette = page.locator(".command-dialog")
            expect(palette).to_be_visible()
            page.screenshot(path=str(OUT_DIR / "03-command-palette.png"))
            page.keyboard.press("Escape")
            time.sleep(0.2)
            expect(palette).not_to_be_visible()
            return "Command Palette opened and closed with Escape"
        record_step("04_ValidateCommandPalette", step_palette)

        # Step 5: Primary Navigation Walkthrough
        def step_navigation():
            for area in ["activity", "studio", "settings", "workbench"]:
                btn = page.locator(f'[data-area="{area}"]')
                if btn.count() > 0:
                    btn.click()
                    time.sleep(0.3)
                    if area == "settings":
                        page.screenshot(path=str(OUT_DIR / "04-settings-surface.png"))
            return "Primary navigation cycle completed"
        record_step("05_ValidatePrimaryNavigation", step_navigation)

        # Step 6: Responsive 800px Walkthrough
        def step_responsive():
            page.set_viewport_size({"width": 800, "height": 900})
            time.sleep(0.3)
            overflow = page.evaluate("({scroll: document.documentElement.scrollWidth, viewport: window.innerWidth})")
            assert overflow["scroll"] <= overflow["viewport"], f"Horizontal overflow detected: {overflow}"
            page.screenshot(path=str(OUT_DIR / "05-responsive-800px.png"))
            return f"Responsive 800px verified: scrollWidth={overflow['scroll']}px <= viewport={overflow['viewport']}px"
        record_step("06_ValidateResponsive800px", step_responsive)

        browser.close()

    # Save summary
    all_passed = all(s["status"] == "PASS" for s in step_results)
    summary = {
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "url": BASE_URL,
        "all_passed": all_passed,
        "console_errors_count": len(console_errors),
        "console_errors": console_errors,
        "page_errors_count": len(page_errors),
        "page_errors": page_errors,
        "steps": step_results
    }
    (OUT_DIR / "walkthrough-summary.json").write_text(json.dumps(summary, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"\nWalkthrough completed. All passed: {all_passed}. Console errors: {len(console_errors)}. Page errors: {len(page_errors)}.")
    return all_passed and len(console_errors) == 0 and len(page_errors) == 0

if __name__ == "__main__":
    success = run_walkthrough()
    sys.exit(0 if success else 1)
