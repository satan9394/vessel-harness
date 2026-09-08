import type { ConversationDelta, ToolDelta } from '../sse';
import ToolActivityRow from './ToolActivityRow';

/** A renderable conversation item: either a message bubble or a tool activity row. */
export interface ChatItem {
  id: string;
  kind: 'message' | 'tool';
  msg?: ConversationDelta;
  tool?: ToolDelta;
}

interface Props {
  items: ChatItem[];
  /** assistant is streaming — show a "thinking" indicator at the end. */
  thinking: boolean;
}

/** Scroll container for the conversation, with user/assistant bubbles + tool rows. */
export default function MessageList({ items, thinking }: Props) {
  return (
    <div className="message-list" role="log" aria-live="polite">
      {items.length === 0 && !thinking && (
        <div className="conversation-empty">发送一条消息开始对话。实时增量将通过 SSE 显示在这里。</div>
      )}
      {items.map((item) =>
        item.kind === 'tool' && item.tool ? (
          <ToolActivityRow key={item.id} delta={item.tool} />
        ) : (
          <div key={item.id} className={`msg msg-${item.msg?.role ?? 'assistant'}`}>
            <div className="msg-role">{item.msg?.role === 'user' ? 'You' : 'Vessel'}</div>
            <div className="msg-body">
              {item.msg?.text ?? ''}
              {item.msg?.toolName ? (
                <span className="msg-tool-call">(调用了工具 {item.msg.toolName})</span>
              ) : null}
            </div>
          </div>
        ),
      )}
      {thinking && (
        <div className="msg msg-assistant">
          <div className="msg-role">Vessel</div>
          <div className="msg-body msg-thinking">
            <span className="thinking-dot" />思考中…
          </div>
        </div>
      )}
    </div>
  );
}