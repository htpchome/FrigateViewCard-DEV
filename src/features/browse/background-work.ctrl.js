const PHONE_STARTUP_BACKGROUND_DELAY_MS = 2500;
const PHONE_STARTUP_IDLE_TIMEOUT_MS = 5000;

const resolveBoundFunction = (value, owner) =>
  typeof value === "function" ? value.bind(owner) : null;

export class BrowseBackgroundWorkController {
  constructor(host, deps = {}) {
    this._host = host;
    this._setTimer =
      deps.setTimer ?? resolveBoundFunction(globalThis.setTimeout, globalThis);
    this._clearTimer =
      deps.clearTimer ?? resolveBoundFunction(globalThis.clearTimeout, globalThis);
    this._requestIdle =
      deps.requestIdle ??
      resolveBoundFunction(
        Reflect.get(globalThis, "requestIdleCallback"),
        globalThis,
      );
    this._cancelIdle =
      deps.cancelIdle ??
      resolveBoundFunction(
        Reflect.get(globalThis, "cancelIdleCallback"),
        globalThis,
      );
    this._phoneDelayMs =
      deps.phoneDelayMs ?? PHONE_STARTUP_BACKGROUND_DELAY_MS;
    this._idleTimeoutMs =
      deps.idleTimeoutMs ?? PHONE_STARTUP_IDLE_TIMEOUT_MS;
    this._timer = null;
    this._idleHandle = null;
    this._generation = 0;
  }

  scheduleStartup({ phone = false, initialLoad = Promise.resolve() } = {}) {
    this.cancel();
    const generation = this._generation;

    if (!phone) {
      this._warmOtherCameras();
      void Promise.resolve(initialLoad)
        .then(() => this._prefetchCalendar(generation))
        .catch(() => {});
      return;
    }

    void Promise.resolve(initialLoad)
      .then(() => this._schedulePhoneWork(generation))
      .catch(() => {});
  }

  cancel() {
    this._generation += 1;
    if (this._timer !== null) {
      this._clearTimer?.(this._timer);
      this._timer = null;
    }
    if (this._idleHandle !== null) {
      this._cancelIdle?.(this._idleHandle);
      this._idleHandle = null;
    }
  }

  dispose() {
    this.cancel();
  }

  _isCurrent(generation) {
    return generation === this._generation && this._host?.isConnected !== false;
  }

  _schedulePhoneWork(generation) {
    if (!this._isCurrent(generation) || !this._setTimer) return;
    this._timer = this._setTimer(() => {
      this._timer = null;
      if (!this._isCurrent(generation)) return;
      if (!this._requestIdle) {
        this._runPhoneWork(generation);
        return;
      }
      this._idleHandle = this._requestIdle(
        () => {
          this._idleHandle = null;
          this._runPhoneWork(generation);
        },
        { timeout: this._idleTimeoutMs },
      );
    }, Math.max(0, Number(this._phoneDelayMs) || 0));
  }

  _runPhoneWork(generation) {
    if (!this._isCurrent(generation)) return;
    this._warmOtherCameras(0);
    this._prefetchCalendar(generation);
  }

  _warmOtherCameras(delayMs) {
    this._host?._browseWindowLoaderController?.scheduleWarmOtherCamerasEvents?.(
      delayMs,
    );
  }

  _prefetchCalendar(generation) {
    if (!this._isCurrent(generation)) return;
    void this._host?._prefetchCalendarActivityForActiveCamera?.();
  }
}
