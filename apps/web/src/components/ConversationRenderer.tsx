import React from 'react';

export interface ConversationRendererProps {
  content: string;
  isStreaming?: boolean;
}

interface OpenUiSpec {
  type: 'summary' | 'metrics' | 'actions' | 'diff';
  title?: string;
  status?: 'success' | 'warning' | 'error' | 'info';
  items?: Array<{ label: string; value: string | number; change?: string; tone?: string }>;
  actions?: Array<{ label: string; actionId: string; primary?: boolean }>;
  summary?: string;
}

/**
 * OpenUI 生成式 UI 规范解析（参考 thesysdev/openui Generative UI 思想）
 * 允许模型以极为精简的 DSL 或 JSON 声明渲染高保真原生交互卡片。
 */
function tryParseOpenUi(code: string): OpenUiSpec | null {
  const trimmed = code.trim();
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    try {
      const parsed = JSON.parse(trimmed) as OpenUiSpec;
      if (parsed.type && ['summary', 'metrics', 'actions', 'diff'].includes(parsed.type)) {
        return parsed;
      }
    } catch {
      // not JSON
    }
  }
  // DSL 简写格式解析: type: summary | title: xxx | status: success
  const lines = trimmed.split('\n').map(l => l.trim()).filter(Boolean);
  const spec: Partial<OpenUiSpec> = {};
  for (const line of lines) {
    const colon = line.indexOf(':');
    if (colon > 0) {
      const key = line.slice(0, colon).trim().toLowerCase();
      const val = line.slice(colon + 1).trim();
      if (key === 'type' && ['summary', 'metrics', 'actions', 'diff'].includes(val)) {
        spec.type = val as OpenUiSpec['type'];
      } else if (key === 'title') {
        spec.title = val;
      } else if (key === 'status') {
        spec.status = val as OpenUiSpec['status'];
      } else if (key === 'summary') {
        spec.summary = val;
      }
    }
  }
  return spec.type ? (spec as OpenUiSpec) : null;
}

export function OpenUiCard({ spec }: { spec: OpenUiSpec }) {
  const statusColor = spec.status === 'success' ? 'var(--ok)' : spec.status === 'error' ? 'var(--danger)' : spec.status === 'warning' ? 'var(--warn)' : 'var(--accent)';
  return (
    <div className="openui-card" style={{ borderColor: statusColor }}>
      <div className="openui-card-header">
        <span className="openui-badge" style={{ background: `color-mix(in srgb, ${statusColor} 15%, transparent)`, color: statusColor }}>
          {spec.type.toUpperCase()}
        </span>
        {spec.title && <strong className="openui-title">{spec.title}</strong>}
      </div>
      {spec.summary && <p className="openui-summary">{spec.summary}</p>}
      {spec.items && spec.items.length > 0 && (
        <div className="openui-grid">
          {spec.items.map((item, index) => (
            <div key={index} className="openui-metric-box">
              <span className="openui-metric-label">{item.label}</span>
              <span className="openui-metric-val">{item.value}</span>
              {item.change && <span className="openui-metric-change">{item.change}</span>}
            </div>
          ))}
        </div>
      )}
      {spec.actions && spec.actions.length > 0 && (
        <div className="openui-actions">
          {spec.actions.map((act, index) => (
            <button key={index} className={`btn ${act.primary ? 'btn-primary' : 'btn-secondary'}`} type="button">
              {act.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function CodeBlock({ code, lang }: { code: string; lang: string }) {
  const openUiSpec = lang.toLowerCase() === 'openui' ? tryParseOpenUi(code) : null;

  if (openUiSpec) {
    return <OpenUiCard spec={openUiSpec} />;
  }

  const handleCopy = (e: React.MouseEvent<HTMLButtonElement>) => {
    void navigator.clipboard?.writeText(code);
    const btn = e.currentTarget;
    const old = btn.textContent;
    btn.textContent = '✓ 已复制';
    setTimeout(() => {
      btn.textContent = old;
    }, 2000);
  };

  return (
    <div className="markdown-code-block">
      <div className="markdown-code-header">
        <span className="markdown-code-lang">{lang || 'text'}</span>
        <button type="button" className="markdown-code-copy btn-sm" onClick={handleCopy}>
          复制
        </button>
      </div>
      <pre className="markdown-pre">
        <code>{code}</code>
      </pre>
    </div>
  );
}

/** 行内 Markdown 简单渲染器（粗体、斜体、行内代码、链接） */
function InlineMarkdown({ text }: { text: string }) {
  // 简易安全解析器：优先切割行内代码 `code`，再处理加粗 **bold**
  const parts: React.ReactNode[] = [];
  const codeRegex = /`([^`]+)`/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = codeRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(renderFormatting(text.slice(lastIndex, match.index)));
    }
    parts.push(
      <code key={`code-${match.index}`} className="markdown-inline-code">
        {match[1]}
      </code>
    );
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    parts.push(renderFormatting(text.slice(lastIndex)));
  }

  return <>{parts}</>;
}

function renderFormatting(str: string): React.ReactNode {
  // 支持 **加粗** 与 *斜体*
  const chunks: React.ReactNode[] = [];
  const boldRegex = /\*\*([^*]+)\*\*/g;
  let last = 0;
  let m: RegExpExecArray | null;

  while ((m = boldRegex.exec(str)) !== null) {
    if (m.index > last) {
      chunks.push(str.slice(last, m.index));
    }
    chunks.push(<strong key={`b-${m.index}`}>{m[1]}</strong>);
    last = m.index + m[0].length;
  }
  if (last < str.length) {
    chunks.push(str.slice(last));
  }
  return chunks;
}

export default function ConversationRenderer({ content }: ConversationRendererProps) {
  if (!content) return null;

  const lines = content.split('\n');
  const elements: React.ReactNode[] = [];
  let inCodeBlock = false;
  let currentCode = '';
  let currentLang = '';
  let inTable = false;
  let tableRows: string[][] = [];

  const flushTable = (key: number) => {
    if (tableRows.length > 0) {
      const headers = tableRows[0];
      const rows = tableRows.slice(1);
      elements.push(
        <div key={`table-wrapper-${key}`} className="markdown-table-wrapper">
          <table className="markdown-table">
            <thead>
              <tr>
                {headers?.map((cell, i) => (
                  <th key={i}><InlineMarkdown text={cell.trim()} /></th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rIdx) => (
                <tr key={rIdx}>
                  {row.map((cell, cIdx) => (
                    <td key={cIdx}><InlineMarkdown text={cell.trim()} /></td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      tableRows = [];
    }
    inTable = false;
  };

  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx]!;

    // 代码块检测
    if (line.trim().startsWith('```')) {
      if (inTable) flushTable(idx);
      if (!inCodeBlock) {
        inCodeBlock = true;
        currentLang = line.trim().slice(3).trim();
        currentCode = '';
      } else {
        inCodeBlock = false;
        elements.push(<CodeBlock key={`code-${idx}`} code={currentCode} lang={currentLang} />);
        currentCode = '';
        currentLang = '';
      }
      continue;
    }

    if (inCodeBlock) {
      currentCode += (currentCode ? '\n' : '') + line;
      continue;
    }

    // Markdown 表格检测
    if (line.trim().startsWith('|') && line.trim().endsWith('|')) {
      // 忽略对齐行 |---|---|
      if (/^\|[-:\s|]+\|$/.test(line.trim())) {
        continue;
      }
      const cells = line.trim().slice(1, -1).split('|');
      tableRows.push(cells);
      inTable = true;
      continue;
    } else if (inTable) {
      flushTable(idx);
    }

    // 标题检测
    if (line.startsWith('# ')) {
      elements.push(<h2 key={`h1-${idx}`} className="markdown-h1"><InlineMarkdown text={line.slice(2)} /></h2>);
    } else if (line.startsWith('## ')) {
      elements.push(<h3 key={`h2-${idx}`} className="markdown-h2"><InlineMarkdown text={line.slice(3)} /></h3>);
    } else if (line.startsWith('### ')) {
      elements.push(<h4 key={`h3-${idx}`} className="markdown-h3"><InlineMarkdown text={line.slice(4)} /></h4>);
    } else if (line.startsWith('> ')) {
      // 引用块
      elements.push(
        <blockquote key={`quote-${idx}`} className="markdown-blockquote">
          <InlineMarkdown text={line.slice(2)} />
        </blockquote>
      );
    } else if (line.trim().startsWith('- [ ] ') || line.trim().startsWith('- [x] ')) {
      // 任务清单
      const checked = line.trim().startsWith('- [x] ');
      const label = line.trim().slice(6);
      elements.push(
        <div key={`task-${idx}`} className="markdown-task-item">
          <input type="checkbox" checked={checked} readOnly className="markdown-checkbox" />
          <span className={checked ? 'markdown-task-done' : ''}><InlineMarkdown text={label} /></span>
        </div>
      );
    } else if (line.trim().startsWith('- ') || line.trim().startsWith('* ')) {
      // 无序列表
      elements.push(
        <li key={`li-${idx}`} className="markdown-li">
          <InlineMarkdown text={line.trim().slice(2)} />
        </li>
      );
    } else if (/^\d+\.\s/.test(line.trim())) {
      // 有序列表
      const numMatch = line.trim().match(/^(\d+)\.\s(.*)$/);
      elements.push(
        <div key={`ol-${idx}`} className="markdown-ol-item">
          <span className="markdown-ol-num">{numMatch?.[1]}.</span>
          <span><InlineMarkdown text={numMatch?.[2] ?? ''} /></span>
        </div>
      );
    } else if (line.trim().length === 0) {
      // 空行
      elements.push(<div key={`blank-${idx}`} className="markdown-blank" />);
    } else {
      // 普通段落
      elements.push(
        <p key={`p-${idx}`} className="markdown-p">
          <InlineMarkdown text={line} />
        </p>
      );
    }
  }

  if (inCodeBlock && currentCode) {
    elements.push(<CodeBlock key="code-unclosed" code={currentCode} lang={currentLang} />);
  }
  if (inTable) {
    flushTable(lines.length);
  }

  return <div className="conversation-markdown-body">{elements}</div>;
}
