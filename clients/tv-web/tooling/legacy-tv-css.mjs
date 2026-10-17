import postcss from "postcss";

function matchingParen(value, openIndex) {
  let depth = 0;
  for (let index = openIndex; index < value.length; index += 1) {
    if (value[index] === "(") depth += 1;
    else if (value[index] === ")") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function topLevelParts(value) {
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === "(") depth += 1;
    else if (value[index] === ")") depth -= 1;
    else if (value[index] === "," && depth === 0) {
      parts.push(value.slice(start, index).trim());
      start = index + 1;
    }
  }
  parts.push(value.slice(start).trim());
  return parts;
}

function firstMixedColour(contents) {
  const parts = topLevelParts(contents);
  if (parts.length < 3 || !/^in\s+srgb(?:-linear)?$/i.test(parts[0])) return undefined;
  return parts[1].replace(/\s+[+-]?(?:\d+(?:\.\d+)?|\.\d+)%\s*$/, "").trim();
}

/**
 * Gives the Chromium 94 vendor floor a usable solid-colour fallback while preserving the
 * richer color-mix declaration for newer TVs. Playarr's mixes consistently
 * put the semantic theme colour first, so the fallback follows theme changes.
 */
export function replaceUnsupportedColorMix(value) {
  let output = "";
  let cursor = 0;
  while (cursor < value.length) {
    const start = value.indexOf("color-mix(", cursor);
    if (start < 0) return output + value.slice(cursor);
    output += value.slice(cursor, start);
    const open = start + "color-mix".length;
    const close = matchingParen(value, open);
    if (close < 0) return output + value.slice(start);
    const replacement = firstMixedColour(value.slice(open + 1, close));
    output += replacement || value.slice(start, close + 1);
    cursor = close + 1;
  }
  return output;
}

function insetSides(value) {
  const values = postcss.list.space(value);
  if (values.length < 1 || values.length > 4) return undefined;
  const [top, second = top, third = top, fourth = second] = values;
  return values.length === 2
    ? [top, second, top, second]
    : values.length === 3
      ? [top, second, third, second]
      : [top, second, third, fourth];
}

const CHANNELS = ["r", "g", "b", "a"];
const MIX_SUPPORTS = "(color: color-mix(in srgb, red 50%, blue))";
const round = (number) => Number(number.toFixed(4));

/** Literal colour as [r, g, b, a] numbers, or undefined. */
function literalChannels(value) {
  const text = value.trim().toLowerCase();
  if (text === "transparent") return [0, 0, 0, 0];
  if (text === "white") return [255, 255, 255, 1];
  if (text === "black") return [0, 0, 0, 1];
  const hex = text.match(/^#([0-9a-f]{3,8})$/);
  if (hex) {
    let digits = hex[1];
    if (digits.length === 3 || digits.length === 4) digits = [...digits].map((d) => d + d).join("");
    if (digits.length !== 6 && digits.length !== 8) return undefined;
    const bytes = digits.match(/../g).map((pair) => parseInt(pair, 16));
    return [bytes[0], bytes[1], bytes[2], bytes.length === 4 ? round(bytes[3] / 255) : 1];
  }
  const rgb = text.match(/^rgba?\(([^)]*)\)$/);
  if (rgb) {
    const parts = rgb[1].split(/[\s,/]+/).filter(Boolean);
    if (parts.length < 3 || parts.length > 4) return undefined;
    const numbers = parts.map((part, index) =>
      part.endsWith("%") ? (parseFloat(part) / 100) * (index < 3 ? 255 : 1) : parseFloat(part)
    );
    if (numbers.some((n) => !Number.isFinite(n))) return undefined;
    return [numbers[0], numbers[1], numbers[2], numbers[3] ?? 1];
  }
  return undefined;
}

const channelName = (property, channel) => `--lc-${property.slice(2)}-${channel}`;

/**
 * Channels of one colour term as CSS number expressions (numbers or var() of the channel custom
 * properties this plugin emits next to every colour token), or undefined when unsupported.
 */
function termChannels(value) {
  const literal = literalChannels(value);
  if (literal) return literal;
  const token = value.trim().match(/^var\(\s*(--[\w-]+)\s*\)$/);
  if (token) return CHANNELS.map((channel) => `var(${channelName(token[1], channel)})`);
  const mix = value.trim().match(/^color-mix\(/i) ? mixChannels(value.trim().slice("color-mix(".length, -1)) : undefined;
  return mix;
}

const isNumber = (expr) => typeof expr === "number";
const times = (a, b) => (isNumber(a) && isNumber(b) ? round(a * b) : a === 1 ? b : b === 1 ? a : a === 0 || b === 0 ? 0 : `(${a} * ${b})`);
const plus = (a, b) => (isNumber(a) && isNumber(b) ? round(a + b) : a === 0 ? b : b === 0 ? a : `(${a} + ${b})`);

/** Premultiplied sRGB mix of two terms, as four channel expressions (CSS Color 5 color-mix). */
function mixChannels(contents) {
  const parts = topLevelParts(contents);
  if (parts.length !== 3 || !/^in\s+srgb$/i.test(parts[0])) return undefined;
  const terms = parts.slice(1).map((part) => {
    const match = part.match(/^(.*?)(?:\s+([\d.]+)%)?$/s);
    return { colour: termChannels(match[1]), weight: match[2] === undefined ? undefined : parseFloat(match[2]) / 100 };
  });
  if (terms.some((term) => !term.colour)) return undefined;
  let [p, q] = terms.map((term) => term.weight);
  if (p === undefined && q === undefined) p = q = 0.5;
  else if (p === undefined) p = 1 - q;
  else if (q === undefined) q = 1 - p;
  const sum = p + q;
  if (!(sum > 0)) return undefined;
  const alphaScale = Math.min(sum, 1);
  p /= sum;
  q /= sum;
  const [x, y] = terms.map((term) => term.colour);
  const xWeight = times(x[3], p);
  const yWeight = times(y[3], q);
  const alpha = plus(xWeight, yWeight);
  const colour = [0, 1, 2].map((index) => {
    if (y[3] === 0) return x[index];
    if (x[3] === 0) return y[index];
    const premultiplied = plus(times(x[index], xWeight), times(y[index], yWeight));
    if (isNumber(alpha)) return isNumber(premultiplied) ? round(premultiplied / alpha) : alpha === 1 ? premultiplied : `(${premultiplied} / ${alpha})`;
    return `(${premultiplied} / max(${alpha}, 0.0001))`;
  });
  return [...colour, times(alpha, alphaScale)];
}

const cssNumber = (expr) => (isNumber(expr) ? String(expr) : `calc${expr.startsWith("(") ? expr : `(${expr})`}`);
const rgbaOf = (channels) => `rgba(${channels.map(cssNumber).join(", ")})`;

/**
 * Replaces every color-mix() in a value with an equivalent rgba() built from channel custom
 * properties, which the Chromium 94 vendor floor understands. Undefined when a term is unsupported.
 */
export function colorMixToChannels(value) {
  let output = "";
  let cursor = 0;
  while (cursor < value.length) {
    const start = value.indexOf("color-mix(", cursor);
    if (start < 0) return output + value.slice(cursor);
    output += value.slice(cursor, start);
    const open = start + "color-mix".length;
    const close = matchingParen(value, open);
    if (close < 0) return undefined;
    const channels = mixChannels(value.slice(open + 1, close));
    if (!channels) return undefined;
    output += rgbaOf(channels);
    cursor = close + 1;
  }
  return output;
}


const HAS_SUPPORTS = "selector(:has(a))";
const HAS_ATTRIBUTE = "data-lc-has";

function hasId(anchor, relative) {
  let hash = 5381;
  for (const char of `${anchor}|${relative}`) hash = ((hash * 33) ^ char.charCodeAt(0)) >>> 0;
  return `h${hash.toString(36)}`;
}

/**
 * Rewrites `A:has(R)` into `A[data-lc-has~="hN"]` and returns the definitions the runtime
 * (`legacy-has.mjs`) needs to set that attribute. Undefined when the selector cannot be rewritten
 * (nested :has, or :has without a compound before it).
 */
export function rewriteHasSelector(selector, definitions = new Map()) {
  let output = "";
  let cursor = 0;
  while (cursor < selector.length) {
    const start = selector.indexOf(":has(", cursor);
    if (start < 0) return output + selector.slice(cursor);
    const open = start + ":has".length;
    const close = matchingParen(selector, open);
    if (close < 0) return undefined;
    const relative = selector.slice(open + 1, close).trim();
    if (relative.includes(":has(")) return undefined;
    const before = output + selector.slice(cursor, start);
    const anchor = before.split(/\s*[>+~]\s*|\s+/).pop();
    if (!anchor) return undefined;
    const id = hasId(anchor.replace(/\[data-lc-has~="h[0-9a-z]+"\]/g, ""), relative);
    definitions.set(id, { anchor: anchor.replace(/\[data-lc-has~="h[0-9a-z]+"\]/g, ""), relative });
    output = `${before}[${HAS_ATTRIBUTE}~="${id}"]`;
    cursor = close + 1;
  }
  return output;
}

function addHasFallbacks(root) {
  const definitions = new Map();
  const legacyBlock = (nodes) => postcss.atRule({ name: "supports", params: `not ${HAS_SUPPORTS}`, nodes });
  const rewriteRule = (rule) => {
    if (!rule.selector.includes(":has(")) return rule.clone();
    const selectors = rule.selectors.map((selector) => rewriteHasSelector(selector, definitions));
    if (selectors.some((selector) => selector === undefined)) return undefined;
    return rule.clone({ selectors });
  };
  // Web's own `@supports selector(:has(...))` blocks: give engines without :has() the same rules,
  // with the :has() part provided by the runtime attribute.
  root.walkAtRules("supports", (atRule) => {
    if (!/^selector\(\s*:has\(/.test(atRule.params.trim())) return;
    const copy = [];
    atRule.each((node) => {
      if (node.type !== "rule") return;
      const rewritten = rewriteRule(node);
      if (rewritten) copy.push(rewritten);
    });
    if (copy.length) atRule.after(legacyBlock(copy));
  });
  root.walkRules((rule) => {
    if (!rule.selector.includes(":has(")) return;
    if (rule.parent?.type === "atrule" && rule.parent.name === "supports" && /:has\(/.test(rule.parent.params)) return;
    if (rule.parent?.type === "atrule" && /keyframes$/i.test(rule.parent.name)) return;
    const rewritten = rewriteRule(rule);
    if (rewritten) rule.after(legacyBlock([rewritten]));
  });
  if (definitions.size) {
    root.append(
      legacyBlock([
        postcss.rule({
          selector: ":root",
          nodes: [...definitions].map(([id, definition]) =>
            postcss.decl({ prop: `--lc-has-${id}`, value: JSON.stringify(JSON.stringify(definition)) })
          ),
        }),
      ])
    );
  }
}


// Chromium 85 (Tizen 6.5) has no :is(), :where(), :focus-visible, the logical padding/margin shorthands or overflow: clip. A rule with an
// unsupported selector is dropped whole, so these are rewritten for the Tizen package only (`chromium85: true`). Playarr's TV builds have
// only a remote, so focus is always keyboard focus and :focus-visible reads as :focus.
const MAX_EXPANDED_SELECTORS = 64;

/** Expands :is() and :where() argument lists into plain selectors (the order of the list is kept); undefined when too many result. */
export function expandMatchesSelectors(selector) {
  const match = /:(?:is|where)\(/.exec(selector);
  if (!match) return [selector];
  const open = match.index + match[0].length - 1;
  const close = matchingParen(selector, open);
  if (close < 0) return [selector];
  const results = [];
  for (const argument of topLevelParts(selector.slice(open + 1, close))) {
    for (const expanded of expandMatchesSelectors(`${selector.slice(0, match.index)}${argument}${selector.slice(close + 1)}`)) {
      results.push(expanded);
      if (results.length > MAX_EXPANDED_SELECTORS) return undefined;
    }
  }
  return results;
}

const LOGICAL_SHORTHANDS = {
  "padding-inline": ["padding-left", "padding-right"],
  "padding-block": ["padding-top", "padding-bottom"],
  "margin-inline": ["margin-left", "margin-right"],
  "margin-block": ["margin-top", "margin-bottom"],
};

function addChromium85Fallbacks(root) {
  root.walkRules((rule) => {
    if (rule.parent?.type === "atrule" && /keyframes$/i.test(rule.parent.name)) return;
    if (!/:(?:is|where|focus-visible)\b/.test(rule.selector)) return;
    const selectors = rule.selectors.flatMap((selector) => expandMatchesSelectors(selector) ?? [selector]);
    rule.selectors = [...new Set(selectors.map((selector) => selector.replace(/:focus-visible\b/g, ":focus")))];
  });
  root.walkDecls((declaration) => {
    // The :has() fallback evaluates its relative selectors with matches(), which throws on :focus-visible here.
    if (declaration.prop.startsWith("--lc-has-")) declaration.value = declaration.value.replace(/:focus-visible\b/g, ":focus");
    const sides = LOGICAL_SHORTHANDS[declaration.prop];
    if (sides) {
      const values = postcss.list.space(declaration.value);
      if (values.length >= 1 && values.length <= 2) {
        declaration.cloneBefore({ prop: sides[0], value: values[0] });
        declaration.cloneBefore({ prop: sides[1], value: values[1] ?? values[0] });
      }
    } else if (declaration.prop === "overflow" && /^clip$/i.test(declaration.value.trim())) {
      declaration.cloneBefore({ value: "hidden" });
    }
  });
}

export function addLegacyTvCssFallbacks(css, from = undefined, { chromium85 = false } = {}) {
  const root = postcss.parse(css, { from });
  const mixedRules = new Set();
  root.walkDecls((declaration) => {
    if (declaration.prop === "inset") {
      const sides = insetSides(declaration.value);
      if (sides) {
        for (const [property, value] of ["top", "right", "bottom", "left"].map(
          (property, index) => [property, sides[index]]
        )) {
          declaration.cloneBefore({ prop: property, value });
        }
      }
    }

    // Every colour token also publishes its channels, so color-mix() over tokens can be
    // rewritten as rgba(calc(...)) that follows the token wherever it is (re)defined.
    if (declaration.prop.startsWith("--") && !declaration.prop.startsWith("--lc-")) {
      const channels = termChannels(declaration.value);
      if (channels) {
        channels.forEach((expr, index) => {
          declaration.cloneAfter({ prop: channelName(declaration.prop, CHANNELS[index]), value: cssNumber(expr) });
        });
      }
    }

    if (declaration.value.includes("color-mix(")) {
      const inKeyframes = declaration.parent?.parent?.type === "atrule" && /keyframes$/i.test(declaration.parent.parent.name);
      const exact = inKeyframes ? undefined : colorMixToChannels(declaration.value);
      if (exact) {
        mixedRules.add(declaration.parent);
        declaration.raws.legacyColorMix = declaration.value;
        declaration.value = exact;
        return;
      }
      const fallback = replaceUnsupportedColorMix(declaration.value);
      if (fallback !== declaration.value && !fallback.includes("color-mix(")) {
        declaration.cloneBefore({ value: fallback });
      }
    }
  });

  // `scrollbar-width: none` needs Chromium 121. Older engines hide the bar with the WebKit pseudo-element.
  root.walkRules((rule) => {
    if (!rule.nodes?.some((node) => node.type === "decl" && node.prop === "scrollbar-width" && node.value.trim() === "none")) return;
    const selectors = rule.selectors.filter((selector) => !selector.includes("::"));
    if (selectors.length === 0) return;
    rule.after(postcss.rule({ selectors: selectors.map((selector) => `${selector}::-webkit-scrollbar`), nodes: [postcss.decl({ prop: "display", value: "none" })] }));
  });

  // `scrollbar-color` (Chromium 121) inherits; draw the same bar for the element and its descendants:
  // the classic 15px gutter, track colour, and a thumb inset 3px with rounded ends.
  root.walkRules((rule) => {
    const colour = rule.nodes?.find((node) => node.type === "decl" && node.prop === "scrollbar-color");
    if (!colour) return;
    const [thumb, track] = postcss.list.space(colour.value);
    const selectors = rule.selectors.filter((selector) => !selector.includes("::"));
    if (!thumb || !track || selectors.length === 0) return;
    const scoped = (pseudo) => selectors.flatMap((selector) => [`${selector}${pseudo}`, `${selector} ${pseudo}`]);
    const decls = (entries) => entries.map(([prop, value]) => postcss.decl({ prop, value }));
    rule.after(
      postcss.rule({ selectors: scoped("::-webkit-scrollbar-thumb"), nodes: decls([["background-color", thumb], ["border", "3px solid transparent"], ["background-clip", "padding-box"], ["border-radius", "8px"]]) })
    );
    rule.after(
      postcss.rule({ selectors: scoped("::-webkit-scrollbar"), nodes: decls([["width", "15px"], ["height", "15px"], ["background-color", track]]) })
    );
  });

  // A declaration that contains var() is never dropped at parse time, so a fallback placed before
  // it cannot win on engines without color-mix(). Keep the rgba() form in the rule and give the
  // original color-mix() declarations back to engines that support them, right after the rule so
  // the cascade order is unchanged.
  for (const rule of mixedRules) {
    const modern = rule.clone({ nodes: [] });
    rule.each((node) => {
      if (node.type === "decl" && node.raws.legacyColorMix) {
        modern.append(node.clone({ value: node.raws.legacyColorMix, raws: { ...node.raws, legacyColorMix: undefined } }));
        delete node.raws.legacyColorMix;
      }
    });
    rule.after(postcss.atRule({ name: "supports", params: MIX_SUPPORTS, nodes: [modern] }));
  }
  addHasFallbacks(root);
  if (chromium85) addChromium85Fallbacks(root);
  return root.toString();
}

// Adds two ids of specificity (`:not(#_):not(#__)`) to the last compound of a selector, before a trailing pseudo-element.
function withExtraId(selector) {
  const match = selector.match(/(::[\w-]+(?:\([^)]*\))?)\s*$/);
  const ids = ":not(#_):not(#__)";
  return match ? `${selector.slice(0, match.index)}${ids}${match[1]}` : `${selector}${ids}`;
}

const WEIGHT_IN_FONT = /^\s*(?:(?:italic|oblique|normal|small-caps)\s+)*(\d{3}|bold|bolder|lighter)\b/i;
// Elements whose weight comes from the user-agent stylesheet.
const BOLD_BY_DEFAULT = "h1,h2,h3,h4,h5,h6,b,strong,th,optgroup";

/**
 * The webOS TV Simulator injects `* { font-weight: 400 !important }`, which flattens every weight. An
 * `!important` rule with more id specificity wins over it, so the stylesheet repeats its own weights that way:
 * inherit everywhere, bold for the user-agent bold elements, then every author font-weight again, in source order.
 * Every author selector gains the same two ids and the baseline rules one, so (baselines repeated per file never beat an author weight) the relative cascade between author rules is unchanged. A real TV
 * resolves the same weights as before.
 */
export function pinFontWeights(css, from = undefined) {
  const root = postcss.parse(css, { from });
  const repeats = [];
  root.walkRules((rule) => {
    if (rule.parent?.type === "atrule" && /keyframes|font-face/i.test(rule.parent.name)) return;
    const weights = [];
    rule.each((node) => {
      if (node.type !== "decl") return;
      if (node.prop === "font-weight") weights.push(node.value.replace(/\s*!important\s*$/i, ""));
      else if (node.prop === "font") {
        const m = node.value.match(WEIGHT_IN_FONT);
        if (m) weights.push(m[1]);
      }
    });
    if (weights.length === 0) return;
    repeats.push({ rule, value: weights.at(-1) });
  });
  if (repeats.length === 0) return css;
  for (const { rule, value } of repeats) {
    rule.after(
      postcss.rule({
        selectors: rule.selectors.map(withExtraId),
        nodes: [postcss.decl({ prop: "font-weight", value, important: true })],
      })
    );
  }
  root.prepend(
    postcss.rule({ selector: `*:not(#_)`, nodes: [postcss.decl({ prop: "font-weight", value: "inherit", important: true })] }),
    postcss.rule({ selectors: BOLD_BY_DEFAULT.split(",").map((tag) => `${tag}:not(#_)`), nodes: [postcss.decl({ prop: "font-weight", value: "bold", important: true })] })
  );
  return root.toString();
}

export function legacyTvCssPlugin({ pinWeights = false, chromium85 = false } = {}) {
  return {
    name: "playarr-legacy-tv-css",
    enforce: "pre",
    transform(code, id) {
      if (!id.split("?", 1)[0].endsWith(".css")) return null;
      const css = addLegacyTvCssFallbacks(code, id, { chromium85 });
      return { code: pinWeights ? pinFontWeights(css, id) : css, map: null };
    },
  };
}
