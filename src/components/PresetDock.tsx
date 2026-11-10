import { useEffect, useMemo, useRef, useState } from 'react';
import { ROAD_TEMPLATES } from '../osm/tags';
import { BUILDING_TEMPLATES } from '../osm/buildingShape';
import { SIGN_GROUPS, SIGNS, signDef } from '../osm/trafficSigns';
import { NODE_FEATURES } from '../map/features';
import { signUrl } from '../map/signArt';
import { PRESETS, TOOLS_IN } from '../map/editScope';
import { useBuildingTool } from '../map/buildingTool';
import { useEditor } from '../state/store';
import { useUi } from '../state/ui';
import { gabarit, Profile, RuleSigns } from './ToolCatalog';
import { Icon, type IconName } from './icons';

/**
 * Ready-made pieces at the bottom of the map, in a capsule: closed it is a row of round buttons,
 * one per kind (roads, buildings, signs and traffic control, stations); a click opens the capsule
 * upwards into a strip of cards of that kind. A card picks its tool with that piece and the
 * capsule closes again, showing what is picked. Only kinds the view mode allows are offered.
 */

type Tab = 'roads' | 'buildings' | 'signs' | 'stations';

const TABS: ReadonlyArray<{ id: Tab; label: string; icon: IconName; tool: string }> = [
  { id: 'roads', label: 'Дороги', icon: 'road', tool: 'draw' },
  { id: 'buildings', label: 'Здания', icon: 'building', tool: 'building' },
  { id: 'signs', label: 'Знаки и ОДД', icon: 'signal', tool: 'signal' },
  { id: 'stations', label: 'Станции', icon: 'node', tool: 'signal' },
];

/** The roads tab is named after what it holds in each view mode. */
const ROADS_LABEL: Partial<Record<string, string>> = { walk: 'Тротуары и дорожки', transit: 'Трамвайные пути', rail: 'Пути', metro: 'Пути метро' };

const STATION_IDS = new Set(['station', 'halt', 'tram_stop', 'subway_station', 'subway_entrance']);

function RoadCards({ close }: { close: () => void }) {
  const template = useEditor((s) => s.templateIndex);
  const mode = useEditor((s) => s.mode);
  const lens = useUi((s) => s.lens);
  const groups = useMemo(() => {
    const m = new Map<string, number[]>();
    ROAD_TEMPLATES.forEach((t, i) => { if (PRESETS[lens].road(t.tags)) m.set(t.group, [...(m.get(t.group) ?? []), i]); });
    return [...m.entries()];
  }, [lens]);
  return (
    <>
      {groups.map(([group, ids]) => (
        <div key={group} className="pd-group">
          <span className="pd-group-title">{group}</span>
          <div className="pd-cards">
            {ids.map((i) => {
              const t = ROAD_TEMPLATES[i];
              const on = mode === 'draw' && template === i;
              return (
                <button key={t.label} className={`pd-card${on ? ' on' : ''}`} aria-pressed={on} title={i < 9 ? `${t.label}, клавиша ${i + 1}` : t.label}
                  onClick={() => { useEditor.getState().setTemplate(i); useEditor.getState().setMode('draw'); close(); }}>
                  <Profile tags={t.tags} />
                  <b>{t.label}</b>
                  <span className="mono">{gabarit(t.tags)}</span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </>
  );
}

function BuildingCards({ close }: { close: () => void }) {
  const template = useBuildingTool((s) => s.template);
  const mode = useEditor((s) => s.mode);
  return (
    <div className="pd-group">
      <span className="pd-group-title">Шаблоны</span>
      <div className="pd-cards">
        {BUILDING_TEMPLATES.map((t, i) => {
          const on = mode === 'building' && template === i;
          const w = 14 + (t.width / 30) * 26;
          const h = 8 + (t.length / 60) * 14;
          return (
            <button key={t.id} className={`pd-card${on ? ' on' : ''}`} aria-pressed={on} title={`${t.label}: клавиша ${i + 1}, R поворачивает`}
              onClick={() => { useBuildingTool.getState().setTemplate(i); useEditor.getState().setMode('building'); close(); }}>
              <svg className="tpl-profile" viewBox="0 0 72 26" aria-hidden="true"><rect x={36 - w / 2} y={13 - h / 2} width={w} height={h} rx="1.5" fill="#6E6A78" stroke="#B9B4C2" /></svg>
              <b>{t.label}</b>
              <span className="mono">{t.width}×{t.length} м · {t.levels} эт.</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function SignCards({ close }: { close: () => void }) {
  const kind = useUi((s) => s.featureKind);
  const mode = useEditor((s) => s.mode);
  const lens = useUi((s) => s.lens);
  const pick = (id: string) => { useUi.getState().setFeatureKind(id); useEditor.getState().setMode('signal'); close(); };
  return (
    <>
      {SIGN_GROUPS.filter((g) => SIGNS.some((s) => s.group === g && PRESETS[lens].sign(s.code))).map((g) => (
        <div key={g} className="pd-group">
          <span className="pd-group-title">{g}</span>
          <div className="pd-cards">
            {SIGNS.filter((s) => s.group === g && PRESETS[lens].sign(s.code)).map((s) => {
              const id = `ts:${s.code}`;
              const on = mode === 'signal' && kind === id;
              return (
                <button key={s.code} className={`pd-card pd-sign${on ? ' on' : ''}`} aria-pressed={on} title={`${s.code.startsWith('signal') ? '' : `${s.code} `}${s.name}`} onClick={() => pick(id)}>
                  <img src={signUrl(`ts:${s.code}${s.value ? `:${s.value.default}` : ''}`)} alt="" width={34} height={34} draggable={false} />
                  <b>{s.name}</b>
                  {!s.code.startsWith('signal') && <span className="mono">{s.code}</span>}
                </button>
              );
            })}
          </div>
        </div>
      ))}
      <div className="pd-group pd-rules"><RuleSigns /></div>
    </>
  );
}

function StationCards({ close }: { close: () => void }) {
  const kind = useUi((s) => s.featureKind);
  const mode = useEditor((s) => s.mode);
  const lens = useUi((s) => s.lens);
  return (
    <div className="pd-group">
      <span className="pd-group-title">Станции и остановки</span>
      <div className="pd-cards">
        {NODE_FEATURES.filter((f) => STATION_IDS.has(f.id) && PRESETS[lens].station(f.id)).map((f) => {
          const on = mode === 'signal' && kind === f.id;
          return (
            <button key={f.id} className={`pd-card pd-sign${on ? ' on' : ''}`} aria-pressed={on} title={f.hint}
              onClick={() => { useUi.getState().setFeatureKind(f.id); useEditor.getState().setMode('signal'); close(); }}>
              <img src={signUrl(f.id)} alt="" width={34} height={34} draggable={false} />
              <b>{f.label}</b>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** What is picked now, as the capsule shows it closed. */
function usePicked(): string | null {
  const mode = useEditor((s) => s.mode);
  const template = useEditor((s) => s.templateIndex);
  const building = useBuildingTool((s) => s.template);
  const kind = useUi((s) => s.featureKind);
  if (mode === 'draw') return ROAD_TEMPLATES[template]?.label ?? null;
  if (mode === 'building') return `Здание: ${BUILDING_TEMPLATES[building]?.label.toLowerCase()}`;
  if (mode === 'signal') {
    if (kind.startsWith('ts:')) { const d = signDef(kind.slice(3)); return d ? `${d.code.startsWith('signal') ? '' : `${d.code} `}${d.name}` : null; }
    return NODE_FEATURES.find((f) => f.id === kind)?.label ?? null;
  }
  return null;
}

export function PresetDock() {
  const lens = useUi((s) => s.lens);
  const micro = useUi((s) => s.workspace === 'micro');
  const kind = useUi((s) => s.featureKind);
  const value = useUi((s) => s.signValue);
  const setValue = useUi((s) => s.setSignValue);
  const mode = useEditor((s) => s.mode);
  const [open, setOpen] = useState<Tab | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const picked = usePicked();
  // A tab is offered when the mode allows its tool and has at least one piece in it.
  const has: Record<Tab, boolean> = {
    roads: ROAD_TEMPLATES.some((t) => PRESETS[lens].road(t.tags)),
    buildings: lens === 'all',
    signs: SIGNS.some((s) => PRESETS[lens].sign(s.code)),
    stations: NODE_FEATURES.some((f) => STATION_IDS.has(f.id) && PRESETS[lens].station(f.id)),
  };
  const tabs = TABS.filter((t) => TOOLS_IN[lens].has(t.tool) && has[t.id]);
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e: PointerEvent) => { if (root.current && !root.current.contains(e.target as Node)) setOpen(null); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(null); } };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    return () => { window.removeEventListener('pointerdown', onDown, true); window.removeEventListener('keydown', onKey, true); };
  }, [open]);
  if (micro || !tabs.length) return null;
  const close = () => setOpen(null);
  const valued = mode === 'signal' && kind.startsWith('ts:') ? signDef(kind.slice(3))?.value : undefined;
  return (
    <div ref={root} className={`preset-dock${open ? ' open' : ''}`} data-tour="preset-dock">
      <div className="pd-body" aria-hidden={!open}>
        <div className="pd-inner">
          {open === 'roads' && <RoadCards close={close} />}
          {open === 'buildings' && <BuildingCards close={close} />}
          {open === 'signs' && <SignCards close={close} />}
          {open === 'stations' && <StationCards close={close} />}
        </div>
      </div>
      <div className="pd-bar">
        {tabs.map((t) => (
          <button key={t.id} className={`pd-tab${open === t.id ? ' on' : ''}`} aria-expanded={open === t.id} title={t.label} onClick={() => setOpen(open === t.id ? null : t.id)}>
            <Icon name={t.icon} size={18} /><span>{t.id === 'roads' ? ROADS_LABEL[lens] ?? t.label : t.label}</span>
          </button>
        ))}
        {picked && (
          <span className="pd-picked" title="Выбрано сейчас">
            <i />{picked}
            {valued && (
              <label className="pd-value">
                <input type="number" min={5} max={130} step={5} value={value} onChange={(e) => setValue(Number(e.target.value) || valued.default)} aria-label={valued.label} />
                <span>{valued.unit}</span>
              </label>
            )}
          </span>
        )}
      </div>
    </div>
  );
}
