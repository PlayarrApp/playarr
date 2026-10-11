// core/Types/Requests.ts: the parts of `GET /api/v1/requests` (RequestView) the requests page reads.

export interface RequestView {
  id: string;
  title: string;
  kind: string;
  status: string;
  mine: boolean;
  year?: number | null;
  requested_by?: string | null;
  status_note?: string | null;
}
