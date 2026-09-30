export const WIDE_VIEW_COMPANION_STYLES = `
  .card .col-left > .wide-companion-panel{flex:1 1 0;overflow:visible;visibility:visible;}
  .wide-companion-panel{position:relative;z-index:20;display:block;flex:1 1 0;min-width:0;min-height:32px;box-sizing:border-box;overflow:visible;--wide-companion-expansion:0px;}
  .wide-companion-surface{position:absolute;inset:calc(0px - var(--wide-companion-expansion)) 0 0;display:flex;flex-direction:column;gap:4px;min-width:0;min-height:0;padding:0 8px 4px;box-sizing:border-box;overflow:hidden;background:var(--c-bg-main);border-radius:calc(var(--fvc-border-radius,0px) / 2) calc(var(--fvc-border-radius,0px) / 2) 0 0;}
  .wide-companion-panel.is-expanded .wide-companion-surface{box-shadow:0 -8px 20px rgb(0 0 0 / 28%);}
  .wide-companion-header{display:grid;flex:0 0 auto;grid-template-columns:minmax(0,1fr) 30px;align-items:center;gap:4px;min-height:32px;}
  .wide-companion-resize-handle{display:grid;grid-template-columns:minmax(0,1fr) auto minmax(0,1fr);align-items:center;gap:6px;min-width:0;min-height:30px;padding:2px 0;box-sizing:border-box;color:var(--c-text);cursor:ns-resize;touch-action:none;user-select:none;outline:none;}
  .card.catalyst-client .wide-companion-resize-handle{cursor:grab;}
  .card.catalyst-client .wide-companion-resize-handle.active{cursor:grabbing;}
  .wide-companion-resize-handle:focus-visible{outline:2px solid var(--c-primary);outline-offset:-2px;border-radius:calc(var(--fvc-border-radius,0px) / 2);}
  .wide-companion-resize-handle.active{background:var(--c-bg-primary);}
  .wide-companion-title{min-width:0;overflow:hidden;color:inherit;font-size:.9rem;font-weight:700;letter-spacing:.02em;text-overflow:ellipsis;white-space:nowrap;}
  .wide-companion-resize-affordance{grid-column:2;display:flex;align-items:center;justify-content:center;gap:2px;color:var(--c-text3);white-space:nowrap;}
  .wide-companion-resize-arrow{display:flex;width:13px;height:13px;align-items:center;justify-content:center;}
  .wide-companion-resize-arrow--up{transform:rotate(180deg);}
  .wide-companion-resize-arrow svg{width:13px;height:13px;}
  .wide-companion-resize-label{font-size:.58rem;font-weight:700;letter-spacing:.04em;text-transform:uppercase;}
  .wide-companion-resize-handle.active .wide-companion-resize-affordance{color:var(--c-primary);}
  .wide-companion-expand-button{display:flex;width:30px;height:30px;min-width:30px;min-height:30px;align-items:center;justify-content:center;padding:0;border:1px solid var(--c-border2);border-radius:50%;background:var(--c-bg-primary);color:var(--c-text);box-shadow:var(--fvc-shadow-s);cursor:pointer;}
  .wide-companion-expand-button svg{width:19px;height:19px;transition:transform .16s ease;}
  .wide-companion-expand-button[aria-expanded="false"] svg{transform:rotate(180deg);}
  .wide-companion-expand-button[aria-expanded="true"]{color:var(--c-primary);}
  .wide-companion-expand-button:focus-visible{outline:2px solid var(--c-primary);outline-offset:1px;}
  @media (hover:hover) and (pointer:fine){.wide-companion-resize-handle:hover{background:var(--c-bg-primary);}.wide-companion-resize-handle:hover .wide-companion-resize-affordance{color:var(--c-primary);}.wide-companion-expand-button:hover{border-color:var(--c-primary);color:var(--c-primary);}}
  .wide-companion-grid{flex:1 1 0;min-height:0;width:100%;height:100%;overflow:hidden;align-content:start;justify-content:stretch;gap:8px;grid-template-columns:repeat(var(--wide-companion-columns,2),minmax(0,1fr));grid-auto-rows:auto;}
  .wide-companion-cell{height:auto;min-height:0;overflow:hidden;border-radius:calc(var(--fvc-border-radius,0px) / 2);}
  .wide-companion-media-host{flex:0 0 auto;min-height:0;aspect-ratio:16/9;border-radius:calc(var(--fvc-border-radius,0px) / 2);}
  .wide-companion-meta{display:flex;flex:0 0 auto;align-items:center;justify-content:flex-start;gap:6px;min-height:24px;padding:3px 6px;border-radius:calc(var(--fvc-border-radius,0px) / 2);box-sizing:border-box;}
  .wide-companion-meta-name{flex:1 1 auto;min-width:0;}
  .wide-companion-meta-status{flex:0 0 auto;}
`;
