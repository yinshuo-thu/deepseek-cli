// Self-contained HTML page served at /authorize.
//
// Visual layout: centered card on a dark background, brand colour #4D6BFE.
// No JS framework, no external assets — everything inline.

export interface AuthorizePageOpts {
  error?: string;
  success?: boolean;
}

const BRAND = '#4D6BFE';

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function authorizePage(opts: AuthorizePageOpts): string {
  const { error, success } = opts;

  const css = `
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; height: 100%; }
    body {
      background: #0b0d12;
      color: #e6e8ee;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Roboto, sans-serif;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      padding: 24px;
    }
    .card {
      width: 100%;
      max-width: 520px;
      background: #14171f;
      border: 1px solid #232838;
      border-radius: 14px;
      padding: 32px;
      box-shadow: 0 18px 60px rgba(0, 0, 0, 0.45);
    }
    .brand-dot {
      display: inline-block;
      width: 10px;
      height: 10px;
      border-radius: 50%;
      background: ${BRAND};
      margin-right: 8px;
      vertical-align: middle;
    }
    h1 {
      font-size: 20px;
      margin: 0 0 8px 0;
      font-weight: 600;
      letter-spacing: -0.01em;
    }
    p.lead {
      margin: 0 0 20px 0;
      color: #9aa1b2;
      font-size: 14px;
      line-height: 1.55;
    }
    ol.steps {
      margin: 0 0 20px 0;
      padding-left: 20px;
      color: #c2c7d4;
      font-size: 13px;
      line-height: 1.6;
    }
    ol.steps code {
      background: #1c2030;
      padding: 1px 6px;
      border-radius: 4px;
      font-size: 12px;
      color: #e6e8ee;
    }
    label {
      display: block;
      font-size: 12px;
      color: #9aa1b2;
      margin-bottom: 6px;
      text-transform: uppercase;
      letter-spacing: 0.06em;
    }
    textarea {
      width: 100%;
      min-height: 120px;
      background: #0b0d12;
      border: 1px solid #2a3044;
      border-radius: 8px;
      color: #e6e8ee;
      font-family: ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace;
      font-size: 13px;
      padding: 10px 12px;
      resize: vertical;
      outline: none;
    }
    textarea:focus { border-color: ${BRAND}; }
    button {
      margin-top: 16px;
      width: 100%;
      background: ${BRAND};
      color: #ffffff;
      border: none;
      border-radius: 8px;
      padding: 12px 16px;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      letter-spacing: 0.01em;
    }
    button:hover { filter: brightness(1.06); }
    .error {
      background: rgba(220, 70, 70, 0.12);
      border: 1px solid rgba(220, 70, 70, 0.4);
      color: #ff8b8b;
      padding: 10px 12px;
      border-radius: 8px;
      font-size: 13px;
      margin-bottom: 16px;
    }
    .success {
      background: rgba(77, 107, 254, 0.12);
      border: 1px solid ${BRAND};
      color: #cbd4ff;
      padding: 14px 16px;
      border-radius: 8px;
      font-size: 14px;
      line-height: 1.5;
    }
    .footer {
      margin-top: 18px;
      color: #6c7388;
      font-size: 12px;
      text-align: center;
    }
  `;

  let body: string;
  if (success) {
    body = `
      <div class="success">
        <strong>You are authorized.</strong><br>
        You can close this tab and return to your terminal.
      </div>
      <p class="footer">DeepSeek-CLI is now logged in.</p>
    `;
  } else {
    body = `
      ${error ? `<div class="error">${escapeHtml(error)}</div>` : ''}
      <p class="lead">
        Paste your DeepSeek web session cookie below. DeepSeek-CLI will use it
        to talk to <code>chat.deepseek.com</code> on your behalf. The cookie
        is stored locally on this machine only.
      </p>
      <ol class="steps">
        <li>Open <code>chat.deepseek.com</code> in your browser and log in.</li>
        <li>Open DevTools and go to <code>Application</code> &rarr; <code>Cookies</code> &rarr; <code>chat.deepseek.com</code>.</li>
        <li>Copy the full <code>Cookie</code> header (or the <code>userToken</code> value) and paste it here.</li>
      </ol>
      <form method="POST" action="/authorize/submit">
        <label for="cookie">Session cookie</label>
        <textarea id="cookie" name="cookie" placeholder="paste cookie here" autofocus required></textarea>
        <button type="submit">Authorize DeepSeek-CLI</button>
      </form>
      <p class="footer">Loopback only &middot; not transmitted off this machine.</p>
    `;
  }

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Authorize DeepSeek-CLI</title>
<style>${css}</style>
</head>
<body>
  <div class="card">
    <h1><span class="brand-dot"></span>Authorize DeepSeek-CLI</h1>
    ${body}
  </div>
</body>
</html>`;
}
