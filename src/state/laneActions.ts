import { classifyTurn, junctionLanes, toggleLaneTurn, turnDelta, type Turn } from '../osm/lanes';
import { useEditor } from './store';
import { useUi } from './ui';

/** Arm reference from its key, "wayId:step". */
export function parseArm(key: string): { wayId: string; step: 1 | -1 } {
  const i = key.lastIndexOf(':');
  return { wayId: key.slice(0, i), step: key.slice(i + 1) === '1' ? 1 : -1 };
}

/** Forbids the turn of the lane link picked on the map. */
export function removePickedLink(): void {
  const link = useUi.getState().laneLink;
  if (!link) return;
  useEditor.getState().apply((d) => toggleLaneTurn(d, link.node, parseArm(link.from), link.lane, link.turn as Turn));
  useUi.getState().setLaneLink(null);
  useEditor.getState().notify('Поворот с этой полосы запрещён');
}

/**
 * Allows lane `lane` of arm `from` to go to arm `to` at a junction: the turn that leads there is
 * added to the lane's rules. Says so when the lane could already go there.
 */
export function connectLanes(nodeId: string, from: string, lane: number, to: string): void {
  const s = useEditor.getState();
  const lanes = junctionLanes(s.doc, nodeId);
  const a = lanes.arms.find((x) => `${x.wayId}:${x.step}` === from);
  const b = lanes.arms.find((x) => `${x.wayId}:${x.step}` === to);
  if (!a || !b || a === b) return;
  const turn = classifyTurn(turnDelta(a, b));
  const approach = lanes.approaches.find((x) => x.arm === a);
  if (approach?.turns[lane]?.includes(turn)) { s.notify('С этой полосы туда уже можно проехать'); return; }
  s.apply((d) => toggleLaneTurn(d, nodeId, a, lane, turn));
  s.notify('Связь добавлена');
}
