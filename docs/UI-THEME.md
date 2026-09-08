# Vessel UI 主题约定（UI-THEME.md）

> 适用于项目产出的所有**静态 HTML 可视化 / 设计稿 / 未来 Web 前端**。
> 一句话：**浅色为默认；深色跟随系统自动适配（`prefers-color-scheme`），不做手动切换按钮。**

---

## 1. 目标语义（用户拍板，2026-09）

- 用户打开页面时，**默认就是系统当前主题**：系统浅色 → 页面浅色；系统深色 → 页面深色。
- 不提供"浅/深/自动"手动切换器——简单处理，纯跟随系统。
- 全部颜色用 CSS 变量，浅色值放 `:root`，深色值放 `@media (prefers-color-scheme: dark)` 覆盖。

## 2. 标准模板（新页面照此写）

```html
<!DOCTYPE html>
<html lang="zh-CN" style="color-scheme: light dark">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
  :root {
    /* 浅色默认（GitHub light 系） */
    --bg:#ffffff; --panel:#f6f8fa; --panel2:#eef1f5; --border:#d0d7de;
    --text:#1f2328; --dim:#57606a; --accent:#0969da; --green:#1a7f37;
    --yellow:#9a6700; --red:#cf222e; --purple:#8250df; --pink:#bf3989;
    --text-soft:#3d444d; --pre-bg:#f6f8fa; --pre-fg:#1f2328; --pre-cmt:#6e7781;
    --hover:#eef1f5; --code-bg:#eef1f5; --row-line:#e3e8ee;
  }
  body { background:var(--bg); color:var(--text); }
  /* ……其余样式一律用 var()，禁止硬编码色值…… */

  /* 深色模式：跟随系统自动切换 */
  @media (prefers-color-scheme: dark){
    :root {
      --bg:#0d1117; --panel:#161b22; --panel2:#1c2333; --border:#30363d;
      --text:#e6edf3; --dim:#8b949e; --accent:#58a6ff; --green:#3fb950;
      --yellow:#d29922; --red:#f85149; --purple:#bc8cff; --pink:#f778ba;
      --text-soft:#c9d1d9; --pre-bg:#0d1117; --pre-fg:#d2d8e0; --pre-cmt:#566070;
      --hover:#1b2230; --code-bg:#232a36; --row-line:#21262d;
    }
  }
</style>
```

## 3. 铁律

1. **颜色只写 CSS 变量**：`var(--bg)` / `var(--accent)` …，禁止在样式里硬编码 hex（除非该色两主题一致，如纯功能色）。
2. `<html>` 标签带 `style="color-scheme: light dark"`——让滚动条/表单等原生控件也跟随系统，避免深色下白控件。
3. 新颜色先加变量：两套值都定义（浅色在 :root、深色在 media query），再使用。
4. 状态色语义统一：绿=成功/online、黄=警告/写入、红=错误/danger、蓝=链接/强调（已内置变量）。
5. 视觉稿交付前必须**双主题各截一张**确认（浅色白底深字、深色无残留浅块、对比度达标）。

## 4. 已遵循本约定的页面

- `docs/agent-cli-analysis.html`（设计来源可视化，三标签页）
- `docs/ui-split-layout.html`（opencode 式分栏 UI 设计稿）

## 5. 验证方式

```powershell
# 无头截图（浅色，默认）—— vision_html_screenshot
# 深色：系统切深色模式后刷新，或 headless Chrome 加 --force-dark-mode 截图比对
# 肉眼检查：无深色残留浅块 / 无浅色下看不清的浅灰字 / 控件配色正常
```
