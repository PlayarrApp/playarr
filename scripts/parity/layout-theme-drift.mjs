// Web refs must say the same thing in both themes: any non-volatile text present in one theme's layout and not the other is run-dependent drift
// (e.g. the nav profile chip captured before the display name resolved). The theme picker labels are the only legitimate theme-dependent text.
const THEME_LABEL = /^(Theme: )?(Dark|Light)$/;

export function themeTextDrift(dark, light) {
  const count = (layout) => {
    const m = new Map();
    for (const e of layout.elements) if (!e.volatile && e.text && !THEME_LABEL.test(e.text)) m.set(e.text, (m.get(e.text) ?? 0) + 1);
    return m;
  };
  const a = count(dark), b = count(light), out = [];
  for (const [t, n] of a) if (n > (b.get(t) ?? 0)) out.push(`dark only: ${t}`);
  for (const [t, n] of b) if (n > (a.get(t) ?? 0)) out.push(`light only: ${t}`);
  return out;
}
