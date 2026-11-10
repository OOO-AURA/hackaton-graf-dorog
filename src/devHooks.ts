// Dev builds only: headless checks (~/tools/pw/smoke-all.mjs) drive the app through window.__app.
import * as actions from './state/actions';
import * as edit from './osm/edit';
import * as buildingActions from './state/buildingActions';
import { useUi } from './state/ui';
import { useEditor } from './state/store';
import { serializeOsm } from './osm/serialize';

(window as unknown as { __app: unknown }).__app = { actions, edit, buildingActions, ui: useUi, editor: useEditor, serializeOsm };
