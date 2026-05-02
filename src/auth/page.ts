// Self-contained HTML page served at /authorize.
//
// Layout mirrors the Claude CLI authorization page:
//   - DeepSeek + CLI logos with arrow connectors
//   - Permission list with icons
//   - Two-step flow: "Open DeepSeek" → cookie auto-post or manual paste
//   - CORS-enabled /authorize/submit so a JS snippet running on
//     chat.deepseek.com can POST the cookie cross-origin
//
// No external assets or JS framework — everything inline.

export interface AuthorizePageOpts {
  error?: string;
  success?: boolean;
}

const BRAND = '#4D6BFE';
const DS_URL = 'https://chat.deepseek.com';

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Inline SVG icons (24×24 viewBox). */
const ICON_USER = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>`;
const ICON_CHAT = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`;
const ICON_TOOL = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>`;
const ICON_SHIELD = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`;

/** DS whale logo (simplified outline). */
const LOGO_DS = `<svg width="40" height="40" viewBox="0 0 40 40" fill="none">
  <rect width="40" height="40" rx="10" fill="#1A1D2E"/>
  <text x="20" y="26" text-anchor="middle" font-size="20" fill="${BRAND}">🐋</text>
</svg>`;
const LOGO_CLI = `<svg width="40" height="40" viewBox="0 0 40 40" fill="none">
  <rect width="40" height="40" rx="10" fill="#1A1D2E"/>
  <text x="20" y="26" text-anchor="middle" font-size="18" fill="#7EC8A4">&gt;_</text>
</svg>`;
const ARROW_SVG = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#555e7a" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M12 5l7 7-7 7"/></svg>`;

const CSS = `
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; height: 100%; }
  body {
    background: #0b0d12;
    color: #e6e8ee;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Roboto, sans-serif;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    min-height: 100vh;
    padding: 24px;
  }
  .brand-name {
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.15em;
    color: #9aa1b2;
    text-transform: uppercase;
    margin-bottom: 20px;
  }
  .logos {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 24px;
  }
  .card {
    width: 100%;
    max-width: 460px;
    background: #14171f;
    border: 1px solid #232838;
    border-radius: 16px;
    padding: 32px;
    box-shadow: 0 20px 60px rgba(0,0,0,0.5);
  }
  h1 {
    font-size: 22px;
    font-weight: 700;
    margin: 0 0 8px;
    letter-spacing: -0.02em;
    text-align: center;
  }
  .subtitle {
    font-size: 14px;
    color: #9aa1b2;
    text-align: center;
    margin: 0 0 24px;
    line-height: 1.55;
  }
  .perms {
    list-style: none;
    margin: 0 0 24px;
    padding: 0;
    border: 1px solid #232838;
    border-radius: 10px;
    overflow: hidden;
  }
  .perms li {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    padding: 14px 16px;
    border-bottom: 1px solid #1c2030;
    font-size: 13px;
    line-height: 1.4;
  }
  .perms li:last-child { border-bottom: none; }
  .perm-icon {
    flex-shrink: 0;
    width: 32px;
    height: 32px;
    border-radius: 8px;
    background: #1c2030;
    display: flex;
    align-items: center;
    justify-content: center;
    color: ${BRAND};
  }
  .perm-text strong { display: block; color: #e6e8ee; font-size: 13px; font-weight: 600; }
  .perm-text span { color: #9aa1b2; font-size: 12px; }
  .revoke-note {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    color: #6c7388;
    margin-bottom: 24px;
  }
  .actions {
    display: flex;
    gap: 10px;
  }
  .btn {
    flex: 1;
    padding: 11px 16px;
    border-radius: 9px;
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    border: none;
    letter-spacing: 0.01em;
    transition: filter 0.15s;
  }
  .btn-cancel {
    background: #1c2030;
    color: #9aa1b2;
    border: 1px solid #2a3044;
  }
  .btn-cancel:hover { filter: brightness(1.2); }
  .btn-auth {
    background: ${BRAND};
    color: #fff;
  }
  .btn-auth:hover { filter: brightness(1.08); }

  /* Step 2: cookie-paste section, hidden by default */
  #step2 { display: none; margin-top: 20px; }
  #step2.visible { display: block; }
  .step2-title {
    font-size: 13px;
    font-weight: 600;
    color: #e6e8ee;
    margin: 0 0 8px;
  }
  .snippet-box {
    background: #0b0d12;
    border: 1px solid #2a3044;
    border-radius: 8px;
    padding: 10px 12px;
    font-family: ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace;
    font-size: 11px;
    color: #8bbcff;
    word-break: break-all;
    line-height: 1.5;
    margin-bottom: 12px;
    position: relative;
  }
  .copy-btn {
    position: absolute;
    top: 6px;
    right: 6px;
    background: #2a3044;
    border: none;
    border-radius: 4px;
    color: #9aa1b2;
    font-size: 11px;
    padding: 2px 8px;
    cursor: pointer;
  }
  .copy-btn:hover { background: #38405a; }
  .divider {
    display: flex;
    align-items: center;
    gap: 10px;
    margin: 12px 0;
    color: #4a5168;
    font-size: 11px;
  }
  .divider hr { flex: 1; border: none; border-top: 1px solid #232838; margin: 0; }
  label {
    display: block;
    font-size: 11px;
    color: #9aa1b2;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    margin-bottom: 6px;
    font-weight: 600;
  }
  textarea {
    width: 100%;
    min-height: 80px;
    background: #0b0d12;
    border: 1px solid #2a3044;
    border-radius: 8px;
    color: #e6e8ee;
    font-family: ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace;
    font-size: 12px;
    padding: 10px 12px;
    resize: vertical;
    outline: none;
  }
  textarea:focus { border-color: ${BRAND}; }
  .paste-submit {
    margin-top: 10px;
    width: 100%;
    background: ${BRAND};
    color: #fff;
    border: none;
    border-radius: 8px;
    padding: 10px;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
  }
  .paste-submit:hover { filter: brightness(1.08); }

  .error {
    background: rgba(220,70,70,0.1);
    border: 1px solid rgba(220,70,70,0.35);
    color: #ff8b8b;
    padding: 10px 12px;
    border-radius: 8px;
    font-size: 13px;
    margin-bottom: 16px;
  }
  .success {
    background: rgba(77,107,254,0.1);
    border: 1px solid ${BRAND};
    color: #c0d0ff;
    padding: 16px;
    border-radius: 10px;
    font-size: 14px;
    line-height: 1.5;
    text-align: center;
  }
  .footer {
    margin-top: 20px;
    color: #4a5168;
    font-size: 11px;
    text-align: center;
  }
  .footer a { color: #6c7388; text-decoration: underline; }
  .waiting {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 12px;
    color: #9aa1b2;
    margin-top: 12px;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
  .spinner {
    width: 14px; height: 14px;
    border: 2px solid #2a3044;
    border-top-color: ${BRAND};
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
    flex-shrink: 0;
  }
`;

// The JS snippet the user runs in the DeepSeek tab's devtools console.
// Uses a plain form POST (no fetch) to avoid CORS complexity entirely.
function makeSnippet(submitUrl: string): string {
  // Escape for JS string literal embedding
  return `javascript:(function(){var f=document.createElement('form');f.method='POST';f.action='${submitUrl}';f.enctype='application/x-www-form-urlencoded';var i=document.createElement('input');i.type='hidden';i.name='cookie';i.value=document.cookie;f.appendChild(i);document.body.appendChild(f);f.submit();})()`;
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
        DeepSeek CLI is now connected.
      </div>
    `;
  } else {
    const snippetDisplay = snippetStr.replace('javascript:', '').replace(/</g, '&lt;').replace(/>/g, '&gt;');

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
            <span>Create and manage AI conversations on your behalf</span>
          </div>
        </li>
        <li>
          <div class="perm-icon">${ICON_TOOL}</div>
          <div class="perm-text">
            <strong>Tool Use</strong>
            <span>Run coding tools using the DeepSeek web API</span>
          </div>
        </li>
      </ul>

      <div class="revoke-note">
        ${ICON_SHIELD}
        You can revoke access at any time by running <code>/logout</code>
      </div>

      <div class="actions">
        <button class="btn btn-cancel" onclick="window.close()">Cancel</button>
        <button class="btn btn-auth" id="authBtn" onclick="handleAuth()">Authorize</button>
      </div>

      <div id="step2">
        <div class="step2-title">Step 1 — Log in to DeepSeek</div>
        <p style="font-size:12px;color:#9aa1b2;margin:0 0 12px;">
          A new tab will open to <strong>chat.deepseek.com</strong>. Log in if needed, then return here.
        </p>

        <div class="step2-title" style="margin-top:12px">Step 2 — Run this in the DeepSeek tab console</div>
        <p style="font-size:12px;color:#9aa1b2;margin:0 0 6px;">
          Press <kbd style="background:#1c2030;padding:1px 5px;border-radius:3px;font-size:11px">F12</kbd>
          → Console, paste the snippet, press Enter. It submits your session cookie automatically.
        </p>
        <div class="snippet-box" id="snippetBox">
          <button class="copy-btn" onclick="copySnippet()">Copy</button>
          <span id="snippetText">${snippetDisplay}</span>
        </div>

        <div class="divider"><hr>or paste cookie manually<hr></div>

        <form method="POST" action="/authorize/submit">
          <label for="cookie">Session cookie</label>
          <textarea id="cookie" name="cookie" placeholder="Paste your chat.deepseek.com Cookie header here…" required></textarea>
          <button type="submit" class="paste-submit">Submit cookie</button>
        </form>

        <div class="waiting" id="waitingMsg" style="display:none">
          <div class="spinner"></div>
          Waiting for authorization via console snippet…
        </div>
      </div>
    `;
  }

  const js = success ? '' : `
<script>
  var DS_URL = '${DS_URL}';
  var SNIPPET = ${JSON.stringify(snippetStr)};
  function handleAuth() {
    // Open DeepSeek in a new tab.
    window.open(DS_URL, '_blank');
    // Show step 2 instructions.
    document.getElementById('step2').classList.add('visible');
    document.getElementById('authBtn').textContent = 'Waiting…';
    document.getElementById('authBtn').disabled = true;
    document.getElementById('waitingMsg').style.display = 'flex';
    // Poll for success every 2s (server sets window.DS_AUTHED via SSE or
    // we simply reload; user paste path resolves without JS).
    var poll = setInterval(function() {
      fetch('/healthz').then(function(r){ return r.text(); }).then(function(t){
        if (t === 'authed') { clearInterval(poll); location.reload(); }
      }).catch(function(){});
    }, 2000);
  }
  function copySnippet() {
    var text = document.getElementById('snippetText').innerText;
    navigator.clipboard.writeText(text).then(function() {
      var btn = document.querySelector('.copy-btn');
      btn.textContent = 'Copied!';
      setTimeout(function(){ btn.textContent = 'Copy'; }, 1500);
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
    ${LOGO_DS}
    ${ARROW_SVG}
    ${LOGO_CLI}
  </div>
  <div class="card">
    <h1>Authorize DeepSeek CLI</h1>
    <p class="subtitle">DeepSeek CLI is requesting permission to access your DeepSeek account.</p>
    ${mainContent}
  </div>
  <div class="footer">
    Loopback only &middot; credentials are not transmitted off this machine.<br>
    <a href="https://deepseek.com/privacy" target="_blank">Privacy Policy</a> &middot; <a href="https://deepseek.com/terms" target="_blank">Terms of Service</a>
  </div>
${js}
</body>
</html>`;
}
