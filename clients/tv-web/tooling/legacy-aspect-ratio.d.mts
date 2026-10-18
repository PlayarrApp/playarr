export function parseRatio(value: unknown): number | undefined;
export function applyAspectRatios(documentObject: Document, selectors: string[], windowObject?: Window): number;
export function installLegacyAspectRatio(options?: { windowObject?: Window; documentObject?: Document }): () => void;
