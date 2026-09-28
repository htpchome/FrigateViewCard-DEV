export const CARD_PICKER_DEMO_STYLES = `
  .card.card-picker-demo .live-playback-controls,
  .card.card-picker-demo .page-nav-row,
  .card.card-picker-demo .tools-row{display:none !important;}
  .card.card-picker-demo #eng-wrap{height:auto;aspect-ratio:16/9;}
  .card.card-picker-demo #engine{visibility:hidden;}
  .card.card-picker-demo #stream-fallback{display:block !important;z-index:6;}
  .card.card-picker-demo .stream-loading,
  .card.card-picker-demo .stream-fallback-status{display:none !important;}
  .card.card-picker-demo .card-picker-demo-live{position:absolute;inset:0;overflow:hidden;background:#000;}
  .card.card-picker-demo :is(.card-picker-demo-fvc-brand-logo,.card-picker-demo-scene){display:block;width:100%;height:100%;}
  .card.card-picker-demo .card-picker-demo-live > .card-picker-demo-scene{filter:brightness(.68) saturate(.85) contrast(1.1);}
  .card.card-picker-demo .card-picker-demo-scene-sky{fill:var(--c-primary-l);}
  .card.card-picker-demo .card-picker-demo-scene-ground{fill:var(--c-bg-panel);}
  .card.card-picker-demo .card-picker-demo-scene-path{fill:var(--c-border2);opacity:.72;}
  .card.card-picker-demo .card-picker-demo-scene-building{fill:var(--c-bg-primary);}
  .card.card-picker-demo .card-picker-demo-scene-roof{fill:var(--c-text2);}
  .card.card-picker-demo .card-picker-demo-scene-door{fill:var(--c-bg-deep);}
  .card.card-picker-demo .card-picker-demo-scene-window{fill:var(--c-primary);opacity:.72;}
  .card.card-picker-demo .card-picker-demo-scene-landscape{fill:var(--c-on);opacity:.65;}
  .card.card-picker-demo .card-picker-demo-scene-subject{fill:var(--c-text);stroke:var(--c-bg-main);stroke-width:2;}
  .card.card-picker-demo .card-picker-demo-scene-frame{fill:none;stroke:var(--c-text-rev);stroke-width:2;opacity:.28;}
  .card.card-picker-demo .info-row{display:flex;align-items:center;justify-content:space-between;gap:4px;flex-wrap:nowrap;padding:2px 7px;}
  .card.card-picker-demo .info-left{flex:0 1 auto;min-width:0;}
  .card.card-picker-demo .info-title{font-size:.88rem;}
  .card.card-picker-demo .section-label{font-size:.72rem;}
  .card.card-picker-demo .stats{flex:0 0 auto;gap:3px;align-self:center;}
  .card.card-picker-demo .stat{font-size:.65rem;}
  .card.card-picker-demo .sv{font-size:.72rem;}
  .card.card-picker-demo .sl{font-size:.55rem;}
  .card.card-picker-demo .button-holder{display:flex;justify-content:center;padding:2px 5px;}
  .card.card-picker-demo .tabs-row{justify-content:center;}
  .card.card-picker-demo .circle-btn{min-width:31px;min-height:31px;}
  .card.card-picker-demo .circle-btn svg{width:20px;height:20px;}
  .card.card-picker-demo .tabs-holder{margin:1px 6px;}
  .card.card-picker-demo .browse-head{min-height:1.2rem;max-height:1.2rem;font-size:.72rem;padding:0 6px;}
  .card.card-picker-demo .browse{padding:0 6px;overflow:hidden;}
  .card.card-picker-demo .list-item.card-picker-demo-alert{flex-wrap:nowrap;gap:6px;min-height:48px;margin-bottom:4px;padding:2px 6px 2px 2px;cursor:default;}
  .card.card-picker-demo .card-picker-demo-alert :is(.et,.card-picker-demo-scene){width:76px;height:43px;}
  .card.card-picker-demo .card-picker-demo-alert .rev-t{font-size:.74rem;white-space:nowrap;}
  .card.card-picker-demo .card-picker-demo-alert .rev-m{font-size:.62rem;gap:5px;}
  .card.card-picker-demo .card-picker-demo-alert-badge{position:absolute;left:3px;bottom:2px;padding:1px 3px;border-radius:3px;background:var(--c-bg-deep);color:var(--c-text-rev);font-size:.5rem;line-height:1.1;opacity:.82;}
  .card.card-picker-demo .card-picker-demo-alert:hover{background:var(--c-bg-primary);}
  .card.card-picker-demo .footer{display:grid;flex:0 0 27px;height:27px;grid-template-columns:minmax(0,1fr) auto;min-height:27px;line-height:1;padding:1px 6px;}
  .card.card-picker-demo .footer .fvc-brand-logo{display:flex;align-items:center;max-height:22px;}
  .card.card-picker-demo .footer .fvc-brand-logo svg{height:20px;}
  .card.card-picker-demo .footer-version{font-size:.56rem;padding:0 1px 2px 4px;}
`;
