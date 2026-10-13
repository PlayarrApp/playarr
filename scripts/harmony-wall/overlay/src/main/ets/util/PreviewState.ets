// Preview-only (never committed): reports the parity state (current route, focused item) to the bridge, so the suite driver can read it.
import { http } from '@kit.NetworkKit';

const PREVIEW_PORT: number = 40017;
let PREVIEW_ROUTE: string = '';
let PREVIEW_WORK_ID: string = '';
let PREVIEW_ROUTE_GENERATION: number = 0;

export class DetailRowImageContext {
  route: string;
  parentWorkId: string;
  rowId: string;
  generation: number;

  constructor(route: string, parentWorkId: string, rowId: string, generation: number) {
    this.route = route;
    this.parentWorkId = parentWorkId;
    this.rowId = rowId;
    this.generation = generation;
  }
}

export function previewReport(query: string): void {
  const req = http.createHttp();
  req.request('http://127.0.0.1:' + PREVIEW_PORT.toString() + '/state?' + query,
    { method: http.RequestMethod.GET, connectTimeout: 800, readTimeout: 800 })
    .then((): void => { req.destroy(); })
    .catch((): void => { req.destroy(); });
}

function previewPost(path: string, body: string): void {
  const req = http.createHttp();
  req.request('http://127.0.0.1:' + PREVIEW_PORT.toString() + path,
    { method: http.RequestMethod.POST, extraData: body, connectTimeout: 800, readTimeout: 800 })
    .then((): void => { req.destroy(); })
    .catch((): void => { req.destroy(); });
}

export function setPreviewRouteContext(route: string, kind: string, workId: string): void {
  const nextWorkId: string = route === 'Detail' ? workId : '';
  if (PREVIEW_ROUTE !== route || PREVIEW_WORK_ID !== nextWorkId) {
    PREVIEW_ROUTE_GENERATION += 1;
    PREVIEW_ROUTE = route;
    PREVIEW_WORK_ID = nextWorkId;
  }
}

export function reportPreviewRoute(route: string, kind: string, workId: string): void {
  setPreviewRouteContext(route, kind, workId);
  const nextWorkId: string = route === 'Detail' ? workId : '';
  const body: string = JSON.stringify({ route: route, kind: kind, work_id: nextWorkId, generation: PREVIEW_ROUTE_GENERATION });
  previewPost('/preview-state', body);
}

export function currentPreviewRouteGeneration(): number {
  return PREVIEW_ROUTE_GENERATION;
}

export function captureDetailRowImageContext(parentWorkId: string, rowId: string): DetailRowImageContext {
  return new DetailRowImageContext(PREVIEW_ROUTE, parentWorkId, rowId, PREVIEW_ROUTE_GENERATION);
}

export function reportDetailLayoutStageForScope(route: string, workId: string, generation: number,
                                                stage: string, value: number, width: number,
                                                height: number): void {
  if (route !== 'Detail' || workId.length === 0 || workId !== PREVIEW_WORK_ID ||
      generation !== PREVIEW_ROUTE_GENERATION) {
    return;
  }
  const body: string = JSON.stringify({
    route: route,
    work_id: workId,
    generation: generation,
    stage: stage,
    value: value,
    width: width,
    height: height,
  });
  previewPost('/layout-stage', body);
}

export function reportDetailRowImageComplete(context: DetailRowImageContext): void {
  if (context.route !== 'Detail' || context.parentWorkId.length === 0 || context.rowId.length === 0 ||
      context.parentWorkId !== PREVIEW_WORK_ID || context.generation !== PREVIEW_ROUTE_GENERATION) {
    return;
  }
  const body: string = JSON.stringify({
    route: context.route,
    work_id: context.parentWorkId,
    parent_work_id: context.parentWorkId,
    row_id: context.rowId,
    generation: context.generation,
  });
  previewPost('/row-image', body);
}

export function reportDetailRowImageStage(context: DetailRowImageContext, stage: string): void {
  if (context.route !== 'Detail' || context.parentWorkId.length === 0 || context.rowId.length === 0 ||
      context.parentWorkId !== PREVIEW_WORK_ID || context.generation !== PREVIEW_ROUTE_GENERATION) {
    return;
  }
  reportDetailRowImageStageForScope(context.route, context.parentWorkId, context.rowId,
                                    context.generation, stage);
}

export function reportDetailImagePayloadScope(context: DetailRowImageContext, imageUrl: string): void {
  if (context.route !== 'Detail' || context.parentWorkId.length === 0 || context.rowId.length === 0 ||
      context.parentWorkId !== PREVIEW_WORK_ID || context.generation !== PREVIEW_ROUTE_GENERATION) {
    return;
  }
  const match: RegExpMatchArray | null = imageUrl.match(/\/img\/([0-9]+)$/);
  if (match === null || match[1].length === 0) {
    return;
  }
  const body: string = JSON.stringify({
    route: context.route,
    work_id: context.parentWorkId,
    parent_work_id: context.parentWorkId,
    row_id: context.rowId,
    generation: context.generation,
    image_id: match[1],
  });
  previewPost('/image-metrics-scope', body);
}

export function reportDetailRowImageStageForScope(route: string, parentWorkId: string, rowId: string,
                                                  generation: number, stage: string): void {
  if (route !== 'Detail' || parentWorkId.length === 0 || rowId.length === 0 ||
      parentWorkId !== PREVIEW_WORK_ID || generation !== PREVIEW_ROUTE_GENERATION) {
    return;
  }
  const body: string = JSON.stringify({
    route: route,
    work_id: parentWorkId,
    parent_work_id: parentWorkId,
    row_id: rowId,
    generation: generation,
    stage: stage,
  });
  previewPost('/row-image-stage', body);
}

export function reportCardFocus(title: string, subtitle: string): void {
  previewReport('title=' + encodeURIComponent(title) + '&sub=' + encodeURIComponent(subtitle));
}

export function reportNavFocus(label: string): void {
  previewReport('nav=' + encodeURIComponent(label));
}
