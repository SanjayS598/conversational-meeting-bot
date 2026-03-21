import { Router } from 'express';
import { config } from '../config';

const router = Router();

/**
 * GET /test
 * Dev-only: serves a simple HTML form to manually test joining a Zoom meeting.
 * Never mount this in production.
 */
router.get('/', (_req, res) => {
  const html = /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Zoom Gateway — Test</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: #0f0f0f;
      color: #e0e0e0;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .card {
      background: #1a1a1a;
      border: 1px solid #2a2a2a;
      border-radius: 12px;
      padding: 36px 40px;
      width: 100%;
      max-width: 480px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.5);
    }
    h1 { font-size: 1.2rem; font-weight: 600; margin-bottom: 24px; color: #fff; }
    .badge {
      display: inline-block;
      font-size: 0.65rem;
      font-weight: 700;
      letter-spacing: 0.08em;
      background: #2563eb22;
      color: #60a5fa;
      border: 1px solid #2563eb55;
      border-radius: 4px;
      padding: 2px 7px;
      margin-left: 8px;
      vertical-align: middle;
    }
    label { display: block; font-size: 0.8rem; color: #888; margin-bottom: 6px; }
    input {
      width: 100%;
      background: #111;
      border: 1px solid #333;
      border-radius: 8px;
      color: #e0e0e0;
      font-size: 0.95rem;
      padding: 10px 14px;
      outline: none;
      transition: border-color 0.15s;
      margin-bottom: 18px;
    }
    input:focus { border-color: #2563eb; }
    input::placeholder { color: #444; }
    button {
      width: 100%;
      background: #2563eb;
      color: #fff;
      border: none;
      border-radius: 8px;
      font-size: 0.95rem;
      font-weight: 600;
      padding: 12px;
      cursor: pointer;
      transition: background 0.15s;
    }
    button:hover { background: #1d4ed8; }
    button:disabled { background: #333; color: #666; cursor: not-allowed; }
    #log {
      margin-top: 24px;
      background: #111;
      border: 1px solid #222;
      border-radius: 8px;
      padding: 14px;
      font-size: 0.8rem;
      font-family: 'SF Mono', 'Fira Code', monospace;
      line-height: 1.6;
      min-height: 60px;
      max-height: 260px;
      overflow-y: auto;
      display: none;
    }
    .log-ok   { color: #4ade80; }
    .log-err  { color: #f87171; }
    .log-info { color: #60a5fa; }
    .log-dim  { color: #555; }
    #stop { background: #7f1d1d; display: none; margin-top: 10px; }
    #stop:hover { background: #991b1b; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Zoom Gateway <span class="badge">DEV TEST</span></h1>

    <label for="url">Meeting URL</label>
    <input id="url" type="url" placeholder="https://zoom.us/j/1234567890?pwd=abc" />

    <label for="passcode">Passcode <span style="color:#555">(optional)</span></label>
    <input id="passcode" type="text" placeholder="123456" />

    <label for="name">Bot display name</label>
    <input id="name" type="text" placeholder="${config.botDisplayName}" value="${config.botDisplayName}" />

    <button id="joinBtn">Join Meeting</button>
    <button id="stop">Leave / Stop</button>

    <div id="log"></div>
  </div>

  <script>
    const TOKEN = '${config.internalServiceSecret}';
    const BASE  = window.location.origin;
    let sessionId = null;

    const url       = document.getElementById('url');
    const passcode  = document.getElementById('passcode');
    const nameInput = document.getElementById('name');
    const joinBtn   = document.getElementById('joinBtn');
    const stopBtn   = document.getElementById('stop');
    const log       = document.getElementById('log');

    function addLog(text, cls = 'log-info') {
      log.style.display = 'block';
      const ts = new Date().toLocaleTimeString();
      log.insertAdjacentHTML('beforeend',
        '<div class="log-dim">[' + ts + ']</div>' +
        '<div class="' + cls + '">' + text + '</div>'
      );
      log.scrollTop = log.scrollHeight;
    }

    joinBtn.addEventListener('click', async () => {
      const meetingUrl = url.value.trim();
      if (!meetingUrl) { addLog('Meeting URL is required', 'log-err'); return; }

      joinBtn.disabled = true;
      joinBtn.textContent = 'Joining…';
      log.innerHTML = '';
      addLog('Starting session…');

      try {
        const body = {
          meeting_session_id: 'test-' + Date.now(),
          user_id: 'dev-test-user',
          meeting_url: meetingUrl,
        };
        if (passcode.value.trim()) body.passcode = passcode.value.trim();
        if (nameInput.value.trim()) body.bot_display_name = nameInput.value.trim();

        const res = await fetch(BASE + '/sessions/start', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-internal-token': TOKEN,
          },
          body: JSON.stringify(body),
        });

        const data = await res.json();

        if (!res.ok) {
          addLog('Error ' + res.status + ': ' + (data.error ?? 'Unknown'), 'log-err');
          joinBtn.disabled = false;
          joinBtn.textContent = 'Join Meeting';
          return;
        }

        sessionId = data.id;
        addLog('Session created: ' + sessionId, 'log-ok');
        addLog('Status: ' + data.status + ' — bot is joining in background…', 'log-info');
        joinBtn.textContent = 'Joining…';
        stopBtn.style.display = 'block';

        // Poll for status
        const poll = setInterval(async () => {
          try {
            const r = await fetch(BASE + '/sessions/' + sessionId + '/status', {
              headers: { 'x-internal-token': TOKEN },
            });
            const s = await r.json();
            addLog('Status update: ' + s.status);
            if (s.status === 'joined') {
              clearInterval(poll);
              addLog('Bot joined the meeting!', 'log-ok');
              joinBtn.textContent = 'In meeting';
            } else if (s.status === 'failed' || s.status === 'ended') {
              clearInterval(poll);
              addLog('Session ' + s.status + (s.error ? ': ' + s.error : ''), 'log-err');
              joinBtn.disabled = false;
              joinBtn.textContent = 'Join Meeting';
              stopBtn.style.display = 'none';
              sessionId = null;
            }
          } catch { clearInterval(poll); }
        }, 3000);

      } catch (err) {
        addLog('Fetch error: ' + err.message, 'log-err');
        joinBtn.disabled = false;
        joinBtn.textContent = 'Join Meeting';
      }
    });

    stopBtn.addEventListener('click', async () => {
      if (!sessionId) return;
      stopBtn.disabled = true;
      addLog('Stopping session ' + sessionId + '…');
      try {
        await fetch(BASE + '/sessions/' + sessionId + '/stop', {
          method: 'POST',
          headers: { 'x-internal-token': TOKEN },
        });
        addLog('Session stopped.', 'log-ok');
      } catch (err) {
        addLog('Stop error: ' + err.message, 'log-err');
      }
      joinBtn.disabled = false;
      joinBtn.textContent = 'Join Meeting';
      stopBtn.style.display = 'none';
      stopBtn.disabled = false;
      sessionId = null;
    });
  </script>
</body>
</html>`;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
});

export default router;
