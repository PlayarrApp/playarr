// Preview-only (never committed): reports the parity state (current route, focused item) to the bridge, so the suite driver can read it.
import { http } from '@kit.NetworkKit';

const PREVIEW_PORT: number = 40017;

export function previewReport(query: string): void {
  const req = http.createHttp();
  req.request('http://127.0.0.1:' + PREVIEW_PORT.toString() + '/state?' + query,
    { method: http.RequestMethod.GET, connectTimeout: 800, readTimeout: 800 })
    .then((): void => { req.destroy(); })
    .catch((): void => { req.destroy(); });
}

export function reportCardFocus(title: string, subtitle: string): void {
  previewReport('title=' + encodeURIComponent(title) + '&sub=' + encodeURIComponent(subtitle));
}

export function reportNavFocus(label: string): void {
  previewReport('nav=' + encodeURIComponent(label));
}
