import "./tizen.css";
import { loadPackagedConfig } from "./tizen-runtime.mjs";
import { installFullDateComma, installSpacedRanges } from "../../../tooling/spaced-range.mjs";
import { installLegacyHas } from "../../../tooling/legacy-has.mjs";
import { installLegacyAspectRatio } from "../../../tooling/legacy-aspect-ratio.mjs";

// Chromium 85 (Tizen 6.5) has no :has(); the build rewrites those rules for this runtime.
installLegacyHas();
// The TV browser writes "5–11 Oct" for date ranges; the web writes "5 – 11 Oct".
installSpacedRanges(window);
// ... and "Wednesday 7 October 2026" for a full date; the web writes "Wednesday, 7 October 2026".
installFullDateComma(window);
// Chromium 85 (Tizen 6.5) has no aspect-ratio either; the build keeps each ratio as --lc-ar for this runtime.
installLegacyAspectRatio();

// The native wrapper packages the complete routed Playarr application. The
// compile-time platform constant makes the shared web runtime select Tizen
// identity, HashRouter navigation, and the AVPlay engine.
void loadPackagedConfig().finally(() => import("../../../web/src/main"));
