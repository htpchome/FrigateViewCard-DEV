export const PREVIEW_PAGE_STYLES = `
  .preview-media-host video,.preview-media-host img,.preview-media-host ha-camera-stream{width:100%;height:100%;display:block;object-fit:contain;object-position:center center;background:var(--c-bg-deep);}
  .preview-shell,.preview-shell-header,.preview-shell-footer{display:none;}
  .card.preview-active{width:100%;max-width:none;margin:0;}
  .card.preview-active .layout{display:flex;flex-direction:column;width:100%;min-width:0;height:var(--view-height,100dvh);max-height:var(--view-height,100dvh);overflow:hidden !important;}
  .card.preview-active .col-left,.card.preview-active .resize-handle,.card.preview-active .col-right{display:none;}
  .card.preview-active.mobile-client .col-left{display:block !important;position:absolute !important;left:-9999px !important;top:0 !important;width:1px !important;height:1px !important;min-width:1px !important;min-height:1px !important;overflow:hidden !important;opacity:0 !important;pointer-events:none !important;}
  .card.preview-active.mobile-client .resize-handle,.card.preview-active.mobile-client .col-right{display:none !important;}
  .card.preview-active .preview-shell-header{display:flex;flex:0 0 auto;align-items:center;justify-content:space-between;gap:10px;padding:10px 12px;}
  .preview-shell-brand{min-width:0;display:flex;align-items:center;}
  .preview-shell-header-fvc-brand-logo{display:flex;align-items:center;max-width:min(46vw,170px);}
  .preview-shell-header-fvc-brand-logo svg{width:100%;height:auto;max-height:24px;}
  .preview-shell-header-fvc-brand-logo[hidden],.preview-shell-title[hidden],.preview-shell-footer[hidden]{display:none !important;}
  .preview-shell-title{min-width:0;display:flex;flex-direction:column;gap:2px;}
  .preview-shell-title-main{font-size:1.05rem;font-weight:700;color:var(--c-text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
  .preview-shell-title-sub{font-size:.78rem;color:var(--c-text2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
  .card.preview-active .preview-shell{display:block;flex:1 1 auto;width:100%;min-width:0;min-height:0;padding:10px;box-sizing:border-box;overflow-y:auto;overscroll-behavior:contain;-webkit-overflow-scrolling:touch;touch-action:pan-y;}
  .card.preview-active .preview-shell-footer{display:grid;grid-template-columns:minmax(0,1fr) auto;flex:0 0 var(--fvc-footer-height);align-items:center;height:var(--fvc-footer-height);min-height:var(--fvc-footer-height);padding:4px 8px;border-top:1px solid var(--c-border);box-sizing:border-box;}
  .preview-shell-footer .fvc-brand-logo{position:static;max-height:24px;}
  .preview-shell-footer .fvc-brand-logo svg{height:24px;}
  .preview-grid{display:grid;gap:10px;width:100%;max-width:100%;grid-template-columns:repeat(auto-fit,minmax(max(min(100%,420px),calc(33.333% - 10px)),1fr));}
  .preview-grid > div{min-width:0;}
  .preview-grid-empty-slot{visibility:hidden;pointer-events:none;}
  .preview-cell{display:flex;flex-direction:column;cursor:pointer;-webkit-backface-visibility:hidden;backface-visibility:hidden;border-radius:var(--fvc-border-radius);container-type:inline-size;container-name:preview-cell;}
  .preview-media-frame{position:relative;flex:0 0 auto;min-width:0;}
  .preview-media-host{position:relative;aspect-ratio:16/9;overflow:hidden;border-radius:var(--fvc-border-radius);background:var(--c-bg-deep);-webkit-backface-visibility:hidden;backface-visibility:hidden;transform:translateZ(0);}
  .preview-media-host::after{content:"";position:absolute;inset:0;pointer-events:none;border:0 solid transparent;border-radius:inherit;box-sizing:border-box;z-index:3;}
  .preview-media-host.grid-alert{border-color:var(--c-bg-alert,var(--error-color));box-shadow:inset 0 0 0 2px var(--c-bg-alert,var(--error-color));}
  .preview-media-host.grid-alert::after{border-width:2px;border-color:var(--c-bg-alert,var(--error-color));}
  .preview-media-host.grid-detection{border-color:var(--c-bg-detect,var(--warning-color));box-shadow:inset 0 0 0 2px var(--c-bg-detect,var(--warning-color));}
  .preview-media-host.grid-detection::after{border-width:2px;border-color:var(--c-bg-detect,var(--warning-color));}
  .preview-media-host > .preview-live-placeholder,.preview-media-host > .preview-live-layer{position:absolute;inset:0;width:100%;height:100%;}
  .preview-media-host > .preview-live-placeholder{z-index:1;}
  .preview-media-host > .preview-live-layer{z-index:2;opacity:0;transition:opacity .16s ease;}
  .preview-media-host > .preview-live-layer.is-ready{opacity:1;}
  .preview-meta{display:grid;grid-template-columns:minmax(0,1fr) auto;grid-template-areas:"name status" "source alerts";gap:2px 8px;align-items:center;padding:6px 8px;background:var(--c-bg-main);border-radius:var(--fvc-border-radius);}
  .preview-meta--with-light{grid-template-columns:minmax(0,1fr) minmax(40px,.5fr) auto;grid-template-areas:"name light status" "source light alerts";}
  .preview-meta-name{grid-area:name;font-size:.82rem;font-weight:700;color:var(--c-text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
  .preview-meta-source{grid-area:source;font-size:.7rem;color:var(--c-text2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
  .preview-meta-alerts{grid-area:alerts;justify-self:end;font-size:.72rem;color:var(--c-text2);}
  .preview-meta-status{grid-area:status;justify-self:end;font-size:.72rem;color:var(--c-text2);display:inline-flex;align-items:center;gap:5px;}
  .preview-meta-status .dot{font-size:.82rem;line-height:1;}
  .preview-grid .preview-meta{padding:5px 8px;}
  .preview-grid :is(.preview-meta-name,.preview-meta-source,.preview-meta-alerts,.preview-meta-status){line-height:1.18;}
  .preview-meta-light{display:contents;}
  .preview-meta-light .linked-light-position-slot{grid-area:light;align-self:center;}
  .preview-meta-light .linked-light-position-slot[data-linked-light-position-slot="left"]{justify-self:start;}
  .preview-meta-light .linked-light-position-slot[data-linked-light-position-slot="right"]{justify-self:end;}
  .preview-meta-light .linked-light-button,.preview-light-overlay .linked-light-button{width:30px;height:30px;min-width:30px;min-height:30px;}
  .preview-light-overlay{position:absolute;z-index:5;right:7px;bottom:7px;left:7px;display:flex;align-items:flex-end;justify-content:space-between;pointer-events:none;}
  .preview-light-overlay .linked-light-position-slot{pointer-events:auto;}
  .preview-light-overlay .linked-light-dimmer{top:auto;bottom:calc(100% + 8px);}
  .preview-cam-buttons{display:flex;flex-wrap:wrap;gap:6px;padding:10px 0;}
  @container preview-cell (max-width: 240px){
    .preview-meta{grid-template-columns:minmax(0,1fr);grid-template-areas:"name" "status" "source" "alerts";gap:2px;}
    .preview-meta--with-light{grid-template-areas:"name" "light" "status" "source" "alerts";}
    .preview-meta-status,.preview-meta-alerts{justify-self:start;}
  }
`;
