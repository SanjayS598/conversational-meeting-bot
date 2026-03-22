/**
 * ZoomJoiner — Puppeteer-based Zoom web-client bot.
 *
 * Design principles
 * ─────────────────
 * • Fully headless: no visible Chrome window, no human interaction required.
 * • Audio-only: camera is completely disabled at both the Chrome-flag level
 *   and inside getUserMedia; no video track is ever sent.
 * • ElementHandle-based interaction: we hold the DOM handle returned by the
 *   frame search so we never lose it by re-querying after finding.
 * • Frame-aware: Zoom's join form can be inside an <iframe>; we search every
 *   frame on the page every 500 ms.
 * • Wide fallback selectors: if Zoom updates their UI, we fall back to
 *   inspecting all <input> / <button> elements for matching text/attributes.
 */

import puppeteer, {
  type Browser,
  type Page,
  type Frame,
  type ElementHandle,
} from 'puppeteer';
import os from 'os';
import path from 'path';
import { config } from '../config';
import { parseZoomUrl } from '../utils/zoom-url';
import type { SessionStatus } from '../types/index';

// ---------------------------------------------------------------------------
// AudioWorklet processor for capturing inbound meeting audio.
// Defined as a separate constant so it can be JSON-embedded into PRELOAD_SCRIPT
// without creating a nested template literal (which TypeScript can't parse).
// Buffers Float32 samples and posts Int16 chunks every 100 ms (1600 samples @ 16 kHz).
// ---------------------------------------------------------------------------
const AUDIO_WORKLET_CODE = [
  'class CaptureProcessor extends AudioWorkletProcessor {',
  '  constructor() { super(); this._buf = []; }',
  '  process(inputs) {',
  '    const ch = inputs[0]?.[0]; if (!ch) return true;',
  '    for (let i = 0; i < ch.length; i++) this._buf.push(ch[i]);',
  '    const CHUNK = 1600;',
  '    while (this._buf.length >= CHUNK) {',
  '      const f32 = this._buf.splice(0, CHUNK);',
  '      const i16 = new Int16Array(CHUNK);',
  '      for (let i = 0; i < CHUNK; i++)',
  '        i16[i] = Math.max(-32768, Math.min(32767, f32[i] * 32768));',
  '      this.port.postMessage(i16.buffer, [i16.buffer]);',
  '    }',
  '    return true;',
  '  }',
  '}',
  "registerProcessor('zoom-capture', CaptureProcessor);",
].join('\n');

// ---------------------------------------------------------------------------
// Preload script — injected into EVERY frame before any page JS runs.
//
//  1. Stealth   — hides Puppeteer/headless fingerprints.
//  2. Capture   — hooks RTCPeerConnection to stream inbound audio to Node.js.
//  3. Inject    — overrides getUserMedia so Zoom's mic track is our TTS stream.
//               — BLOCKS all video: returns no video tracks for any request.
// ---------------------------------------------------------------------------
const PRELOAD_SCRIPT = /* js */ `
(function () {
  'use strict';

  /* ── 1. Stealth ─────────────────────────────────────────────────────────── */
  try {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    Object.defineProperty(navigator, 'plugins', {
      get: () => Object.assign([1, 2, 3, 4, 5], { refresh: () => {} }),
    });
    Object.defineProperty(navigator, 'languages', {
      get: () => ['en-US', 'en'],
    });
    window.chrome = window.chrome || {
      runtime: {}, loadTimes: () => {}, csi: () => {}, app: {},
    };
  } catch (_) {}

  /* ── 2. Capture: incoming meeting audio → Node.js ───────────────────────── */
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    console.log('[ZG] AudioContext available:', !!Ctx, 'RTCPeerConnection available:', !!window.RTCPeerConnection);
    if (Ctx && window.RTCPeerConnection) {
      const captureCtx = new Ctx({ sampleRate: 16000 });
      console.log('[ZG] captureCtx created state:', captureCtx.state, 'sampleRate:', captureCtx.sampleRate, 'audioWorklet:', !!captureCtx.audioWorklet);

      // AUDIO_WORKLET_CODE is JSON-embedded at build time to avoid nested backtick
      // syntax inside this template literal. The blob URL approach lets us load the
      // processor without needing a separate file served from a URL.
      const workletCode = ${JSON.stringify(AUDIO_WORKLET_CODE)};
      const blobUrl = URL.createObjectURL(
        new Blob([workletCode], { type: 'application/javascript' })
      );
      console.log('[ZG] AudioWorklet blob URL created:', blobUrl.slice(0, 30) + '...');

      // ONE shared capture node — all audio tracks are mixed by the AudioContext
      // before reaching the worklet. Creating a new node per-track was sending 3x
      // the audio data to Deepgram as incoherent interleaved chunks.
      let _sharedCaptureNode = null;
      let _captureNodePromise = null; // guards against concurrent track-event race
      let _chunksEmitted = 0;
      let _activePCCount = 0;
      window.__captureCtxState = captureCtx.state;

      function _ensureCaptureNode() {
        if (_sharedCaptureNode) return Promise.resolve(_sharedCaptureNode);
        if (_captureNodePromise) return _captureNodePromise;  // reuse in-flight promise
        _captureNodePromise = (async () => {
          // ── Try AudioWorklet first (preferred: no UI thread jank) ──────────
          if (captureCtx.audioWorklet) {
            try {
              await captureCtx.audioWorklet.addModule(blobUrl);
              console.log('[ZG] AudioWorklet module loaded OK');
              const wNode = new AudioWorkletNode(captureCtx, 'zoom-capture');
              wNode.port.onmessage = (e) => {
                const i16 = new Int16Array(e.data);
                _chunksEmitted++;
                if (_chunksEmitted === 1 || _chunksEmitted % 100 === 0) {
                  console.log('[ZG] AudioWorklet chunk #' + _chunksEmitted + ' samples=' + i16.length);
                }
                if (window.__onAudioChunk) window.__onAudioChunk(Array.from(i16));
              };
              _sharedCaptureNode = wNode;
              console.log('[ZG] Using AudioWorklet for capture (shared node)');
              return _sharedCaptureNode;
            } catch (awe) {
              console.warn('[ZG] AudioWorklet failed, falling back to ScriptProcessorNode:', String(awe));
            }
          }
          // ── Fallback: ScriptProcessorNode (deprecated but reliable) ──────
          const spNode = captureCtx.createScriptProcessor(1024, 1, 1);
          spNode.onaudioprocess = (e) => {
            const f32 = e.inputBuffer.getChannelData(0);
            const i16 = new Int16Array(f32.length);
            for (let k = 0; k < f32.length; k++) {
              i16[k] = Math.max(-32768, Math.min(32767, f32[k] * 32768));
            }
            _chunksEmitted++;
            if (_chunksEmitted === 1 || _chunksEmitted % 100 === 0) {
              console.log('[ZG] ScriptProcessor chunk #' + _chunksEmitted + ' samples=' + f32.length);
            }
            if (window.__onAudioChunk) window.__onAudioChunk(Array.from(i16));
          };
          // ScriptProcessorNode must be connected to destination to fire
          spNode.connect(captureCtx.destination);
          _sharedCaptureNode = spNode;
          console.log('[ZG] Using ScriptProcessorNode for capture (shared node)');
          return _sharedCaptureNode;
        })();
        return _captureNodePromise;
      }

      const OrigPC = window.RTCPeerConnection;
      window.RTCPeerConnection = class extends OrigPC {
        constructor(...args) {
          super(...args);
          _activePCCount++;
          window.__activePCCount = _activePCCount;
          console.log('[ZG] RTCPeerConnection constructed total=' + _activePCCount);
          this.addEventListener('track', async (ev) => {
            console.log('[ZG] track event kind=' + ev.track.kind + ' readyState=' + ev.track.readyState);
            if (ev.track.kind !== 'audio') return;
            try {
              await captureCtx.resume();
              window.__captureCtxState = captureCtx.state;
              console.log('[ZG] captureCtx resumed state:', captureCtx.state);
              const captureNode = await _ensureCaptureNode();
              const src = captureCtx.createMediaStreamSource(new MediaStream([ev.track]));
              src.connect(captureNode);
              console.log('[ZG] audio track mixed into shared capture node id=' + ev.track.id);
            } catch (err) {
              console.error('[ZG] audio capture error', err);
            }
          });
        }
      };
      console.log('[ZG] RTCPeerConnection override installed');
    } else {
      console.error('[ZG] AudioContext or RTCPeerConnection not available — audio capture disabled');
    }
  } catch (err) {
    console.error('[ZG] RTCPeerConnection hook error', err);
  }

  /* ── 3. Inject: TTS mic + block camera ──────────────────────────────────── */
  try {
    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      const injectCtx = Ctx ? new Ctx({ sampleRate: 16000 }) : null;
      const injectDest = injectCtx ? injectCtx.createMediaStreamDestination() : null;

      if (injectDest) {
        window.__injectionStream = injectDest.stream;

        window.__injectAudio = function (i16arr) {
          try {
            const f32 = new Float32Array(i16arr.length);
            for (let k = 0; k < i16arr.length; k++) f32[k] = i16arr[k] / 32768;
            const buf = injectCtx.createBuffer(1, f32.length, 16000);
            buf.copyToChannel(f32, 0);
            // Must await resume() before starting the source — if the AudioContext
            // is 'suspended', src.start() will silently discard audio.
            injectCtx.resume().then(function () {
              var src = injectCtx.createBufferSource();
              src.buffer = buf;
              src.connect(injectDest);
              src.start();
              console.log('[ZG] __injectAudio played samples=' + i16arr.length + ' ctxState=' + injectCtx.state);
            }).catch(function (err) {
              console.error('[ZG] audio inject resume error', err);
            });
          } catch (err) {
            console.error('[ZG] audio inject error', err);
          }
        };
      }

      const origGUM = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);

      /**
       * getUserMedia override:
       *   • Audio requests → return our TTS injection stream (fake mic).
       *   • Video requests → return an empty MediaStream (camera BLOCKED).
       *   • Audio+Video    → still return audio-only injection stream.
       */
      navigator.mediaDevices.getUserMedia = async function (constraints) {
        // Block camera entirely — return empty stream for any video-only request
        if (constraints && constraints.video && !constraints.audio) {
          return new MediaStream();
        }

        // For audio requests, use our fake injection mic
        if (constraints && constraints.audio) {
          if (window.__injectionStream) {
            // Return only the audio tracks from our TTS stream
            return new MediaStream(window.__injectionStream.getAudioTracks());
          }
          // Fallback: let Chrome's fake device handle it (still no real mic)
          return origGUM({ audio: constraints.audio });
        }

        // Any other case — block
        return new MediaStream();
      };

      // Hide video input devices from device enumeration
      const origEnum = navigator.mediaDevices.enumerateDevices.bind(
        navigator.mediaDevices
      );
      navigator.mediaDevices.enumerateDevices = async function () {
        const devices = await origEnum();
        return devices.filter((d) => d.kind !== 'videoinput');
      };
    }
  } catch (err) {
    console.error('[ZG] getUserMedia override error', err);
  }
})();
`;

// ---------------------------------------------------------------------------
// Selectors tried in order across all frames.
// Broad fallback selectors are intentionally included at the end of each list.
// ---------------------------------------------------------------------------

/** All selectors that should find the "Display Name" input. */
const NAME_SELECTORS = [
  'input#inputname',
  'input[data-testid="inputname"]',
  'input.preview-name-input',
  'input[placeholder*="Name" i]',
  'input[placeholder*="Your name" i]',
  'input[aria-label*="name" i]',
  'input[name="inputname"]',
  // Very broad — last resort
  'input[type="text"]',
  'input:not([type])',
];

/** All selectors that should find the meeting passcode input. */
const PASSCODE_SELECTORS = [
  'input#inputpasscode',
  'input[data-testid="inputpasscode"]',
  'input[placeholder*="passcode" i]',
  'input[placeholder*="password" i]',
  'input[type="password"]',
];

/** All selectors that should find the "Join" button on the pre-join page. */
const JOIN_BTN_SELECTORS = [
  'button.preview-join-button',
  'button[data-btntype="join"]',
  'button#joinBtn',
  'button[data-testid="joinBtn"]',
];

/** All selectors for "Join Audio by Computer" dialog button. */
const AUDIO_BTN_SELECTORS = [
  'button.join-audio-by-voip__join-btn',
  'button[aria-label*="Join Audio by Computer" i]',
  '[data-testid="joinVoIPBtn"]',
  'button.join-audio__join-btn',
  'button.voip-button',
];

/** Submit button for the post-join passcode modal */
const PASSCODE_SUBMIT_SELECTORS = [
  'button.zm-btn--primary',
  'button[data-testid="passcodeSubmit"]',
  'button#submitPasscode',
];

/**
 * Selectors that indicate the bot is fully inside the meeting room
 * (i.e. the meeting toolbar is rendered and interactive).
 *
 * IMPORTANT: must NOT match elements on the pre-join form page.
 * Removed '.zm-btn' (matches Join button on pre-join form) and
 * '.footer' (matches copyright footer on every Zoom page).
 */
const IN_MEETING_SELECTORS = [
  'button[aria-label*="Mute" i]',
  'button[aria-label*="Unmute" i]',
  '.footer-button__button',
  '.meeting-app',
  '.\\35 a4-button',              // Zoom className that starts with a digit
  '[class*="footer-button"]',
  '[class*="meeting-footer"]',
];

/**
 * Text patterns that ONLY appear in Zoom's actual waiting room screen.
 * Deliberately excludes "please wait" — that phrase also appears in Zoom's
 * normal loading overlay while the meeting room is rendering, causing a
 * false-positive that blocks the bot indefinitely.
 */
const WAITING_ROOM_TEXT_PATTERNS = [
  /waiting for the host to start this meeting/i,
  /the host will let you in soon/i,
  /waiting for the host/i,
  /please wait, the meeting host will let you in/i,
];

/**
 * Selectors for modal dialogs that must be dismissed before the audio-join
 * button is accessible (e.g. camera-error, floating-reactions tooltip).
 */
const DISMISS_DIALOG_SELECTORS = [
  'button[aria-label="Close"]',
  'button[aria-label*="close" i]',
  'button.zm-btn--close',
  // "Cannot detect your camera" error — click OK to dismiss
  '.zm-modal-footer button.zm-btn--primary',
  '.zm-modal button.zm-btn',
  // Floating-reactions / feature announcement
  '.footer-chat__tooltip-close',
  '[class*="tooltip-close"]',
  '[class*="announcement"] button',
  '[class*="popover"] button',
  '[class*="dialog"] button',
  '[class*="modal"] button',
];

// ---------------------------------------------------------------------------

export interface CaptionEvent {
  speaker: string;
  text: string;
  elapsed_ms: number;
}

export interface ZoomJoinerCallbacks {
  onAudioChunk: (int16Array: number[]) => void;
  onStatusChange: (status: SessionStatus, error?: string) => void;
  onCaption?: (event: CaptionEvent) => void;
}

// ---------------------------------------------------------------------------

export class ZoomJoiner {
  private browser: Browser | null = null;
  private page: Page | null = null;
  private endMonitorTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly sessionId: string,
    private readonly callbacks: ZoomJoinerCallbacks,
  ) {}

  // ── Public API ────────────────────────────────────────────────────────────

  async join(
    meetingUrl: string,
    botDisplayName: string,
    passcode?: string,
  ): Promise<void> {
    const { meetingId, pwdHash, webClientUrl } = parseZoomUrl(meetingUrl);

    this.browser = await puppeteer.launch({
      headless: config.headless,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        // ── Media: fake audio device, camera completely off ──────────────
        '--use-fake-ui-for-media-stream',        // suppress permission dialogs
        '--use-fake-device-for-media-stream',    // fake mic — no real hardware
        '--disable-camera',                       // block camera device access
        '--disable-video-capture',               // block video capture pipeline
        // ── Stealth: hide browser automation fingerprints ────────────────
        '--disable-blink-features=AutomationControlled',
        '--disable-infobars',
        // ── Stability ────────────────────────────────────────────────────
        '--autoplay-policy=no-user-gesture-required',
        '--disable-features=IsolateOrigins,site-per-process',
        '--window-size=1280,800',
        '--lang=en-US',
      ],
      defaultViewport: { width: 1280, height: 800 },
    });

    this.page = await this.browser.newPage();

    // Forward browser console → Node.js so [ZG] audio errors are visible in Docker logs
    this.page.on('console', (msg) => {
      const text = msg.text();
      const type = msg.type();
      if (type === 'error' || text.includes('[ZG]')) {
        this.log(`[Browser:${type}] ${text}`);
      }
    });
    this.page.on('pageerror', (err) => {
      this.log(`[Browser:pageerror] ${err instanceof Error ? err.message : String(err)}`, 'error');
    });

    // Inject stealth + audio bridge before any page JS runs
    await this.page.evaluateOnNewDocument(PRELOAD_SCRIPT);

    // Bridge: page-captured audio → Node.js callback
    await this.page.exposeFunction(
      '__onAudioChunk',
      (int16Array: number[]) => this.callbacks.onAudioChunk(int16Array),
    );

    await this.page.setUserAgent(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ' +
        'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    );

    // Grant mic permission up front so Zoom's permission dialog never appears
    await this.browser
      .defaultBrowserContext()
      .overridePermissions('https://zoom.us', ['microphone']);

    this.callbacks.onStatusChange('joining');
    this.log(`Navigating to: ${webClientUrl}`);

    await this.page.goto(webClientUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });

    // Handle the "open in desktop app?" gateway if Zoom redirected there
    await this.handleGatewayPage(meetingId, pwdHash);

    // Hard 3-minute timeout — prevents the session hanging in 'joining' forever
    const joinTimeout = new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error('Join timed out after 3 minutes')),
        180_000,
      ),
    );

    await Promise.race([this.runJoinFlow(botDisplayName, passcode), joinTimeout]);

    this.callbacks.onStatusChange('joined');
    this.startEndMonitor();
  }

  async injectAudio(int16Array: number[]): Promise<void> {
    if (!this.page || this.page.isClosed()) return;
    try {
      const frame = this.safeMainFrame();
      if (!frame) return;
      await frame.evaluate((data: number[]) => {
        const w = window as unknown as { __injectAudio?: (d: number[]) => void };
        w.__injectAudio?.(data);
      }, int16Array);
    } catch (err) {
      this.log(`injectAudio error: ${err}`, 'error');
    }
  }

  async cleanup(): Promise<void> {
    if (this.endMonitorTimer) {
      clearInterval(this.endMonitorTimer);
      this.endMonitorTimer = null;
    }
    // Grab refs and null them immediately so re-entrant calls are no-ops
    const browser = this.browser;
    this.page = null;
    this.browser = null;
    try {
      // Close the whole browser (closes all pages) — skipping page.close() first
      // avoids hangs when the page is in a stuck/crashed state.
      if (browser) await browser.close();
    } catch (err) {
      this.log(`cleanup error: ${err}`, 'error');
    }
  }

  // ── Gateway page ──────────────────────────────────────────────────────────

  /**
   * Zoom frequently shows "Would you like to open this meeting with the Zoom
   * app?" gateway page at zoom.us/j/{id}. We detect this and click through to
   * the web client instead of the desktop app.
   */
  private async handleGatewayPage(
    meetingId: string,
    pwdHash?: string,
  ): Promise<void> {
    await this.sleep(2000);
    const currentUrl = this.page!.url();
    this.log(`URL after load: ${currentUrl}`);

    if (currentUrl.includes('/wc/')) {
      this.log('Already inside web client — skipping gateway handling');
      return;
    }

    await this.saveScreenshot('gateway-page');

    // Try to click the "Join from Your Browser" link (several text variants)
    const clicked = await this.safePageEval(() => {
      const patterns =
        /join from.*(your)?\s*browser|use browser|start from browser|web client/i;
      const el = Array.from(
        document.querySelectorAll<HTMLElement>('a, button, [role="link"]'),
      ).find((e) => patterns.test(e.textContent ?? ''));

      if (el) {
        el.click();
        return true;
      }

      // Scroll down — the link is often hidden below the fold
      window.scrollTo(0, document.body.scrollHeight);
      return false;
    });

    if (!clicked) {
      // Scroll may have revealed the link — try again after a moment
      await this.sleep(1500);
      const clickedAfterScroll = await this.safePageEval(() => {
        const patterns =
          /join from.*(your)?\s*browser|use browser|start from browser|web client/i;
        const el = Array.from(
          document.querySelectorAll<HTMLElement>('a, button, [role="link"]'),
        ).find((e) => patterns.test(e.textContent ?? ''));
        if (el) { el.click(); return true; }
        return false;
      });

      if (!clickedAfterScroll) {
        // Last resort: navigate directly to the web client URL
        const wcUrl = `https://zoom.us/wc/${meetingId}/join${
          pwdHash ? `?pwd=${pwdHash}` : ''
        }`;
        this.log(`Gateway: couldn't find browser link — navigating to ${wcUrl}`);
        await this.page!.goto(wcUrl, {
          waitUntil: 'domcontentloaded',
          timeout: 30_000,
        });
        await this.sleep(2000);
        return;
      }
    }

    this.log('Clicked browser join link — waiting for web client to load');
    try {
      await this.page!.waitForNavigation({
        waitUntil: 'domcontentloaded',
        timeout: 15_000,
      });
    } catch {
      // SPA navigation may not fire a full navigation event
    }
    await this.sleep(1500);
  }

  // ── Join flow ─────────────────────────────────────────────────────────────

  private async runJoinFlow(
    name: string,
    passcode?: string,
  ): Promise<void> {
    await this.saveScreenshot('before-join-form');

    // ── Fill name ──────────────────────────────────────────────────────────
    this.log('Step: fillName');
    const nameFilled = await this.findAndFillInput(
      NAME_SELECTORS,
      (placeholder, type) =>
        type !== 'password' &&
        (placeholder.toLowerCase().includes('name') || placeholder === ''),
      name,
      'fillName',
      30_000,
    );

    if (!nameFilled) {
      await this.saveScreenshot('no-name-input');
      this.log(
        `fillName: could not find name input after 30 s. URL: ${this.page?.url()}`,
        'warn',
      );
    }

    await this.sleep(300);

    // ── Fill passcode ──────────────────────────────────────────────────────
    if (passcode) {
      this.log('Step: fillPasscode');
      const passFilled = await this.findAndFillInput(
        PASSCODE_SELECTORS,
        (_placeholder, type) => type === 'password',
        passcode,
        'fillPasscode',
        10_000,
      );
      if (!passFilled) {
        this.log('fillPasscode: passcode input not found', 'warn');
      }
    }

    await this.sleep(300);

    // ── Click Join ─────────────────────────────────────────────────────────
    this.log('Step: clickJoin');
    await this.saveScreenshot('before-join-button');
    const joinClicked = await this.findAndClickButton(
      JOIN_BTN_SELECTORS,
      /^join$/i,
      'clickJoin',
      15_000,
    );
    if (!joinClicked) {
      this.log('clickJoin: could not find join button', 'warn');
    }

    // ── Post-join unified state machine ──────────────────────────────────
    //
    // After clicking Join, Zoom transitions through several states:
    //   LOADING       → blank/black page while the meeting SPA initialises
    //   WAITING_ROOM  → host hasn't admitted the bot yet
    //   AUDIO_DIALOG  → "Join Audio by Computer" dialog
    //   IN_MEETING    → meeting toolbar visible, bot is fully joined
    //
    // We poll for all of these and react accordingly rather than sleeping
    // a fixed amount and guessing what state we're in.
    this.log('Step: waitForPostJoin');
    await this.runPostJoinStateMachine(passcode);

    this.log('Step: done — bot is in the meeting');

    // Post-join diagnostic: verify audio capture is set up correctly
    try {
      const diagnostic = await this.page!.evaluate(() => {
        const w = window as unknown as Record<string, unknown>;
        const audioCtxState = (w.__captureCtxState as string) ?? 'unknown';
        const onAudioChunkDefined = typeof w.__onAudioChunk === 'function';
        // Check if any RTCPeerConnections are open
        const pcs = (w.__activePCCount as number) ?? 'unknown';
        return { audioCtxState, onAudioChunkDefined, activePCCount: pcs };
      });
      this.log(`[AudioDiag] onAudioChunkDefined=${diagnostic.onAudioChunkDefined} audioCtxState=${diagnostic.audioCtxState} activePCCount=${diagnostic.activePCCount}`);
    } catch (diagErr) {
      this.log(`[AudioDiag] diagnostic failed: ${diagErr}`, 'error');
    }
  }

  // ── Generic frame-aware helpers ───────────────────────────────────────────

  /**
   * Searches every frame for a matching input element and fills it.
   *
   * Strategy (in priority order):
   *   1. Specific selectors from `specificSelectors` list.
   *   2. Any `<input>` element whose `placeholder` / `type` attributes
   *      satisfy `fallbackTest`.
   *
   * Returns `true` if the input was found and text was typed.
   *
   * WHY ElementHandle: we hold the handle returned by `frame.$()` and call
   * `.click()` / `.type()` directly on it. This avoids the race condition
   * where we returned `{frame, selector}` and the element moved before we
   * re-queried it.
   */
  private async findAndFillInput(
    specificSelectors: string[],
    fallbackTest: (placeholder: string, type: string) => boolean,
    text: string,
    label = 'input',
    timeout = 20_000,
  ): Promise<boolean> {
    const deadline = Date.now() + timeout;

    while (Date.now() < deadline) {
      if (!this.page || this.page.isClosed()) return false;

      for (const frame of this.page.frames()) {
        if (frame.isDetached()) continue;

        // ── Specific selectors first ────────────────────────────────────
        for (const sel of specificSelectors) {
          const result = await this.tryFillElement(frame, sel, text, label);
          if (result) return true;
        }

        // ── Broad fallback: inspect every <input> in this frame ─────────
        try {
          const inputs = await frame.$$('input');
          for (const elHandle of inputs) {
            try {
              const meta = await elHandle.evaluate(
                (el) => {
                  const input = el as HTMLInputElement;
                  const rect = el.getBoundingClientRect();
                  return {
                    placeholder: input.placeholder ?? '',
                    type: input.type ?? 'text',
                    visible: rect.width > 0 && rect.height > 0,
                    disabled: input.disabled,
                    readonly: input.readOnly,
                  };
                },
              );

              if (
                !meta.visible ||
                meta.disabled ||
                meta.readonly ||
                !fallbackTest(meta.placeholder, meta.type)
              ) {
                continue;
              }

              await elHandle.click({ clickCount: 3 });
              await elHandle.type(text, { delay: 40 });
              this.log(
                `${label}: fallback fill — placeholder="${meta.placeholder}" ` +
                  `type="${meta.type}" frame="${frame.url()}"`,
              );
              return true;
            } catch {
              // Element became detached or unclickable — try the next one
            }
          }
        } catch {
          // Frame detached during iteration
        }
      }

      await this.sleep(500);
    }

    return false;
  }

  /**
   * Searches every frame for a matching button / link and clicks it.
   *
   * Strategy:
   *   1. Specific selectors from `specificSelectors`.
   *   2. Any `<button>` or `[role="button"]` whose text matches `textPattern`.
   */
  private async findAndClickButton(
    specificSelectors: string[],
    textPattern: RegExp,
    label = 'button',
    timeout = 15_000,
  ): Promise<boolean> {
    const deadline = Date.now() + timeout;

    while (Date.now() < deadline) {
      if (!this.page || this.page.isClosed()) return false;

      for (const frame of this.page.frames()) {
        if (frame.isDetached()) continue;

        // ── Specific selectors ──────────────────────────────────────────
        for (const sel of specificSelectors) {
          try {
            const el = await frame.$(sel);
            if (!el) continue;
            const visible: boolean = await el.evaluate(
              (e) => {
                const rect = e.getBoundingClientRect();
                return rect.width > 0 && rect.height > 0;
              },
            );
            if (!visible) continue;
            await el.click();
            this.log(`${label}: clicked selector="${sel}" frame="${frame.url()}"`);
            return true;
          } catch {
            // Detached or not clickable — try next
          }
        }

        // ── Text-based fallback ─────────────────────────────────────────
        try {
          const clicked: boolean = await frame.evaluate(
            (pattern: string) => {
              const re = new RegExp(pattern, 'i');
              const el = Array.from(
                document.querySelectorAll<HTMLElement>(
                  'button, [role="button"], input[type="submit"]',
                ),
              ).find((b) => re.test(b.textContent?.trim() ?? ''));
              if (el) {
                const rect = el.getBoundingClientRect();
                if (rect.width > 0 && rect.height > 0) {
                  el.click();
                  return true;
                }
              }
              return false;
            },
            textPattern.source,
          );
          if (clicked) {
            this.log(`${label}: clicked via text pattern frame="${frame.url()}"`);
            return true;
          }
        } catch {
          // Frame detached
        }
      }

      await this.sleep(500);
    }

    return false;
  }

  /**
   * Try to fill one specific selector in one specific frame.
   * Returns `true` on success, `false` if element not found or not usable.
   */
  private async tryFillElement(
    frame: Frame,
    selector: string,
    text: string,
    label: string,
  ): Promise<boolean> {
    try {
      const el: ElementHandle<Element> | null = await frame.$(selector);
      if (!el) return false;

      const meta = await el.evaluate((e) => {
        const input = e as HTMLInputElement;
        const rect = e.getBoundingClientRect();
        return {
          visible: rect.width > 0 && rect.height > 0,
          disabled: input.disabled,
          readonly: input.readOnly,
        };
      });

      if (!meta.visible || meta.disabled || meta.readonly) return false;

      await el.click({ clickCount: 3 }); // triple-click to select any existing text
      await el.type(text, { delay: 40 });
      this.log(
        `${label}: filled selector="${selector}" frame="${frame.url()}"`,
      );
      return true;
    } catch {
      return false;
    }
  }

  // ── Post-join state machine ───────────────────────────────────────────────

  /**
   * After the Join button is clicked, Zoom cycles through several states.
   * This method polls every 1 s and reacts:
   *
   *  • IN_MEETING toolbar visible  → done (bot is fully in)
   *  • Audio-join dialog visible   → click it, then wait for toolbar
   *  • Actual waiting room text    → log and keep waiting (host will admit)
   *  • Camera/modal error          → dismiss it, keep polling
   *  • Loading / black screen      → do nothing, keep polling
   *
   * A 10-second settle window after the Join click prevents false positives
   * from Zoom's loading overlay, which briefly contains "please wait"-like
   * text in hidden DOM nodes before the meeting room renders.
   */
  private async runPostJoinStateMachine(passcode?: string): Promise<void> {
    const TIMEOUT = 5 * 60_000; // wait up to 5 min (covers waiting-room scenarios)
    const POLL = 1000;
    const now = Date.now();
    // Settle windows — avoid false positives from the pre-join form:
    //   - IN_MEETING check: wait at least 8 s for Zoom SPA to navigate away from pre-join
    //   - WAITING_ROOM check: wait 10 s for Zoom loading overlay to clear
    const IN_MEETING_CHECK_AFTER = now + 8_000;
    const WAITING_ROOM_CHECK_AFTER = now + 10_000;

    let inWaitingRoom = false;
    let passcodeFilled = false; // only attempt post-join passcode once
    const deadline = now + TIMEOUT;

    await this.saveScreenshot('after-join-click');

    while (Date.now() < deadline) {
      if (!this.page || this.page.isClosed()) break;

      // ① Check for meeting toolbar (primary success signal)
      //    Only after the 8-second settle window to avoid false positives
      //    from .zm-btn / .footer-button present on the pre-join form page.
      if (Date.now() > IN_MEETING_CHECK_AFTER) {
        const toolbarFound = await this.isAnyVisible(IN_MEETING_SELECTORS);
        if (toolbarFound) {
          this.log('Post-join: meeting toolbar confirmed — bot is fully in');
          await this.saveScreenshot('in-meeting-confirmed');
          return;
        }
      }

      // ② Check for audio-join dialog and click it
      const audioEl = await this.findVisibleElement(AUDIO_BTN_SELECTORS);
      if (audioEl) {
        this.log('Post-join: clicking "Join Audio by Computer"');
        try { await audioEl.click(); } catch { /* may be detached */ }
        await this.sleep(2000); // give WebRTC a moment to negotiate
        continue;
      }

      // ③ Dismiss any modal dialogs (camera error, feature announcements)
      await this.dismissModals();

      // ④ Check for post-join passcode modal (Zoom sometimes asks for passcode
      //    as a separate dialog AFTER clicking Join, even if we filled the
      //    pre-join form field — e.g. when pwd= isn't embedded in the URL)
      if (!passcodeFilled) {
        const askedForPasscode = await this.detectPasscodePrompt();
        if (askedForPasscode) {
          passcodeFilled = true; // prevent infinite retry loops
          if (passcode) {
            this.log('Post-join: passcode modal detected — filling passcode');
            const filled = await this.findAndFillInput(
              PASSCODE_SELECTORS,
              (_p, type) => type === 'password',
              passcode,
              'postJoinPasscode',
              5_000,
            );
            if (filled) {
              await this.sleep(200);
              await this.findAndClickButton(
                PASSCODE_SUBMIT_SELECTORS,
                /^(submit|ok|join)$/i,
                'passcodeSubmit',
                5_000,
              );
            }
          } else {
            this.log('Post-join: passcode modal detected but no passcode provided — skipping', 'warn');
          }
          await this.sleep(1000);
          continue;
        }
      }

      // ④ Check for actual waiting room (only after settle period)
      if (Date.now() > WAITING_ROOM_CHECK_AFTER) {
        const nowInWaitingRoom = await this.detectActualWaitingRoom();
        if (nowInWaitingRoom && !inWaitingRoom) {
          this.log('Post-join: waiting room detected — waiting for host admission');
          await this.saveScreenshot('waiting-room');
          inWaitingRoom = true;
        } else if (!nowInWaitingRoom && inWaitingRoom) {
          this.log('Post-join: waiting room cleared — host admitted the bot');
          inWaitingRoom = false;
          await this.sleep(2000);
        }
      }

      await this.sleep(POLL);
    }

    this.log('Post-join state machine: 5-min timeout — proceeding anyway', 'warn');
    await this.saveScreenshot('post-join-timeout');
  }

  /**
   * Returns true if Zoom has shown a passcode-required dialog after the
   * Join button was clicked (separate from the pre-join form passcode field).
   */
  private async detectPasscodePrompt(): Promise<boolean> {
    if (!this.page || this.page.isClosed()) return false;
    for (const frame of this.page.frames()) {
      if (frame.isDetached()) continue;
      try {
        const found: boolean = await frame.evaluate(() => {
          const text = (document.body as HTMLElement)?.innerText ?? '';
          return (
            /enter.*meeting passcode/i.test(text) ||
            /passcode.*required/i.test(text) ||
            /incorrect passcode/i.test(text) ||
            /this meeting requires a passcode/i.test(text)
          );
        });
        if (found) return true;
      } catch { /* detached */ }
    }
    return false;
  }

  /**
   * Returns true only if Zoom's waiting room text is visible.
   * Uses SPECIFIC phrases that ONLY appear on the actual waiting room UI
   * and NOT on Zoom's loading overlay or meeting page hidden elements.
   */
  private async detectActualWaitingRoom(): Promise<boolean> {
    if (!this.page || this.page.isClosed()) return false;
    for (const frame of this.page.frames()) {
      if (frame.isDetached()) continue;
      try {
        const found: boolean = await frame.evaluate(() => {
          // innerText gives rendered text only; more reliable than textContent
          // which includes hidden elements that cause false positives.
          const text = (document.body as HTMLElement)?.innerText ?? '';
          return (
            /waiting for the host to start this meeting/i.test(text) ||
            /the host will let you in soon/i.test(text) ||
            /waiting for the host/i.test(text) ||
            /please wait, the meeting host will let you in/i.test(text)
          );
        });
        if (found) return true;
      } catch { /* detached */ }
    }
    return false;
  }

  /**
   * Dismiss any modal/tooltip dialogs that might obstruct the audio button.
   * Best-effort — all errors swallowed.
   */
  private async dismissModals(): Promise<void> {
    if (!this.page || this.page.isClosed()) return;
    for (let pass = 0; pass < 3; pass++) {
      let dismissedSomething = false;

      for (const frame of this.page.frames()) {
        if (frame.isDetached()) continue;
        for (const sel of DISMISS_DIALOG_SELECTORS) {
          try {
            const all = await frame.$$(sel);
            for (const el of all) {
              const meta = await el.evaluate((e) => {
                const rect = e.getBoundingClientRect();
                const text = (e as HTMLElement).innerText || e.textContent || '';
                return {
                  visible: rect.width > 0 && rect.height > 0,
                  text: text.trim(),
                  aria: e.getAttribute('aria-label') || '',
                };
              }).catch(() => ({ visible: false, text: '', aria: '' }));
              if (!meta.visible) continue;

              const looksDismissive =
                /close|dismiss|ok|got it|not now|cancel|x/i.test(meta.text) ||
                /close|dismiss/i.test(meta.aria) ||
                sel.includes('close');

              if (!looksDismissive) continue;

              await el.click().catch(() => {});
              dismissedSomething = true;
              this.log(`Dismissed modal: selector="${sel}" text="${meta.text}" aria="${meta.aria}"`);
              await this.sleep(250);
            }
          } catch { /* detached or not clickable */ }
        }

        try {
          const clickedByText = await frame.evaluate(() => {
            const candidates = Array.from(
              document.querySelectorAll<HTMLElement>('button, [role="button"], a, span')
            );
            const target = candidates.find((el) => {
              const rect = el.getBoundingClientRect();
              const text = (el.innerText || el.textContent || '').trim();
              return rect.width > 0 && rect.height > 0 && /^(ok|got it|not now|close)$/i.test(text);
            });
            if (!target) return false;
            target.click();
            return true;
          });
          if (clickedByText) {
            dismissedSomething = true;
            this.log('Dismissed modal via text-based button search');
            await this.sleep(250);
          }
        } catch { /* detached */ }

      }

      try {
        await this.page.keyboard.press('Escape').catch(() => {});
      } catch { /* page closed */ }

      if (!dismissedSomething) break;
    }
  }

  /**
   * Returns true if any selector from `selectors` is visible in any frame.
   */
  private async isAnyVisible(selectors: string[]): Promise<boolean> {
    if (!this.page || this.page.isClosed()) return false;
    for (const frame of this.page.frames()) {
      if (frame.isDetached()) continue;
      for (const sel of selectors) {
        try {
          const el = await frame.$(sel);
          if (!el) continue;
          const visible: boolean = await el.evaluate((e) => {
            const rect = e.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
          });
          if (visible) return true;
        } catch { /* detached */ }
      }
    }
    return false;
  }

  /**
   * Returns the first visible ElementHandle from `selectors` across all
   * frames, or null if none found.
   */
  private async findVisibleElement(
    selectors: string[],
  ): Promise<ElementHandle<Element> | null> {
    if (!this.page || this.page.isClosed()) return null;
    for (const frame of this.page.frames()) {
      if (frame.isDetached()) continue;
      for (const sel of selectors) {
        try {
          const el = await frame.$(sel);
          if (!el) continue;
          const visible: boolean = await el.evaluate((e) => {
            const rect = e.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
          });
          if (visible) return el;
        } catch { /* detached */ }
      }
    }
    return null;
  }

  // ── Caption scraping ───────────────────────────────────────────────────────

  /**
   * Enable Zoom live captions and stream them to onCaption callback.
   *
   * Strategy (mirrors the Recall.ai blog approach):
   *  1. Click the "Live Transcript" / "Closed Caption" toolbar button to enable captions.
   *  2. Build a participantMap: avatar-image-src / initials-text → display name.
   *  3. Inject a MutationObserver for all [class*="live-transcription"] containers.
   *  4. On every mutation, extract visible text + speaker avatar, deduplicate with
   *     a per-speaker sliding-window (find the overlap between old and new text),
   *     and emit only the NEW words.
   */
  private async startCaptionScraper(): Promise<void> {
    if (!this.callbacks.onCaption) return;
    if (!this.page || this.page.isClosed()) return;

    const joinedAt = Date.now();

    // ── Step 1: Enable live captions ──────────────────────────────────────
    await this.enableLiveCaptions();

    // ── Step 2: Expose Node.js caption receiver to the browser ────────────
    await this.page.exposeFunction(
      '__onCaption',
      (speaker: string, text: string, elapsedMs?: number) => {
        if (this.callbacks.onCaption) {
          this.callbacks.onCaption({
            speaker,
            text,
            elapsed_ms: typeof elapsedMs === 'number' ? elapsedMs : Date.now() - joinedAt,
          });
        }
      },
    );

    // ── Step 3: Build participant map + install MutationObserver in page ──
    try {
      await this.page.evaluate((joinedAtMs: number) => {
        const windowWithState = window as unknown as {
          __participantMapObserver?: MutationObserver;
          __captionRootObserver?: MutationObserver;
          __captionContainerObservers?: MutationObserver[];
          __zgParticipantMap?: Record<string, string>;
          __onCaption?: (speaker: string, text: string, elapsedMs: number) => void;
        };

        if (windowWithState.__captionRootObserver) {
          return;
        }

        windowWithState.__zgParticipantMap = windowWithState.__zgParticipantMap || {};
        windowWithState.__captionContainerObservers = windowWithState.__captionContainerObservers || [];

        const participantMap = windowWithState.__zgParticipantMap;

        function mapParticipantItem(item: Element) {
          const nameEl = item.querySelector(
            '.participants-item__display-name, [class*="participants-item__display-name"], [class*="participants-item__name"], [class*="participants__name"]'
          );
          const name = (nameEl as HTMLElement | null)?.innerText?.trim();
          if (!name) return;

          const img = item.querySelector('img');
          if (img?.src) participantMap[img.src] = name;

          const initialsEl = item.querySelector(
            '[class*="avatar__initials"], [class*="avatar-initials"], [class*="initials"]'
          );
          const initials = (initialsEl as HTMLElement | null)?.innerText?.trim();
          if (initials) participantMap[initials] = name;
        }

        function refreshParticipantMap() {
          const items = document.querySelectorAll(
            '.participants-item, [class*="participants-item"], [class*="participants-li"]'
          );
          items.forEach(mapParticipantItem);
        }

        function startParticipantObserver() {
          const participantsButton = Array.from(
            document.querySelectorAll<HTMLElement>('button, [role="button"]')
          ).find((el) => {
            const label = (el.getAttribute('aria-label') || el.innerText || el.textContent || '').trim();
            return /open the participants list|participants/i.test(label);
          });

          participantsButton?.click();
          participantsButton?.click();

          refreshParticipantMap();

          const panel = document.querySelector(
            '.participants-ul, .participants-list, [class*="participants-list"], [class*="participants-ul"], [class*="participants-panel"]'
          );
          if (!panel) {
            setTimeout(startParticipantObserver, 1500);
            return;
          }

          if (!windowWithState.__participantMapObserver) {
            windowWithState.__participantMapObserver = new MutationObserver(() => {
              refreshParticipantMap();
            });
            windowWithState.__participantMapObserver.observe(panel, {
              childList: true,
              subtree: true,
              characterData: true,
            });
          }
        }

        function resolveSpeaker(container: Element): string {
          const img = container.querySelector('img');
          if (img?.src && participantMap[img.src]) return participantMap[img.src];

          const initialsEl = container.querySelector(
            '[class*="avatar__initials"], [class*="avatar-initials"], [class*="initials"]'
          );
          const initials = (initialsEl as HTMLElement | null)?.innerText?.trim();
          if (initials && participantMap[initials]) return participantMap[initials];
          if (initials) return initials;

          const label = container.querySelector('[aria-label]')?.getAttribute('aria-label')?.trim();
          if (label) return label;
          return 'Participant';
        }

        function emitContainerSnapshot(container: Element) {
          const captionSpans = container.querySelectorAll(
            '.live-transcription-subtitle__item, [class*="live-transcription-subtitle__item"], [class*="subtitle__item"], [class*="caption-line"], [class*="transcription-subtitle"]'
          );
          const speaker = resolveSpeaker(container);
          const elapsedMs = Date.now() - joinedAtMs;
          captionSpans.forEach((span) => {
            const currentText = (span as HTMLElement).innerText.trim();
            if (!currentText) return;
            windowWithState.__onCaption?.(speaker, currentText, elapsedMs);
          });
        }

        function observeCaptionContainer(container: Element) {
          const element = container as HTMLElement;
          if (element.dataset.zgCaptionObserved === '1') return;
          element.dataset.zgCaptionObserved = '1';

          const observer = new MutationObserver(() => {
            emitContainerSnapshot(container);
          });

          observer.observe(container, {
            childList: true,
            subtree: true,
            characterData: true,
          });
          windowWithState.__captionContainerObservers?.push(observer);
          emitContainerSnapshot(container);
        }

        function attachCaptionObservers() {
          const containers = document.querySelectorAll(
            '[class*="live-transcription"], [class*="caption"]'
          );
          containers.forEach(observeCaptionContainer);
        }

        startParticipantObserver();
        attachCaptionObservers();

        windowWithState.__captionRootObserver = new MutationObserver(() => {
          refreshParticipantMap();
          attachCaptionObservers();
        });
        windowWithState.__captionRootObserver.observe(document.body, {
          childList: true,
          subtree: true,
        });
      }, joinedAt);
    } catch (err) {
      this.log(`captionScraper: evaluate error: ${err}`, 'warn');
    }

    this.log('Caption scraper installed');
  }

  /**
   * Click the "Live Transcript" button in the toolbar to enable Zoom's
   * built-in closed captions (uses Zoom's own ASR — instant, free).
   */
  private async enableLiveCaptions(): Promise<void> {
    if (!this.page || this.page.isClosed()) return;

    // Wait a moment for toolbar to settle after joining
    await this.sleep(2000);
    await this.dismissModals();
    await this.saveScreenshot('before-enable-captions');

    const captionButtonSelectors = [
      'button[aria-label*="transcript" i]',
      'button[aria-label*="closed caption" i]',
      'button[aria-label*="live transcript" i]',
      'button[aria-label*="captions" i]',
      '[class*="caption-btn"]',
      '[class*="live-transcript"]',
    ];

    // It might be in the "More" overflow menu
    const moreSelectors = [
      'button[aria-label*="More" i]',
      '[class*="more-button"]',
      'button[aria-label*="see more options" i]',
      'button[aria-label*="more" i]',
    ];

    // First try directly
    let clicked = false;
    for (const frame of this.page.frames()) {
      if (frame.isDetached()) continue;
      for (const sel of captionButtonSelectors) {
        try {
          const el = await frame.$(sel);
          if (!el) continue;
          const visible = await el.evaluate((e) => {
            const r = e.getBoundingClientRect();
            return r.width > 0 && r.height > 0;
          });
          if (visible) {
            await el.click();
            this.log(`enableLiveCaptions: clicked "${sel}" in frame="${frame.url()}"`);
            clicked = true;
            break;
          }
        } catch { /* try next */ }
      }
      if (clicked) break;
    }

    if (!clicked) {
      // Try opening "More" overflow first.
      clicked = await this.openMoreAndPickCaptionItem(moreSelectors, captionButtonSelectors);
    }

    if (!clicked) {
      // Try text-based fallback — look for any button with "caption" or "transcript" text
      const fallbackClicked = await this.safePageEval(() => {
        const btn = Array.from(
          document.querySelectorAll<HTMLElement>('button, [role="button"]')
        ).find((b) =>
          /transcript|caption/i.test(b.getAttribute('aria-label') ?? '') ||
          /transcript|caption/i.test(b.textContent ?? '')
        );
        if (btn) { btn.click(); return true; }
        return false;
      });
      clicked = fallbackClicked === true;
      if (clicked) this.log('enableLiveCaptions: clicked via text fallback');
    }

    if (!clicked) {
      clicked = await this.safeClickByVisibleText([
        /captions?/i,
        /closed\s+caption/i,
        /live\s+transcript/i,
        /show\s+subtitles/i,
      ]);
      if (clicked) this.log('enableLiveCaptions: clicked by visible text');
    }

    if (!clicked) {
      const visibleButtons = await this.collectVisibleButtonLabels();
      this.log(`enableLiveCaptions: could not find caption button; visible controls=${JSON.stringify(visibleButtons.slice(0, 20))}`, 'warn');
      this.log('enableLiveCaptions: could not find caption button — captions may already be on or unavailable', 'warn');
    }

    // After clicking, Zoom may show a submenu: "Enable auto-transcription" / "View captions"
    await this.sleep(800);
    const submenuClicked = await this.safeClickByVisibleText([
      /enable.*transcript/i,
      /auto.?transcri/i,
      /start.*caption/i,
      /view.*transcript/i,
      /show.*captions?/i,
      /show.*subtitles?/i,
    ]);
    if (submenuClicked) this.log('enableLiveCaptions: clicked caption submenu item');
    await this.saveScreenshot('after-enable-captions');
  }

  private async openMoreAndPickCaptionItem(
    moreSelectors: string[],
    captionButtonSelectors: string[],
  ): Promise<boolean> {
    if (!this.page || this.page.isClosed()) return false;

    for (const frame of this.page.frames()) {
      if (frame.isDetached()) continue;

      for (const moreSel of moreSelectors) {
        try {
          const moreEl = await frame.$(moreSel);
          if (!moreEl) continue;
          const visible = await moreEl.evaluate((e) => {
            const r = e.getBoundingClientRect();
            return r.width > 0 && r.height > 0;
          });
          if (!visible) continue;

          await moreEl.click();
          this.log(`enableLiveCaptions: opened More via selector="${moreSel}" frame="${frame.url()}"`);
          await this.sleep(800);

          for (const menuFrame of this.page.frames()) {
            if (menuFrame.isDetached()) continue;
            for (const sel of captionButtonSelectors) {
              try {
                const el = await menuFrame.$(sel);
                if (!el) continue;
                const v = await el.evaluate((e) => {
                  const r = e.getBoundingClientRect();
                  return r.width > 0 && r.height > 0;
                });
                if (v) {
                  await el.click();
                  this.log(`enableLiveCaptions: clicked via More menu selector="${sel}" frame="${menuFrame.url()}"`);
                  return true;
                }
              } catch { /* try next */ }
            }
          }

          const byText = await this.safeClickByVisibleText([
            /captions?/i,
            /closed\s+caption/i,
            /live\s+transcript/i,
            /show\s+subtitles/i,
          ]);
          if (byText) {
            this.log('enableLiveCaptions: clicked caption item by visible text after opening More');
            return true;
          }

          // We successfully opened More already; do not keep toggling it with
          // other selectors in the same pass.
          break;
        } catch { /* try next */ }
      }
    }

    // Final fallback: click a visible More button by label text.
    const openedByText = await this.safeClickByVisibleText([/^more$/i, /more/i]);
    if (!openedByText) return false;
    await this.sleep(800);
    return this.safeClickByVisibleText([
      /captions?/i,
      /closed\s+caption/i,
      /live\s+transcript/i,
      /show\s+subtitles/i,
    ]);
  }

  private async safeClickByVisibleText(patterns: RegExp[]): Promise<boolean> {
    if (!this.page || this.page.isClosed()) return false;

    for (const frame of this.page.frames()) {
      if (frame.isDetached()) continue;
      try {
        const clicked = await frame.evaluate((sources: string[]) => {
          const regexes = sources.map((s) => new RegExp(s, 'i'));
          const elements = Array.from(
            document.querySelectorAll<HTMLElement>(
              'button, [role="button"], [role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"], li, a, div, span'
            )
          );
          const target = elements.find((el) => {
            const rect = el.getBoundingClientRect();
            const text = (el.innerText || el.textContent || '').trim();
            if (!(rect.width > 0 && rect.height > 0 && text)) return false;
            if (!regexes.some((re) => re.test(text))) return false;
            // Prefer small leaf nodes rather than giant container divs.
            const childText = Array.from(el.children).map((c) => (c as HTMLElement).innerText || c.textContent || '').join(' ').trim();
            return !childText || childText === text;
          });
          if (!target) return false;
          target.click();
          return true;
        }, patterns.map((p) => p.source));
        if (clicked) {
          this.log(`safeClickByVisibleText: clicked text matching ${patterns.map((p) => p.source).join('|')} frame="${frame.url()}"`);
          return true;
        }
      } catch { /* detached */ }
    }

    return false;
  }

  private async collectVisibleButtonLabels(): Promise<string[]> {
    if (!this.page || this.page.isClosed()) return [];

    const labels: string[] = [];
    for (const frame of this.page.frames()) {
      if (frame.isDetached()) continue;
      try {
        const frameLabels = await frame.evaluate(() => {
          return Array.from(
            document.querySelectorAll<HTMLElement>('button, [role="button"], [role="menuitem"]')
          )
            .map((el) => {
              const rect = el.getBoundingClientRect();
              if (rect.width <= 0 || rect.height <= 0) return '';
              return (el.innerText || el.textContent || el.getAttribute('aria-label') || '').trim();
            })
            .filter(Boolean);
        });
        labels.push(...frameLabels);
      } catch { /* detached */ }
    }
    return labels;
  }

  // ── Meeting-ended detection ───────────────────────────────────────────────

  private startEndMonitor(): void {
    this.endMonitorTimer = setInterval(async () => {
      if (!this.page || this.page.isClosed()) {
        clearInterval(this.endMonitorTimer!);
        this.endMonitorTimer = null;
        this.log('endMonitor: page is closed/null — firing ended');
        this.callbacks.onStatusChange('ended');
        return;
      }

      try {
        const result = await this.safePageEval(() => {
          // Use innerText (rendered/visible text only) — textContent includes hidden
          // DOM template elements that Zoom pre-renders, causing false positives.
          const visibleText = (document.body as HTMLElement)?.innerText ?? '';
          const title = document.title.toLowerCase();

          // Primary: check if the in-meeting toolbar has disappeared
          const toolbarGone =
            !document.querySelector('button[aria-label*="Mute" i]') &&
            !document.querySelector('button[aria-label*="Unmute" i]') &&
            !document.querySelector('.footer-button__button') &&
            !document.querySelector('[class*="footer-button"]') &&
            !document.querySelector('[class*="meeting-footer"]');

          // Secondary: check for visible "meeting ended" text or page title
          const endedText =
            visibleText.includes('This meeting has been ended') ||
            visibleText.includes('The meeting has been ended') ||
            title.includes('meeting ended');

          return {
            toolbarGone,
            endedText,
            titleSnippet: title.slice(0, 80),
          };
        });

        // Only fire ended if BOTH signals agree, OR if explicit ended text is visible.
        // Requiring toolbarGone prevents false positives from hidden DOM templates.
        const ended = result && (
          (result.toolbarGone && result.endedText) ||
          result.endedText
        );

        if (result?.toolbarGone || result?.endedText) {
          this.log(`endMonitor: toolbarGone=${result.toolbarGone} endedText=${result.endedText} title="${result.titleSnippet}"`);
        }

        if (ended) {
          this.log('endMonitor: meeting ended confirmed — cleaning up');
          clearInterval(this.endMonitorTimer!);
          this.endMonitorTimer = null;
          await this.cleanup();
          this.callbacks.onStatusChange('ended');
        }
      } catch {
        clearInterval(this.endMonitorTimer!);
        this.endMonitorTimer = null;
        this.callbacks.onStatusChange('ended');
      }
    }, 5_000);
  }

  // ── Misc helpers ──────────────────────────────────────────────────────────

  private safeMainFrame(): Frame | null {
    try {
      return this.page?.mainFrame() ?? null;
    } catch {
      return null;
    }
  }

  private async safePageEval<T>(fn: () => T): Promise<T | undefined> {
    try {
      return await this.page!.evaluate(fn);
    } catch (err) {
      const msg = String(err);
      if (!msg.includes('detached') && !msg.includes('closed')) {
        this.log(`evaluate error: ${msg}`, 'error');
      }
      return undefined;
    }
  }

  /**
   * Saves a full-page PNG screenshot to /tmp for debugging.
   * Filename: zoom-bot-<sessionId>-<label>.png
   */
  private async saveScreenshot(label: string): Promise<void> {
    try {
      const file = path.join(
        os.tmpdir(),
        `zoom-bot-${this.sessionId}-${label}.png`,
      );
      await this.page!.screenshot({
        path: file as `${string}.png`,
        fullPage: true,
      });
      this.log(`Screenshot: ${file}`);
    } catch {
      // Non-critical; page may already be closed
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }

  private log(
    msg: string,
    level: 'info' | 'warn' | 'error' = 'info',
  ): void {
    const prefix = `[ZoomJoiner:${this.sessionId}]`;
    if (level === 'error') console.error(prefix, msg);
    else if (level === 'warn') console.warn(prefix, msg);
    else console.log(prefix, msg);
  }
}
