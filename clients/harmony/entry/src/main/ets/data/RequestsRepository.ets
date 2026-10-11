/** `GET /api/v1/requests`: the viewer's title requests with their status (web `listRequests`). */

import { getPlayarrClient } from '../AppContainer';
import { ApiResult } from '../net/ApiResult';
import { requestsUrl } from '../core/Endpoints.ts';
import { RequestView } from '../core/Types/Requests.ts';

export function listRequests(): Promise<ApiResult<RequestView[]>> {
  return getPlayarrClient().getJson<RequestView[]>(requestsUrl());
}
