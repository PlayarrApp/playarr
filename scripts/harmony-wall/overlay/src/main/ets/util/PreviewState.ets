// Preview-only (never committed): reports the parity state (current route, focused item) to the bridge, so the suite driver can read it.
import { http } from '@kit.NetworkKit';
import type { UIContext } from '@kit.ArkUI';
import { episodeFocusRectForComponent } from '../design/ComponentMeasurement';
import { seriesDetailMeasurementId } from '../core/SeriesEpisodePresentation';
import { PreviewTelemetryQueue } from './PreviewTelemetryQueue';
import type { PreviewTelemetryEvent } from './PreviewTelemetryQueue';
import { selectPreviewCard } from './PreviewCardSelector';
import type { PreviewCardGeometry } from './PreviewCardSelector';

const PREVIEW_PORT: number = 40017;
const PREVIEW_TELEMETRY_BATCH_SIZE: number = 64;
const PREVIEW_TELEMETRY_QUEUE_LIMIT: number = 65536;
const PREVIEW_TELEMETRY_FLUSH_MS: number = 250;
const PREVIEW_BASE_URL: string = 'http://localhost:' + PREVIEW_PORT.toString();
let PREVIEW_ROUTE: string = '';
let PREVIEW_WORK_ID: string = '';
let PREVIEW_ROUTE_GENERATION: number = 0;
let PREVIEW_DETAIL_LOAD_SEQUENCE: number = 0;
let PREVIEW_HTTP_REQUEST_SEQUENCE: number = 0;
const PREVIEW_HTTP_REQUESTS: Map<number, http.HttpRequest> = new Map();
const PREVIEW_TELEMETRY_QUEUE: PreviewTelemetryQueue = new PreviewTelemetryQueue(
  (batch: Array<PreviewTelemetryEvent>, batchId: number): Promise<number> => {
    const req = http.createHttp();
    retainPreviewHttpRequest(req);
    return req.request(PREVIEW_BASE_URL + '/preview-batch',
      { method: http.RequestMethod.POST, extraData: JSON.stringify({ batch_id: batchId, events: batch }), connectTimeout: 800, readTimeout: 800 })
      .then((response): number => response.responseCode);
  },
  (reason: string, pending: number): void => {
    console.error('PLAYARR_PREVIEW_TELEMETRY_FAILED: ' + reason + '; pending=' + pending.toString());
  },
  (callback: () => void, delayMs: number): number => setTimeout(callback, delayMs),
  (timer: number): void => clearTimeout(timer),
  PREVIEW_TELEMETRY_BATCH_SIZE,
  PREVIEW_TELEMETRY_QUEUE_LIMIT,
  PREVIEW_TELEMETRY_FLUSH_MS,
);

// The Previewer's native read thread can still be unwinding after its JS promise settles. Keep the handle strongly reachable until the
// preview process exits instead of relying on an omitted destroy() call to prevent premature finalisation.
export function retainPreviewHttpRequest(request: http.HttpRequest): void {
  if (PREVIEW_HTTP_REQUESTS.size >= 8192) {
    throw new Error('preview HTTP request lifetime limit exceeded');
  }
  PREVIEW_HTTP_REQUEST_SEQUENCE += 1;
  PREVIEW_HTTP_REQUESTS.set(PREVIEW_HTTP_REQUEST_SEQUENCE, request);
}

enum PreviewAreaLengthTypeCode {
  Missing = 0,
  Number = 1,
  String = 2,
  Resource = 3,
  Boolean = 4,
  Other = 5,
}

enum PreviewAreaUnitCode {
  Unknown = 0,
  NumberVp = 1,
  Px = 2,
  Fp = 3,
  Percent = 4,
  UnrecognisedString = 5,
  Resource = 6,
}

interface PreviewSeriesTargetAreaSampleBody {
  route: string;
  work_id: string;
  generation: number;
  stage: string;
  present: number;
  width_vp: number;
  height_vp: number;
  page_offset_vp: number;
  rail_offset_vp: number;
  sampled_at_ms: number;
}

interface PreviewEpisodeCardContainerReportBody {
  route: string;
  work_id: string;
  generation: number;
  stage: string;
  report_invoked: number;
  sender_route_ok: number;
  sender_work_present: number;
  sender_work_matches: number;
  sender_generation_matches: number;
  sender_rect_finite: number;
  sender_rect_positive: number;
  sender_density_valid: number;
  x_vp?: number;
  y_vp?: number;
  width_vp?: number;
  height_vp?: number;
  density?: number;
}

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
  PREVIEW_TELEMETRY_QUEUE.enqueue({ method: 'GET', path: '/state?' + query, body: '' });
}

function previewPost(path: string, body: string): void {
  PREVIEW_TELEMETRY_QUEUE.enqueue({ method: 'POST', path: path, body: body });
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

export function beginPreviewDetailLoad(workId: string): number {
  PREVIEW_DETAIL_LOAD_SEQUENCE += 1;
  const loadSequence: number = PREVIEW_DETAIL_LOAD_SEQUENCE;
  reportPreviewDetailLoad(workId, PREVIEW_ROUTE_GENERATION, loadSequence, 'load-start', 'loading');
  return loadSequence;
}

export function reportPreviewDetailLoad(workId: string, generation: number, loadSequence: number, stage: string,
  renderState: string, resultCategory: string = '', status: number = -1,
  errorCategory: string = ''): void {
  if (PREVIEW_ROUTE !== 'Detail' || workId.length === 0 || workId !== PREVIEW_WORK_ID ||
      generation !== PREVIEW_ROUTE_GENERATION || generation <= 0 || !Number.isInteger(loadSequence) || loadSequence <= 0 ||
      (stage !== 'load-start' && stage !== 'api-result' && stage !== 'render-state') ||
      (renderState !== 'loading' && renderState !== 'error' && renderState !== 'detail-ready')) {
    return;
  }
  previewPost('/detail-load', JSON.stringify({
    route: 'Detail', work_id: workId, generation: generation,
    load_sequence: loadSequence, stage: stage, render_state: renderState,
    result_category: resultCategory, status: status, error_category: errorCategory,
  }));
}

function areaLengthTypeCode(value: Length | undefined): number {
  if (value === undefined || value === null) {
    return PreviewAreaLengthTypeCode.Missing;
  }
  if (typeof value === 'number') {
    return PreviewAreaLengthTypeCode.Number;
  }
  if (typeof value === 'string') {
    return PreviewAreaLengthTypeCode.String;
  }
  if (typeof value === 'boolean') {
    return PreviewAreaLengthTypeCode.Boolean;
  }
  if (typeof value === 'object') {
    return PreviewAreaLengthTypeCode.Resource;
  }
  return PreviewAreaLengthTypeCode.Other;
}

function areaLengthUnitCode(value: Length | undefined): number {
  if (value === undefined || value === null) {
    return PreviewAreaUnitCode.Unknown;
  }
  if (typeof value === 'number') {
    return PreviewAreaUnitCode.NumberVp;
  }
  if (typeof value !== 'string') {
    return typeof value === 'object' ? PreviewAreaUnitCode.Resource : PreviewAreaUnitCode.Unknown;
  }
  if (value.endsWith('vp')) {
    return PreviewAreaUnitCode.NumberVp;
  }
  if (value.endsWith('px')) {
    return PreviewAreaUnitCode.Px;
  }
  if (value.endsWith('fp')) {
    return PreviewAreaUnitCode.Fp;
  }
  if (value.endsWith('%')) {
    return PreviewAreaUnitCode.Percent;
  }
  return PreviewAreaUnitCode.UnrecognisedString;
}

function areaLengthNumber(value: Length | undefined): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value !== 'string') {
    return null;
  }
  let numericText = value;
  if (value.endsWith('vp') || value.endsWith('px') || value.endsWith('fp')) {
    numericText = value.slice(0, value.length - 2);
  } else if (value.endsWith('%')) {
    numericText = value.slice(0, value.length - 1);
  }
  if (numericText.length === 0) {
    return null;
  }
  const numericValue = Number(numericText);
  return Number.isFinite(numericValue) ? numericValue : null;
}

export function reportDetailAreaGeometryForScope(route: string, workId: string, generation: number,
                                                 area: Area): void {
  if (route !== 'Detail' || workId.length === 0 || workId !== PREVIEW_WORK_ID ||
      generation !== PREVIEW_ROUTE_GENERATION) {
    return;
  }
  const positionX = area.position.x;
  const positionY = area.position.y;
  const globalX = area.globalPosition.x;
  const globalY = area.globalPosition.y;
  const width = area.width;
  const height = area.height;
  previewPost('/layout-stage', JSON.stringify({
    route: route,
    work_id: workId,
    generation: generation,
    stage: 'detail-row-area-geometry',
    x: areaLengthNumber(positionX),
    y: areaLengthNumber(positionY),
    global_x: areaLengthNumber(globalX),
    global_y: areaLengthNumber(globalY),
    width: areaLengthNumber(width),
    height: areaLengthNumber(height),
    x_type_code: areaLengthTypeCode(positionX),
    y_type_code: areaLengthTypeCode(positionY),
    global_x_type_code: areaLengthTypeCode(globalX),
    global_y_type_code: areaLengthTypeCode(globalY),
    width_type_code: areaLengthTypeCode(width),
    height_type_code: areaLengthTypeCode(height),
    x_unit_code: areaLengthUnitCode(positionX),
    y_unit_code: areaLengthUnitCode(positionY),
    global_x_unit_code: areaLengthUnitCode(globalX),
    global_y_unit_code: areaLengthUnitCode(globalY),
    width_unit_code: areaLengthUnitCode(width),
    height_unit_code: areaLengthUnitCode(height),
  }));
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

export function reportDetailEpisodeTargetForScope(route: string, workId: string, rowId: string,
                                                    generation: number): void {
  if (route !== 'Detail' || workId.length === 0 || rowId.length === 0 || workId !== PREVIEW_WORK_ID ||
      generation !== PREVIEW_ROUTE_GENERATION) {
    return;
  }
  previewPost('/episode-target', JSON.stringify({
    route: route, work_id: workId, parent_work_id: workId, row_id: rowId, generation: generation,
  }));
}

export function reportDetailSeriesTargetCardVisibilityForScope(route: string, workId: string,
  generation: number, visible: number, intersectionWidthVp: number, intersectionHeightVp: number,
  pageOffsetVp: number, railOffsetVp: number, offsetsFresh: number): void {
  if (route !== 'Detail' || workId.length === 0 || workId !== PREVIEW_WORK_ID ||
      generation !== PREVIEW_ROUTE_GENERATION || (visible !== 0 && visible !== 1) ||
      (offsetsFresh !== 0 && offsetsFresh !== 1) || !Number.isFinite(intersectionWidthVp) ||
      !Number.isFinite(intersectionHeightVp) || !Number.isFinite(pageOffsetVp) ||
      !Number.isFinite(railOffsetVp) || intersectionWidthVp < 0 || intersectionHeightVp < 0) {
    return;
  }
  previewPost('/layout-stage', JSON.stringify({
    route: route, work_id: workId, generation: generation, stage: 'series-target-card-visibility',
    visible: visible, intersection_width_vp: intersectionWidthVp, intersection_height_vp: intersectionHeightVp,
    page_offset_vp: pageOffsetVp, rail_offset_vp: railOffsetVp, offsets_fresh: offsetsFresh,
  }));
}

export function reportDetailSeriesTargetAreaSampleForScope(route: string, workId: string,
  generation: number, present: number, widthVp: number, heightVp: number,
  pageOffsetVp: number, railOffsetVp: number, sampledAtMs: number): void {
  if (route !== 'Detail' || workId.length === 0 || workId !== PREVIEW_WORK_ID ||
      generation !== PREVIEW_ROUTE_GENERATION || (present !== 0 && present !== 1) ||
      !Number.isFinite(widthVp) || !Number.isFinite(heightVp) || widthVp <= 0 || heightVp <= 0 ||
      !Number.isFinite(pageOffsetVp) || !Number.isFinite(railOffsetVp) ||
      !Number.isInteger(sampledAtMs) || sampledAtMs < 1000000000000 || sampledAtMs > 10000000000000) {
    return;
  }
  const body: PreviewSeriesTargetAreaSampleBody = {
    route: route, work_id: workId, generation: generation, stage: 'series-target-area-sample', present: present,
    width_vp: widthVp, height_vp: heightVp, page_offset_vp: pageOffsetVp, rail_offset_vp: railOffsetVp,
    sampled_at_ms: sampledAtMs,
  };
  previewPost('/layout-stage', JSON.stringify(body));
}

export function reportDetailPreviewGenerationScope(workId: string, capturedGeneration: number,
                                                   liveGeneration: number): boolean {
  if (PREVIEW_ROUTE !== 'Detail' || workId.length === 0 || workId !== PREVIEW_WORK_ID ||
      liveGeneration !== PREVIEW_ROUTE_GENERATION || !Number.isInteger(capturedGeneration) ||
      !Number.isInteger(liveGeneration) || capturedGeneration <= 0 || liveGeneration <= 0) {
    return false;
  }
  const matches = capturedGeneration === liveGeneration ? 1 : 0;
  previewPost('/layout-stage', JSON.stringify({
    route: 'Detail', work_id: PREVIEW_WORK_ID, generation: liveGeneration,
    stage: 'detail-preview-generation-scope', captured_generation: capturedGeneration,
    live_generation: liveGeneration, scope_matches: matches,
  }));
  return matches === 1;
}

export function reportDetailEpisodeCardContainerAreaForScope(route: string, workId: string, rowId: string,
  generation: number, xVp: number, yVp: number, widthVp: number, heightVp: number, densityPixels: number): void {
  const routeOk = route === 'Detail';
  const workPresent = workId.length > 0;
  const workMatches = workId === PREVIEW_WORK_ID;
  const generationMatches = generation === PREVIEW_ROUTE_GENERATION;
  const rectangleFinite = Number.isFinite(xVp) && Number.isFinite(yVp) &&
    Number.isFinite(widthVp) && Number.isFinite(heightVp);
  const rectanglePositive = widthVp > 0 && heightVp > 0;
  const densityValid = Number.isFinite(densityPixels) && densityPixels > 0;
  if (PREVIEW_ROUTE === 'Detail' && PREVIEW_WORK_ID.length > 0 && PREVIEW_ROUTE_GENERATION > 0) {
    const diagnostic: PreviewEpisodeCardContainerReportBody = {
      route: PREVIEW_ROUTE,
      work_id: PREVIEW_WORK_ID,
      generation: PREVIEW_ROUTE_GENERATION,
      stage: 'episode-card-container-report',
      report_invoked: 1,
      sender_route_ok: routeOk ? 1 : 0,
      sender_work_present: workPresent ? 1 : 0,
      sender_work_matches: workMatches ? 1 : 0,
      sender_generation_matches: generationMatches ? 1 : 0,
      sender_rect_finite: rectangleFinite ? 1 : 0,
      sender_rect_positive: rectanglePositive ? 1 : 0,
      sender_density_valid: densityValid ? 1 : 0,
    };
    if (rectangleFinite) {
      diagnostic.x_vp = xVp;
      diagnostic.y_vp = yVp;
      diagnostic.width_vp = widthVp;
      diagnostic.height_vp = heightVp;
    }
    if (Number.isFinite(densityPixels)) {
      diagnostic.density = densityPixels;
    }
    previewPost('/layout-stage', JSON.stringify(diagnostic));
  }
  if (!routeOk || !workPresent || !rowId.length || !workMatches || !generationMatches ||
      !rectangleFinite || !rectanglePositive || !densityValid) {
    return;
  }
  previewPost('/episode-card-container-area', JSON.stringify({
    route: route, work_id: workId, parent_work_id: workId, row_id: rowId, generation: generation,
    x_vp: xVp, y_vp: yVp, width_vp: widthVp, height_vp: heightVp, density: densityPixels,
  }));
}

export function reportDetailEpisodeCardAreaForScope(route: string, workId: string, rowId: string,
                                                     generation: number, xVp: number, yVp: number,
                                                     widthVp: number, heightVp: number,
                                                     densityPixels: number): void {
  if (route !== 'Detail' || workId.length === 0 || rowId.length === 0 || workId !== PREVIEW_WORK_ID ||
      generation !== PREVIEW_ROUTE_GENERATION) {
    return;
  }
  if (!Number.isFinite(densityPixels) || densityPixels <= 0) {
    return;
  }
  previewPost('/episode-card-area', JSON.stringify({
    route: route, work_id: workId, parent_work_id: workId, row_id: rowId, generation: generation,
    x_vp: xVp, y_vp: yVp, width_vp: widthVp, height_vp: heightVp, density: densityPixels,
  }));
}

export function reportDetailEpisodeCardAreaForMeasurement(uiContext: UIContext, route: string, workId: string,
  rowId: string, generation: number, railId: string, occurrence: number, componentId: string, area: Area): void {
  if (route !== 'Detail' || workId.length === 0 || rowId.length === 0) {
    return;
  }
  // The Image's component ID carries Detail's focus generation, which is not the preview route generation: read it from the ID, then
  // require the whole ID to be exactly this card's.
  const prefix: string = 'detail-measure-Detail-' + encodeURIComponent(workId) + '-';
  const measuredGeneration: number = componentId.startsWith(prefix) ?
    Number(componentId.substring(prefix.length).split('-')[0]) : NaN;
  if (!Number.isInteger(measuredGeneration) || componentId !== seriesDetailMeasurementId('image', workId,
      measuredGeneration, railId, rowId, occurrence)) {
    return;
  }
  const rect = episodeFocusRectForComponent(uiContext, componentId);
  if (rect !== null) {
    reportDetailEpisodeCardAreaForScope(route, workId, rowId, generation,
      rect.left, rect.top, rect.width, rect.height, uiContext.vp2px(1));
    return;
  }
  // The Previewer has no component lookup by ID: the Image's own Area is already in vp and relative to the window.
  const x = areaLengthNumber(area.globalPosition.x);
  const y = areaLengthNumber(area.globalPosition.y);
  const width = areaLengthNumber(area.width);
  const height = areaLengthNumber(area.height);
  if (x === null || y === null || width === null || height === null) {
    return;
  }
  reportDetailEpisodeCardAreaForScope(route, workId, rowId, generation, x, y, width, height, uiContext.vp2px(1));
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

// Capture-only focused appearance: the Previewer never delivers a focus event, so the parity route `focus:<id>` supplies the selected look.
// Touch captures add shadow and outer ring without lift or scale; TV captures retain the remote lift. Production focus is untouched.
class PreviewCardEntry implements PreviewCardGeometry {
  setOn: (on: boolean) => void;
  x: number = 0;
  y: number = 0;
  width: number = 0;
  height: number = 0;
  measured: boolean = false;
  alive: boolean = true;
  visible: boolean = true;
  constructor(setOn: (on: boolean) => void) {
    this.setOn = setOn;
  }
}

const PREVIEW_CARDS: PreviewCardEntry[] = [];

export function previewRegisterCard(setOn: (on: boolean) => void): number {
  PREVIEW_CARDS.push(new PreviewCardEntry(setOn));
  return PREVIEW_CARDS.length - 1;
}

export function previewUnregisterCard(index: number): void {
  if (index >= 0 && index < PREVIEW_CARDS.length) {
    PREVIEW_CARDS[index].alive = false;
  }
}

export function previewCardMoved(index: number, area: Area): void {
  if (index >= 0 && index < PREVIEW_CARDS.length) {
    PREVIEW_CARDS[index].x = Number(area.globalPosition.x);
    PREVIEW_CARDS[index].y = Number(area.globalPosition.y);
    PREVIEW_CARDS[index].width = Number(area.width);
    PREVIEW_CARDS[index].height = Number(area.height);
    PREVIEW_CARDS[index].measured = Number.isFinite(PREVIEW_CARDS[index].x) &&
      Number.isFinite(PREVIEW_CARDS[index].y) && Number.isFinite(PREVIEW_CARDS[index].width) &&
      Number.isFinite(PREVIEW_CARDS[index].height) && PREVIEW_CARDS[index].width > 0 &&
      PREVIEW_CARDS[index].height > 0;
  }
}

export function previewCardVisible(index: number, visible: boolean): void {
  if (index >= 0 && index < PREVIEW_CARDS.length) {
    PREVIEW_CARDS[index].visible = visible;
  }
}

/** Focused look on the live card intersecting the viewport nearest the top-left of content, off on every other. */
export function previewFocusFirstCard(tvMode: boolean): string {
  // Use the resolved device profile, never child positions: offscreen descendants in a phone rail can extend past x=500.
  const best: number = selectPreviewCard(PREVIEW_CARDS, tvMode);
  for (let i = 0; i < PREVIEW_CARDS.length; i++) {
    if (PREVIEW_CARDS[i].alive) {
      PREVIEW_CARDS[i].setOn(i === best);
    }
  }
  return best >= 0 ? 'ok:' + PREVIEW_CARDS[best].x.toString() + ',' + PREVIEW_CARDS[best].y.toString() : 'none';
}
