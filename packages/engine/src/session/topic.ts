/** User-facing grouping metadata for one or more sessions. */
export interface SessionTopic {
  topicId: string;
  title: string;
  summary?: string;
  createdAt: number;
  updatedAt: number;
  tags?: string[];
  isArchived?: boolean;
}

const MAX_TITLE_LENGTH = 20;
const GREETING = /^(?:hi|hello|hey|你好|您好|嗨|哈喽)[\s.!！?？,，。]*$/i;
const CODE_LINE = /^(?:const|let|var|function|class|import|export|return|def|async|await|#include|\}|\{)/;

/**
 * Remove ```-fenced blocks with a linear scan instead of a backtracking regex.
 * Only balanced fences are removed, matching the previous behaviour while
 * avoiding the polynomial-regex pattern flagged by CodeQL (js/polynomial-redos).
 */
function stripCodeFences(text: string): string {
  let result = '';
  let index = 0;
  while (index < text.length) {
    const open = text.indexOf('```', index);
    if (open === -1) {
      result += text.slice(index);
      break;
    }
    result += text.slice(index, open);
    const afterInfo = text.indexOf('\n', open);
    const close = afterInfo === -1 ? -1 : text.indexOf('```', afterInfo + 1);
    if (close === -1) {
      result += text.slice(open);
      break;
    }
    const afterClose = text.indexOf('\n', close);
    index = afterClose === -1 ? text.length : afterClose + 1;
    result += ' ';
  }
  return result;
}

/**
 * Derive a short, stable title from the first user prompt without calling a model.
 * Markdown fences and code-only prompts are kept out of the navigation label.
 */
export function deriveTopicTitle(firstPrompt: string): string {
  if (typeof firstPrompt !== 'string' || firstPrompt.trim() === '') return 'New conversation';
  if (GREETING.test(firstPrompt.trim())) return '日常问候对话';

  const withoutFences = stripCodeFences(firstPrompt);
  const firstLine = withoutFences.split(/[\r\n]/).map((line) => line.trim()).find((line) => line.length > 0) ?? '';
  if (CODE_LINE.test(firstLine)) return '代码处理请求';

  const firstSentence = firstLine.split(/[.!?。！？;；]/, 1)[0] ?? '';
  const title = firstSentence
    .replace(/`([^`]*)`/g, '$1')
    .replace(/^\s{0,3}(?:#{1,6}\s*|[-*+]\s+|>\s*)/, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[^\p{L}\p{N}\p{Script=Han}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!title) return 'New conversation';
  return Array.from(title).slice(0, MAX_TITLE_LENGTH).join('').trim() || 'New conversation';
}
