import { css } from "lit";

export const styles = css`
  :host { display:block; min-height:100%; color:var(--primary-text-color,#1f2937); background:var(--primary-background-color,#f5f7fa); font-family:var(--paper-font-body1_-_font-family,Roboto,Arial,sans-serif); }
  * { box-sizing:border-box; }
  button,input,select { font:inherit; }
  fieldset { border:0; padding:0; margin:0; min-width:0; }
  button { cursor:pointer; }
  button:disabled { cursor:default; opacity:.55; }
  button:focus-visible,input:focus-visible,select:focus-visible,a:focus-visible { outline:3px solid var(--primary-color,#0288d1); outline-offset:3px; }
  .shell { max-width:1120px; margin:0 auto; padding:28px clamp(16px,4vw,42px) 48px; }
  header { display:flex; align-items:center; gap:12px; margin-bottom:26px; }
  .brand { width:44px; height:44px; border-radius:14px; background:var(--primary-color,#0288d1); color:var(--text-primary-color,#fff); display:grid; place-items:center; font-size:26px; flex:none; }
  h1 { font-size:clamp(23px,4vw,30px); margin:0 0 4px; font-weight:650; letter-spacing:-.025em; }
  header p { margin:0; color:var(--secondary-text-color,#64748b); font-size:14px; }
  .tabs { display:flex; align-items:center; gap:6px; overflow:auto; padding:4px 3px 13px; border-bottom:1px solid var(--divider-color,#dce2e8); scrollbar-width:thin; }
  .tab { flex:none; padding:12px 16px; border:0; border-radius:999px; color:var(--secondary-text-color,#526174); background:transparent; white-space:nowrap; }
  .tab[aria-selected=true] { background:var(--primary-color,#0288d1); color:var(--text-primary-color,#fff); font-weight:600; }
  .tab-dot { display:inline-block; width:6px; height:6px; margin-left:7px; border-radius:50%; background:currentColor; vertical-align:middle; }
  .add { flex:none; border:1px solid var(--divider-color,#dce2e8); background:var(--card-background-color,#fff); border-radius:999px; padding:11px 16px; color:var(--primary-text-color,#1f2937); }
  .panel { padding-top:26px; }
  .panel-heading { display:flex; align-items:flex-start; justify-content:space-between; gap:16px; margin-bottom:22px; }
  h2 { margin:0 0 7px; font-size:22px; letter-spacing:-.015em; }
  h3 { margin:0 0 6px; font-size:16px; }
  p { line-height:1.5; }
  .muted,.help { color:var(--secondary-text-color,#64748b); }
  .help { margin:6px 0 0; font-size:13px; line-height:1.5; }
  .panel-heading p { margin:0; max-width:650px; }
  .card { background:var(--card-background-color,#fff); border:1px solid var(--divider-color,#e0e5eb); border-radius:18px; padding:22px; margin-bottom:20px; }
  .controls { display:flex; gap:20px; flex-wrap:wrap; align-items:flex-end; }
  .field { display:flex; flex-direction:column; gap:8px; min-width:160px; flex:1; }
  .field>span { font-size:14px; font-weight:550; }
  .field input,.field select { width:100%; min-height:44px; padding:10px 12px; border:1px solid var(--divider-color,#cbd5e1); border-radius:9px; color:var(--primary-text-color,#1f2937); background:var(--secondary-background-color,#f8fafc); }
  .switch-row { display:flex; align-items:center; justify-content:space-between; gap:20px; padding:3px 0; }
  .switch-row+.controls { margin-top:22px; }
  .switch-row label { flex:1; cursor:pointer; }
  .switch-row strong { display:block; font-size:15px; }
  .switch-row small { display:block; line-height:1.5; margin-top:5px; color:var(--secondary-text-color,#64748b); }
  input[type=checkbox] { width:22px; height:22px; accent-color:var(--primary-color,#0288d1); flex:none; cursor:pointer; }
  .switch { appearance:none; width:44px!important; height:26px!important; border-radius:30px; background:var(--disabled-text-color,#9aa5b2); position:relative; margin:0; transition:background .15s; }
  .switch::after { content:""; position:absolute; width:20px; height:20px; border-radius:50%; background:#fff; left:3px; top:3px; transition:transform .15s; }
  .switch:checked { background:var(--primary-color,#0288d1); }
  .switch:checked::after { transform:translateX(18px); }
  .check { display:flex; gap:10px; align-items:center; font-size:14px; min-height:44px; }
  .images { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:18px; }
  .slot { min-width:0; }
  .slot-label { display:flex; align-items:center; justify-content:space-between; gap:8px; margin-bottom:8px; font-size:14px; }
  .slot-label small { color:var(--secondary-text-color,#64748b); }
  .preview { aspect-ratio:4/3; background:var(--card-background-color,#fff); border:1px solid var(--divider-color,#dce2e8); border-radius:12px; overflow:hidden; }
  .slot-actions { display:flex; gap:8px; margin-top:8px; }
  .slot-actions button { width:100%; min-height:40px; font-size:13px; }
  .button { border:1px solid var(--divider-color,#cbd5e1); border-radius:9px; padding:10px 16px; min-height:44px; background:var(--card-background-color,#fff); color:var(--primary-text-color,#1f2937); display:inline-flex; align-items:center; justify-content:center; gap:7px; }
  .primary { border-color:transparent; background:var(--primary-color,#0288d1); color:var(--text-primary-color,#fff); font-weight:600; }
  .savebar { display:flex; align-items:center; justify-content:space-between; gap:16px; margin-top:28px; padding-top:20px; border-top:1px solid var(--divider-color,#dce2e8); }
  .savebar p { margin:0; font-size:14px; color:var(--secondary-text-color,#64748b); }
  .actions { display:flex; gap:8px; align-items:center; }
  .notice { border-radius:12px; padding:13px 16px; line-height:1.5; margin:18px 0; background:var(--secondary-background-color,#edf3f9); }
  .error { border:1px solid var(--error-color,#db4437); color:var(--error-color,#b3261e); }
  .success { border-left:3px solid var(--success-color,#2e7d32); }
  .priority { list-style:none; padding:0; margin:12px 0 0; }
  .priority li { display:flex; align-items:center; gap:10px; padding:10px 0; border-bottom:1px solid var(--divider-color,#e2e8f0); }
  .priority li:last-child { border-bottom:0; }
  .priority .order { width:24px; color:var(--secondary-text-color,#64748b); }
  .priority .theme-name { flex:1; }
  .priority button { min-width:44px; padding:8px; }
  .dashboard { display:flex; align-items:center; gap:14px; min-height:64px; border-bottom:1px solid var(--divider-color,#e2e8f0); cursor:pointer; }
  .dashboard:last-child { border-bottom:0; }
  .dashboard span { display:block; }
  .dashboard small { display:block; color:var(--secondary-text-color,#64748b); font-size:12px; margin-top:4px; }
  dialog { border:1px solid var(--divider-color,#dce2e8); border-radius:18px; width:min(460px,calc(100vw - 32px)); color:var(--primary-text-color,#1f2937); background:var(--card-background-color,#fff); padding:26px; box-shadow:0 20px 70px #0005; }
  dialog::backdrop { background:#0008; }
  dialog .actions { flex-wrap:wrap; justify-content:flex-end; margin-top:24px; }
  dialog h2 { font-size:21px; }
  .sr-only { position:absolute; width:1px; height:1px; overflow:hidden; clip:rect(0,0,0,0); white-space:nowrap; }
  @media(max-width:800px) { .images { grid-template-columns:repeat(2,minmax(0,1fr)); } }
  @media(max-width:480px) { .shell { padding-top:20px; } .card { padding:17px; border-radius:14px; } .panel-heading { display:block; } .images { gap:14px 12px; } .savebar { align-items:flex-start; flex-direction:column; } .savebar .actions { width:100%; } .savebar .primary { flex:1; } .controls { gap:14px; } .field { min-width:120px; } .tab { padding:11px 14px; } }
  @media(prefers-reduced-motion:reduce) { * { transition:none!important; } }
`;
