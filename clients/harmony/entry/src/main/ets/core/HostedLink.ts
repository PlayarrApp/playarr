// core/HostedLink.ts: wire parsing for the hosted TV link broker, as web's lib/hostedDeviceLink.ts.
// The QR carries only the broker address, so the user never types a server URL.

import type { DeviceCodeResponse } from "./Types/Auth";

export interface HostedLinkClaim {
  serverUrl: string;
  serverDeviceCode: string;
  serverUrls: string[];
}

interface HostedCodeWire {
  device_code?: string;
  user_code?: string;
  verification_uri?: string;
  verification_uri_complete?: string;
  expires_in?: number;
  interval?: number;
}

interface HostedClaimWire {
  server_url?: string;
  server_device_code?: string;
  server_urls?: string[];
}

/** A broker code response body, or null when it is not JSON or any field is missing or mistyped. */
export function parseHostedCode(bodyText: string): DeviceCodeResponse | null {
  let wire: HostedCodeWire;
  try {
    wire = JSON.parse(bodyText) as HostedCodeWire;
  } catch (err) {
    return null;
  }
  if (wire === null || typeof wire.device_code !== "string" || typeof wire.user_code !== "string"
    || typeof wire.verification_uri !== "string" || typeof wire.verification_uri_complete !== "string"
    || typeof wire.expires_in !== "number" || typeof wire.interval !== "number") {
    return null;
  }
  return { device_code: wire.device_code, user_code: wire.user_code, verification_uri: wire.verification_uri,
    verification_uri_complete: wire.verification_uri_complete, expires_in: wire.expires_in, interval: wire.interval };
}

/** The approved claim body: the server to use and its device code. Null when the shape is wrong. */
export function parseHostedClaim(bodyText: string): HostedLinkClaim | null {
  let wire: HostedClaimWire;
  try {
    wire = JSON.parse(bodyText) as HostedClaimWire;
  } catch (err) {
    return null;
  }
  if (wire === null || typeof wire.server_url !== "string" || typeof wire.server_device_code !== "string"
    || !Array.isArray(wire.server_urls)) {
    return null;
  }
  const urls: string[] = [];
  for (const url of wire.server_urls) {
    if (typeof url === "string") urls.push(url);
  }
  return { serverUrl: wire.server_url, serverDeviceCode: wire.server_device_code, serverUrls: urls };
}
