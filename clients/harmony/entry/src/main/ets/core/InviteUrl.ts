// core/InviteUrl.ts: web `packages/domain/src/inviteUrl.ts` `buildInviteUrl`, for one server address (the fallback
// bundle web uses for non-admins and for nodes without a peer address list).
import { encodeBase64Url } from "./Base64Url";

const SIGNUP_ORIGIN = "https://playarr.app";

/** UTF-8 bytes of a string (the bundle JSON may carry a non-ASCII address). */
function utf8(text: string): Uint8Array {
  const bytes: number[] = [];
  for (const ch of text) {
    const code = ch.codePointAt(0) as number;
    if (code < 0x80) {
      bytes.push(code);
    } else if (code < 0x800) {
      bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    } else if (code < 0x10000) {
      bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    } else {
      bytes.push(0xf0 | (code >> 18), 0x80 | ((code >> 12) & 0x3f), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    }
  }
  return Uint8Array.from(bytes);
}

/** `https://playarr.app/signup?servers=<base64url [{peer_node_id,url}]>&invite=<token>`. */
export function buildInviteUrl(serverUrl: string, inviteToken: string): string {
  const servers = encodeBase64Url(utf8(JSON.stringify([{ peer_node_id: "", url: serverUrl }])));
  return SIGNUP_ORIGIN + "/signup?servers=" + servers + "&invite=" + encodeURIComponent(inviteToken);
}
