import { CameraCellMediaController } from "../live/camera-cell-media.ctrl.js";
import { GridMediaController as GridRuntimeMediaController } from "./runtime-media.ctrl.js";

// Compatibility surface for focused controller tests and downstream imports.
// Production composition loads CameraCellMediaController in the core bundle and
// GridRuntimeMediaController only from the lazy Grid asset.
export class GridMediaController extends GridRuntimeMediaController {
  constructor(host, options = {}) {
    const cameraCellMediaController =
      options.cameraCellMediaController || new CameraCellMediaController(host);
    super(host, { ...options, cameraCellMediaController });
    const mountGridGo2RtcCell =
      cameraCellMediaController._mountGridGo2RtcCell.bind(
        cameraCellMediaController,
      );
    this._mountGridGo2RtcCell = (...args) => mountGridGo2RtcCell(...args);
  }

  _mountGridCameraCellMedia(...args) {
    const controller = this._cameraCellMediaController;
    const originalMount = controller._mountGridGo2RtcCell;
    controller._mountGridGo2RtcCell = (...mountArgs) =>
      this._mountGridGo2RtcCell(...mountArgs);
    try {
      return controller._mountGridCameraCellMedia(...args);
    } finally {
      controller._mountGridGo2RtcCell = originalMount;
    }
  }

  mountCameraCellMedia(...args) {
    return this._mountGridCameraCellMedia(...args);
  }

  refreshSnapshotMedia(...args) {
    return this._cameraCellMediaController.refreshSnapshotMedia(...args);
  }
}
