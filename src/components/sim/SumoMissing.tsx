import { checkSumo, type SumoStatus } from '../../sim/store';

const isWindows = typeof navigator !== 'undefined' && /Win/i.test(navigator.userAgent);

const STEPS = isWindows
  ? ['py -m venv $HOME\\tools\\sumo-venv', '& $HOME\\tools\\sumo-venv\\Scripts\\pip install eclipse-sumo']
  : ['python3 -m venv ~/tools/sumo-venv', '~/tools/sumo-venv/bin/pip install eclipse-sumo'];

const WHAT: Readonly<Record<string, string>> = {
  sumo: 'sumo, сам симулятор',
  netconvert: 'netconvert, он строит сеть SUMO из графа',
  SUMO_HOME: 'папка SUMO_HOME с randomTrips.py и sumolib',
};

/** Shown instead of the run button's silent failure: what is missing and how to install it. */
export function SumoMissing({ status }: { status: SumoStatus }) {
  return (
    <section className="sumo-missing" role="alert">
      <p><strong>SUMO не найден.</strong> Микросимуляции не хватает: {status.missing.map((m) => WHAT[m] ?? m).join('; ')}.</p>
      <p>Проще всего поставить SUMO из pip в отдельное окружение{isWindows ? ' (команды для PowerShell)' : ''}, приложение найдёт его само:</p>
      <pre className="mono">{STEPS.join('\n')}</pre>
      <p>Если SUMO уже стоит в другом месте, укажите папку с программами в переменной <code>GRAF_SUMO_BIN</code>, а корень установки в <code>SUMO_HOME</code>, и перезапустите приложение. Сейчас программы ищутся в <code>{status.bin || 'PATH'}</code>.</p>
      <button className="btn" onClick={() => void checkSumo()}>Проверить снова</button>
    </section>
  );
}
