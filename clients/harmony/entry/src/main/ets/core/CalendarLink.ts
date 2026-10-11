// core/CalendarLink.ts: opening the viewer's calendar (iCal) link, as web lib/calendarLink.ts.
// The server returns a link's secret URL only when it is created (it stores a hash), so the device remembers the URL.

export type CalendarLinkOpenPlan = "fetch" | "stored" | "needsReset";

/**
 * What opening the link panel does, given the server's status: `POST` returns the existing link unchanged only when
 * the server says `link_available` (or when no link exists yet, so it simply creates one). A server that predates
 * re-showable links reports no such field and a POST would replace the link, so the stored copy is shown, and when
 * there is none the viewer must press Reset on purpose.
 */
export function planCalendarLinkOpen(active: boolean, linkAvailable: boolean | undefined, storedUrl: string | null): CalendarLinkOpenPlan {
  if (!active || linkAvailable === true) {
    return "fetch";
  }
  return storedUrl !== null && storedUrl.length > 0 ? "stored" : "needsReset";
}

export type CalendarLinkFailure = "unreachable" | "unsupported" | "signin" | "other";

/** Why the link could not be loaded, in terms a viewer can act on (`status` 0 means no HTTP response). */
export function classifyCalendarLinkFailure(status: number): CalendarLinkFailure {
  if (status === 0) {
    return "unreachable";
  }
  if (status === 404 || status === 405 || status === 501) {
    return "unsupported";
  }
  if (status === 401 || status === 403) {
    return "signin";
  }
  return "other";
}

const FAILURE_TEXT: Record<string, string> = {
  unreachable: "Could not reach your Playarr server. Check your connection and that the server is online, then try again.",
  unsupported: "This server version does not support calendar links yet. Ask your server admin to update Playarr Server.",
  signin: "Your sign-in has expired. Sign in again to get your calendar link.",
  other: "Something went wrong getting your calendar link. Try again.",
};

export function calendarLinkFailureText(failure: CalendarLinkFailure): string {
  return FAILURE_TEXT[failure];
}

/** The device-local storage scope for the remembered URL: per server and profile. */
export function calendarLinkScope(serverUrl: string, profileId: string): string {
  return serverUrl + "|" + profileId;
}
