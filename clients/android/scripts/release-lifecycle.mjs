const PUBLISHED = 'RELEASE_LIFECYCLE_STATE_PUBLISHED';
const IN_REVIEW = 'RELEASE_LIFECYCLE_STATE_IN_REVIEW';

export function findReleaseLifecycle(releases = [], versionCode) {
  const release = releases.find((candidate) =>
    (candidate.activeArtifacts ?? []).some(
      (artifact) => String(artifact.versionCode) === String(versionCode),
    ),
  );
  return release?.releaseLifecycleState;
}

export function findInReviewVersionCodes(releases = []) {
  return releases
    .filter((release) => release.releaseLifecycleState === IN_REVIEW)
    .flatMap((release) => release.activeArtifacts ?? [])
    .map((artifact) => String(artifact.versionCode));
}

export async function waitForReleaseLifecycle(
  loadReleases,
  versionCode,
  {
    attempts = 6,
    delayMs = 5000,
    sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  } = {},
) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const lifecycleState = findReleaseLifecycle(await loadReleases(), versionCode);
    if (lifecycleState) {
      return lifecycleState;
    }
    if (attempt < attempts) {
      await sleep(delayMs);
    }
  }
  return undefined;
}

export function formatReleaseLifecycleEvidence(track, versionCode, lifecycleState) {
  const prefix = `Verified Google Play ${track} versionCode=${versionCode}`;
  if (lifecycleState === PUBLISHED) {
    return `${prefix}, lifecycle=PUBLISHED; Google reports this release available to users on the track`;
  }
  if (lifecycleState === IN_REVIEW) {
    return `${prefix}, lifecycle=IN_REVIEW; this does not prove tester availability`;
  }
  return `${prefix}, lifecycle=${lifecycleState}; this does not prove tester availability`;
}

// A commit refused for a missing Console declaration (foreground service, data safety, content rating):
// the upload is fine, only sending it for review is blocked. Not a review conflict or a version clash.
export function isDeclarationBlock(error) {
  const message = String(error?.apiMessage ?? '');
  return (
    (error?.status === 403 || error?.status === 400) &&
    !/in review|already (been )?used|version ?code/i.test(message)
  );
}

// Play's 403 "Version code N has already been used." for the version code this run expects.
export function isVersionCodeReusable(error, expectedVersionCode) {
  const match = /^Version code (\d+) has already been used/i.exec(String(error?.apiMessage ?? ''));
  return error?.status === 403 && match !== null && match[1] === String(expectedVersionCode);
}
