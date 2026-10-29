import { localizedValue } from '../../i18n';
import { useI18n } from '../LanguageProvider';
import { layoutDag, type TeamDagTask } from '../../teamStages';
import { useEffect, useRef, useState } from 'react';

export default function TeamDagCanvas({ tasks, activeTaskId, onSelectTask }: {
  tasks: TeamDagTask[]; activeTaskId?: string; onSelectTask: (id: string) => void;
}) {
  const { t, lang } = useI18n();
  const nodes = layoutDag(tasks);
  const positions = new Map(nodes.map(node => [node.task.id, node]));
  const width = Math.max(320, ...nodes.map(node => node.x + 220));
  const scroll = useRef<HTMLDivElement>(null);
  const [overflow, setOverflow] = useState(false);
  useEffect(() => {
    const element = scroll.current;
    if (!element) return;
    const measure = () => setOverflow(element.scrollWidth > element.clientWidth + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [width]);
  return <>
    {overflow && <p className="dim" role="status">{lang === 'zh' ? '↔ 横向滚动查看完整任务图' : '↔ Scroll horizontally to see all tasks'}</p>}
    <div className="team-dag-scroll" ref={scroll} tabIndex={overflow ? 0 : undefined} aria-label={t('uiTeamTaskDependencies')}><svg aria-label={t('uiTeamTaskDependencies')} role="group"
    width={width} height={Math.max(140, ...nodes.map(node => node.y + 100))}>
    {nodes.flatMap(node => node.task.dependencies.map(id => {
      const from = positions.get(id);
      if (!from) return null;
      return <path key={`${id}:${node.task.id}`} data-edge={`${id}:${node.task.id}`} className="team-dag-edge"
        d={`M ${from.x + 200} ${from.y + 34} C ${from.x + 220} ${from.y + 34}, ${node.x - 20} ${node.y + 34}, ${node.x} ${node.y + 34}`} />;
    }))}
    {nodes.map(({ task, x, y }) => <g key={task.id} transform={`translate(${x},${y})`}>
      <foreignObject width="200" height="76"><button type="button" className={`team-dag-node status-${task.status}`}
        aria-pressed={activeTaskId === task.id} onClick={() => onSelectTask(task.id)}>
        <strong>{task.title}</strong><span>{localizedValue(task.status, t)}</span>
      </button></foreignObject>
    </g>)}
  </svg></div></>;
}
