import type { WidgetBlock } from '@vessel/shared';
import InlineDiffInspector from './InlineDiffInspector';
import RedGreenGateBadge from './RedGreenGateBadge';
import AstImpactRadar from './AstImpactRadar';
import PermissionActionCard from './PermissionActionCard';

export interface WidgetDispatcherProps {
  widget: WidgetBlock;
  sessionId: string;
  onRespond?: (widgetId: string, optionId: string) => Promise<void>;
}
export function WidgetDispatcher({ widget, sessionId, onRespond }: WidgetDispatcherProps): React.JSX.Element {
  switch (widget.kind) {
    case 'diff_inspector': return <InlineDiffInspector key={`${sessionId}:${widget.id}`} widget={widget} sessionId={sessionId} />;
    case 'red_green_gate': return <RedGreenGateBadge widget={widget} />;
    case 'impact_radar': return <AstImpactRadar widget={widget} />;
    case 'permission_action': return <PermissionActionCard key={`${sessionId}:${widget.id}`} widget={widget} onRespond={onRespond} />;
  }
}
