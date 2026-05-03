// Self-contained HTML page served at /authorize.
//
// Layout: brand name → dual logos + dots → white card → footer
//         (mirrors the Claude CLI authorization page structure)
//
// Auth flow:
//   1. User clicks "Authorize"
//   2. JS auto-copies the bookmarklet snippet to clipboard AND opens
//      chat.deepseek.com in a new tab — no manual copy needed
//   3. User switches to the DeepSeek tab, opens DevTools Console,
//      pastes (Ctrl+V / Cmd+V) and presses Enter — one gesture
//   4. The snippet POSTs document.cookie cross-origin to /authorize/submit
//   5. /healthz polling detects "authed", page auto-reloads to success state
//   Manual paste of the raw cookie string is available only as a fallback.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

export interface AuthorizePageOpts {
  error?: string;
  success?: boolean;
}

const BRAND  = '#4D6BFE';
const DS_URL = 'https://chat.deepseek.com';

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ── DeepSeek logo PNG — read from disk at module load time ─────────────────
const _pngPath = join(dirname(fileURLToPath(import.meta.url)), 'deepseek.png');
const DS_PNG_B64 = readFileSync(_pngPath).toString('base64');
const DS_LOGO_IMG = `<img src="data:image/png;base64,${DS_PNG_B64}" width="40" height="40" style="display:block" alt="DeepSeek">`;

// ── Inline SVG icons ────────────────────────────────────────────────────────
const ICON_USER   = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>`;
const ICON_CHAT   = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`;
const ICON_TOOL   = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>`;
const ICON_LOCK   = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`;
const ICON_CHECK  = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;

// CLI terminal icon — outlined rounded square
const CLI_ICON = `<svg width="52" height="52" viewBox="0 0 52 52" fill="none" xmlns="http://www.w3.org/2000/svg">
  <rect x="1" y="1" width="50" height="50" rx="13" fill="white" stroke="#D1D5DB" stroke-width="2"/>
  <text x="26" y="34" text-anchor="middle" font-family="ui-monospace,SFMono-Regular,Menlo,monospace" font-size="17" font-weight="600" fill="#374151">&gt;_</text>
</svg>`;

// Five-dot connector matching Claude's dotted bridge
const DOTS = `<div class="dots"><span></span><span></span><span></span><span></span><span></span></div>`;

// ── CSS ────────────────────────────────────────────────────────────────────
const CSS = `
  *, *::before, *::after { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    background: #EBF2FF;
    color: #111827;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Roboto, sans-serif;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: flex-start;
    min-height: 100vh;
    padding: 52px 24px 40px;
  }

  /* Brand name */
  .brand-name {
    font-size: 12px;
    font-weight: 800;
    letter-spacing: 0.22em;
    color: #374151;
    text-transform: uppercase;
    margin-bottom: 26px;
    user-select: none;
  }

  /* Dual logo row */
  .logos {
    display: flex;
    align-items: center;
    gap: 16px;
    margin-bottom: 32px;
  }
  .logo-ds {
    width: 52px; height: 52px;
    border-radius: 14px;
    background: #ffffff;
    border: 2px solid #D1D5DB;
    display: flex; align-items: center; justify-content: center;
    flex-shrink: 0;
  }
  .dots { display: flex; gap: 6px; align-items: center; }
  .dots span {
    display: block; width: 5px; height: 5px;
    background: #9CA3AF; border-radius: 50%;
  }

  /* Card */
  .card {
    width: 100%;
    max-width: 448px;
    background: #ffffff;
    border: 1px solid #E5E7EB;
    border-radius: 20px;
    padding: 32px;
    box-shadow: 0 1px 2px rgba(0,0,0,0.06), 0 4px 16px rgba(77,107,254,0.07), 0 16px 48px rgba(0,0,0,0.06);
  }
  h1 {
    font-size: 24px; font-weight: 700;
    margin: 0 0 10px;
    letter-spacing: -0.03em;
    text-align: center; color: #111827;
  }
  .subtitle {
    font-size: 14px; color: #6B7280;
    text-align: center; margin: 0 0 24px;
    line-height: 1.6;
  }

  /* Permissions list */
  .perms {
    list-style: none; margin: 0 0 18px; padding: 0;
    border: 1px solid #E5E7EB; border-radius: 12px; overflow: hidden;
  }
  .perms li {
    display: flex; align-items: center; gap: 14px;
    padding: 14px 16px; border-bottom: 1px solid #F3F4F6;
  }
  .perms li:last-child { border-bottom: none; }
  .perm-icon {
    flex-shrink: 0; width: 36px; height: 36px; border-radius: 8px;
    background: #F3F4F6; display: flex; align-items: center; justify-content: center;
    color: #374151;
  }
  .perm-text strong { display: block; color: #111827; font-size: 14px; font-weight: 600; margin-bottom: 1px; }
  .perm-text span   { color: #6B7280; font-size: 13px; }

  /* Revoke note */
  .revoke-note {
    display: flex; align-items: center; gap: 7px;
    font-size: 13px; color: #6B7280; margin-bottom: 24px;
  }

  /* Buttons */
  .actions { display: flex; gap: 10px; }
  .btn {
    flex: 1; padding: 12px 16px; border-radius: 10px;
    font-size: 15px; font-weight: 600; cursor: pointer;
    letter-spacing: -0.01em; border: none;
    transition: opacity 0.14s;
  }
  .btn-cancel { background: #ffffff; color: #374151; border: 1.5px solid #D1D5DB; }
  .btn-cancel:hover { background: #F9FAFB; }
  .btn-auth   { background: #111827; color: #ffffff; }
  .btn-auth:hover    { opacity: 0.85; }
  .btn-auth:disabled { opacity: 0.5; cursor: default; }

  /* ── Step 2: auto-flow panel ── */
  #step2 { display: none; margin-top: 20px; }
  #step2.visible { display: block; }

  /* Copied-to-clipboard badge */
  .copied-badge {
    display: flex; align-items: center; gap: 7px;
    background: #F0FDF4; border: 1px solid #BBF7D0;
    border-radius: 8px; padding: 9px 12px;
    font-size: 13px; color: #15803D; font-weight: 500;
    margin-bottom: 14px;
  }
  .copied-badge svg { flex-shrink: 0; color: #16A34A; }

  /* Step indicators */
  .steps { display: flex; flex-direction: column; gap: 10px; margin-bottom: 16px; }
  .step  { display: flex; align-items: flex-start; gap: 10px; font-size: 13px; color: #374151; }
  .step-num {
    flex-shrink: 0; width: 20px; height: 20px; border-radius: 50%;
    background: ${BRAND}; color: #fff;
    font-size: 11px; font-weight: 700;
    display: flex; align-items: center; justify-content: center;
  }
  .step-text { line-height: 1.5; padding-top: 2px; }
  .step-text strong { color: #111827; }

  /* Waiting indicator */
  .waiting {
    display: flex; align-items: center; gap: 8px;
    font-size: 12px; color: #6B7280;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
  .spinner {
    width: 14px; height: 14px;
    border: 2px solid #E5E7EB; border-top-color: ${BRAND};
    border-radius: 50%; animation: spin 0.8s linear infinite;
    flex-shrink: 0;
  }

  /* Fallback toggle */
  .fallback-toggle {
    margin-top: 14px;
    font-size: 12px; color: #9CA3AF; text-align: center;
  }
  .fallback-toggle button {
    background: none; border: none; color: #6B7280;
    font-size: 12px; cursor: pointer; text-decoration: underline; padding: 0;
  }
  .fallback-toggle button:hover { color: ${BRAND}; }

  /* Fallback: manual cookie paste */
  #fallback { display: none; margin-top: 14px; }
  #fallback.visible { display: block; }
  .snippet-box {
    background: #F9FAFB; border: 1px solid #E5E7EB; border-radius: 8px;
    padding: 10px 44px 10px 12px;
    font-family: ui-monospace,"SFMono-Regular",Menlo,Consolas,monospace;
    font-size: 11px; color: ${BRAND}; word-break: break-all; line-height: 1.55;
    position: relative; margin-bottom: 12px;
  }
  .copy-btn {
    position: absolute; top: 7px; right: 8px;
    background: #E5E7EB; border: none; border-radius: 5px;
    color: #374151; font-size: 11px; font-weight: 600;
    padding: 3px 9px; cursor: pointer;
  }
  .copy-btn:hover { background: #D1D5DB; }
  .divider {
    display: flex; align-items: center; gap: 10px;
    margin: 12px 0; color: #9CA3AF; font-size: 11px;
  }
  .divider hr { flex: 1; border: none; border-top: 1px solid #E5E7EB; margin: 0; }
  label {
    display: block; font-size: 11px; color: #6B7280;
    text-transform: uppercase; letter-spacing: 0.07em;
    margin-bottom: 5px; font-weight: 700;
  }
  textarea {
    width: 100%; min-height: 80px;
    background: #F9FAFB; border: 1px solid #E5E7EB; border-radius: 8px;
    color: #111827;
    font-family: ui-monospace,"SFMono-Regular",Menlo,Consolas,monospace;
    font-size: 12px; padding: 10px 12px; resize: vertical; outline: none;
  }
  textarea:focus { border-color: ${BRAND}; box-shadow: 0 0 0 3px rgba(77,107,254,0.1); }
  .paste-submit {
    margin-top: 10px; width: 100%;
    background: #111827; color: #fff; border: none; border-radius: 8px;
    padding: 10px; font-size: 13px; font-weight: 600; cursor: pointer;
  }
  .paste-submit:hover { opacity: 0.85; }
  kbd {
    background: #F3F4F6; border: 1px solid #D1D5DB; border-radius: 4px;
    padding: 1px 5px; font-family: ui-monospace,monospace; font-size: 11px; color: #374151;
  }

  /* Error / success */
  .error {
    background: #FEF2F2; border: 1px solid #FECACA; color: #DC2626;
    padding: 10px 14px; border-radius: 9px; font-size: 13px; margin-bottom: 16px;
  }
  .success {
    background: #EEF2FF; border: 1px solid rgba(77,107,254,0.4); color: #3730A3;
    padding: 24px 20px; border-radius: 12px; font-size: 14px;
    line-height: 1.65; text-align: center;
  }
  .success strong { color: #1e40af; }

  /* Footer */
  .footer {
    margin-top: 22px; color: #9CA3AF; font-size: 12px;
    text-align: center; line-height: 1.65;
  }
  .footer a { color: #6B7280; text-decoration: underline; }
  .footer a:hover { color: ${BRAND}; }
`;

// Bookmarklet — hidden form POST avoids CORS preflight entirely.
function makeSnippet(submitUrl: string): string {
  return (
    `javascript:(function(){` +
    `var f=document.createElement('form');` +
    `f.method='POST';` +
    `f.action=${JSON.stringify(submitUrl)};` +
    `f.enctype='application/x-www-form-urlencoded';` +
    `var i=document.createElement('input');` +
    `i.type='hidden';i.name='cookie';i.value=document.cookie;` +
    `f.appendChild(i);document.body.appendChild(f);f.submit();` +
    `})()`
  );
}

export function authorizePage(opts: AuthorizePageOpts, submitUrl = 'http://127.0.0.1:31337/authorize/submit'): string {
  const { error, success } = opts;
  const snippetStr = makeSnippet(submitUrl);

  let mainContent: string;

  if (success) {
    mainContent = `
      <div class="success">
        <strong>Authorization complete.</strong><br><br>
        You can close this tab and return to your terminal.<br>
        DeepSeek CLI is now connected to your account.
      </div>`;
  } else {
    const snippetDisplay = snippetStr
      .replace('javascript:', '')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    mainContent = `
      ${error ? `<div class="error">${escapeHtml(error)}</div>` : ''}

      <ul class="perms">
        <li>
          <div class="perm-icon">${ICON_USER}</div>
          <div class="perm-text">
            <strong>Account Information</strong>
            <span>View your account details and profile</span>
          </div>
        </li>
        <li>
          <div class="perm-icon">${ICON_CHAT}</div>
          <div class="perm-text">
            <strong>Conversations</strong>
            <span>View and manage your conversations</span>
          </div>
        </li>
        <li>
          <div class="perm-icon">${ICON_TOOL}</div>
          <div class="perm-text">
            <strong>Usage Information</strong>
            <span>View your usage and billing information</span>
          </div>
        </li>
      </ul>

      <div class="revoke-note">
        ${ICON_LOCK}
        You can revoke access at any time from your account settings.
      </div>

      <div class="actions">
        <button class="btn btn-cancel" onclick="window.close()">Cancel</button>
        <button class="btn btn-auth" id="authBtn" onclick="handleAuth()">Authorize</button>
      </div>

      <!-- Step 2: shown after clicking Authorize -->
      <div id="step2">
        <div class="copied-badge">
          ${ICON_CHECK}
          Snippet copied to clipboard — just paste it in the console
        </div>

        <div class="steps">
          <div class="step">
            <div class="step-num">1</div>
            <div class="step-text">
              Switch to the <strong>DeepSeek</strong> tab that just opened
              (log in first if prompted)
            </div>
          </div>
          <div class="step">
            <div class="step-num">2</div>
            <div class="step-text">
              Open DevTools: press <kbd>F12</kbd> and click the <strong>Console</strong> tab
            </div>
          </div>
          <div class="step">
            <div class="step-num">3</div>
            <div class="step-text">
              Paste (<kbd>Ctrl+V</kbd> / <kbd>⌘V</kbd>) and press <kbd>Enter</kbd>
              — authorization completes automatically
            </div>
          </div>
        </div>

        <div class="waiting" id="waitingMsg">
          <div class="spinner"></div>
          Waiting for authorization…
        </div>

        <div class="fallback-toggle">
          <button onclick="toggleFallback()">Having trouble? Paste cookie manually</button>
        </div>

        <div id="fallback">
          <div style="margin-bottom:8px">
            <div style="font-size:12px;color:#6B7280;margin-bottom:6px">
              Or re-copy the console snippet:
            </div>
            <div class="snippet-box">
              <button class="copy-btn" onclick="copySnippet()">Copy</button>
              <span id="snippetText">${snippetDisplay}</span>
            </div>
          </div>

          <div class="divider"><hr>or paste raw cookie<hr></div>

          <form method="POST" action="/authorize/submit">
            <label for="cookie">Session cookie</label>
            <textarea id="cookie" name="cookie"
              placeholder="Paste the full Cookie header from DevTools → Network → any request to chat.deepseek.com/api/…"
              required></textarea>
            <button type="submit" class="paste-submit">Submit cookie</button>
          </form>
        </div>
      </div>`;
  }

  const js = success ? '' : `
<script>
  var SNIPPET = ${JSON.stringify(snippetStr)};
  var fallbackVisible = false;

  function handleAuth() {
    // 1. Copy snippet to clipboard automatically.
    navigator.clipboard.writeText(SNIPPET).catch(function() {
      // Clipboard API blocked (non-HTTPS/non-localhost) — silent; user can copy manually.
    });

    // 2. Open DeepSeek in new tab.
    window.open(${JSON.stringify(DS_URL)}, '_blank');

    // 3. Reveal step-2 panel and update button state.
    document.getElementById('step2').classList.add('visible');
    var btn = document.getElementById('authBtn');
    btn.textContent = 'Waiting…';
    btn.disabled = true;

    // 4. Poll /healthz every 2 s; reload when server confirms authed.
    setInterval(function() {
      fetch('/healthz').then(function(r) { return r.text(); }).then(function(t) {
        if (t === 'authed') location.reload();
      }).catch(function() {});
    }, 2000);
  }

  function toggleFallback() {
    fallbackVisible = !fallbackVisible;
    var el = document.getElementById('fallback');
    if (fallbackVisible) el.classList.add('visible');
    else el.classList.remove('visible');
  }

  function copySnippet() {
    var text = document.getElementById('snippetText').innerText;
    navigator.clipboard.writeText(text).then(function() {
      var btn = document.querySelector('.copy-btn');
      btn.textContent = 'Copied!';
      setTimeout(function() { btn.textContent = 'Copy'; }, 1500);
    });
  }
</script>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Authorize DeepSeek CLI</title>
<style>${CSS}</style>
</head>
<body>

  <div class="brand-name">DeepSeek</div>

  <div class="logos">
    <div class="logo-ds">${DS_LOGO_IMG}</div>
    ${DOTS}
    ${CLI_ICON}
  </div>

  <div class="card">
    <h1>Authorize DeepSeek CLI</h1>
    <p class="subtitle">
      <strong>DeepSeek CLI</strong> is requesting permission to access your<br>
      DeepSeek account.
    </p>
    ${mainContent}
  </div>

  <div class="footer">
    By authorizing, you agree to DeepSeek's
    <a href="https://deepseek.com/privacy" target="_blank">Privacy Policy</a>
    and
    <a href="https://deepseek.com/terms" target="_blank">Terms of Service</a>.
  </div>

${js}
</body>
</html>`;
}
