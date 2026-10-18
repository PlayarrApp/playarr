import assert from 'node:assert/strict';
import test from 'node:test';

import {
  findReleaseLifecycle,
  findInReviewVersionCodes,
  formatReleaseLifecycleEvidence,
  isDeclarationBlock,
  isVersionCodeReusable,
  waitForReleaseLifecycle,
} from './release-lifecycle.mjs';

test('finds every version code currently in review', () => {
  assert.deepEqual(
    findInReviewVersionCodes([
      {
        activeArtifacts: [{ versionCode: 2017 }],
        releaseLifecycleState: 'RELEASE_LIFECYCLE_STATE_PUBLISHED',
      },
      {
        activeArtifacts: [{ versionCode: 21800704 }, { versionCode: 21800001 }],
        releaseLifecycleState: 'RELEASE_LIFECYCLE_STATE_IN_REVIEW',
      },
    ]),
    ['21800704', '21800001'],
  );
});

test('finds lifecycle state by active artifact version code', () => {
  const lifecycle = findReleaseLifecycle(
    [
      {
        activeArtifacts: [{ versionCode: 2017 }],
        releaseLifecycleState: 'RELEASE_LIFECYCLE_STATE_PUBLISHED',
      },
      {
        activeArtifacts: [{ versionCode: 21800704 }],
        releaseLifecycleState: 'RELEASE_LIFECYCLE_STATE_IN_REVIEW',
      },
    ],
    '21800704',
  );

  assert.equal(lifecycle, 'RELEASE_LIFECYCLE_STATE_IN_REVIEW');
});

test('claims track availability only for a published release', () => {
  assert.match(
    formatReleaseLifecycleEvidence(
      'alpha',
      '21800704',
      'RELEASE_LIFECYCLE_STATE_PUBLISHED',
    ),
    /available to users on the track/,
  );
  assert.match(
    formatReleaseLifecycleEvidence(
      'alpha',
      '21800704',
      'RELEASE_LIFECYCLE_STATE_IN_REVIEW',
    ),
    /lifecycle=IN_REVIEW; this does not prove tester availability/,
  );
  assert.match(
    formatReleaseLifecycleEvidence(
      'alpha',
      '21800704',
      'RELEASE_LIFECYCLE_STATE_NOT_SENT_FOR_REVIEW',
    ),
    /this does not prove tester availability/,
  );
});

test('waits for the committed version to appear in lifecycle results', async () => {
  const responses = [
    [],
    [
      {
        activeArtifacts: [{ versionCode: 21800704 }],
        releaseLifecycleState: 'RELEASE_LIFECYCLE_STATE_IN_REVIEW',
      },
    ],
  ];
  let sleeps = 0;

  const lifecycle = await waitForReleaseLifecycle(
    async () => responses.shift(),
    '21800704',
    {
      attempts: 2,
      delayMs: 0,
      sleep: async () => {
        sleeps += 1;
      },
    },
  );

  assert.equal(lifecycle, 'RELEASE_LIFECYCLE_STATE_IN_REVIEW');
  assert.equal(sleeps, 1);
});

test('treats a declaration refusal as a draft fallback but not a review or version conflict', () => {
  const foreground = { status: 403, apiMessage: 'You must let us know whether your app uses any Foreground Service permissions.' };
  assert.equal(isDeclarationBlock(foreground), true);
  assert.equal(isDeclarationBlock({ status: 400, apiMessage: 'Complete the data safety form.' }), true);
  assert.equal(isDeclarationBlock({ status: 400, apiMessage: 'Changes cannot be sent: release in review' }), false);
  assert.equal(isDeclarationBlock({ status: 403, apiMessage: 'Version code 12 has already been used.' }), false);
  assert.equal(isDeclarationBlock({ status: 500, apiMessage: 'oops' }), false);
  assert.equal(isDeclarationBlock(new Error('network')), false);
});

test('reuses an already uploaded bundle only for the expected version code', () => {
  const used = { status: 403, apiMessage: 'Version code 30003252 has already been used.' };
  assert.equal(isVersionCodeReusable(used, '30003252'), true);
  assert.equal(isVersionCodeReusable(used, 30003252), true);
  assert.equal(isVersionCodeReusable(used, '30003253'), false);
  assert.equal(isVersionCodeReusable({ ...used, status: 400 }, '30003252'), false);
  assert.equal(isVersionCodeReusable({ status: 403, apiMessage: 'Other' }, '30003252'), false);
  assert.equal(isVersionCodeReusable(new Error('x'), '1'), false);
});
