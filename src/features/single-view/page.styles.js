export const SINGLE_VIEW_PAGE_STYLES = `
  .card .single-view-frame {
    container-type: inline-size;
    container-name: single-view;
  }

  .card .layout--single-view .single-view-live-status-overlay {
    position: absolute;
    z-index: 7;
    top: 8px;
    right: 8px;
    display: none;
    align-items: center;
    justify-content: center;
    gap: 4px;
    pointer-events: none;
  }

  .card .layout--single-view :is(.single-view-live-badge, .single-view-source-indicator) {
    display: inline-flex;
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
    backdrop-filter: blur(4px);
    -webkit-backdrop-filter: blur(4px);
  }

  .card .layout--single-view :is(.single-view-live-badge, .single-view-source-indicator)[hidden],
  .card .layout--single-view .single-view-source-indicator :is([data-single-view-source-icon], [data-single-view-source-text])[hidden] {
    display: none !important;
  }

  .card .layout--single-view .single-view-source-indicator-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }

  .card .layout--single-view .single-view-source-indicator-icon svg {
    width: 14px;
    height: 14px;
    color: currentColor;
    fill: currentColor;
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

  .card .layout--single-view #live-stage:has(#stream-loading:not([hidden])) .single-view-live-status-overlay {
    display: none;
  }

  @container single-view (max-width: 420px) {
    .card .layout--single-view .info-row {
      grid-template-columns: minmax(0, 1fr) 40px minmax(0, 1fr);
    }

    .card .layout--single-view .single-view-live-status-overlay {
      display: inline-flex;
    }

    .card .layout--single-view .single-view-source-indicator {
      opacity: 0;
      visibility: hidden;
      transition: opacity .16s ease, visibility 0s linear .16s;
    }

    .card .layout--single-view #live-stage.live-controls-visible .single-view-source-indicator {
      opacity: 1;
      visibility: visible;
      transition-delay: 0s;
    }

    .card .layout--single-view .info-left {
      min-width: 0;
      overflow: hidden;
      gap: clamp(4px, 2vw, 14px);
    }

    .card .layout--single-view .info-online-stat {
      display: none;
    }

    .card .layout--single-view .info-row-center-controls {
      width: max-content;
      justify-self: center;
    }
  }

  @container single-view (max-width: 390px) {
    .card .layout--single-view .info-alert-stat,
    .card .layout--single-view .stats {
      display: none;
    }
  }
`;
