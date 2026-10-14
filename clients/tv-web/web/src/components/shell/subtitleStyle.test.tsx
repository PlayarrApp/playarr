import { readFileSync, readdirSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { PageHeader } from "./PageHeader";

// Owner rule 2026-10-14: every page header subtitle is the Movies, Series and Music one: beside the title, after a
// vertical divider, in the page ink (never the pink kicker), wrapping under the title only when there is no room.
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const global = read("../../styles/global.css");
const layout = read("../../styles/page-layout.css");
const back = { label: "Back", to: "/" };
const html = (node: React.ReactElement) => renderToStaticMarkup(<MemoryRouter>{node}</MemoryRouter>);

function rule(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? "";
}

describe("one header subtitle style", () => {
  it("renders every header subtitle, in every variant, as the plain detail span", () => {
    for (const variant of ["page", "detail"] as const) {
      const markup = html(<PageHeader title="Title" detail="Subtitle" variant={variant} back={back} />);
      expect(markup).toContain('<span class="page-header-detail">Subtitle</span>');
      expect(markup).not.toMatch(/<(strong|small)\b/);
      expect(markup).not.toMatch(/is-section|tv-detail-heading-item|page-subtitle|has-subtitle/);
    }
  });

  it("styles it as the media-page header does: divider, page ink, small uppercase", () => {
    const span = rule(layout, ".tv-library-heading > .page-header-title-block > span");
    expect(span).toContain("border-left: 1px solid var(--line-strong)");
    expect(span).toContain("padding-left: var(--page-header-gap)");
    expect(span).toContain("color: var(--ink)");
    expect(span).not.toContain("brand");
    expect(span).toContain("text-transform: uppercase");
    expect(span).toContain("font-weight: 680");
  });

  it("keeps the header subtitle out of the shared kicker rule", () => {
    const shared = /(?:^|\n)\.tv-provider,\s*\.tv-detail-kicker\s*\{([^}]*)\}/.exec(global)?.[1] ?? "";
    expect(shared).toContain("color: var(--brand-ink)");
    expect(global).not.toContain(".page-subtitle");
  });

  it("wraps under the title with a rule only when it does not fit", () => {
    const wrapped = rule(layout, ".tv-library-heading.is-detail-wrapped > .page-header-title-block > .page-header-detail");
    expect(wrapped).toContain("border-top: 1px solid var(--line-strong)");
    expect(wrapped).toContain("border-left: 0");
    expect(layout).not.toContain("has-subtitle");
  });

  it("never lets a page build its own header subtitle", () => {
    const pages = new URL("../../pages/", import.meta.url);
    const walk = (dir: URL): URL[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? walk(new URL(`${e.name}/`, dir)) : /\.tsx$/.test(e.name) && !/\.test\./.test(e.name) ? [new URL(e.name, dir)] : [],
      );
    for (const file of walk(pages)) {
      const source = readFileSync(file, "utf8");
      expect(source, `${file.pathname} must not render .page-header-detail itself`).not.toMatch(/page-header-detail|tv-detail-heading-item/);
      expect(source, `${file.pathname} passes a section object as the subtitle`).not.toMatch(/detail:\s*\{\s*title:/);
    }
  });
});
