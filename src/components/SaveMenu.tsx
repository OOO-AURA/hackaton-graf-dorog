import { useEffect, useRef } from 'react';
import { saveOsm } from '../state/actions';
import { useEditor } from '../state/store';
import { isDesktop } from '../platform';
import { exportAs, exportReport } from './exports';
import { Icon } from './icons';

/**
 * Save button with a menu beside it: the name the file is saved under (the server waits for the
 * team's name, hack-teamNN.osm), save as, and the exports of networks for the simulators and the report.
 */
export function SaveMenu() {
  const empty = useEditor((s) => !Object.keys(s.doc.nodes).length);
  const saveName = useEditor((s) => s.saveName);
  const setSaveName = useEditor((s) => s.setSaveName);
  const ref = useRef<HTMLDetailsElement>(null);
  const close = () => ref.current?.removeAttribute('open');
  const run = (task: () => Promise<void>) => { close(); void task(); };
  const named = /^hack-team\d+\.osm$/i.test(saveName.trim());
  // A click outside the menu shuts it, as menus do.
  useEffect(() => {
    const onDown = (e: PointerEvent) => { if (ref.current?.open && !ref.current.contains(e.target as Node)) close(); };
    window.addEventListener('pointerdown', onDown);
    return () => window.removeEventListener('pointerdown', onDown);
  }, []);
  return (
    <div className="save-split">
      <button className="btn btn-ink" onClick={() => void saveOsm()} disabled={empty} title={`Сохранить как ${saveName} (⌘S)`}><Icon name="save" /> Сохранить</button>
      <details className="menu save-menu" ref={ref}>
        <summary className={`btn btn-ink save-more${empty ? ' is-disabled' : ''}`} aria-label="Ещё: имя файла и экспорт" title="Имя файла, сохранить как, экспорт" onClick={(e) => { if (empty) e.preventDefault(); }}>
          <Icon name="chevron" size={14} />
        </summary>
        <div className="menu-list" role="menu">
          <label className="field save-name">
            <span>Имя файла{named ? '' : ' · сервер ждёт hack-teamNN.osm'}</span>
            <input className="mono" value={saveName} onChange={(e) => setSaveName(e.target.value)} spellCheck={false} aria-label="Имя файла" onKeyDown={(e) => { if (e.key === 'Enter') run(() => saveOsm()); }} />
          </label>
          <button role="menuitem" onClick={() => run(() => saveOsm(true))}><strong>Сохранить как… <kbd>⌘⇧S</kbd></strong><span>Выбрать папку и имя</span></button>
          <hr />
          <button role="menuitem" onClick={() => run(() => exportAs('sumo'))} disabled={!isDesktop}><strong>Сеть SUMO .net.xml</strong><span>{isDesktop ? 'netconvert с теми же настройками, что в Микро' : 'Только в настольном приложении: нужен netconvert'}</span></button>
          <button role="menuitem" onClick={() => run(() => exportAs('matsim'))}><strong>Сеть MATSim network.xml</strong><span>Узлы и линки с пропускной способностью по СП</span></button>
          <button role="menuitem" onClick={() => run(exportReport)}><strong>Отчёт HTML</strong><span>Показатели, карта и графики в одном файле, печатается в PDF</span></button>
        </div>
      </details>
    </div>
  );
}
