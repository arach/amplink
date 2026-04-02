import type { VoiceProfile } from "./voice-profile.ts";
import type { VoicePreset } from "./voice-presets.ts";

interface VoiceAdminPageOptions {
  origin: string;
  userId: string;
  profile: VoiceProfile;
  token: string | null;
  presets: VoicePreset[];
}

export function renderVoiceAdminPage(options: VoiceAdminPageOptions): string {
  const bootstrap = JSON.stringify({
    origin: options.origin,
    userId: options.userId,
    token: options.token,
    profile: options.profile,
    presets: options.presets,
  });

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Amplink Voice Admin</title>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=Instrument+Serif:ital@0;1&family=Space+Grotesk:wght@300;400;500&display=swap" rel="stylesheet" />
    <style>
      :root {
        --bg: #0a0a0a;
        --paper: #141414;
        --ink: #e5e5e5;
        --muted: #737373;
        --accent: #38bdf8;
        --accent-soft: rgba(56, 189, 248, 0.10);
        --line: rgba(255, 255, 255, 0.09);
        --line-strong: rgba(255, 255, 255, 0.14);
        --shadow: 0 20px 60px rgba(0, 0, 0, 0.4);
      }

      * {
        box-sizing: border-box;
      }

      ::selection {
        background: rgba(56, 189, 248, 0.3);
        color: white;
      }

      body {
        margin: 0;
        min-height: 100vh;
        font-family: "IBM Plex Mono", ui-monospace, monospace;
        color: var(--ink);
        background:
          radial-gradient(circle at top left, rgba(56, 189, 248, 0.08), transparent 28%),
          linear-gradient(180deg, rgba(255, 255, 255, 0.02), rgba(255, 255, 255, 0)),
          var(--bg);
        -webkit-font-smoothing: antialiased;
      }

      main {
        width: min(1100px, calc(100vw - 32px));
        margin: 32px auto 56px;
      }

      .hero,
      .panel {
        background: var(--paper);
        backdrop-filter: blur(18px);
        border: 1px solid var(--line-strong);
        border-radius: 16px;
        box-shadow: var(--shadow);
      }

      .hero {
        padding: 28px;
        display: grid;
        gap: 14px;
      }

      .eyebrow {
        font-size: 10px;
        letter-spacing: 0.14em;
        text-transform: uppercase;
        color: var(--accent);
      }

      h1 {
        margin: 0;
        font-family: "Instrument Serif", Georgia, serif;
        font-size: clamp(2.4rem, 7vw, 4.2rem);
        line-height: 0.95;
        font-weight: 400;
        font-style: italic;
      }

      .hero p {
        margin: 0;
        max-width: 60ch;
        color: var(--muted);
        line-height: 1.6;
        font-size: 13px;
      }

      .hero-grid {
        display: grid;
        grid-template-columns: 1.3fr 1fr;
        gap: 16px;
        align-items: end;
      }

      .chip-row {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
      }

      .chip {
        padding: 8px 14px;
        border-radius: 999px;
        background: var(--accent-soft);
        border: 1px solid var(--line);
        color: var(--accent);
        font-size: 10px;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }

      .layout {
        display: grid;
        grid-template-columns: 1.2fr 0.8fr;
        gap: 18px;
        margin-top: 18px;
      }

      .panel {
        padding: 24px;
      }

      .stack {
        display: grid;
        gap: 18px;
      }

      .section-head {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 12px;
        margin-bottom: 14px;
      }

      .section-head h2,
      .section-head h3 {
        margin: 0;
        font-size: 12px;
        text-transform: uppercase;
        letter-spacing: 0.14em;
        color: var(--ink);
      }

      .muted {
        color: var(--muted);
      }

      label {
        display: grid;
        gap: 8px;
        font-size: 11px;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: var(--muted);
      }

      input,
      select,
      textarea,
      button {
        font: inherit;
        font-size: 13px;
        text-transform: none;
        letter-spacing: 0;
      }

      input,
      select,
      textarea {
        width: 100%;
        border: 1px solid var(--line-strong);
        border-radius: 10px;
        background: var(--bg);
        color: var(--ink);
        padding: 12px 14px;
        transition: border-color 0.2s;
      }

      input:focus,
      select:focus,
      textarea:focus {
        outline: none;
        border-color: rgba(56, 189, 248, 0.4);
      }

      input[type="range"] {
        -webkit-appearance: none;
        appearance: none;
        height: 3px;
        background: var(--line-strong);
        border: none;
        border-radius: 2px;
        padding: 0;
      }

      input[type="range"]::-webkit-slider-thumb {
        -webkit-appearance: none;
        width: 16px;
        height: 16px;
        border-radius: 50%;
        background: var(--accent);
        cursor: pointer;
        border: 2px solid var(--bg);
      }

      select {
        -webkit-appearance: none;
        appearance: none;
        cursor: pointer;
        background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23737373' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E");
        background-repeat: no-repeat;
        background-position: right 14px center;
        padding-right: 36px;
      }

      textarea {
        min-height: 112px;
        resize: vertical;
        line-height: 1.5;
      }

      .two-up {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 14px;
      }

      .persona-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 12px;
      }

      .persona-card {
        position: relative;
        border: 1px solid var(--line-strong);
        border-radius: 12px;
        background: var(--bg);
        padding: 16px;
        cursor: pointer;
        transition: border-color 0.2s, background 0.2s;
      }

      .persona-card:hover {
        border-color: rgba(255, 255, 255, 0.2);
      }

      .persona-card input {
        position: absolute;
        inset: 0;
        opacity: 0;
        pointer-events: none;
      }

      .persona-card strong {
        display: block;
        margin-bottom: 8px;
        color: var(--ink);
        font-size: 13px;
      }

      .persona-card p {
        margin: 0;
        color: var(--muted);
        line-height: 1.5;
        font-size: 11px;
      }

      .persona-card.active {
        border-color: rgba(56, 189, 248, 0.5);
        background: var(--accent-soft);
      }

      .persona-card.active strong {
        color: var(--accent);
      }

      .actions {
        display: flex;
        flex-wrap: wrap;
        gap: 12px;
      }

      button {
        border: 0;
        border-radius: 999px;
        padding: 11px 18px;
        cursor: pointer;
        font-size: 11px;
        letter-spacing: 0.1em;
        text-transform: uppercase;
        transition: opacity 0.2s;
      }

      button:hover {
        opacity: 0.85;
      }

      .primary {
        background: var(--accent);
        color: #0a0a0a;
        font-weight: 500;
      }

      .secondary {
        background: transparent;
        color: var(--ink);
        border: 1px solid var(--line-strong);
      }

      .secondary:hover {
        border-color: rgba(56, 189, 248, 0.3);
        background: var(--accent-soft);
        opacity: 1;
      }

      .preview-box {
        display: grid;
        gap: 14px;
        padding: 18px;
        border-radius: 12px;
        background: var(--bg);
        border: 1px solid var(--line-strong);
      }

      .preview-label {
        font-size: 10px;
        letter-spacing: 0.14em;
        text-transform: uppercase;
        color: var(--muted);
      }

      .preview-text {
        font-family: "Instrument Serif", Georgia, serif;
        font-size: 24px;
        line-height: 1.2;
        color: var(--ink);
      }

      .status {
        min-height: 20px;
        color: var(--muted);
        font-size: 11px;
        letter-spacing: 0.06em;
      }

      .secret-shell {
        display: none;
      }

      .secret-shell.revealed {
        display: block;
      }

      .secret-note {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 8px 12px;
        border-radius: 999px;
        background: var(--accent-soft);
        color: var(--accent);
        font-size: 10px;
        letter-spacing: 0.1em;
        text-transform: uppercase;
      }

      .vault-grid {
        display: grid;
        gap: 12px;
      }

      .vault-card {
        display: grid;
        gap: 10px;
        padding: 16px;
        border-radius: 12px;
        background: var(--bg);
        border: 1px solid var(--line-strong);
      }

      .vault-card strong {
        font-size: 13px;
        color: var(--ink);
      }

      .vault-card p {
        margin: 0;
        color: var(--muted);
        line-height: 1.55;
        font-size: 11px;
      }

      .vault-meta {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }

      .vault-pill {
        padding: 5px 10px;
        border-radius: 999px;
        background: var(--accent-soft);
        color: var(--accent);
        font-size: 10px;
        letter-spacing: 0.06em;
      }

      @media (max-width: 900px) {
        .hero-grid,
        .layout,
        .two-up,
        .persona-grid {
          grid-template-columns: 1fr;
        }
      }
    </style>
  </head>
  <body>
    <main>
      <section class="hero">
        <div class="eyebrow" id="eyebrow-toggle">Amplink Cloud Voice</div>
        <div class="hero-grid">
          <div>
            <h1>Voice Admin</h1>
            <p>
              Change the spoken personality, ElevenLabs voice, speaking pace, and receipt-versus-completion audio policy live.
              The next voice turn picks it up immediately.
            </p>
          </div>
          <div class="chip-row">
            <div class="chip">Live backend control</div>
            <div class="chip">Per-user profile</div>
            <div class="chip">Preview before saving</div>
          </div>
        </div>
      </section>

      <section class="layout">
        <div class="stack">
          <section class="panel">
            <div class="section-head">
              <h2>Profile</h2>
              <span class="muted" id="updated-at"></span>
            </div>
            <div class="two-up">
              <label>
                User ID
                <input id="user-id" autocomplete="off" />
              </label>
              <label>
                Voice ID
                <input id="voice-id" autocomplete="off" />
              </label>
            </div>

            <label style="margin-top: 14px;">
              Speech Pace
              <input id="speech-rate" type="range" min="0.7" max="1.2" step="0.05" />
              <span class="muted" id="speech-rate-label">Normal pace</span>
            </label>

            <div class="two-up" style="margin-top: 14px;">
              <label>
                Spoken Replies
                <select id="tts-mode">
                  <option value="both">Receipt + Completion</option>
                  <option value="ack">Receipt Only</option>
                  <option value="result">Completion Only</option>
                  <option value="off">Off</option>
                </select>
              </label>
              <label>
                Roast Frequency
                <select id="roast-frequency">
                  <option value="off">Off</option>
                  <option value="rare">Rare</option>
                  <option value="sometimes">Sometimes</option>
                </select>
              </label>
            </div>

            <div style="margin-top: 18px;">
              <div class="section-head">
                <h3>Persona</h3>
                <span class="muted">Shapes spoken overlays, not the actual agent result.</span>
              </div>
              <div class="persona-grid" id="persona-grid"></div>
            </div>

            <label style="margin-top: 18px;">
              Custom Style
              <textarea id="custom-style" placeholder="Optional tone note, e.g. calm and surgical, with one dry aside if the task is messy."></textarea>
            </label>

            <div class="secret-shell" id="secret-shell" style="margin-top: 18px;">
              <div class="section-head">
                <h3>Voice Vault</h3>
                <span class="secret-note">hidden rack unlocked</span>
              </div>
              <div class="vault-grid" id="vault-grid"></div>
            </div>

            <div class="actions" style="margin-top: 18px;">
              <button class="primary" id="save-profile">Save Profile</button>
              <button class="secondary" id="reload-profile">Reload</button>
            </div>
          </section>
        </div>

        <div class="stack">
          <section class="panel">
            <div class="section-head">
              <h2>Preview</h2>
              <span class="muted">Hear the next turn before you commit it.</span>
            </div>

            <div class="preview-box">
              <div class="preview-label">Receipt Preview</div>
              <div class="preview-text" id="ack-preview">Got it. I’m sending that to Amplink now.</div>
              <div class="actions">
                <button class="secondary" data-preview-stage="ack">Play Receipt</button>
              </div>
            </div>

            <div class="preview-box">
              <div class="preview-label">Completion Preview</div>
              <div class="preview-text" id="result-preview">Amplink finished the task and the result is ready.</div>
              <div class="actions">
                <button class="secondary" data-preview-stage="result">Play Completion</button>
              </div>
            </div>

            <div class="status" id="status"></div>
          </section>
        </div>
      </section>
    </main>

    <script type="application/json" id="bootstrap">${escapeHtml(bootstrap)}</script>
    <script>
      const bootstrap = JSON.parse(document.getElementById("bootstrap").textContent);
      const state = {
        origin: bootstrap.origin,
        token: bootstrap.token || new URLSearchParams(location.search).get("token") || "",
        userId: bootstrap.userId,
        profile: bootstrap.profile,
        presets: bootstrap.presets || [],
        audio: null,
        secretUnlocked: new URLSearchParams(location.search).get("vault") === "1",
      };

      const personaDescriptions = {
        operator: "Direct, composed, and efficient. The clean default.",
        warm: "Friendly and smooth without turning chatty.",
        dry: "Terse, with a little edge and a straight face.",
        roast: "Playful teasing in tiny doses. Never mean."
      };

      const userIdInput = document.getElementById("user-id");
      const voiceIdInput = document.getElementById("voice-id");
      const speechRateInput = document.getElementById("speech-rate");
      const speechRateLabel = document.getElementById("speech-rate-label");
      const ttsModeSelect = document.getElementById("tts-mode");
      const roastFrequencySelect = document.getElementById("roast-frequency");
      const customStyleInput = document.getElementById("custom-style");
      const updatedAt = document.getElementById("updated-at");
      const status = document.getElementById("status");
      const ackPreview = document.getElementById("ack-preview");
      const resultPreview = document.getElementById("result-preview");
      const personaGrid = document.getElementById("persona-grid");
      const secretShell = document.getElementById("secret-shell");
      const vaultGrid = document.getElementById("vault-grid");
      const eyebrowToggle = document.getElementById("eyebrow-toggle");
      let eyebrowTapCount = 0;
      let eyebrowTapTimer = null;

      renderPersonaCards();
      renderVoiceVault();
      hydrateForm(state.profile);
      syncSecretVault();

      document.getElementById("save-profile").addEventListener("click", saveProfile);
      document.getElementById("reload-profile").addEventListener("click", reloadProfile);
      speechRateInput.addEventListener("input", () => {
        updateSpeechRateLabel(Number(speechRateInput.value || 1));
      });
      speechRateInput.addEventListener("change", refreshDraftPreview);
      ttsModeSelect.addEventListener("change", refreshDraftPreview);
      roastFrequencySelect.addEventListener("change", refreshDraftPreview);
      customStyleInput.addEventListener("input", refreshDraftPreview);

      document.querySelectorAll("[data-preview-stage]").forEach((button) => {
        button.addEventListener("click", () => previewStage(button.dataset.previewStage));
      });

      userIdInput.addEventListener("change", async () => {
        state.userId = userIdInput.value.trim() || bootstrap.userId;
        await reloadProfile();
      });

      eyebrowToggle.addEventListener("click", () => {
        eyebrowTapCount += 1;
        clearTimeout(eyebrowTapTimer);
        eyebrowTapTimer = setTimeout(() => {
          eyebrowTapCount = 0;
        }, 1200);

        if (eyebrowTapCount >= 5) {
          eyebrowTapCount = 0;
          toggleSecretVault();
        }
      });

      document.addEventListener("keydown", (event) => {
        if (event.shiftKey && event.key.toLowerCase() === "v") {
          toggleSecretVault();
        }
      });

      function renderPersonaCards() {
        const personas = ["operator", "warm", "dry", "roast"];
        personaGrid.innerHTML = personas.map((persona) => \`
          <label class="persona-card" data-persona-card="\${persona}">
            <input type="radio" name="persona" value="\${persona}" \${state.profile.persona === persona ? "checked" : ""} />
            <strong>\${titleCase(persona)}</strong>
            <p>\${personaDescriptions[persona]}</p>
          </label>
        \`).join("");

        personaGrid.querySelectorAll("input[name=persona]").forEach((input) => {
          input.addEventListener("change", () => {
            highlightPersona(input.value);
            refreshDraftPreview();
          });
        });

        highlightPersona(state.profile.persona);
      }

      function highlightPersona(persona) {
        personaGrid.querySelectorAll("[data-persona-card]").forEach((card) => {
          card.classList.toggle("active", card.dataset.personaCard === persona);
        });
      }

      function renderVoiceVault() {
        vaultGrid.innerHTML = state.presets.map((preset) => \`
          <article class="vault-card">
            <div>
              <strong>\${preset.label}</strong>
              <p>\${preset.description}</p>
            </div>
            <div class="vault-meta">
              <span class="vault-pill">\${titleCase(preset.persona || "operator")}</span>
              <span class="vault-pill">\${formatTtsMode(preset.ttsMode || "both")}</span>
              <span class="vault-pill">\${formatSpeechRate(preset.speechRate || 1)}</span>
              <span class="vault-pill">\${shortVoiceId(preset.voiceId || "")}</span>
            </div>
            <div class="actions">
              <button class="secondary" data-apply-preset="\${preset.id}">Load Preset</button>
            </div>
          </article>
        \`).join("");

        vaultGrid.querySelectorAll("[data-apply-preset]").forEach((button) => {
          button.addEventListener("click", () => {
            const preset = state.presets.find((entry) => entry.id === button.dataset.applyPreset);
            if (!preset) {
              return;
            }

            applyPreset(preset);
          });
        });
      }

      function currentDraft() {
        const checked = personaGrid.querySelector("input[name=persona]:checked");
        return {
          userId: userIdInput.value.trim() || state.userId,
          voiceId: voiceIdInput.value.trim(),
          speechRate: Number(speechRateInput.value || state.profile.speechRate || 1),
          ttsMode: ttsModeSelect.value,
          persona: checked ? checked.value : state.profile.persona,
          roastFrequency: roastFrequencySelect.value,
          customStyle: customStyleInput.value.trim(),
        };
      }

      function hydrateForm(profile) {
        userIdInput.value = state.userId;
        voiceIdInput.value = profile.voiceId || "";
        speechRateInput.value = String(profile.speechRate || 1);
        updateSpeechRateLabel(Number(profile.speechRate || 1));
        ttsModeSelect.value = profile.ttsMode;
        roastFrequencySelect.value = profile.roastFrequency;
        customStyleInput.value = profile.customStyle || "";
        renderPersonaCards();
        updatedAt.textContent = profile.updatedAt ? "Updated " + new Date(profile.updatedAt).toLocaleString() : "";
        refreshDraftPreview();
      }

      function applyPreset(preset) {
        if (preset.voiceId) {
          voiceIdInput.value = preset.voiceId;
        }
        if (typeof preset.speechRate === "number") {
          speechRateInput.value = String(preset.speechRate);
          updateSpeechRateLabel(preset.speechRate);
        }
        if (preset.ttsMode) {
          ttsModeSelect.value = preset.ttsMode;
        }
        if (preset.roastFrequency) {
          roastFrequencySelect.value = preset.roastFrequency;
        }
        if (typeof preset.customStyle === "string") {
          customStyleInput.value = preset.customStyle;
        }
        if (preset.persona) {
          const input = personaGrid.querySelector(\`input[name="persona"][value="\${preset.persona}"]\`);
          if (input) {
            input.checked = true;
            highlightPersona(preset.persona);
          }
        }

        refreshDraftPreview();
        setStatus(\`\${preset.label} loaded. Save Profile to make it live.\`);
      }

      function refreshDraftPreview() {
        const draft = currentDraft();
        updateSpeechRateLabel(draft.speechRate);
        ackPreview.textContent = draft.persona === "warm"
          ? "Got it. I’m handing that to Amplink now, and I’ll keep you posted."
          : draft.persona === "dry"
            ? "Copy. Amplink has the job now."
            : draft.persona === "roast"
              ? "Fine. I’m sending that to Amplink now. Bold request, honestly."
              : "Got it. I’m sending that to Amplink now.";

        resultPreview.textContent = draft.persona === "warm"
          ? "Amplink wrapped it up. The result is ready for you."
          : draft.persona === "dry"
            ? "Done. Amplink finished without setting anything on fire."
            : draft.persona === "roast"
              ? "Amplink finished the task. Somehow the code survived."
              : "Amplink finished the task and the result is ready.";
      }

      async function reloadProfile() {
        setStatus("Reloading profile…");
        const response = await apiFetch("/api/voice-profile?user=" + encodeURIComponent(state.userId));
        if (!response.ok) {
          setStatus("Could not load the voice profile.");
          return;
        }

        const payload = await response.json();
        state.profile = payload.profile;
        state.userId = payload.profile.userId;
        hydrateForm(state.profile);
        setStatus("Profile reloaded.");
      }

      async function saveProfile() {
        setStatus("Saving profile…");
        const draft = currentDraft();
        const response = await apiFetch("/api/voice-profile?user=" + encodeURIComponent(draft.userId), {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(draft),
        });

        if (!response.ok) {
          setStatus("Could not save the voice profile.");
          return;
        }

        const payload = await response.json();
        state.profile = payload.profile;
        state.userId = payload.profile.userId;
        hydrateForm(state.profile);
        setStatus("Saved. The next voice turn will use this profile.");
      }

      async function previewStage(stage) {
        setStatus(stage === "ack" ? "Rendering receipt preview…" : "Rendering completion preview…");
        const response = await apiFetch("/api/voice-preview?user=" + encodeURIComponent(currentDraft().userId), {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            stage,
            profile: currentDraft(),
          }),
        });

        if (!response.ok) {
          setStatus("Preview failed.");
          return;
        }

        const payload = await response.json();
        if (stage === "ack") {
          ackPreview.textContent = payload.spokenText;
        } else {
          resultPreview.textContent = payload.spokenText;
        }

        if (state.audio) {
          state.audio.pause();
          state.audio = null;
        }

        if (payload.tts && payload.tts.audioBase64) {
          state.audio = new Audio("data:" + payload.tts.contentType + ";base64," + payload.tts.audioBase64);
          await state.audio.play().catch(() => {});
        }

        setStatus("Preview ready.");
      }

      async function apiFetch(path, init = {}) {
        const headers = new Headers(init.headers || {});
        if (state.token) {
          headers.set("authorization", "Bearer " + state.token);
        }

        return fetch(state.origin + path + appendToken(path), {
          ...init,
          headers,
        });
      }

      function appendToken(path) {
        if (!state.token) {
          return "";
        }

        return path.includes("?") ? "&token=" + encodeURIComponent(state.token) : "?token=" + encodeURIComponent(state.token);
      }

      function setStatus(message) {
        status.textContent = message;
      }

      function toggleSecretVault() {
        state.secretUnlocked = !state.secretUnlocked;
        syncSecretVault();
        setStatus(state.secretUnlocked ? "Voice Vault unlocked." : "Voice Vault hidden.");
      }

      function syncSecretVault() {
        secretShell.classList.toggle("revealed", state.secretUnlocked);
      }

      function formatTtsMode(value) {
        return value === "ack"
          ? "Receipt only"
          : value === "result"
            ? "Completion only"
            : value === "off"
              ? "Muted"
              : "Receipt + completion";
      }

      function updateSpeechRateLabel(value) {
        speechRateLabel.textContent = formatSpeechRate(value);
      }

      function formatSpeechRate(value) {
        const numeric = Number(value || 1);
        if (Math.abs(numeric - 1) < 0.01) {
          return "Normal pace";
        }

        if (numeric < 1) {
          return numeric.toFixed(2) + "x slower";
        }

        return numeric.toFixed(2) + "x faster";
      }

      function shortVoiceId(value) {
        return value ? "voice " + value.slice(0, 6) : "voice unset";
      }

      function titleCase(value) {
        return value.charAt(0).toUpperCase() + value.slice(1);
      }
    </script>
  </body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
