import { StrictMode, useEffect } from 'react';
import type { ComponentType } from 'react';
import { createRoot } from 'react-dom/client';
import { getCurrentWindow, Window as TauriWindow } from '@tauri-apps/api/window';
import './tokens.css';
import './styles.css';
import { DENSITIES, SCALES, get, replaceState, useS } from './store';
import type { State } from './store';
import { act } from './act';
import { isEditable, mod } from './kbd';
import { emitTo, listen, startDrag } from './platform';
import { VIEWS, isView, viewOfLabel, wanted } from './popups';
import type { View } from './popups';
import { Settings } from './Settings';
import { Help } from './Help';
import { AiPop } from './AiPop';
import { Drawer } from './Drawer';
import { DevPanel } from './Controls';

/**
 * A popup window (see popups.ts). It renders one view from a copy of the main window's state and sends
 * everything the user does back as actions. Which view: the window's label, `popup-<view>`.
 */
const win = getCurrentWindow();
const view = viewOfLabel(win.label);

const COMPONENTS: Record<View, ComponentType> = { settings: Settings, help: Help, ai: AiPop, drawer: Drawer, dev: DevPanel };

const closeMe = () => void emitTo('main', 'yatai://popup-closed', view);
const focusMain = () => void TauriWindow.getByLabel('main').then((m) => m?.setFocus());

function Popup({ v }: { v: View }) {
  const s = useS();
  useEffect(() => {
    document.documentElement.dataset.theme = s.dark ? 'dark' : 'light';
    document.documentElement.style.setProperty('--ui-scale', String(SCALES[s.scale] ?? 1));
    document.documentElement.style.setProperty('--dens', String(DENSITIES[s.density] ?? 1));
  }, [s.dark, s.scale, s.density]);

  useEffect(() => {
    // the main window's shortcuts that still make sense here
    const keys = (e: KeyboardEvent) => {
      const M = mod(e);
      const k = e.key;
      const t = e.target as HTMLInputElement | null;
      if (M && !e.altKey) {
        const p = get().proposal;
        if (p && k === 'Enter') return (e.preventDefault(), e.stopPropagation(), act.acceptAi());
        if (p && k === 'Backspace' && !(isEditable(t) && t?.value)) return (e.preventDefault(), e.stopPropagation(), act.rejectAi());
        if (k === 'w') return (e.preventDefault(), closeMe());
        if (k === ',') return (e.preventDefault(), act.openSettings());
        if (e.shiftKey && k.toLowerCase() === 'd') return (e.preventDefault(), act.toggleDev());
        if (k === '/') return (e.preventDefault(), get().ai ? act.closeAi() : act.openAi());
        if (['1', '2', '3'].includes(k)) return (e.preventDefault(), act.setTab((['next', 'inbox', 'organizer'] as const)[+k - 1]), focusMain());
        if (isEditable(t)) return;
        if (k.toLowerCase() === 'z') return (e.preventDefault(), e.shiftKey ? act.redo() : act.undo());
        return;
      }
      if (k === '?' && !isEditable(t) && v !== 'help') (e.preventDefault(), act.toggleHelp());
    };
    // the headers move the (frameless) window
    const drag = (e: PointerEvent) => {
      const el = e.target as HTMLElement;
      if (e.button !== 0 || el.closest('button, input, select, textarea, a, [role="tab"]')) return;
      if (el.closest('.ai-head, .dhead, .dev-head, .help > h3')) (e.preventDefault(), void startDrag('move'));
    };
    const blur = () => (VIEWS[v] as { blurCloses?: boolean }).blurCloses && closeMe();
    window.addEventListener('keydown', keys, true);
    window.addEventListener('pointerdown', drag);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', keys, true);
      window.removeEventListener('pointerdown', drag);
      window.removeEventListener('blur', blur);
    };
  }, [v]);

  const C = COMPONENTS[v];
  return <C />;
}

async function boot() {
  if (!isView(view)) return void (document.body.textContent = `unknown popup: ${win.label}`);
  document.body.classList.add('popup-body', `popup-${view}`);
  const root = createRoot(document.getElementById('root')!);
  let first = true;
  await listen<State>('yatai://state', (m) => {
    replaceState(m);
    if (!first) return;
    first = false;
    root.render(
      <StrictMode>
        <Popup v={view} />
      </StrictMode>,
    );
    // a new window is created hidden: it shows itself once it has painted (later opens are the main window's)
    if (wanted(view, m))
      requestAnimationFrame(() =>
        setTimeout(async () => {
          await win.show();
          await win.setFocus();
        }, 0),
      );
  });
  await emitTo('main', 'yatai://popup-hello', view);
}
void boot();
