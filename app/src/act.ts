/**
 * The actions, as the views that can live in a popup window call them.
 * In the main window `act` *is* the actions module. In a popup window (popup.html) the store is only a copy,
 * so `act.x(...args)` sends the name and the arguments to the main window, which runs the real action; the
 * new state comes back as the next copy. Arguments must be plain data (ids, strings, small objects).
 */
import * as actions from './actions';
import { emitTo, inPopup } from './platform';

type Actions = typeof actions;

export const act: Actions = inPopup
  ? (new Proxy({} as Actions, {
      get: (_, name) => (...args: unknown[]) => void emitTo('main', 'yatai://act', { name: String(name), args }),
    }) as Actions)
  : actions;

/** main window: run an action a popup asked for */
export function runAct(name: string, args: unknown[]) {
  const f = (actions as Record<string, unknown>)[name];
  if (typeof f === 'function') return (f as (...a: unknown[]) => unknown)(...args);
  console.warn('yatai: a popup asked for an unknown action', name);
}
