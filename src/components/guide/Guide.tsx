import { useEffect, useRef, useState } from 'react';
import { useEditor, type Mode } from '../../state/store';
import { useUi } from '../../state/ui';
import { openExample } from '../fileActions';
import { Icon, type IconName } from '../icons';
import { SECTIONS, sectionById, type GuideId } from './sections';

/**
 * The reference: a window with the contents on the left and one section on the right. It opens
 * by itself on the first start on «Знакомство», a short walk through the app; «?» and the (i)
 * buttons of the panels open it on their own section.
 */

const SEEN_KEY = 'graf-guide';

function seen(): boolean {
  try { return localStorage.getItem(SEEN_KEY) === 'seen'; } catch { return true; }
}

function markSeen(): void {
  try { localStorage.setItem(SEEN_KEY, 'seen'); } catch { /* private mode: it shows again next time */ }
}

const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement && (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable);

/** «?» opens and shuts the reference, Esc shuts it; the first start opens it on the walk. */
function useGuideKeys(): void {
  useEffect(() => {
    if (!seen()) useUi.getState().setHelpOpen(true, 'welcome');
    const onKey = (e: KeyboardEvent) => {
      const ui = useUi.getState();
      if (e.key === 'Escape' && ui.helpOpen) { e.stopImmediatePropagation(); ui.setHelpOpen(false); return; }
      if (e.key === '?' && !isTyping(e.target) && !e.metaKey && !e.ctrlKey) { e.preventDefault(); ui.setHelpOpen(!ui.helpOpen, ui.helpOpen ? undefined : 'start'); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);
}

const ACTIONS: ReadonlyArray<{ mode: Mode; icon: IconName; title: string; text: string; key: string }> = [
  { mode: 'draw', icon: 'road', title: 'Нарисовать дорогу', text: 'Точки кликами, Enter заканчивает', key: 'D' },
  { mode: 'signal', icon: 'signal', title: 'Светофор или знак', text: 'Знак встаёт у края ближней дороги', key: 'T' },
  { mode: 'building', icon: 'building', title: 'Поставить здание', text: 'Само встаёт вдоль дороги', key: 'B' },
  { mode: 'insert', icon: 'node', title: 'Узел на дороге', text: 'Для изгиба или перекрёстка', key: 'N' },
];

/** The window in small: where each part is. */
function Layout() {
  return (
    <div className="guide-layout" aria-hidden="true">
      <i className="gl-head">Шапка: файл, шаги, сохранение</i>
      <i className="gl-nav">Навигатор</i>
      <i className="gl-map">Карта и инструменты</i>
      <i className="gl-insp">Инспектор</i>
      <i className="gl-dock">Нижняя панель: ошибки, отчёт, изменения</i>
    </div>
  );
}

function Welcome({ go, close }: { go: (id: GuideId) => void; close: () => void }) {
  const [page, setPage] = useState(0);
  const empty = useEditor((s) => !Object.keys(s.doc.nodes).length);
  const act = async (mode: Mode) => {
    close();
    if (empty) await openExample();
    useEditor.getState().setMode(mode);
  };
  const pages = [
    {
      title: 'Граф дорог',
      body: (
        <>
          <p className="guide-lead">Редактор улично-дорожной сети из OpenStreetMap. Правьте дороги, перекрёстки, светофоры и здания, сразу смотрите, как меняются потоки, и сохраняйте файл, который примут MATSim, SUMO и Webots.</p>
          <Layout />
        </>
      ),
    },
    {
      title: 'Правка',
      body: (
        <>
          <p>Кликните дорогу, перекрёсток или здание: справа появятся его свойства. Или начните с действия:</p>
          <div className="guide-actions">
            {ACTIONS.map((a) => (
              <button key={a.mode} className="insp-start" onClick={() => void act(a.mode)}>
                <Icon name={a.icon} size={18} />
                <span><b>{a.title}</b><span className="hint">{a.text}</span></span>
                <kbd>{a.key}</kbd>
              </button>
            ))}
          </div>
          {empty && <p className="hint">Граф ещё не открыт: кнопка откроет пример из задания.</p>}
        </>
      ),
    },
    {
      title: 'Макро и Микро',
      body: (
        <>
          <p>Шаги в центре шапки показывают, как правка меняет движение:</p>
          <dl className="guide-dl">
            <dt>Макро</dt><dd>«Распределить потоки» — и цвет дорог покажет загрузку в час пик. Видно, где сеть не справится.</dd>
            <dt>Микро</dt><dd>«Запустить SUMO» — машины поедут по полосам, видно очереди у светофоров, задержку и уровень обслуживания.</dd>
            <dt>Сценарии</dt><dd>Сохраните базу и правку отдельными сценариями и сравните их в одной таблице.</dd>
          </dl>
        </>
      ),
    },
    {
      title: 'Проверка и сохранение',
      body: (
        <>
          <dl className="guide-dl">
            <dt>Ошибки графа</dt><dd>Вкладка внизу: места, которые симуляторы поймут неправильно. Многие чинятся одной кнопкой.</dd>
            <dt>Отчёт сервера</dt><dd>Прогон через те же программы, что у организаторов. Зелёный — файл примут.</dd>
            <dt>Сохранить</dt><dd><kbd>⌘S</kbd>. В меню рядом — имя файла и экспорт сетей SUMO и MATSim.</dd>
          </dl>
          <p>Этот справочник всегда открывается кнопкой <kbd>?</kbd> в шапке, а значки <Icon name="info" size={14} /> на панелях ведут сразу в нужный раздел.</p>
        </>
      ),
    },
  ];
  const last = page === pages.length - 1;
  return (
    <div className="guide-welcome">
      <p className="micro">Знакомство · {page + 1} из {pages.length}</p>
      <h3 className="display guide-title">{pages[page].title}</h3>
      <div className="guide-page" key={page}>{pages[page].body}</div>
      <div className="guide-walk">
        <div className="guide-dots" role="tablist" aria-label="Страницы знакомства">
          {pages.map((p, i) => <button key={p.title} role="tab" aria-selected={i === page} aria-label={p.title} className={i === page ? 'on' : ''} onClick={() => setPage(i)} />)}
        </div>
        {page > 0 && <button className="btn btn-quiet" onClick={() => setPage(page - 1)}>Назад</button>}
        {last
          ? <button className="btn btn-ink" onClick={() => { if (empty) { close(); void openExample(); } else go('start'); }}>{empty ? 'Открыть пример' : 'Дальше: весь справочник'}</button>
          : <button className="btn btn-ink" onClick={() => setPage(page + 1)}>Дальше</button>}
      </div>
    </div>
  );
}

export function Guide() {
  useGuideKeys();
  const open = useUi((s) => s.helpOpen);
  const section = useUi((s) => s.helpSection);
  const setOpen = useUi((s) => s.setHelpOpen);
  const hints = useUi((s) => s.mapHints);
  const setHints = useUi((s) => s.setMapHints);
  const body = useRef<HTMLDivElement>(null);
  useEffect(() => { body.current?.scrollTo({ top: 0 }); }, [section]);
  if (!open) return null;
  const close = () => { markSeen(); setOpen(false); };
  const go = (id: GuideId) => setOpen(true, id);
  const current = sectionById(section);
  const groups = [...new Set(SECTIONS.map((s) => s.group))];
  return (
    <div className="help-backdrop" onPointerDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <section className="help guide" role="dialog" aria-modal="true" aria-label="Справочник">
        <header className="help-head">
          <h2 className="display">Справочник</h2>
          <button className="icon-btn" onClick={close} aria-label="Закрыть справочник" title="Esc"><Icon name="close" /></button>
        </header>
        <div className="guide-main">
          <nav className="guide-toc" aria-label="Разделы">
            {groups.map((g) => (
              <div key={g}>
                <p className="micro">{g}</p>
                {SECTIONS.filter((s) => s.group === g).map((s) => (
                  <button key={s.id} className={s.id === section ? 'on' : ''} aria-current={s.id === section ? 'page' : undefined} onClick={() => go(s.id)}>{s.title}</button>
                ))}
              </div>
            ))}
            <label className="help-hints">
              <input type="checkbox" className="switch" checked={hints} onChange={(e) => setHints(e.target.checked)} />
              Подсказка внизу карты
            </label>
          </nav>
          <div className="guide-body" ref={body}>
            {current.id === 'welcome'
              ? <Welcome go={go} close={close} />
              : (
                <article className="guide-article">
                  <h3 className="display guide-title">{current.title}</h3>
                  {current.body()}
                </article>
              )}
          </div>
        </div>
      </section>
    </div>
  );
}
