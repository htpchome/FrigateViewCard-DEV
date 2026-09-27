export const EDITOR_STYLES = `
          :host{
                --editor-primary-bg: var(--card-background-color);
                --editor-secondary-bg: var(--secondary-background-color);
                --editor-card-bg: var(--card-background-color);
                --editor-text: var(--primary-text-color);
                --editor-muted: var(--secondary-text-color);
                --editor-primary: var(--primary-color);
                --editor-primary-d: var(--dark-primary-color);
                --editor-primary-l: var(--light-primary-color);
                --editor-border: var(--divider-color);
                --editor-border-width: var(--ha-card-border-width);
                --editor-shadow: var(--ha-card-box-shadow);
                --editor-icon: var(--icon-color, var(--secondary-text-color));
              --c-bg-main: var(--editor-primary-bg);
              --c-bg-mobile:var(--ha-color-fill-neutral-normal-resting,var(--wa-color-neutral-fill-normal,var(--secondary-background-color)));
              --c-text: var(--editor-text);
              --c-text2: var(--editor-muted);
              --c-text-rev: var(--text-primary-color);
              --c-border: var(--editor-border);
              --c-border2: var(--state-inactive-color);
              --c-primary: var(--editor-primary);
              --c-accent: var(--accent-color, var(--editor-primary));
              --c-alert: var(--error-color);
            }
            input[type="range"],input[type="checkbox"]{accent-color:var(--c-primary, var(--editor-primary));}
            ha-switch{
              --primary-color:var(--c-primary, var(--editor-primary));
              --accent-color:var(--c-primary, var(--editor-primary));
              --state-active-color:var(--c-primary, var(--editor-primary));
              --state-on-color:var(--c-primary, var(--editor-primary));
              --switch-checked-color:var(--c-primary, var(--editor-primary));
              --switch-checked-button-color:var(--c-primary, var(--editor-primary));
              --switch-checked-track-color:var(--c-primary-l, var(--editor-primary-l));
              --mdc-theme-secondary:var(--c-primary, var(--editor-primary));
              --ha-color-fill-primary-loud-resting:var(--c-primary, var(--editor-primary));
              --ha-color-fill-primary-loud-hover:var(--c-primary, var(--editor-primary));
              --ha-color-fill-primary-normal-resting:var(--c-primary-l, var(--editor-primary-l));
              --ha-color-fill-primary-normal-hover:var(--c-primary-l, var(--editor-primary-l));
              --wa-color-brand-fill-loud:var(--c-primary, var(--editor-primary));
              --wa-color-brand-fill-normal:var(--c-primary-l, var(--editor-primary-l));
            }
            .ed-wrap{
                display:flex;
                flex-direction:column;
                gap:16px;
                padding:8px 0;
                background:transparent;
                color:var(--editor-text);
                font-family: var(--ha-font-family, inherit);
                font-size: var(--ha-font-size, 14px);
            }
            .settings-container{display:flex;flex-direction:column;gap:6px;}
            .config-save-reminder{position:sticky;top:8px;z-index:20;box-sizing:border-box;width:100%;min-height:30px;display:flex;align-items:center;justify-content:center;gap:6px;padding:5px 10px;border:1px solid color-mix(in srgb,var(--success-color,#2e7d32) 55%,transparent);border-radius:10px;background:color-mix(in srgb,var(--success-color,#2e7d32) 14%,transparent);-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px);color:var(--success-color,#2e7d32);font-size:12px;font-weight:600;line-height:1.2;text-align:center;pointer-events:none;}
            .config-save-reminder[data-config-save-state="dirty"]{border-color:color-mix(in srgb,var(--warning-color, var(--c-accent, var(--editor-primary))) 55%,transparent);background:color-mix(in srgb,var(--warning-color, var(--c-accent, var(--editor-primary))) 16%,transparent);color:var(--warning-color, var(--c-accent, var(--editor-primary)));}
            .standalone-landing-note{box-sizing:border-box;width:100%;margin-top:8px;padding:7px 10px;border:1px solid color-mix(in srgb,var(--c-primary, var(--editor-primary)) 42%,transparent);border-radius:10px;background:color-mix(in srgb,var(--c-primary-l, var(--editor-primary-l)) 42%,var(--editor-card-bg));color:var(--c-primary-d, var(--editor-text));font-weight:650;line-height:1.3;}
            .display-options-info{box-sizing:border-box;width:100%;display:flex;align-items:flex-start;gap:8px;margin:14px 0 2px;padding:9px 11px;border:1px solid color-mix(in srgb,var(--info-color,#03a9f4) 55%,transparent);border-radius:10px;background:color-mix(in srgb,var(--info-color,#03a9f4) 13%,transparent);color:color-mix(in srgb,var(--info-color,#0277bd) 75%,var(--primary-text-color,#111));font-size:11px;font-weight:600;line-height:1.35;}
            .display-options-info ha-icon,.display-options-warning ha-icon{width:18px;height:18px;flex:0 0 18px;}
            .display-options-group-title{display:block;margin-bottom:12px;color:var(--c-primary-d,var(--editor-primary-d));font-size:13px;font-weight:800;line-height:1.2;}
            .editor-choice-chips.active-tabs-choice-row{grid-template-columns:repeat(5,minmax(0,1fr));gap:6px;}
            .active-tabs-choice-row .editor-choice-chip-body{min-height:38px;padding:6px;gap:5px;font-size:11px;line-height:1.1;}
            .active-tabs-choice-row .editor-choice-chip-indicator{width:15px;height:15px;}
            .display-option-block + .display-option-block{margin-top:13px;padding-top:13px;border-top:1px solid color-mix(in srgb,var(--c-border2,var(--editor-border)) 55%,transparent);}
            .display-option-block .layout-row .field-label{margin:0;}
            .display-options-warning{box-sizing:border-box;width:100%;display:flex;align-items:flex-start;gap:7px;margin-top:7px;padding:7px 9px;border:1px solid color-mix(in srgb,var(--warning-color,#f59e0b) 65%,transparent);border-radius:8px;background:color-mix(in srgb,var(--warning-color,#f59e0b) 13%,transparent);color:color-mix(in srgb,var(--warning-color,#b86b00) 78%,var(--primary-text-color,#111));font-size:11px;font-weight:650;line-height:1.35;}
            .display-options-warning[hidden]{display:none;}
            .config-save-reminder-icon{display:inline-flex;width:17px;height:17px;flex:0 0 17px;}
            .config-save-reminder-icon svg{display:block;width:100%;height:100%;}
            .environment-version-summary{margin:12px 0;}
            .card-version-status{box-sizing:border-box;width:100%;display:flex;align-items:center;gap:9px;margin:0;padding:9px 11px;border-radius:10px;background:var(--c-primary-l, var(--editor-primary-l));color:var(--c-primary-d, var(--editor-text));font-size:12px;line-height:1.3;cursor:default;}
            .environment-item-icon{display:inline-flex;width:14px;height:14px;flex:0 0 14px;align-items:center;justify-content:center;}
            .environment-item-icon svg{display:block;width:100%;height:100%;}
            .card-version-icon{width:20px;height:20px;flex-basis:20px;align-self:flex-start;}
            .card-version-copy{display:flex;min-width:0;flex:1 1 auto;flex-direction:column;gap:1px;}
            .card-version-update-link{appearance:none;flex:0 0 auto;padding:2px 0;border:0;background:transparent;color:inherit;font:inherit;font-weight:700;text-decoration:underline;text-underline-offset:2px;cursor:pointer;}
            .card-version-update-link[hidden]{display:none;}
            .card-version-update-link:focus-visible{outline:2px solid currentColor;outline-offset:3px;border-radius:2px;}
            .environment-support-items{display:flex;flex-wrap:wrap;gap:4px 10px;margin-top:4px;}
            .environment-support-item{display:inline-flex;min-width:0;align-items:center;gap:4px;color:color-mix(in srgb,currentColor 76%,transparent);font-size:10px;font-weight:600;line-height:1.25;}
            .environment-support-item[data-support-status="warning"],.environment-support-item[data-support-status="error"]{padding:2px 6px;border:1px solid;border-radius:999px;}
            .environment-support-item[data-support-status="warning"]{border-color:color-mix(in srgb,var(--warning-color, #f59e0b) 58%,transparent);background:color-mix(in srgb,var(--warning-color, #f59e0b) 17%,transparent);color:color-mix(in srgb,var(--warning-color, #b86b00) 75%,var(--primary-text-color, #111));}
            .environment-support-item[data-support-status="error"]{border-color:color-mix(in srgb,var(--error-color, var(--c-alert, #d32f2f)) 65%,transparent);background:color-mix(in srgb,var(--error-color, var(--c-alert, #d32f2f)) 15%,transparent);color:var(--error-color, var(--c-alert, #b71c1c));}
            .environment-support-item[hidden]{display:none;}
            .settings-panel{
                border:1px solid var(--c-border2, var(--editor-border));
                border-radius:16px;
                background:var(--editor-card-bg, var(--editor-card-bg));
                color:var(--c-text, var(--editor-text));
                overflow:hidden;
              }
              .setting-title{
                width:100%;
                box-sizing:border-box;
                border:0;
                border-bottom:1px solid transparent;
                background:transparent;
                color:inherit;
                display:flex;
                align-items:center;
                gap:10px;
                padding:12px 14px;
                text-align:left;
                font-family:inherit;
                font-size:14px;
                font-weight:700;
                line-height:1.2;
                cursor:pointer;
                transition:background-color .16s ease,color .16s ease;
              }
              .setting-title h3{margin:0;font:inherit;line-height:inherit;color:inherit;}
              .setting-title ha-icon,.setting-title-icon{color:var(--c-text2, var(--editor-muted));}
              .setting-title-icon{display:inline-flex;width:24px;height:24px;align-items:center;justify-content:center;}
              .setting-title-icon svg{width:24px;height:24px;}
              .setting-title:hover,.settings-panel.active .setting-title{background:var(--c-bg-mobile);border-bottom-color:var(--c-border2, var(--editor-border));}
              .settings-panel.active .setting-title{color:var(--c-accent, var(--editor-primary));}
              .settings-panel.active .setting-title :is(ha-icon,.setting-title-icon){color:var(--c-accent, var(--editor-primary));}
              .setting-content{
                position:relative;
                max-height:0;
                opacity:0;
                overflow:hidden;
                padding:0 14px;
                transition:max-height .28s ease, opacity .2s ease, padding .2s ease;
              }
              .settings-panel.active .setting-content{
                max-height:none;
                opacity:1;
                padding:0 14px 14px;
              }
              .settings-more-slot{position:absolute;top:8px;right:14px;left:14px;z-index:3;display:flex;justify-content:center;height:0;pointer-events:none;}
              .settings-more-chip{appearance:none;-webkit-appearance:none;display:inline-flex;align-items:center;justify-content:center;gap:4px;min-width:72px;min-height:36px;padding:6px 12px;border:1px solid color-mix(in srgb,var(--c-border2, var(--editor-border)) 82%,transparent);border-radius:999px;background:color-mix(in srgb,var(--c-bg-main, var(--editor-card-bg)) 82%,transparent);box-shadow:0 4px 14px rgba(0,0,0,.22);-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px);color:var(--c-text, var(--editor-text));font:inherit;font-size:11px;font-weight:750;line-height:1;cursor:pointer;pointer-events:auto;transition:background-color .16s ease,border-color .16s ease,color .16s ease,box-shadow .16s ease,transform .1s ease;}
              .settings-more-chip[hidden]{display:none;}
              .settings-more-chip svg{width:17px;height:17px;fill:currentColor;}
              .settings-more-chip:focus-visible{border-color:var(--c-primary, var(--editor-primary));background:var(--c-primary-l, var(--editor-primary-l));color:var(--c-primary-d, var(--editor-primary-d));outline:none;box-shadow:0 5px 17px rgba(0,0,0,.28);}
              .settings-more-chip:active{transform:scale(.96);}
              @media (hover:hover) and (pointer:fine){.settings-more-chip:hover{border-color:var(--c-primary, var(--editor-primary));background:var(--c-primary-l, var(--editor-primary-l));color:var(--c-primary-d, var(--editor-primary-d));box-shadow:0 5px 17px rgba(0,0,0,.28);}}
              .field-label{font-size:12px;font-weight:600;margin-bottom:8px;display:block;color:var(--c-text, var(--editor-text));}
            .field-helper{min-height:1.2em;margin:4px 0px;font-size:11px;color:var(--c-text2, var(--editor-muted));}
            .field-helper.error{color:var(--c-alert);}
            .section{border-top:1px solid var(--c-border2, var(--editor-border));padding-top:16px;}
            .setting-content > .section:first-child{border-top:none;}
            .timeline-dependent-section,
            .ha-navbar-dependent-section{margin-inline-start:14px;padding-inline-start:12px;border-inline-start:2px solid var(--c-primary, var(--editor-primary));}
            .editor-choice-field{display:block;min-width:0;margin:0;padding:0;border:0;}
            .editor-choice-field--fit{flex:1 1 420px;max-width:560px;}
            .editor-choice-field .field-label{margin:0 0 8px;}
            .editor-choice-chips{display:grid;grid-template-columns:repeat(auto-fit,minmax(88px,1fr));gap:8px;width:100%;min-width:0;}
            .editor-choice-field--single-row .editor-choice-chips{grid-template-columns:repeat(4,minmax(0,1fr));}
            .editor-choice-chips--compact{display:flex;width:auto;gap:6px;}
            .editor-choice-chips--detailed{grid-template-columns:repeat(auto-fit,minmax(160px,1fr));}
            .dashboard-swipe-page-selection{margin-top:16px;padding-top:14px;border-top:1px solid var(--c-border2, var(--editor-border));}
            .dashboard-swipe-device-group + .dashboard-swipe-device-group{margin-top:12px;}
            .dashboard-swipe-pages-grid{grid-template-columns:repeat(auto-fit,minmax(88px,1fr));align-items:stretch;gap:6px;}
            .dashboard-swipe-pages-grid > .editor-choice-chip{display:flex;}
            .dashboard-swipe-pages-grid .editor-choice-chip-body{flex:1 1 auto;min-height:40px;padding:6px;gap:5px;font-size:11px;line-height:1.15;}
            .dashboard-swipe-pages-grid .editor-choice-chip-indicator{width:15px;height:15px;}
            .dashboard-swipe-landing-note{font-weight:600;color:var(--c-primary-d, var(--editor-primary-d));}
            .editor-swipe-choice-grid{align-items:stretch;}
            .editor-swipe-choice{position:relative;min-width:0;}
            .editor-swipe-choice > .editor-choice-chip{height:100%;}
            .editor-swipe-choice > .editor-choice-chip .editor-choice-chip-body{height:100%;}
            .editor-swipe-choice:has(.editor-swipe-choice-footer) .editor-choice-chip-body{padding-bottom:42px;}
            .editor-swipe-choice-footer{position:absolute;z-index:1;right:9px;bottom:7px;left:36px;display:flex;align-items:center;justify-content:flex-end;gap:7px;color:var(--c-text2, var(--editor-muted));font-size:10px;font-weight:600;line-height:1.15;text-align:right;cursor:pointer;}
            .editor-swipe-choice-footer ha-switch{flex:0 0 auto;}
            .editor-swipe-choice-footer:has(ha-switch[disabled]){opacity:.55;cursor:not-allowed;}
            .swipe-navigation-dependent-section{margin-inline-start:14px;padding-inline-start:12px;border-inline-start:2px solid var(--c-primary, var(--editor-primary));}
            .swipe-owner-warning,.navbar-owner-warning{padding:8px 10px;border:1px solid color-mix(in srgb,var(--warning-color, #f59e0b) 70%,transparent);border-radius:8px;background:color-mix(in srgb,var(--warning-color, #f59e0b) 12%,transparent);color:color-mix(in srgb,var(--warning-color, #b86b00) 75%,var(--primary-text-color, #111));line-height:1.35;}
            .swipe-owner-warning strong,.navbar-owner-warning strong{display:inline-block;padding:1px 5px;border-radius:5px;background:color-mix(in srgb,var(--warning-color, #f59e0b) 20%,transparent);color:inherit;font-weight:800;}
            .navbar-owner-info{padding:8px 10px;border:1px solid var(--success-color, #2e7d32);border-radius:8px;background:color-mix(in srgb,var(--success-color, #2e7d32) 9%,transparent);color:var(--success-color, #2e7d32);line-height:1.35;}
            .navbar-owner-info strong{display:inline-block;padding:1px 5px;border-radius:5px;background:color-mix(in srgb,var(--success-color, #2e7d32) 16%,transparent);color:inherit;font-weight:800;}
            .editor-choice-chip{position:relative;display:block;min-width:0;cursor:pointer;}
            .editor-choice-chip-input{position:absolute;inline-size:1px;block-size:1px;margin:0;opacity:0;pointer-events:none;}
            .editor-choice-chip-body{display:flex;align-items:center;gap:8px;min-height:40px;box-sizing:border-box;padding:8px 11px;border:1px solid var(--c-border2, var(--editor-border));border-radius:10px;background:var(--c-bg-main, var(--editor-card-bg));color:var(--c-text, var(--editor-text));font-size:12px;font-weight:600;line-height:1.25;transition:background-color .16s ease,border-color .16s ease,color .16s ease,box-shadow .16s ease,transform .1s ease;}
            .editor-choice-chips--detailed .editor-choice-chip-body{align-items:flex-start;min-height:104px;}
            .editor-choice-chip-copy{display:flex;min-width:0;flex-direction:column;gap:5px;}
            .editor-choice-chip-description{color:var(--c-text2, var(--editor-muted));font-size:11px;font-weight:400;line-height:1.35;}
            .editor-choice-chip-input:checked + .editor-choice-chip-body .editor-choice-chip-description{color:inherit;opacity:.8;}
            .editor-choice-chip-indicator{position:relative;flex:0 0 auto;width:17px;height:17px;box-sizing:border-box;border:2px solid var(--c-text2, var(--editor-muted));border-radius:50%;background:var(--c-bg-main, var(--editor-card-bg));transition:border-color .16s ease,background-color .16s ease;}
            .editor-choice-chip-indicator::after{content:"";position:absolute;inset:3px;border-radius:50%;background:var(--c-text-rev, #fff);transform:scale(0);transition:transform .14s ease;}
            .editor-choice-chip-input:not(:disabled) + .editor-choice-chip-body:hover{border-color:var(--c-primary, var(--editor-primary));background:var(--c-primary-l, var(--editor-primary-l));box-shadow:0 2px 7px rgba(0,0,0,.12);}
            .editor-choice-chip-input:not(:disabled) + .editor-choice-chip-body:active{transform:scale(.985);}
            .editor-choice-chip-input:focus-visible + .editor-choice-chip-body{outline:2px solid var(--c-primary, var(--editor-primary));outline-offset:2px;}
            .editor-choice-chip-input:checked + .editor-choice-chip-body{border-color:var(--c-primary, var(--editor-primary));background:var(--c-primary-l, var(--editor-primary-l));color:var(--c-primary-d, var(--editor-primary-d));box-shadow:inset 0 0 0 1px var(--c-primary, var(--editor-primary));}
            .editor-choice-chip-input:checked:not(:disabled) + .editor-choice-chip-body:hover{box-shadow:inset 0 0 0 1px var(--c-primary, var(--editor-primary)),0 2px 7px rgba(0,0,0,.16);}
            .editor-choice-chip-input:checked + .editor-choice-chip-body .editor-choice-chip-indicator{border-color:var(--c-primary, var(--editor-primary));background:var(--c-primary, var(--editor-primary));}
            .editor-choice-chip-input:checked + .editor-choice-chip-body .editor-choice-chip-indicator::after{transform:scale(1);}
            .editor-choice-chips--checkbox .editor-choice-chip-indicator{border-radius:4px;}
            .editor-choice-chips--checkbox .editor-choice-chip-indicator::after{inset:2px 5px 4px;border:solid var(--c-text-rev, #fff);border-width:0 2px 2px 0;border-radius:0;background:transparent;transform:rotate(45deg) scale(0);}
            .editor-choice-chips--checkbox .editor-choice-chip-input:checked + .editor-choice-chip-body .editor-choice-chip-indicator::after{transform:rotate(45deg) scale(1);}
            .editor-choice-chip-input:disabled + .editor-choice-chip-body{opacity:.5;cursor:not-allowed;background:var(--c-bg-mobile, var(--editor-secondary-bg));}
            .editor-choice-chip-input[data-dashboard-swipe-landing="true"]:checked:disabled + .editor-choice-chip-body{opacity:1;border-color:var(--c-primary, var(--editor-primary));background:var(--c-primary-l, var(--editor-primary-l));color:var(--c-primary-d, var(--editor-primary-d));box-shadow:inset 0 0 0 1px var(--c-primary, var(--editor-primary));}
            .editor-choice-field--compact{flex:0 0 auto;}
            .editor-choice-field--compact .editor-choice-chip-body{min-height:36px;padding:6px 9px;}
            .editor-choice-field--compact .editor-choice-chip-indicator{width:15px;height:15px;}
            .card-height-control{display:flex;gap:8px;align-items:flex-start;min-width:0;}
            .card-height-slider-control{display:flex;flex:1 1 auto;min-width:120px;flex-direction:column;}
            .card-height-slider-control > #stream_height{width:100%;margin-top:7px;}
            .card-height-value{align-self:flex-start;margin-top:0;}
            .chk-row{display:flex;flex-wrap:wrap;gap:8px 16px;}
            .text-display-field + .text-display-field{margin-top:8px;}
            .text-display-row{display:flex;align-items:center;gap:12px;min-width:0;}
            .text-display-token-helper{margin:4px 0 0;}
            .text-display-field + .section{margin-top:12px;}
            .limited-text-input{position:relative;flex:1 1 auto;min-width:0;}
            .limited-text-input ha-input{display:block;width:100%;min-width:0;}
            .limited-text-counter{position:absolute;right:11px;top:50%;z-index:1;transform:translateY(-50%);padding-inline-start:6px;background:var(--c-bg-mobile, var(--editor-secondary-bg));color:var(--c-text2, var(--editor-muted));font-size:11px;font-variant-numeric:tabular-nums;line-height:1;pointer-events:none;}
            .text-display-checkbox{display:inline-flex;align-items:center;gap:5px;flex:0 0 auto;cursor:pointer;color:var(--c-text, var(--editor-text));font-size:12px;font-weight:600;}
            .text-display-checkbox input{margin:0;}

            .cam-wrap{display:flex;flex-direction:column;gap:8px;}
            .cam-row{
              position:relative;
              display:grid;
              grid-template-columns:auto minmax(0,1fr) auto auto;
              gap:8px;
              align-items:center;
              border:1px solid var(--c-border2, var(--editor-border));
              border-inline-start:4px solid var(--c-primary, var(--editor-primary));
              border-radius:10px;
              padding:8px 10px;
              background:var(--c-bg-mobile, var(--editor-secondary-bg));
              box-shadow:var(--editor-shadow);
              transition:background-color .16s ease,border-color .16s ease,box-shadow .16s ease,opacity .16s ease,transform .16s ease;
            }
            .grid-order-row,.grid-order-excluded-row{
              position:relative;
              display:grid;
              grid-template-columns:auto minmax(0,1fr) auto auto;
              gap:6px;
              align-items:center;
              border:1px solid var(--c-border2, var(--editor-border));
              border-inline-start:4px solid var(--c-primary, var(--editor-primary));
              border-radius:10px;
              padding:4px 7px;
              background:var(--c-bg-mobile, var(--editor-secondary-bg));
              box-shadow:var(--editor-shadow);
              transition:background-color .16s ease,border-color .16s ease,box-shadow .16s ease,opacity .16s ease,transform .16s ease;
            }
            .cam-row:hover,.cam-row:focus-within,.grid-order-row:hover,.grid-order-row:focus-within,.grid-order-excluded-row:hover,.grid-order-excluded-row:focus-within{background:var(--c-bg-main, var(--editor-card-bg));border-color:var(--c-primary, var(--editor-primary));}
            .cam-row.dragging,.grid-order-row.dragging{opacity:.5;transform:scale(.985);box-shadow:none;}
            .cam-row.drop-target{background:var(--c-bg-main, var(--editor-card-bg));border-color:var(--c-primary, var(--editor-primary));box-shadow:0 0 0 2px var(--c-primary, var(--editor-primary));}
            .grid-order-row.drop-target{background:var(--c-bg-main, var(--editor-card-bg));border-color:var(--c-primary, var(--editor-primary));box-shadow:0 0 0 2px var(--c-primary, var(--editor-primary));}
            :is(.cam-row,.grid-order-row).drop-target-before::before,
            :is(.cam-row,.grid-order-row).drop-target-after::after{content:"";position:absolute;z-index:3;left:4px;right:4px;height:4px;border-radius:999px;background:var(--c-primary, var(--editor-primary));box-shadow:0 0 0 2px var(--c-bg-main, var(--editor-card-bg));pointer-events:none;}
            :is(.cam-row,.grid-order-row).drop-target-before::before{top:-6px;}
            :is(.cam-row,.grid-order-row).drop-target-after::after{bottom:-6px;}
            .cam-drag{border:1px solid var(--c-border2, var(--editor-border));background:var(--c-bg-main, var(--editor-card-bg));color:var(--editor-icon);cursor:grab;line-height:1;display:grid;place-items:center;width:28px;height:28px;border-radius:8px;}
            .cam-drag:hover,.cam-drag:active{background:var(--c-primary, var(--editor-primary));border-color:var(--c-primary, var(--editor-primary));color:var(--c-text-rev, var(--editor-card-bg));}
            .cam-drag ha-icon{--mdc-icon-size:18px;}
            .cam-name{font-size:15px;color:var(--editor-text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
            .cam-meta{font-size:11px;color:var(--editor-muted);margin-top:2px;}
            .cam-action{width:32px;height:32px;border:none;background:transparent;color:var(--editor-icon);display:grid;place-items:center;cursor:pointer;border-radius:8px;}
            .cam-action:hover{background:var(--editor-secondary-bg);color:var(--editor-text);}
            .cam-action svg{width:18px;height:18px;display:block;fill:currentColor;}
            .cam-toolbar{display:flex;align-items:center;gap:8px;}
            .cam-add{border:var(--editor-border-width) solid var(--editor-border);border-radius:999px;padding:8px 16px;background:var(--editor-card-bg);color:var(--editor-primary);font-weight:600;cursor:pointer;}
            .cam-add:hover{border-color:var(--editor-primary);}
            .cam-add[disabled]{opacity:.5;cursor:not-allowed;}
            .cam-helper{font-size:11px;color:var(--c-text2, var(--editor-muted));}
            .grid-order-config{flex:1 1 100%;width:100%;min-width:0;box-sizing:border-box;display:flex;flex-direction:column;gap:7px;}
            .grid-order-custom{margin-top:2px;margin-bottom:0;}
            .grid-order-sections,.grid-order-excluded{display:flex;flex-direction:column;gap:8px;}
            .grid-order-excluded{margin-top:12px;padding-top:10px;border-top:1px solid var(--c-border2, var(--editor-border));}
            .grid-order-excluded[hidden]{display:none;}
            .grid-order-heading{font-size:12px;font-weight:700;color:var(--c-text2, var(--editor-muted));letter-spacing:.02em;padding:2px 2px 0;}
            .grid-order-row{grid-template-columns:auto minmax(0,1fr) auto;}
            .grid-order-row .cam-drag{width:26px;height:26px;border-radius:7px;}
            .grid-order-row .cam-drag ha-icon{--mdc-icon-size:16px;}
            .grid-order-excluded-row{grid-template-columns:minmax(0,1fr) auto;}
            .grid-order-excluded-row .grid-order-camera-copy{opacity:.58;}
            .grid-order-excluded-row:hover .grid-order-camera-copy,.grid-order-excluded-row:focus-within .grid-order-camera-copy{opacity:.76;}
            .grid-order-camera-copy{min-width:0;}
            .grid-order-action{width:38px;min-width:38px;height:34px;padding:2px;border:0;border-radius:8px;background:transparent;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:0;font:inherit;font-size:9px;font-weight:700;line-height:1;cursor:pointer;box-shadow:none;}
            .grid-order-action svg{width:17px;height:17px;display:block;flex:0 0 auto;}
            .grid-order-action--exclude{color:var(--c-accent);}
            .grid-order-action--include{color:var(--c-on);}
            .grid-order-action:hover,.grid-order-action:focus-visible{background:var(--c-bg-main, var(--editor-card-bg));outline:none;box-shadow:0 0 0 1px currentColor inset;}

            .theme-row{display:flex;align-items:center;}
            .theme-seg{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;width:100%;}
            .theme-opt{
              appearance:none;
              border:var(--editor-border-width) solid var(--c-border2);
              background:var(--editor-card-bg);
              color:var(--c-text);
              border-radius:10px;
              padding:8px 10px;
              cursor:pointer;
              font-weight:600;
              line-height:1.4;
              transition:background .16s ease,border-color .16s ease,color .16s ease,box-shadow .16s ease;
            }
            .theme-opt:hover{background:var(--c-bg-main);border-color:var(--c-primary);}
            .theme-opt:active{transform:translateY(1px);}
            .theme-opt:focus-visible{outline:none;box-shadow:0 0 0 2px var(--c-primary-l, var(--c-primary));}
            .theme-opt.active{background:var(--c-primary);border-color:var(--c-primary);color:var(--c-text-rev);}
            .theme-custom-panel{margin-top:10px;border:var(--editor-border-width) solid var(--editor-border);border-radius:10px;background:var(--editor-card-bg);}
            .theme-custom-panel[hidden]{display:none;}
            .theme-custom-body{padding:10px 12px;}
            .theme-custom-scope{display:flex;flex-direction:column;gap:7px;padding:2px 0 12px;}
            .theme-custom-scope-label{font-size:12px;font-weight:600;color:var(--c-text2, var(--editor-muted));text-align:center;}
            .theme-scope-seg{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:3px;width:min(100%,390px);margin:0 auto;padding:5px;box-sizing:border-box;border-radius:999px;background:var(--c-bg-main, var(--editor-secondary-bg));box-shadow:inset 0 0 0 1px var(--c-border2, var(--editor-border)),0 5px 13px rgba(0,0,0,.12);}
            .theme-scope-opt{appearance:none;min-width:0;min-height:62px;padding:7px 8px;border:0;border-radius:999px;background:transparent;color:var(--c-text2, var(--editor-muted));display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;font:inherit;font-size:11px;font-weight:650;line-height:1;cursor:pointer;touch-action:manipulation;-webkit-tap-highlight-color:transparent;transition:background .16s ease,color .16s ease,box-shadow .16s ease,transform .1s ease;}
            .theme-scope-opt ha-icon{--mdc-icon-size:25px;pointer-events:none;}
            .theme-scope-opt span{pointer-events:none;}
            .theme-scope-opt.active{background:var(--c-bg-primary, var(--editor-card-bg));color:var(--c-primary, var(--editor-primary));box-shadow:0 2px 8px rgba(0,0,0,.16),inset 0 0 0 1px color-mix(in srgb,var(--c-primary, var(--editor-primary)) 26%,transparent);}
            .theme-scope-opt:active{transform:scale(.98);}
            .theme-scope-opt:focus-visible{outline:2px solid var(--c-primary, var(--editor-primary));outline-offset:1px;}
            @media (hover:hover){.theme-scope-opt:not(.active):hover{background:color-mix(in srgb,var(--c-bg-primary, var(--editor-card-bg)) 66%,transparent);color:var(--c-text, var(--editor-text));}}
            .card-view-start-seg{width:min(100%,280px);margin:0;padding:3px;gap:2px;}
            .card-view-mode-seg{width:min(100%,430px);}
            .editor-bubble-selector{width:min(100%,560px);grid-template-columns:repeat(var(--editor-bubble-option-count,3),minmax(0,1fr));}
            .editor-bubble-selector .card-view-start-opt{padding-inline:4px;white-space:nowrap;}
            .card-view-start-opt{position:relative;min-height:32px;padding:5px 9px;flex-direction:row;font-size:11px;}
            .card-view-start-input{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap;}
            .card-view-start-opt:has(.card-view-start-input:checked){background:var(--c-bg-primary, var(--editor-card-bg));color:var(--c-primary, var(--editor-primary));box-shadow:0 2px 8px rgba(0,0,0,.16),inset 0 0 0 1px color-mix(in srgb,var(--c-primary, var(--editor-primary)) 26%,transparent);}
            .card-view-start-opt:has(.card-view-start-input:disabled){opacity:.48;cursor:not-allowed;}
            .card-view-start-opt:has(.card-view-start-input:focus-visible){outline:2px solid var(--c-primary, var(--editor-primary));outline-offset:1px;}
            @media (hover:hover){.card-view-start-opt:not(:has(.card-view-start-input:checked)):not(:has(.card-view-start-input:disabled)):hover{background:color-mix(in srgb,var(--c-bg-primary, var(--editor-card-bg)) 66%,transparent);color:var(--c-text, var(--editor-text));}}
            .theme-custom-row{display:grid;grid-template-columns:1fr auto auto;gap:10px;align-items:center;padding:10px 0;border-top:1px solid var(--c-border2, var(--editor-border));}
            .theme-custom-scope + .theme-custom-row{border-top:none;}
            .theme-custom-label{display:flex;flex-direction:column;gap:2px;min-width:0;}
            .theme-custom-warn{font-size:11px;color:var(--c-text2, var(--editor-muted));}
            .theme-color-wrap{position:relative;width:60px;height:60px;display:flex;align-items:center;justify-content:center;}
            .theme-color-input{width:60px;height:60px;padding:0;border:1px solid var(--editor-border);border-radius:4px;background:transparent;cursor:pointer;}
            .theme-color-input:disabled{opacity:1;cursor:not-allowed;}
            .theme-color-reset{
              position:absolute;
              left:calc(-1.4em - 2px);
              bottom:0;
              width:1.4em;
              height:1.4em;
              padding:0;
              border:none;
              background:transparent;
              color:var(--c-alert);
              display:grid;
              place-items:center;
              cursor:pointer;
            }
            .theme-color-reset[hidden]{display:none;}
            .theme-color-reset ha-icon{--mdc-icon-size:1.4em;}
            .layout-row{display:flex;align-items:center;justify-content:space-between;gap:8px;}
            .timezone-row{align-items:flex-start;flex-wrap:wrap;}
            .timezone-readout{display:inline-flex;align-items:center;gap:7px;max-width:100%;box-sizing:border-box;padding:6px 10px;border-left:3px solid var(--c-primary, var(--editor-primary));border-radius:4px;background:var(--c-bg-main, var(--editor-secondary-bg));color:var(--c-text, var(--editor-text));font-size:12px;line-height:1.35;cursor:default;}
            .timezone-readout ha-icon{--mdc-icon-size:17px;color:var(--c-text2, var(--editor-muted));flex:0 0 auto;}
            .timezone-helper{max-width:560px;}
            .timezone-helper a{color:var(--c-primary, var(--editor-primary));text-decoration:underline;text-underline-offset:2px;}

            .cam-modal.hidden{display:none;}
            .cam-modal{position:fixed;inset:0;box-sizing:border-box;padding:12px;background:rgba(0,0,0,.30);display:flex;align-items:flex-start;justify-content:center;overflow:auto;overscroll-behavior:contain;z-index:10000;}
            .cam-modal-card{flex:0 0 auto;width:min(640px,100%);margin:auto;overflow:visible;box-sizing:border-box;background:var(--editor-card-bg);color:var(--editor-text);border:var(--editor-border-width) solid var(--editor-border);border-radius:16px;padding:16px;box-shadow:var(--editor-shadow);}
            .cam-modal-card ha-input,
            .cam-modal-card ha-selector,
            .cam-modal-card ha-switch{--ha-card-background:var(--editor-card-bg);}
            .cam-modal-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;}
            .camera-modal-card .cam-modal-head{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:12px;margin-bottom:10px;}
            .cam-modal-title{min-width:0;color:var(--primary-text-color);font-size:22px;font-weight:600;text-align:center;}
            .cam-modal-head-spacer{width:calc(24px + 1rem);height:calc(24px + 1rem);}
            .camera-modal-body{padding:0;border:1px solid var(--c-border2, var(--editor-border));border-radius:12px;overflow:hidden;}
            .camera-modal-accordion + .camera-modal-accordion{border-top:1px solid var(--c-border2, var(--editor-border));}
            .camera-modal-accordion-bar{box-sizing:border-box;width:100%;min-height:40px;display:flex;align-items:center;gap:10px;padding:9px 12px;border:0;background:var(--c-bg-mobile);color:var(--editor-text);font:inherit;font-size:13px;font-weight:700;line-height:1.2;text-align:left;}
            button.camera-modal-accordion-bar{cursor:pointer;appearance:none;}
            .camera-modal-accordion-title{flex:0 1 auto;min-width:0;}
            .camera-modal-accordion-summary{min-width:0;margin-inline-start:auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--c-text2, var(--editor-muted));font-size:12px;font-weight:500;}
            .camera-modal-accordion-summary[hidden]{display:none;}
            .camera-modal-accordion-icon{display:inline-flex;width:20px;height:20px;flex:0 0 20px;align-items:center;justify-content:center;color:var(--c-text2, var(--editor-muted));transition:transform .16s ease;}
            .camera-modal-accordion-icon svg{display:block;width:18px;height:18px;}
            .camera-modal-accordion.active .camera-modal-accordion-icon{transform:rotate(180deg);color:var(--c-primary, var(--editor-primary));}
            .camera-modal-accordion.active > .camera-modal-accordion-bar{color:var(--c-primary, var(--editor-primary));}
            .camera-modal-accordion-content{padding:10px 12px 12px;background:var(--editor-card-bg);}
            .camera-modal-accordion-content[hidden]{display:none;}
            .camera-modal-primary{padding-bottom:10px;border-bottom:1px solid var(--c-border2, var(--editor-border));}
            .camera-modal-selector-field{display:block;min-width:0;}
            .camera-modal-selector-field ha-selector{display:block;width:100%;min-width:0;}
            .camera-modal-selector-label{display:block;margin:0 0 4px 1px;color:var(--c-text2, var(--editor-muted));font-size:10px;font-weight:400;line-height:1.2;}
            .camera-modal-floating-field{position:relative;display:block;min-width:0;}
            .camera-modal-floating-field ha-selector{display:block;width:100%;min-width:0;}
            .camera-modal-floating-label{position:absolute;top:6px;left:12px;z-index:2;color:var(--c-text2, var(--editor-muted));font-size:10px;font-weight:400;line-height:1;pointer-events:none;}
            .camera-modal-accordion-content > .cam-modal-field:last-child{margin-bottom:0;}
            .camera-modal-accordion-content > .camera-group-add-row{padding-inline-start:0;}
            .camera-modal-accordion-content > .camera-group-help,
            .camera-modal-accordion-content > .camera-group-fields{margin-inline-start:0;}
            button.camera-modal-accordion-bar:focus-visible{outline:2px solid var(--c-primary, var(--editor-primary));outline-offset:-3px;}
            @media (hover:hover) and (pointer:fine){button.camera-modal-accordion-bar:hover{background:color-mix(in srgb,var(--c-bg-mobile) 78%,var(--c-primary, var(--editor-primary)));}}
            .cam-modal-toggle-row{align-items:center;justify-content:space-between;gap:14px;}
            .cam-modal-toggle-copy{min-width:0;}
            .cam-modal-toggle-copy .cam-modal-label{margin:0;}
            .cam-modal-toggle-copy .field-helper{margin-top:3px;line-height:1.4;}
            .cam-modal-toggle-row ha-switch{flex:0 0 auto;}
            .round-btn{display:inline-flex;align-items:center;justify-content:center;min-width:calc(24px + 1rem);min-height:calc(24px + 1rem);aspect-ratio:1/1;padding:0;background-color:var(--c-bg-main);color:var(--c-text2);background-image:radial-gradient(circle at center,var(--wa-color-neutral-fill-normal,var(--editor-card-bg)) 0 50%,transparent 51%);background-position:center;background-repeat:no-repeat;background-size:0 0;border:none;box-shadow:0 0 6px 1px var(--c-border2);border-radius:50%;font:inherit;font-weight:600;font-size:1rem;line-height:1;cursor:pointer;appearance:none;transition:background-size .35s ease,box-shadow .2s ease,transform .12s ease;}
            .round-btn svg{width:24px;height:24px;opacity:.85;color:var(--c-text2);}
            .round-btn:hover{background-size:210% 210%;}
            .round-btn:hover svg{color:var(--c-text);}
            .round-btn:focus-visible{outline:2px solid var(--editor-primary-l);outline-offset:3px;}
            .cam-modal-label{font-size:12px;font-weight:600;color:var(--editor-text);margin-bottom:6px;display:block;}
            .cam-modal-field{margin-bottom:8px;}
            .camera-group-add-row{display:flex;justify-content:flex-start;padding-inline-start:12px;}
            .camera-group-help{margin:0 0 10px 12px;border-inline-start:3px solid var(--c-primary, var(--editor-primary));border-radius:0 8px 8px 0;background:var(--editor-secondary-bg);color:var(--editor-text);font-size:12px;line-height:1.35;}
            .camera-group-help[hidden]{display:none;}
            .camera-group-help summary{padding:7px 10px;color:var(--c-primary, var(--editor-primary));font-weight:700;cursor:pointer;}
            .camera-group-help-copy{padding:0 10px 9px;color:var(--c-text2, var(--editor-muted));}
            .camera-group-fields{margin:0 0 10px 12px;padding:10px;border-inline-start:3px solid var(--editor-primary);background:var(--editor-secondary-bg);border-radius:0 10px 10px 0;}
            .camera-group-fields[hidden]{display:none!important;}
            .camera-group-fields-head{display:flex;align-items:center;gap:10px;margin-bottom:6px;}
            .camera-group-fields-title{font-size:12px;font-weight:700;color:var(--editor-text);}
            .camera-group-secondary-row{display:block;min-width:0;}
            .camera-group-selector{flex:1 1 auto;min-width:0;}
            .camera-group-action{flex:0 0 auto;}
            .camera-group-fields-footer{display:flex;justify-content:flex-end;align-items:center;margin-top:5px;}
            .cam-inline-add{display:inline-flex;align-items:center;gap:6px;min-height:30px;padding:4px 10px;border:1px solid var(--c-border2);border-radius:999px;background:var(--editor-secondary-bg);color:var(--editor-text);font:inherit;font-size:12px;font-weight:700;line-height:1;cursor:pointer;}
            .cam-inline-add[hidden]{display:none!important;}
            .cam-inline-add svg{width:18px;height:18px;flex:0 0 18px;color:var(--editor-primary);}
            .cam-inline-add:hover{background:var(--editor-primary-l);border-color:var(--editor-primary);color:var(--editor-primary-d);}
            .cam-inline-add:hover svg{color:var(--editor-primary-d);}
            .cam-inline-remove{min-height:28px;padding:3px 7px;border:0;border-radius:6px;background:transparent;color:var(--c-primary,var(--editor-primary));font:inherit;font-size:12px;font-weight:700;line-height:1;cursor:pointer;}
            .cam-inline-remove:hover{background:var(--c-primary-l,var(--editor-primary-l));color:var(--c-primary-d,var(--editor-primary-d));}
            .linked-entity-row{display:block;min-width:0;}
            .linked-entity-selectors{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);align-items:start;gap:10px;min-width:0;}
            .linked-entity-field{display:grid;grid-template-rows:auto minmax(56px,auto);align-content:start;min-width:0;}
            .linked-entity-field > .cam-modal-label{margin:0 0 6px;}
            .linked-entity-selectors ha-selector,.camera-group-selector ha-selector{display:block;width:100%;min-width:0;background:var(--editor-card-bg);border-radius:4px 4px 0 0;--mdc-menu-max-height:min(320px,48dvh);--ha-card-background:var(--editor-card-bg);--mdc-text-field-fill-color:var(--editor-card-bg);--mdc-filled-text-field-container-color:var(--editor-card-bg);--ha-color-fill-neutral-normal-resting:var(--editor-card-bg);--wa-color-neutral-fill-normal:var(--editor-card-bg);--ha-color-fill-neutral-normal-hover:var(--editor-primary-l);--wa-color-neutral-fill-normal-hover:var(--editor-primary-l);}
            .linked-entity-selectors ha-selector:hover,.linked-entity-selectors ha-selector:focus-within,.camera-group-selector ha-selector:hover,.camera-group-selector ha-selector:focus-within{background:var(--editor-primary-l);--ha-card-background:var(--editor-primary-l);--mdc-text-field-fill-color:var(--editor-primary-l);--mdc-filled-text-field-container-color:var(--editor-primary-l);}
            .camera-group-layout-field{display:block;margin:10px 0 8px;}
            .camera-group-layout-field .cam-modal-label{margin:0 0 7px;}
            .camera-group-layout-field .editor-choice-chips{grid-template-columns:repeat(2,minmax(0,1fr));}
            #camera-modal-ptz-rotation-row{margin-top:10px;padding-left:12px;border-left:3px solid var(--c-primary, var(--editor-primary));}
            #camera-modal-ptz-rotation-row .editor-choice-chips{grid-template-columns:repeat(4,minmax(0,1fr));}
            .cam-modal-foot{display:flex;justify-content:flex-end;gap:8px;margin-top:8px;}
            .camera-modal-card .cam-modal-helper{margin-top:4px;}
            .cam-btn{min-height:38px;border:1px solid transparent;border-radius:999px;background:transparent;color:var(--editor-primary);font-weight:600;cursor:pointer;padding:8px 14px;transition:background .16s ease,color .16s ease,border-color .16s ease;}
            .cam-btn:hover,.cam-btn:focus-visible{background:var(--editor-primary-l);border-color:transparent;color:var(--editor-primary-d);outline:none;}
            .cam-btn.primary{background:var(--editor-primary);color:var(--text-primary-color);border-color:var(--editor-primary);padding:8px 18px;}
            .cam-btn.primary:hover,.cam-btn.primary:focus-visible{background:var(--editor-primary-d);border-color:var(--editor-primary-d);color:var(--text-primary-color);}
            .cam-btn.danger{background:var(--c-alert);color:var(--c-text-rev);border-color:var(--c-alert);padding:8px 18px;}
            .cam-btn.danger:hover{background:var(--c-alert);border-color:var(--c-alert);filter:brightness(.9);}
            .cam-modal-helper{font-size:11px;color:var(--error-color);min-height:16px;}
            .camera-capability-status{box-sizing:border-box;width:fit-content;max-width:100%;margin:5px 0 7px;padding:5px 9px;border:1px solid var(--c-border2);border-radius:10px;background:var(--editor-secondary-bg);color:var(--editor-muted);line-height:1.3;}
            .cam-confirm-card{width:min(420px,100%);}
            .cam-confirm-title{margin:0 0 8px;font-size:20px;color:var(--c-text);}
            .cam-confirm-message{margin:0;color:var(--c-text2);line-height:1.5;}
            @media (max-width:560px){
              .linked-entity-selectors{grid-template-columns:minmax(0,1fr);}
            }
            .standalone-landing-dialog{position:fixed;inset:0;margin:auto;box-sizing:border-box;width:min(420px,calc(100vw - 24px));max-width:none;max-height:calc(100dvh - 24px);overflow:auto;}
            .standalone-landing-dialog::backdrop{background:rgba(0,0,0,.30);}
            .standalone-landing-dialog:not([open]){display:none;}

`;
