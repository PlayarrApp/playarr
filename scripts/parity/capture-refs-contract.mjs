export function selectedLiveScreens(requestedScreens, groups, groupDefinitions) {
  return requestedScreens.filter((screen) => groups.some((group) => groupDefinitions[group]?.liveScreens?.includes(screen)));
}

export function shouldStampReferenceBuild({ partial, liveScreens = [] }) {
  return !partial && liveScreens.length === 0;
}

export function assertBuildIdentityStable(expected, actual, source = "capture") {
  if (expected !== actual) throw new Error(`${source} build identity changed during capture (${expected} -> ${actual}); nothing copied`);
}
