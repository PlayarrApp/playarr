// core/Requests.ts: row text for the requests page, as web pages/Requests.tsx.
import type { RequestView } from "./Types/Requests.ts";

const STATUS_LABELS: Record<string, string> = {
  pending: "Waiting for approval",
  approved: "Approved",
  declined: "Declined",
  available: "Available",
  failed: "Failed",
};

/** The status as a viewer reads it; an unknown status shows as it came. */
export function requestStatusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status;
}

/** The meta line parts: year, status, then who asked (only when the server names them). */
export function requestMetaParts(request: RequestView): string[] {
  const parts: string[] = [];
  if (request.year !== undefined && request.year !== null && request.year > 0) {
    parts.push(String(request.year));
  }
  parts.push(requestStatusLabel(request.status));
  if (request.requested_by !== undefined && request.requested_by !== null && request.requested_by.length > 0) {
    parts.push(request.mine ? "Requested by you" : "Requested by " + request.requested_by);
  }
  return parts;
}
