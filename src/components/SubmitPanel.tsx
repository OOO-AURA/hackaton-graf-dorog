import type { ReactNode } from 'react';
import { isDirty, useEditor } from '../state/store';
import { saveOsm } from '../state/actions';
import { useUi } from '../state/ui';
import { isDesktop } from '../platform';
import { CheckButton, useCheck } from './CheckPanel';
import { exportAs, exportReport } from './exports';
import { Icon } from './icons';

/**
 * Step «Сдача»: what the jury needs, as a list from top to bottom. A graph without errors, the
 * same check the server runs, the team's file name, then the save and the exports.
 */

type Mark = 'ok' | 'warn' | 'todo';

function Item({ n, mark, title, children }: { n: number; mark: Mark; title: string; children: ReactNode }) {
  return (
    <li className={`submit-item is-${mark}`}>
      <span className="submit-mark" aria-label={mark === 'ok' ? 'готово' : mark === 'warn' ? 'есть замечания' : 'не сделано'}>
        {mark === 'ok' ? <Icon name="check" size={13} /> : n}
      </span>
      <div className="submit-text">
        <b>{title}</b>
        {children}
      </div>
    </li>
  );
}

function GraphItem() {
  const report = useEditor((s) => s.report);
  const openBottom = useUi((s) => s.openBottom);
  const errors = report?.issues.filter((i) => i.severity === 'error').length ?? 0;
  const warnings = (report?.issues.length ?? 0) - errors;
  const mark: Mark = !report ? 'todo' : errors ? 'warn' : 'ok';
  return (
    <Item n={1} mark={mark} title="Граф без ошибок">
      <span className="hint">
        {!report ? 'Проверка графа ещё идёт.' : errors ? `Ошибок: ${errors}, замечаний: ${warnings}.` : warnings ? `Ошибок нет, замечаний: ${warnings}.` : 'Ошибок и замечаний нет.'}
        {report && report.issues.length > 0 && <> <button className="link" onClick={() => openBottom('issues')}>Показать</button></>}
      </span>
    </Item>
  );
}

function ServerItem() {
  const report = useCheck((s) => s.report);
  const running = useCheck((s) => s.running);
  const openBottom = useUi((s) => s.openBottom);
  const failed = report?.stages.filter((s) => s.status === 'fail').map((s) => s.name) ?? [];
  const mark: Mark = !report ? 'todo' : failed.length ? 'warn' : 'ok';
  return (
    <Item n={2} mark={mark} title="Проверка как на сервере">
      <span className="hint">
        {!isDesktop ? 'Работает в настольном приложении: в браузере нет SUMO, MATSim и Webots.'
          : running ? 'Идёт прогон, обычно 10–20 секунд.'
          : !report ? 'Граф пройдёт через те же программы, что на сервере организаторов.'
          : failed.length ? `Не прошли: ${failed.join(', ')}.` : 'SUMO, MATSim и Webots приняли файл.'}
        {report && <> <button className="link" onClick={() => openBottom('check')}>Отчёт</button></>}
      </span>
      <div className="buttons"><CheckButton /></div>
    </Item>
  );
}

function NameItem() {
  const saveName = useEditor((s) => s.saveName);
  const setSaveName = useEditor((s) => s.setSaveName);
  const named = /^hack-team\d+\.osm$/i.test(saveName.trim());
  return (
    <Item n={3} mark={named ? 'ok' : 'warn'} title="Имя файла">
      <span className="hint">Сервер ждёт имя команды, например <span className="mono">hack-team10.osm</span>.</span>
      <input className="mono submit-name" value={saveName} onChange={(e) => setSaveName(e.target.value)} aria-label="Имя файла для сдачи" spellCheck={false} />
    </Item>
  );
}

function SaveItem() {
  const dirty = useEditor(isDirty);
  return (
    <Item n={4} mark={dirty ? 'todo' : 'ok'} title="Сохранить и выгрузить">
      <span className="hint">{dirty ? 'Есть несохранённые правки.' : 'Всё сохранено.'} Экспорт пишет готовые сети для симуляторов и отчёт.</span>
      <div className="buttons">
        <button className="btn btn-ink" onClick={() => void saveOsm()}><Icon name="save" /> Сохранить .osm</button>
        <button className="btn" onClick={() => void exportAs('sumo')} disabled={!isDesktop} title={isDesktop ? 'Сеть через netconvert с теми же настройками, что и в Симуляции' : 'Нужен netconvert, он есть только в настольном приложении'}>SUMO .net.xml</button>
        <button className="btn" onClick={() => void exportAs('matsim')} title="Узлы и линки с пропускной способностью по СП">MATSim network.xml</button>
        <button className="btn" onClick={() => void exportReport()} title="Показатели, карта и графики в одном файле, из браузера печатается в PDF">Отчёт HTML</button>
      </div>
    </Item>
  );
}

export function SubmitPanel() {
  return (
    <ol className="submit-list">
      <GraphItem />
      <ServerItem />
      <NameItem />
      <SaveItem />
    </ol>
  );
}
