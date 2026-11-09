import { Suspense, lazy } from 'react';
import { useS } from './store';

/** CodeMirror is big: it is only fetched the first time the editor opens */
const Editor = lazy(() => import('./MdEditor').then((m) => ({ default: m.MdEditor })));
export const MdEditor = () => (useS().mdEdit ? <Suspense fallback={null}><Editor /></Suspense> : null);
