export const SINGLE_VIEW_PAGE_STYLES = `
  .card .single-view-frame {
    container-type: inline-size;
    container-name: single-view;
  }

  .card .layout--single-view .single-view-live-badge {
    position: absolute;
    z-index: 7;
    top: 8px;
    right: 8px;
    display: none;
    align-items: center;
    justify-content: center;
    gap: 5px;
    min-height: 24px;
    box-sizing: border-box;
    padding: 3px 7px;
    border: 1px solid var(--fvc-media-overlay-border);
    border-radius: 999px;
    color: var(--fvc-media-overlay-text);
    background: var(--fvc-media-overlay-bg-soft);
    box-shadow: var(--fvc-media-overlay-shadow);
    font-size: .64rem;
    font-weight: 750;
    line-height: 1;
    text-transform: uppercase;
    pointer-events: none;
    backdrop-filter: blur(4px);
    -webkit-backdrop-filter: blur(4px);
  }

  .card .layout--single-view .single-view-live-badge[hidden] {
    display: none !important;
  }

  .card .layout--single-view .single-view-live-badge-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--c-on);
    box-shadow: 0 0 0 2px var(--fvc-media-overlay-live-halo);
  }

  .card .layout--single-view .single-view-live-badge.is-offline .single-view-live-badge-dot {
    background: var(--c-off);
    box-shadow: 0 0 0 2px var(--fvc-media-overlay-offline-halo);
  }

  .card .layout--single-view #live-stage:has(#stream-loading:not([hidden])) .single-view-live-badge {
    display: none;
  }

  @container single-view (max-width: 420px) {
    .card .layout--single-view .single-view-live-badge {
      display: inline-flex;
    }

    .card .layout--single-view .info-online-stat {
      display: none;
    }

    .card .layout--single-view .live-playback-controls {
      gap: 6px;
    }

    .card .layout--single-view .live-playback-controls > button {
      width: 29px;
      height: 29px;
      flex-basis: 29px;
    }

    .card .layout--single-view .live-playback-controls.overlay-controls svg,
    .card .layout--single-view .live-playback-controls.overlay-controls:hover svg {
      width: 24px;
      height: 24px;
    }
  }
`;
