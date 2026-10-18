export interface PreviewTelemetryEvent {
  method: string;
  path: string;
  body: string;
}

export type PreviewTelemetrySender = (batch: Array<PreviewTelemetryEvent>, batchId: number) => Promise<number>;
export type PreviewTelemetryFailure = (reason: string, pending: number) => void;
export type PreviewTelemetryTimer = (callback: () => void, delayMs: number) => number;
export type PreviewTelemetryTimerClear = (timer: number) => void;

const MAX_DELIVERY_ATTEMPTS: number = 3;
const RETRY_DELAY_MS: number = 100;

export class PreviewTelemetryQueue {
  private readonly events: Array<PreviewTelemetryEvent> = [];
  private readonly send: PreviewTelemetrySender;
  private readonly onFailure: PreviewTelemetryFailure;
  private readonly setTimer: PreviewTelemetryTimer;
  private readonly clearTimer: PreviewTelemetryTimerClear;
  private readonly batchSize: number;
  private readonly queueLimit: number;
  private readonly flushMs: number;
  private draining: boolean = false;
  private timer: number = -1;
  private failed: boolean = false;
  private flushDue: boolean = false;
  private nextBatchId: number = 1;
  private inFlightCount: number = 0;

  constructor(
    send: PreviewTelemetrySender,
    onFailure: PreviewTelemetryFailure,
    setTimer: PreviewTelemetryTimer,
    clearTimer: PreviewTelemetryTimerClear,
    batchSize: number,
    queueLimit: number,
    flushMs: number,
  ) {
    this.send = send;
    this.onFailure = onFailure;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
    this.batchSize = batchSize;
    this.queueLimit = queueLimit;
    this.flushMs = flushMs;
  }

  enqueue(event: PreviewTelemetryEvent): void {
    if (this.failed) {
      return;
    }
    if (this.events.length + this.inFlightCount >= this.queueLimit) {
      this.fail('telemetry queue limit exceeded', this.events.length + this.inFlightCount + 1);
      return;
    }
    this.events.push(event);
    if (this.events.length >= this.batchSize) {
      if (this.timer >= 0) {
        this.clearTimer(this.timer);
        this.timer = -1;
      }
      this.flushDue = true;
      void this.drain();
    } else if (this.timer < 0) {
      this.timer = this.setTimer((): void => {
        this.timer = -1;
        this.flushDue = true;
        void this.drain();
      }, this.flushMs);
    }
  }

  private fail(reason: string, pending: number): void {
    if (this.failed) {
      return;
    }
    this.failed = true;
    this.flushDue = false;
    if (this.timer >= 0) {
      this.clearTimer(this.timer);
      this.timer = -1;
    }
    this.onFailure(reason, pending);
  }

  private async drain(): Promise<void> {
    if (this.draining || this.failed) {
      return;
    }
    this.draining = true;
    try {
      while (this.events.length > 0 && !this.failed) {
        if (this.events.length < this.batchSize && !this.flushDue) {
          if (this.timer < 0) {
            this.timer = this.setTimer((): void => {
              this.timer = -1;
              this.flushDue = true;
              void this.drain();
            }, this.flushMs);
          }
          break;
        }
        this.flushDue = false;
        const batch: Array<PreviewTelemetryEvent> = this.events.splice(0, this.batchSize);
        this.inFlightCount = batch.length;
        let delivered: boolean = false;
        let failureReason: string = 'batch delivery failed';
        for (let attempt = 1; attempt <= MAX_DELIVERY_ATTEMPTS && !delivered && !this.failed; attempt += 1) {
          try {
            const status = await this.send(batch, this.nextBatchId);
            if (status >= 200 && status < 300) {
              delivered = true;
            } else {
              failureReason = 'batch delivery rejected with status ' + status.toString();
              if (status < 500 && status !== 429) {
                break;
              }
            }
          } catch (_error) {
            failureReason = 'batch delivery failed';
          }
          if (!delivered && attempt < MAX_DELIVERY_ATTEMPTS) {
            await new Promise<void>((resolve): void => {
              this.setTimer(resolve, RETRY_DELAY_MS);
            });
          }
        }
        if (!delivered) {
          this.events.unshift(...batch);
          this.inFlightCount = 0;
          this.fail(failureReason, this.events.length);
          break;
        }
        this.inFlightCount = 0;
        this.nextBatchId += 1;
      }
    } finally {
      this.draining = false;
    }
  }
}
