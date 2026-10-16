export type ParityIdentityFailureCode =
  | 'token_missing'
  | 'token_acquisition_failure'
  | `http_status_${number}`
  | 'json_invalid'
  | 'json_not_array'
  | 'current_profile_missing'
  | 'current_profile_multiple'
  | 'username_missing'
  | 'token_changed'
  | 'timeout'
  | 'network_failure'
  | 'unknown';

export interface ParityIdentity {
  username: string;
  isCurrentCount: number;
  serverUrl: string;
}

/** Error carrying only a fixed diagnostic code; never serialize its message or arbitrary properties. */
export function parityIdentityFailure(code: ParityIdentityFailureCode): Error & {parityCode: ParityIdentityFailureCode} {
  return Object.assign(new Error('device-test identity unavailable'), {parityCode: code});
}

export async function readParityIdentity(options: {
  getAccessToken(): Promise<string | undefined>;
  serverUrl: string;
  profilesUrl: string;
  fetcher?: typeof fetch;
  timeoutMs?: number;
}): Promise<ParityIdentity> {
  let tokenBefore: string | undefined;
  try { tokenBefore = await options.getAccessToken(); }
  catch { throw parityIdentityFailure('token_acquisition_failure'); }
  if (typeof tokenBefore !== 'string' || tokenBefore.length === 0) throw parityIdentityFailure('token_missing');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 8000);
  let profiles: Array<{username?: unknown; is_current?: unknown}>;
  try {
    let response: Response;
    try {
      response = await (options.fetcher ?? fetch)(options.profilesUrl, {
        headers: {Authorization: `Bearer ${tokenBefore}`},
        signal: controller.signal,
      });
    } catch {
      throw parityIdentityFailure(controller.signal.aborted ? 'timeout' : 'network_failure');
    }
    if (!response.ok) throw parityIdentityFailure(`http_status_${response.status}`);
    let body: unknown;
    try { body = await response.json(); }
    catch { throw parityIdentityFailure(controller.signal.aborted ? 'timeout' : 'json_invalid'); }
    if (!Array.isArray(body)) throw parityIdentityFailure('json_not_array');
    profiles = body as Array<{username?: unknown; is_current?: unknown}>;
  } finally {
    clearTimeout(timeout);
  }

  let tokenAfter: string | undefined;
  try { tokenAfter = await options.getAccessToken(); }
  catch { throw parityIdentityFailure('token_acquisition_failure'); }
  if (tokenAfter !== tokenBefore) throw parityIdentityFailure('token_changed');
  const current = profiles.filter((profile) => profile.is_current === true);
  if (current.length === 0) throw parityIdentityFailure('current_profile_missing');
  if (current.length > 1) throw parityIdentityFailure('current_profile_multiple');
  if (typeof current[0]?.username !== 'string' || current[0].username.trim().length === 0) throw parityIdentityFailure('username_missing');
  return {username: current[0].username, isCurrentCount: current.length, serverUrl: options.serverUrl};
}
