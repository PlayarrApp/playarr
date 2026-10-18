import {createContext} from 'react';
import type {RailTarget} from '../shell/ShellChrome';

// A work detail page keeps its parent section lit in the rail (web does the same); the page reports it here once its work loads.
export const DetailRailContext = createContext<(target: RailTarget | null) => void>(() => undefined);
