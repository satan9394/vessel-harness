让我仔细审查这份代码。用户要求对 Task 232 进行对抗性审查，我们需要：

1. 全屏独立工作台 (ProviderHub.tsx & App.tsx)
2. 高级模型筛选器 (ModelChips.tsx)
3. Lark 预设补齐
4. 代码契约、向后兼容性、红线

先看关键代码。

**ProviderHub.tsx**：
```tsx
export default function ProviderHub({ api, onChanged, initialPreset }: {...}) {
  return <ProviderSettingsModal api={api} onChanged={onChanged} initialPreset={initialPreset} embedded />;
}
```
这就是一个薄包装。它确实消除了 Settings 区域只有按钮的尴尬，App.tsx 中 settings area 渲染了 ProviderHub。但是问题：

- ProviderHub 没有传 onClose，这没问题因为 embedded。
- 但是 initialPreset 作为 prop 传进来，App.tsx 中 `initialPreset={providerPreset}`，但 providerPreset 只在通过 TaskComposer 的 onConfigureModels(preset) 设置。Settings 区域中的 providerPreset 可能不会重置。而且 App.tsx 中 providerPreset 的状态在设置 showProviders 时设置，在关闭 modal 时清空。但是应用到 Settings 区域的 ProviderHub：`<ProviderHub api={api} initialPreset={providerPreset} ...>`，如果 providerPreset 被设置且关闭了 modal，providerPreset 被清空，ProviderHub 的 initialPreset 变为 undefined，但它内部有一个 useEffect 处理 initialPreset 变化。但 ProviderSettingsModal 中 `const [preset, setPreset] = useState(initialPreset && ...)` 仅初始化一次，然后 useEffect 处理 initialPreset 变化。没问题。

**关键问题：embedded 模式下的 ProviderSettingsModal 有一个重大缺陷**：`useId()` 被替换为 `const id = 'provider'`。评论说���ProviderSettingsModal.tsx 既有 exports 与 DOM ID 是否完全向下兼容”。原来用 `useId()` 生成唯一 ID，现在改为固定 'provider'。这会导致：

1. 如果页面上同时有 modal 和非 modal 实例（不太可能，因为 showProviders && area !== 'settings'，但 ProviderHub 在 settings area 中渲染，modal 不在 settings 中渲染，所以同一时间只有一个实例）。实际上在 App.tsx 中，settings 区域渲染 ProviderHub，modal 仅在 `showProviders && area !== 'settings'` 时渲染。所以两者不会同时渲染。但是，`useId` 改为固定 'provider' 可能违反 React 的 ID 唯一性约定，虽然目前只有一个实例。但更重要的是：**DOM ID 兼容性** – 原来 ID 是随机生成的，所以其实并不存在“既有 DOM ID”被外部依赖的问题。但是，`id` 被用于输入框的 id 和 label 的 htmlFor。如果有测试依赖 `#provider-key`？在 App.tsx 中 command palette 的 providers 命令使用 `document.querySelector<HTMLInputElement>('#provider-key')?.focus()`。搜索 `#provider-key`：在 diff 中 fieldset 里有 `<input id={`${id}-key`} ...>`？我们没看到完整的 fieldset，但很可能有 `id={`${id}-apiKey`}` 之类。Command 中使用 `#provider-key`，说明某处有一个 id 为 `provider-key` 的元素。如果原来 `useId()` 生成的是��似 `:r1:-key`，那么 command 的 `#provider-key` 本来就不匹配。除非原始代码中曾经使用固定 id。等等，diff 中原始代码是 `const id = useId();`，而 command palette 的 `#provider-key` 是新增的。可能开发者假设 id 变成了 'provider'，所以想聚焦 `#provider-key`。但是字段的 id 是 `${id}-name`、`${id}-protocol`、`${id}-url`…… apiKey 的 id 可能是 `${id}-key` 或 `${id}-apiKey`。我们需要看到完整代码。从 diff 中可见的 fieldset 包含 preset, name, protocol, url，后续被截断。假设有 apiKey 字段，它的 id 可能是 `${id}-key`。如果 id='provider'，那么 `#provider-key` 存在。但这依赖未展示的代码。命令 execute 中 `document.querySelector<HTMLInputElement>('#provider-key')?.focus()` 在 embedded provider hub 中可用（因为 embedded 没有 modal，但 DOM 中仍然存在）。但如果在 settings 区域中 ProviderHub 渲染时，id 固定为 'provider'，那 `#provider-key` 应该存在。问题是：**如果 modal 同时存在呢？** 由于 `showProviders && area !== 'settings'`，当 settings 区域中时 modal 不渲染。所以唯一。

2. **`useId` 移除引入的 a11y/SSR 问题**：固定 id 在页面多个实例时会冲突。虽然目前没有多个实例，但 ProviderSettingsModal 是一个可复用组件，导出的默��组件可能被其他页面使用，或者在测试中同时挂载两个实例。这是一个向后兼容性风险。**严重程度中等**，需要指出。

3. **`const id = 'provider'` 破坏了 useId 的稳定性与唯一性契约**。更好的做法是保留 useId 并额外添加一个固定的 DOM id 用于 command palette，或使用 `useId` 生成 id 然后在 command palette 中通过其他方式定位。这需要审查。

**ModelChips.tsx 审查**：

- `all = [...new Set([...models, ...selected])]`，合并候选模型与已选模型，确保已选模型即使不在候选列表中也显示。
- 搜索：query 实时过滤。大小写不敏感。OK。
- 分段过滤 all/selected/unselected。OK。
- 批量操作仅作用于 visible 模型。OK。
- 计数徽章：`t('modelSearchCount', { selected, total })`。OK。
- 滚动区域：`model-chips-scroll`，但 CSS 未提供，无法验证羽化遮罩。代码中有 tabIndex=0 和 role=group。
- 回车添加模型：`onKeyDown` 处理 Enter，检查 isComposing 和 keyCode 229。OK。但使用 `event.keyCode` 已废弃，虽然作为兼容性可以。检查非法字符 `/[\x00-\x1f\x7f,，]/`。OK。
- 星标设为默认：`onSetDefault` 只在 active 时显示，按 model === defaultModel 显示 ★/☆。OK。
- a11y：
  - `role="group" aria-label` 在两个地方���复：外层 div 和内层 filters、scroll。外层 model-chips 有 role=group，内层还有两个 role=group，嵌套 group 本身不是错误，但过多。
  - `aria-pressed={active}` 在 model-chip-toggle 上，用于表示选中状态。这是 button 的 toggle 状态，合理。
  - `role="status"` 计数。OK。
  - 搜索清除按钮有 aria-label。OK。
  - **问题：`onRemove` 按钮的显示条件**：`{onRemove && (!active || !models.includes(model)) && ...}`。这意味着对于已选模型且存在于 models 中的，不显示移除按钮；对于已选但不在 models 中的，显示移除按钮；对于未选模型，显示移除按钮。这在逻辑上是为了移除“自定义”模型？但语义混乱：已选且属于候选模型的标签无法被移除，只能通过 onToggle 取消选中。而“移除”按钮出现在未选模型上，点击会调用 onRemove(model)，但该模型未选，通常移除应该从候选列表中删除。行为取决于父组件实现。代码本身可接受，但 UI 语义值得质疑：为什么一个未选中的模型标签上有 × 按钮？这可能造成用户困惑。如果 onRemove 是“从候选中移除”，那么对未选模型显示合理；但对已选且不在候选中显示也合理。对已选且在候选中不显示则合理。这是有意的设计。可以接受，但需审查是否与父组件语义一致。
  - **关键 a11y 问题**：`model-chip-toggle` 是一个 button，外层 `span` 没有 role。`aria-pressed` 表示选中。但是选中时显示 `{active && <span aria-hidden="true">✓ </span>}{model}`，视觉上的 ✓ 对屏幕阅读器隐藏，而 aria-pressed 会播报 pressed。OK。
  - 搜索输入 `type="search"` 有 aria-label，OK。
  - **焦点管理**：批量操作后，焦点可能保留在按钮上，但列表更新。没有 live region 声明选中数量变化？有 role=status 的计数，它会播报变化。OK。
  - **回车添加模型时，没有在 onAdd 后清空草稿并保持焦点？** 会清空 draft。OK。
  - **模型列表的虚拟化**：海量模型（如 OpenRouter 数百个）全部渲染为 DOM 节点，没有虚拟化。CSS 滚动 + 羽化遮罩是视觉缓解，但性能上可能有问题。要求是“滚动羽化遮罩与自适应排版”，代码里只有滚动容器，没有明确虚拟化。可以指出但非阻断。

**批量反选逻辑**：
```js
function bulk(action) {
  const next = new Set(selected);
  for (const model of visible) {
    if (action === 'deselect' || (action === 'invert' && selection.has(model))) next.delete(model);
    else next.add(model);
  }
  onSelectionChange([...next]);
}
```
- select：添加所有 visible（无论是否已选，Set 去重）。OK。
- deselect：删除所有 visible。OK。
- invert：对 visible 中已选的删除，未选的添加。OK。
- 注意：批量操作仅影响 visible，这符合过滤场景。但用户可能期望“全选”针对所有模型而非过滤后可见模型。按钮文案 `selectAll` 可能与行为不符。需要指出：在过滤状态下，点击“全选”只会选中当前筛选结果，而不是全部模型。这可能是设计意图（让批量操作作用于当前视图），但 i18n 文案若为“全选”可能误导。需要检查文案是否可以说明“全选当前筛选结果”。这是一个 UX 细节，值得指出。

**计数徽章使用 `modelSearchCount`**：selected 计数是 `selection.size`，total 是 `all.length`。如果 selected 包含不在 models 中的模型，`all` 已包含 selected，所以 total 正确。

**过滤按钮计数**：unselected 计数 = all.length - selection.size，正确。

**搜索清除按钮在无 query 时不渲染**，布局可能跳动，但可接受。

**ModelChips 中 `useI18n` 的 t 函数**：未提供翻译键是否都存在。需要检查 i18n 是否新增了 `modelSearchPlaceholder`、`modelFilterAll`、`modelFilterSelected`、`modelFilterUnselected`、`selectAll`、`deselectAll`、`invertSelection`、`modelSearchCount`、`modelSearchClear`、`modelSetAsDefault`、`modelRemove`、`modelAddPlaceholder`、`presetNoResults`、`providerModels` 等。Diff 未展示 i18n 修改。这是**重大遗漏**：新增的 i18n 键如果没有在语言文件中定义，`t` 会返回什么？可能返回键本身或空。需要检查。任务要求“是否提供了实时搜索框……”但 i18n 完整性是红线。没有看到 i18n diff，所以必须指出风险。

**ProviderSettingsModal 审查**：

- `initialPreset` useEffect：
```js
useEffect(() => {
  if (initialPreset) pickPreset(initialPreset);
}, [initialPreset]);
```
`pickPreset` 内部调用 `change(next)`，而 `change` 定义在组件作用域内，每次渲染重新创建。effect 依赖只有 initialPreset，ESLint exhaustive-deps 会警告，但功能上 pickPreset 使用当前闭包。这可能导致 stale closure 问题？pickPreset 只使用 setState 函数和 PROVIDER_PRESETS，不依赖其他状态，所以安全。但 lint 会报。可接受但不优雅。更重要的：**当 initialPreset 与当前 preset 相同时，effect 仍会执行 pickPreset，重置表单**。例如用户已编辑表单，然后父组件重渲染但 initialPreset 引用不变，effect 不执行（依赖相同）。但如果 initialPreset 从 'lark' 变为 'lark'（相同字符串），不执行。OK。但如果��组件传入的 initialPreset 在用户编辑后变化，会覆盖用户编辑，这是预期的（打开指定预设）。在 embedded 模式下，initialPreset 可能来自 App 的 providerPreset，当用户通过 TaskComposer 触发 modal 时 providerPreset 设置，modal 关闭时清空。但 Settings 中的 ProviderHub 也接收 providerPreset。如果用户在 Settings 中，点击 TaskComposer 的配置模型按钮会打开 modal（因为 area 是 settings？等等：TaskComposer 只在 workbench 中渲染。当 area=settings 时，workbench 隐藏（hidden），但 TaskComposer 仍挂载在 DOM 中？`<div className="workbench-region" hidden={area !== 'workbench'}>`，所以 TaskComposer 仍然渲染，只是 hidden。如果用户在 settings 中，TaskComposer 是 hidden 但仍在 DOM，其 onConfigureModels 可能被触发吗？hidden 元素不可交互，所以不会。好。

- **embedded 模式下 `role` 改为 `region`，`aria-modal` 移除。** 但 `tabIndex={-1}` 保留，`onKeyDown` 在 embedded 时直接 return。OK。但是 embedded 模式下，`dialog.current?.querySelector<HTMLElement>('button')?.focus()` 被跳过，不自动聚焦。对全屏页面来说，用户进入 settings 区域后焦点不会自动移到标题或内容。这可能影响键盘用户。但区域导航是通过 Rail 按钮点击，焦点会留在 Rail 按钮上，或者通过键盘 Tab 进入。不算严重。

- **embedded 模式下 `onKeyDown` 直接 return**：这阻止了 Escape 关闭。但全屏 settings 页面不需要 Escape 关闭。OK。然而，`onKeyDown` 直接 return 也意味着 Tab 焦点陷阱被禁用，这是正确的，因为不是 modal。

- **`savedResults` 状态**：测试已保存的 provider 时，创建 `input = { name, protocol, baseUrl, models, apiKey: savedKey }`。注意：`testProvider` 会测试该输入。但保存的 provider 可能有多个模型，测试时全部模型都会测试，可能较慢。此外，如果 `provider.models` 为空，测试可能失败。UI 显示 `providerModelCount` 后，有“再次测试”按钮。OK。

- **`testSaved` 中 `onChanged?.(); await refresh();`** 在测试成功后刷新 provider 列表，这可能重置 `providers` 状态并丢失 `savedResults`？`refresh` 更新 `providers`，`savedResults` 保持。但 `refresh` 的实现：
```js
async function refresh() {
  const response = await api.listProviders();
  ...
}
```
diff 中截断，但可能 `setProviders(response.providers)`。刷新后 `savedResults` 以 provider.name 为键，保持。OK。

- **测试已保存 provider 时，如果 apiKey 为空**，`validateProvider(input, providers, false)` 的第三个参数 `false` 可能表示“不要��� API key”或“不是更新”？需要看 validateProvider 签名。如果 savedKey 为空，而 provider 有掩码 key，测试时发送空 key 会失败。用户在“再次测试”时被要求输入 API key，但提示“providerRetestHint”可能说明需要输入 key。这是合理的，因为后端不返回明文 key。但**用户体验问题**：用户必须重新输入 API key 才能测试已保存的 provider，这很繁琐。更好的方式是后端支持使用已保存的 key 测试。但这是后端约束。UI 提示了 hint。可接受，但值得指出。

- **`savedKey` 是全局单一状态**，测试不同 provider 时共用。打开测试表单时清空。OK。

- **`testingSaved` 状态**：一次只能测试一个 provider。OK。

- **删除确认逻辑**：`deleting === provider.name` 时显示确认。但 `<button ... onClick={() => void run('delete')}>` 使用 `run('delete')`，而 `run` 内部使用 `deleting` 状态：
```js
else if (deleting) { const removed = await api.deleteProvider(deleting); ... }
```
这依赖 `deleting` 状态，OK。但删除后 `setDeleting(undefined)`？在 `run` 的成功路径中，可能设置 `setDeleting(undefined)`。diff 中未展示完整 `run`，但原始代码可能如此。假设 OK。

- **`providerInput()` 中的 `models` 来自 `models` 字符串状态，而 `candidates` 状态用于 ModelChips？** 等等，ModelChips 在哪里使用？diff 中导入了 ModelChips，但没看到在 JSX 中使用！搜索 diff：`import { ModelChips } from './ModelChips';` 但没有 `<ModelChips` 的渲染。这是**关键问题**：高级模型筛选器组件被创建并导入，但没有在 ProviderSettingsModal 中实际使用！任务要求“高级模型筛选器 (ModelChips.tsx)”，如果它没有被集成，那么痛点二没有解决。diff 中被截断的部分可能包含？让我再仔细看 diff：在 fieldset 中，`<label htmlFor={`${id}-url`}>...` 后面被截断了。可能在截断部分有 ModelChips 的使用。但导入语句在顶部，且 `updateModels` 函数被定义：
```js
function updateModels(next: string[]) { setModels([...new Set(next)].join(', ')); ... }
```
这个函数没有被 diff 中可见的代码使用。它很可能是为 ModelChips 的 `onSelectionChange` 准备的。在截断的 fieldset 中可能渲染 ModelChips。我们无法确定。但作为审查，需要指出：**diff 中未展示 ModelChips 的实际挂载，如果缺失则组件成为死代码**。然而，用户提供的源码只包含 ModelChips.tsx 和 ProviderHub.tsx，以及 diff 的截断。我们需要基于已有信息判断。可以指出需要验证 ModelChips 是否在 ProviderSettingsModal 的模型字���中被使用，若未使用则严重违背 DoD。

- **模型输入字段**：原始代码有 `models` 字符串输入（逗号分隔）。`updateModels` 的存在暗示 ModelChips 可能替换或增强该输入。但 diff 中没看到 `<ModelChips ...>`。这是一个**可疑点**，需要明确标记为未验证/潜在缺失。

- **`PROVIDER_PRESETS` 扩展**：
```js
export const PROVIDER_PRESETS: Record<string, AddProviderInput> = {
  ...Object.fromEntries(PROVIDER_PRESETS_CATALOG.map(preset => [preset.id, { name: preset.id, protocol: preset.protocol, baseUrl: preset.baseUrl, apiKey: '', models: preset.defaultModel ? [preset.defaultModel] : [] }])),
  DeepSeek: {...}, ...
}
```
这里 `name: preset.id`，即 provider 名称使用预设 id。对于 Lark，如果 id 是 'lark' 或 'feishu'，name 会是 'lark'。但用户添加的 provider 名称可能应该是更友好的名称。原 DeepSeek 预设的 name 是 'deepseek'（小写），所以一致。但注意：**对象展开顺序**。`...Object.fromEntries(...)` 在前，然后显式定义 `DeepSeek`、`OpenAI` 等覆盖。如果 catalog 中包含 'DeepSeek' id，会被后面的显式定义覆盖。OK。但如果 catalog 中包含 'custom'，没有覆盖？原始 PRESETS 中有 `custom`？diff 中只看到 DeepSeek, OpenAI, Claude，可能还有 custom。catalog 的 id 如果��现有键冲突，后面的覆盖。OK。

- **`PROVIDER_PRESETS` 类型**：`Record<string, AddProviderInput>`。通过 catalog 生成的 `protocol: preset.protocol`，需要 PresetInfo.protocol 类型与 AddProviderInput['protocol'] 兼容。如果 PresetInfo 的 protocol 是 string，TypeScript 会报错。可能 PresetInfo 定义正确。需要检查 presetsData.ts。未提供。风险。

- **`selectedId={PROVIDER_PRESETS_CATALOG.find(item => item.id === preset || item.baseUrl === form.baseUrl)?.id}`**：如果用户修改 baseUrl 为某个预设的 baseUrl，画廊会高亮该预设。这可能导致意外高亮。可接受。

- **PresetsGallery**：未提供源码，但被导入。`onSelect={pickGallery}` 传入 PresetInfo，`pickGallery(info) { pickPreset(info.id); }`。OK。但 `pickPreset` 使用 `PROVIDER_PRESETS[info.id]`，而 PROVIDER_PRESETS 是通过 catalog 生成的。如果 PresetsGallery 使用的 catalog 与 PROVIDER_PRESETS 的 catalog 一致，OK。但 `PresetInfo` 的 `id` 必须作为 PROVIDER_PRESETS 的键存在。catalog 生成保证了。不过，**如果 PresetsGallery 中有不在 catalog 中的预设怎么办？** 应该不会。

- **`pickPreset` 中 `setCandidates(next.models)`**：对于 catalog 生成的预设，`models: preset.defaultModel ? [preset.defaultModel] : []`。如果 defaultModel 是单个���型，候选只有 1 个。用户测试连接后，`availableModels` 会更新 candidates。OK。

- **`initialPreset` 初始化逻辑**：
```js
const [preset, setPreset] = useState(initialPreset && PROVIDER_PRESETS[initialPreset] ? initialPreset : 'DeepSeek');
const [form, setForm] = useState(PROVIDER_PRESETS[preset]!);
```
`useState` 初始化器中引用 `preset` 变量，而 `preset` 是同一渲染中的 `const`，由前一行 useState 返回。在函数组件中，这是可行的：第一行 useState 返回当前渲染的 preset 值，第二行 useState 使用该值初始化 form。首次渲染 preset 是 initialPreset 或 'DeepSeek'，form 对应。后续渲染 form 状态保持。OK。

- **`const [candidates, setCandidates] = useState<string[]>(form.models);`**：同样引用 form。OK。

- **`useEffect(() => { if (initialPreset) pickPreset(initialPreset); }, [initialPreset]);`**：这个 effect 在首次渲染后执行，如果 initialPreset 存在，会再次 pickPreset，可能导致重复 setState。但 pickPreset 会 change(next) 并 setModels 等，与初始化一致。如果 `initialPreset` 在挂载时存在，初始化已经设置了，effect 又设置一次，产生额外渲染。可接受但多余。更严重的是，**如果 initialPreset 是无效键**，初始化回退到 DeepSeek，但 effect 中 `if (initialPreset)` 为真，调用 `pickPreset(initialPreset)`，其中 `const next = PROVIDER_PRESETS[key]; if (!next) return;`，安全返回。OK。

- **`change(next)` 中 `setForm(previous => ({ ...previous, ...next, modelCapabilities: undefined }))`**。当 pickPreset 调用 change(next) 时，next 是完整的 AddProviderInput，包括 name, protocol, baseUrl, apiKey, models。它会覆盖 form，并清除 modelCapabilities。然后 setModels 和 setCandidates 单独设置。OK。

- **`savedResults[provider.name]` 作为 key**：provider.name 是唯一标识？后端可能允许同名？通常 name 唯一。OK。

- **`providerFailure(savedResults[provider.name]!.error)` 调用两次**，性能小问题。可提取变量。

- **`role="status"` 徽章**：每个 provider 卡片都有一个 role=status 的 span，页面初始渲染多个 status 区域，可能导致屏幕阅读器播报大量“未测试”。更好的做法是仅在测试结果出现时设置 role=status，或者使用 aria-live=polite 但初始内容为空。**a11y 问题**：多个 `role="status"` 元素且初始文本为“未测试”，加载时可能被播报。但通常 role=status 在内容变化时播报，初始内容不播报。不过，最佳实践是限制数量。可指出。

- **嵌入模式下 provider-heading 使用 h2**，页面已有 h2？在 App.tsx settings 区域，ProviderHub 替代了原来的 h2 settings。现在 ProviderHub 内部有 h2 modelSettings，然后 provider-registry 有 h3，provider-add 有 h4。标题层级：settings 区域没有 h1/h2 “设置”标题？原先有 `<h2>{t('settings')}</h2>`，现在被移除了，直接渲染 ProviderHub。ProviderHub 内部 h2 是“模型设置”。这导致页面标题层级从 h2 开始，没有 h1。可访问性上，页面应该有一个 h1。Rail 是导航。Settings 区域缺少 h1 “设置” 可能是一个结构问题。可以指出：**语义标题层级不完整**。但不算阻断。

- **ProviderHub 包装器**：`return <ProviderSettingsModal ... embedded />;`。没有额外 DOM 包裹。ProviderSettingsModal 在 embedded 时渲染 `<div className="provider-hub"><div className="provider-hub-panel" role="region">...`。外层 provider-hub 没有 role。OK。

**App.tsx 审查**：

- 引入 `formatClock` 和 `Rail`，新增 `sidebarCollapsed`、`draftRequest`、`recentSessions`、首页欢迎区。这些是范围蔓延（scope creep）！Task 232 的目标是模型供应商中枢和高级筛选器，但 diff 中加入了大量无关的 UI 改动：
  - 侧边栏折叠（sidebarCollapsed, Rail, desktop-sidebar-toggle）
  - 工作台首页重新设计（home-heading, home-workspace, home-starters, home-recent, draftRequest）
  - 时间格式化（formatClock）
  - Activity 时间显示改变
  - 命令面板 providers 命令的逻辑改变
  这些改动超出了任务范围，增加了审查面和回归风险。**必须强烈指出范围蔓延**。DoD 没有要求这些。特别是首页重构可能破坏现有布局和测试。对抗性审查应标记为 REJECT 理由之一（或至少严重警告）。

- **`import { formatClock } from './utils/timeFormat';import { useCallback...`**：两个 import 在同一行，缺少换行。格式问题，但功能正常。ESLint/prettier 可能报错。**代码风格红线**。

- **`rail` 组件**：`<Rail area={area} onSelect={value => { setArea(value); setDrawer(false); setShowProviders(false); }} />`。Rail 是新增组件，未提供源码。它取代了 primary-nav。需要验证 Rail 是否包含所有导航项（workbench, activity, studio, settings）和 a11y。未提供，风险。

- **`inert={sidebarCollapsed && !drawer}`**：当侧边栏折叠时，给 `#session-navigation` 设置 inert。但折叠按钮 `desktop-sidebar-toggle` 位于 topbar，不在 navigation-shell 内，所以可以展开。OK。但是，`inert` 属性在 React 中的支持？React 19 支持 inert 作为布尔属性。如果 React 18，可能需要 `inert={sidebarCollapsed && !drawer ? '' : undefined}`。diff ��已有 `inert={taskStarting}` 的用法，说明项目已使用该属性。OK。

- **`sidebarToggle` ref 和 focus**：`onCollapse={() => { setSidebarCollapsed(true); sidebarToggle.current?.focus(); }}`。Sidebar 组件新增 onCollapse prop。折叠后焦点移到 topbar 按钮，合理。但 `sidebarToggle` 是 topbar 中按钮的 ref，按钮在 DOM 中始终存在。OK。

- **`desktop-sidebar-toggle` 的 aria-expanded={!sidebarCollapsed}** 和 aria-controls="session-navigation"。OK。但 `aria-label={t(sidebarCollapsed ? 'expandSidebar' : 'collapseSidebar')}`，需要 i18n 键存在。未验证。

- **命令面板 providers 命令**：
```js
execute: () => { if (area !== 'settings') setShowProviders(true); else document.querySelector<HTMLInputElement>('#provider-key')?.focus(); }
```
这里直接查询 DOM `#provider-key`。如果 ProviderHub 嵌入在 settings 中，且 `id='provider'`，apiKey 输入 id 可能是 `provider-key`。但需要确认。**脆弱性**：命令依赖固定 DOM id，且 id 从 useId 改为固定值。如果未来有多个 ProviderSettingsModal 实例，id 冲突。此外，如果 apiKey 字段的 id 不是 `provider-key`（比如 `provider-apiKey`），聚焦失败且无声。**代码健壮性问题**。更好的做法是通过 ref 或状态管理聚焦。此外，在 settings 区域时，命令不��打开 modal，而是尝试聚焦现有输入。但如果 settings 区域的 ProviderHub 尚未加载（loading），`#provider-key` 可能不存在，聚焦失败。需要处理。

- **`showProviders && area !== 'settings'`**：当用户在 settings 区域通过某种方式设置 showProviders=true（例如通过 NewSessionForm 的 onConfigureModels？NewSessionForm 仅在 showNew 时渲染，且其 onConfigureModels={() => setShowProviders(true)}。如果用户在 settings 区域，showNew 可能为 true 吗？NewSessionForm 的打开通过 onAdvanced（workbench）或命令面板。命令面板 sandbox 命令会 setShowNew(true)，不检查 area。如果用户在 settings 区域打开命令面板并执行 sandbox 命令，会 setShowNew(true)，但 area 仍为 settings。此时 NewSessionForm 渲染（showNew），其 onConfigureModels 可能被触发，设置 showProviders=true。但 modal 条件 `area !== 'settings'` 为 false，所以 modal 不渲染。用户点击“配置模型”后没有反应。**交互 bug**：在 settings 区域中，从 NewSessionForm 触发配置模型会被静默忽略。需要在 onConfigureModels 中同时切换 area 到 workbench，或者允许 modal 在 settings 中渲染（但会与 ProviderHub 重复）。这是一个边界情况，但真实存在。需要指出。

- **ProviderHub 的 onChanged**：`onChanged={() => setProviderRevision(previous => previous + 1)}`。当在 settings 中修改 provider 后，providerRevision 增加，触发依赖它的组件刷新。OK。但 ProviderHub 的 initialPreset 使用 providerPreset。在 settings 区域中，providerPreset 通常是 undefined，除非之前通过 TaskComposer 设置并未清空。关闭 modal 时清空 providerPreset，所以 settings 中应为 undefined。OK。

- **`providerPreset` 在开启 modal 时设置**：`onConfigureModels={preset => { setProviderPreset(preset); setShowProviders(true); }}`。TaskComposer 的 onConfigureModels 现在接收 preset 参数。需要检查 TaskComposer 是否更新了 prop 类型和调用处。未提供，风险。如果 TaskComposer 仍以无参数调用 onConfigureModels，preset 为 undefined，OK。如果其他地方调用 onConfigureModels 传递事件对象而非字符串，会导致 providerPreset 被设置为事件对象，ProviderSettingsModal 中 `PROVIDER_PRESETS[initialPreset]` 使用对象作为键会变成 "[object Object]"，无效，回退 DeepSeek。不是崩溃，但类型不安全。需要检查 TaskComposer 签名。**重大类型契约风险**。

- **`ProviderHub` 没有 `onClose`**，OK。

- **删除 Settings 区域的 h2**：原先 `<h2>{t('settings')}</h2>` 被移除，导致页面缺少主标题。ProviderHub 内部 h2 是“模型设置”。用户进入 settings 区域时，没有“设置”标题。这可能影响导航语义。可以指出。

- **`settings-secondary-panel`**：包含偏好设置等。OK。

- **工作台首页重构**：新增 `recentSessions` 计算，每次渲染都 filter+sort+slice。sessions 可能很大，排序 O(n log n) 每次渲染。可接受但可 memo。`recentSessions` 使用 `updatedAt ?? createdAt` 的 localeCompare。ISO 字符串比较 OK。但 `formatClock` 用于时间显示，未提供实现，可能只显示时间不显示日期，导致跨天会话时间歧义。在 Activity 中原本用 `toLocaleString()`，现在改为 `formatClock`，显示信息减少。**功能回归**：Activity 中会话时间从完整日期时间变为仅时钟？需要检查 formatClock。如果它只返回 HH:mm，跨天信息丢失。这可能是一个 UX 退化。对抗性审查应指出。

- **starter prompts**：`t(\`starter${kind}Prompt\`)` 动态键。需要 i18n 存在 `starterReviewPrompt`、`starterBenchmarksPrompt`、`starterExplorePrompt`、`starterReview`、`starterBenchmarks`、`starterExplore`、`workbenchWelcome`、`activeWorkspace`、`chooseProject`、`homeServerOnline`、`homeServerOffline`、`quickStart`、`recentSessions`、`homeUpdated`、`homeNoSessions`。大量新 i18n 键，未在 diff 中看到 i18n 修改。**高风险**。

- **`draftRequest` 类型 `{ text: string; serial: number }`**，TaskComposer 新增 `draftRequest` prop。未提供 TaskComposer 修改。如果 TaskComposer 未处理该 prop，starter prompts 点击无效果。**必须验证 TaskComposer 集成**。DoD 没有要求首页 starter，但这是新增的 UI，若半成品会破坏体验。

- **`sidebarCollapsed` 状态没有持久化**，刷新后重置。可接受但体验一般。

- **`disabled={taskStarting}`** 在 starter buttons，OK。

- **`hidden={area !== 'workbench'}`** 的 workbench-region 仍渲染 TaskComposer，当 area=settings 时 hidden。hidden 元素内的表单仍可能被屏幕阅读器忽略（hidden 会）。OK。但 focus 可能进入 hidden 区域？如果之前焦点在 workbench 内，切换到 settings 后，焦点可能留在 hidden 元素中，导致键盘用户迷失。React 不会自动管理。App 有 navigationFocus ref 吗？`const navigationFocus = useRef<HTMLElement | null>(null);` 但 diff 中没看到使用。可能需要焦点管理。**a11y 问题**：区域切换时焦点没有移动到新区域标题。Rail 的 onSelect 设置 area，但没有聚焦新区域。用户通过键盘激活 Rail 按钮后，焦点留在 Rail 按钮，Tab 会进入主内容？由于 Rail 在 DOM 中位于 navigation-shell 之前，Tab 顺序可能先到 navigation-shell 的隐藏/折叠控件，再到 main。不是理想。可指出。

**ProviderSettingsModal 的 `id` 兼容性**：

DoD 明确要求：“ProviderSettingsModal.tsx 既有 exports 与 DOM ID 是否完全向下兼容”。原始代码使用 `useId()`，生成的 ID 不是固定的，所以不存在外部依赖的固定 DOM ID。现在改为固定 'provider'，这使得 command palette 可以使用 `#provider-key`。但这**改变了 DOM ID 的生成方式**，从唯一变为固定。如果有测试或外部代码依赖 `useId` 生成的 ID 格式（不太可能），会破坏。但更关键的是，“向下兼容”意味着不破坏已有 DOM ID 契约。原始 ID 是动态的，没有稳定契约。改为固定 ID 实际上增加了稳定性，但也引入了多实例冲突。需要判断：**是否算向下兼容？** 如果既有测试通过 `id` 前缀查找