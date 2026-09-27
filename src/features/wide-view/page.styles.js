export const WIDE_VIEW_PAGE_STYLES = `
  .card .layout.wide-view{flex-direction:column;isolation:isolate;}
  .card .wide-view-columns{position:relative;isolation:isolate;display:flex;flex:1 1 0;width:100%;min-width:0;min-height:0;overflow:hidden;}
  .card .col-left > .wide-companion-panel{flex:1 1 0;min-height:32px;overflow:hidden;visibility:hidden;}
  .layout.wide-view .resize-handle{flex:0 0 10px;width:10px;height:auto;overflow:visible;cursor:col-resize;color:var(--c-text3);border-inline:1px solid var(--c-border2);box-sizing:border-box;}
  .layout.wide-view .resize-handle::before{content:'↔';position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);font-size:.5rem;line-height:0.6;opacity:.82;transition:opacity .14s ease;}
  .layout.wide-view .resize-handle::after{content:'Resize ↕ Video';top:50%;left:50%;width:auto;height:auto;transform:translate(-50%,-50%);writing-mode:vertical-rl;text-orientation:mixed;background:transparent;color:var(--c-text3);font-size:.5rem;line-height:0.6;letter-spacing:.05em;text-transform:uppercase;white-space:nowrap;opacity:0;transition:opacity .14s ease;}
  .layout.wide-view .resize-handle:hover,
  .layout.wide-view .resize-handle.active{color:var(--c-text);background:color-mix(in srgb,var(--c-bg-primary) 72%,var(--c-bg-panel));}
  .layout.wide-view .resize-handle:hover::before,
  .layout.wide-view .resize-handle.active::before{opacity:0;}
  .layout.wide-view .resize-handle:hover::after,
  .layout.wide-view .resize-handle.active::after{opacity:1;}
  .wide-footer{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;flex:0 0 var(--fvc-footer-height);height:var(--fvc-footer-height);min-height:var(--fvc-footer-height);line-height:1;font-size:1.2rem;padding:4px;text-align:left;border-top:1px solid var(--c-border);box-sizing:border-box;}
  .card .layout--wide-view{flex:1 1 0;height:auto;min-height:0;}
  .card .col-left--wide-view{height:100%;max-height:100%;overflow:hidden;}
  .card .layout--wide-view .tabs-holder.has-open-toolbar-panel{position:relative;z-index:30;}
`;
