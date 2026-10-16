import {readParityIdentity} from './parityIdentity';

function response(status: number, json: () => Promise<unknown>): Response {
  return {ok: status >= 200 && status < 300, status, json} as Response;
}

async function failureCode(options: Parameters<typeof readParityIdentity>[0]): Promise<unknown> {
  try {
    await readParityIdentity(options);
    throw new Error('expected identity lookup to fail');
  } catch (error) {
    return error && typeof error === 'object' ? (error as {parityCode?: unknown}).parityCode : undefined;
  }
}

describe('readParityIdentity', () => {
  const token = 'private-test-token';
  const base = {serverUrl: 'https://example.invalid', profilesUrl: 'https://example.invalid/api/v1/users/profiles', getAccessToken: async () => token};

  it('classifies credential, HTTP, payload and current-profile failures without exposing details', async () => {
    const cases: Array<[string, Parameters<typeof readParityIdentity>[0], string]> = [
      ['token acquisition', {...base, getAccessToken: async () => { throw new Error(token); }}, 'token_acquisition_failure'],
      ['missing token', {...base, getAccessToken: async () => undefined}, 'token_missing'],
      ['HTTP status', {...base, fetcher: async () => response(401, async () => [])}, 'http_status_401'],
      ['invalid JSON', {...base, fetcher: async () => response(200, async () => { throw new Error(token); })}, 'json_invalid'],
      ['non-array JSON', {...base, fetcher: async () => response(200, async () => ({secret: token}))}, 'json_not_array'],
      ['no current profile', {...base, fetcher: async () => response(200, async () => [{is_current: false}])}, 'current_profile_missing'],
      ['multiple current profiles', {...base, fetcher: async () => response(200, async () => [{is_current: true, username: 'user-a'}, {is_current: true, username: 'user-b'}])}, 'current_profile_multiple'],
      ['missing username', {...base, fetcher: async () => response(200, async () => [{is_current: true}])}, 'username_missing'],
    ];

    for (const [label, options, expected] of cases) {
      const failure = await failureCode(options);
      expect(failure).toBe(expected);
      expect(String(failure)).not.toContain(token);
      expect(label).toBeTruthy();
    }
  });

  it('distinguishes a changing token, timeout and network failure', async () => {
    let tokenRead = 0;
    expect(await failureCode({
      ...base,
      getAccessToken: async () => (++tokenRead === 1 ? token : 'rotated-test-token'),
      fetcher: async () => response(200, async () => [{is_current: true, username: 'test-user'}]),
    })).toBe('token_changed');

    expect(await failureCode({
      ...base,
      timeoutMs: 1,
      fetcher: (_input, init) => new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error(token)), {once: true});
      }),
    })).toBe('timeout');

    expect(await failureCode({
      ...base,
      fetcher: async () => { throw new Error(token); },
    })).toBe('network_failure');
  });
});
