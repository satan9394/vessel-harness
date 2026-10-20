import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import ConversationRenderer, { OpenUiCard } from './ConversationRenderer';

function nodes(root: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(root)) return root.flatMap(nodes);
  if (!isValidElement<Record<string, unknown>>(root)) return [];
  const list: ReactElement<Record<string, unknown>>[] = [root];
  if (typeof root.type === 'function') {
    try {
      const expanded = (root.type as (props: unknown) => ReactNode)(root.props);
      list.push(...nodes(expanded));
    } catch {
      // hook call inside plain test runner
    }
  }
  if (root.props && typeof root.props === 'object' && 'children' in root.props) {
    list.push(...nodes(root.props.children as ReactNode));
  }
  return list;
}

describe('ConversationRenderer', () => {
  it('renders plain text and markdown headings, bold, inline code', () => {
    const markdown = `# 主标题\n## 二级标题\n这是**加粗文字**和\`inline code\`段落。`;
    const tree = nodes(ConversationRenderer({ content: markdown }));
    expect(tree.some(n => n.type === 'h2' && n.props.className === 'markdown-h1')).toBe(true);
    expect(tree.some(n => n.type === 'h3' && n.props.className === 'markdown-h2')).toBe(true);
    expect(tree.some(n => n.type === 'strong')).toBe(true);
    expect(tree.some(n => n.type === 'code' && n.props.className === 'markdown-inline-code')).toBe(true);
  });

  it('renders code blocks with language indicator and copy button', () => {
    const content = '```typescript\nconst greeting = "hello";\n```';
    const tree = nodes(ConversationRenderer({ content }));
    expect(tree.some(n => n.props.className === 'markdown-code-block')).toBe(true);
    expect(tree.some(n => n.props.className === 'markdown-code-lang' && n.props.children === 'typescript')).toBe(true);
    expect(tree.some(n => n.type === 'button' && n.props.className?.toString().includes('markdown-code-copy'))).toBe(true);
  });

  it('renders markdown tables correctly', () => {
    const tableMd = `| 模块 | 状态 |\n|---|---|\n| Core | PASS |\n| UI | PASS |`;
    const tree = nodes(ConversationRenderer({ content: tableMd }));
    expect(tree.some(n => n.type === 'table' && n.props.className === 'markdown-table')).toBe(true);
    expect(tree.some(n => n.type === 'th')).toBe(true);
    expect(tree.some(n => n.type === 'td')).toBe(true);
  });

  it('renders markdown task checklists', () => {
    const tasksMd = `- [x] 第一步已完成\n- [ ] 第二步待执行`;
    const tree = nodes(ConversationRenderer({ content: tasksMd }));
    const checkboxes = tree.filter(n => n.type === 'input' && n.props.type === 'checkbox');
    expect(checkboxes.length).toBe(2);
    expect(checkboxes[0]?.props.checked).toBe(true);
    expect(checkboxes[1]?.props.checked).toBe(false);
  });

  it('renders OpenUI Generative UI cards directly', () => {
    const spec = {
      type: 'summary' as const,
      title: '任务执行完成',
      status: 'success' as const,
      summary: '所有门禁验证通过',
      items: [
        { label: '测试通过', value: 3461 },
        { label: '覆盖率', value: '100%' },
      ],
    };
    const tree = nodes(OpenUiCard({ spec }));
    expect(tree.some(n => n.props.className === 'openui-card')).toBe(true);
    expect(tree.some(n => n.props.className === 'openui-title')).toBe(true);
  });
});
