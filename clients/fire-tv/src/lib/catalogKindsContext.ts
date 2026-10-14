import {createContext} from 'react';
import type {WorkKind} from '@playarr-tv/api-client';

/** The catalog kinds already loaded and cached by the authenticated app shell. */
export const CatalogKindsContext = createContext<ReadonlySet<WorkKind> | null>(null);
