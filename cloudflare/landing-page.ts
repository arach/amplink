export function renderLandingPage(): string {
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Amplink | Voice for your AI agents</title>
    <link rel="icon" href="data:image/x-icon;base64,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" sizes="48x48">

    <meta name="title" content="Amplink | Voice for your AI agents" />
    <meta name="description" content="Talk to your desktop AI agents from your phone. Encrypted relay through Cloudflare, voice synthesis by ElevenLabs. Zero credentials on the wire." />

    <meta property="og:type" content="website" />
    <meta property="og:url" content="https://amplink.cloud/" />
    <meta property="og:title" content="Amplink | Voice for your AI agents" />
    <meta property="og:description" content="Talk to your desktop AI agents from your phone. Encrypted relay through Cloudflare, voice synthesis by ElevenLabs. Zero credentials on the wire." />

    <meta property="twitter:card" content="summary_large_image" />
    <meta property="twitter:url" content="https://amplink.cloud/" />
    <meta property="twitter:title" content="Amplink | Voice for your AI agents" />
    <meta property="twitter:description" content="Talk to your desktop AI agents from your phone. Encrypted relay through Cloudflare, voice synthesis by ElevenLabs. Zero credentials on the wire." />

    <script src="https://cdn.tailwindcss.com"></script>
    <script>
      tailwind.config = {
        theme: {
          extend: {
            colors: {
              canvas: '#0a0a0a',
              panel: '#141414',
              ink: '#e5e5e5',
              secondary: '#b5b5b5',
              muted: '#737373',
              accent: '#38bdf8',
              'accent-bright': '#7dd3fc',
              line: 'rgba(255,255,255,0.09)',
              'line-strong': 'rgba(255,255,255,0.14)',
              wave: 'rgba(56,189,248,0.10)',
            },
            fontFamily: {
              sans: ['Space Grotesk', 'system-ui', 'sans-serif'],
              mono: ['IBM Plex Mono', 'ui-monospace', 'monospace'],
              display: ['Instrument Serif', 'Georgia', 'serif'],
            },
            animation: {
              'fade-up': 'fade-up 0.5s ease-out both',
              'pulse-slow': 'pulse 3s ease-in-out infinite',
            },
            keyframes: {
              'fade-up': {
                from: { opacity: '0', transform: 'translateY(6px)' },
                to: { opacity: '1', transform: 'translateY(0)' },
              },
            },
          },
        },
      };
    </script>
    <link href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Space+Grotesk:wght@300;400;500&family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet">
    <style>
      body {
        font-family: 'Space Grotesk', system-ui, sans-serif;
        font-weight: 300;
        background:
          radial-gradient(circle at top left, rgba(56,189,248,0.08), transparent 28%),
          linear-gradient(180deg, rgba(255,255,255,0.02), rgba(255,255,255,0)),
          #0a0a0a;
        color: #e5e5e5;
        -webkit-font-smoothing: antialiased;
      }

      h1, h2, h3 { font-family: 'Instrument Serif', Georgia, serif; }

      .hero-grid {
        background-image:
          linear-gradient(to right, rgba(255,255,255,0.04) 1px, transparent 1px),
          linear-gradient(to bottom, rgba(255,255,255,0.04) 1px, transparent 1px);
        background-size: 42px 42px;
        mask-image: linear-gradient(to bottom, rgba(0,0,0,0.5), transparent 88%);
        -webkit-mask-image: linear-gradient(to bottom, rgba(0,0,0,0.5), transparent 88%);
      }

      .signal-bar {
        height: 3px;
        background: linear-gradient(90deg, transparent, #38bdf8 30%, #7dd3fc 60%, transparent);
        opacity: 0.4;
      }

      ::selection {
        background: rgba(56,189,248,0.3);
        color: white;
      }

      .delay-1 { animation-delay: 0.08s; }
      .delay-2 { animation-delay: 0.16s; }
      .delay-3 { animation-delay: 0.24s; }
      .delay-4 { animation-delay: 0.32s; }
      .delay-5 { animation-delay: 0.40s; }

      @media (prefers-reduced-motion: reduce) {
        *, *::before, *::after {
          animation-duration: 0.01ms !important;
          transition-duration: 0.01ms !important;
        }
      }

      .waveform-bar {
        display: inline-block;
        width: 3px;
        border-radius: 2px;
        background: #38bdf8;
        animation: waveform 1.2s ease-in-out infinite alternate;
      }
      .waveform-bar:nth-child(1) { height: 12px; animation-delay: 0s; }
      .waveform-bar:nth-child(2) { height: 20px; animation-delay: 0.15s; }
      .waveform-bar:nth-child(3) { height: 28px; animation-delay: 0.3s; }
      .waveform-bar:nth-child(4) { height: 16px; animation-delay: 0.45s; }
      .waveform-bar:nth-child(5) { height: 24px; animation-delay: 0.6s; }
      .waveform-bar:nth-child(6) { height: 14px; animation-delay: 0.75s; }
      .waveform-bar:nth-child(7) { height: 22px; animation-delay: 0.9s; }

      @keyframes waveform {
        0% { transform: scaleY(0.3); opacity: 0.4; }
        100% { transform: scaleY(1); opacity: 1; }
      }

      @keyframes float {
        0%, 100% { transform: translateY(0); }
        50% { transform: translateY(-8px); }
      }

      .float { animation: float 6s ease-in-out infinite; }
    </style>
  </head>
  <body>
    <!-- Grid background -->
    <div class="fixed inset-0 z-0 pointer-events-none hero-grid"></div>

    <!-- Navbar -->
    <nav id="navbar" class="fixed top-0 left-0 right-0 z-50 transition-all duration-300 border-b border-transparent">
      <div class="max-w-6xl mx-auto px-6 sm:px-8 lg:px-12 h-14 flex items-center justify-between">
        <a href="/" class="flex items-center gap-2.5 group">
          <img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACgAAAAoCAYAAACM/rhtAAAACXBIWXMAAAsTAAALEwEAmpwYAAACz0lEQVR4nO2Y63LaQAyFeQRLuwZ8wdgEAjRpQp6qk759+wLqHC3X9QUGL4VO82PHZhecL5LOkWAQReZnFPFvIiOPtCLH9Dl4RDjaQ5pfg3tD0Jn1BUhfEaQHrkFmW1tt+7w9O3fe9blggES4XgdIdEPAywBMw/7pmQ8ZELA9CuwB+u95SlmqlOVbQTLPWc+XOclLQWI4AGD9vF5bdAJ4eM88Y5mnJOWYZZaSxMbKLGVZFySLrAdgiJUNjYIVY5ZxbGRsjV4dLOtrvjbFuwgc15C/zy1RxuvYWlnlpKksE1Kw2BiZJSSrCckipX412KTWdiXaWmmgvt6mJM85iWUjydDIc0byVpLW4k1tpk3JzFassfJ9SvJRkSwnqDGIhGSWOJFgL4iKT4VQN1vyhII1io28Tkk2pYsczha5SylUDLH8BaNutpLpmOUpI3kvo32U1ojkLNI6TIfdHnk1YJOl+GtZkFpIlZLMM9I0w0IQTUQP4tipNRjgQShd+1YjB7B8xGorsTV6P88d7NBaz0rOgwUDHFqraS1TUrgkxp6RMmGtPdgLN9hUEEA/FX4NWmO1G2zKSCOFyAEOYFAxbKbLAfxnBhMJrsZYWRVbAUxczRXbVKPuAN72j91cxegQ8LOPygnA9VvSyMFaAOd3m11KuyzqKkDfSlBnaF+b6mAlK6S5coCIYJuBH6c4GODxw+Ypa/HD09CyDFuN2Hvl6m00tLrXHKVmi+rtg7t7zHNII+psmrD21iphTbHzuYOVHP5wPcWnz+3d6txCBwDUfmSKnZ1UKWt/Rdq7RqY+62wEdWSakKwnpIY8shiZrKb4dTtw1muprtr2FPcEBBjGIwgAVoLIYZ6DlbwcqfWclVwyaFwtknoxtwFYr+baB42gPniJ2XIrVPckFGSaaUsTd0S4+/tvoAg+whrcG4C+AOl/j2D0D/yI/ombe8M0wRGZH38A/umWrP4/vy4AAAAASUVORK5CYII=" class="w-6 h-6 rounded-lg">
          <span class="font-mono text-[12px] uppercase tracking-[0.14em] text-ink">amplink</span>
          <span class="hidden sm:inline-block rounded-full bg-wave px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.1em] text-accent">hackathon</span>
        </a>

        <div class="hidden md:flex items-center gap-1">
          <a href="#how-it-works" class="rounded-md px-3.5 py-1.5 font-mono text-[12px] uppercase tracking-[0.14em] text-muted hover:bg-wave hover:text-ink transition-colors">How it Works</a>
          <a href="#features" class="rounded-md px-3.5 py-1.5 font-mono text-[12px] uppercase tracking-[0.14em] text-muted hover:bg-wave hover:text-ink transition-colors">Features</a>
          <a href="https://github.com/arach/amplink" target="_blank" rel="noopener noreferrer" class="rounded-md px-3.5 py-1.5 font-mono text-[12px] uppercase tracking-[0.14em] text-muted hover:bg-wave hover:text-ink transition-colors flex items-center gap-2">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4"/><path d="M9 18c-4.51 2-5-2-7-2"/></svg>
            GitHub
          </a>
        </div>

        <button id="mobile-toggle" class="md:hidden text-ink" onclick="document.getElementById('mobile-menu').classList.toggle('hidden')">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="4" x2="20" y1="12" y2="12"/><line x1="4" x2="20" y1="6" y2="6"/><line x1="4" x2="20" y1="18" y2="18"/></svg>
        </button>
      </div>

      <div id="mobile-menu" class="hidden absolute top-full left-0 right-0 bg-canvas/95 backdrop-blur-xl border-b border-line p-6 md:hidden flex flex-col gap-4">
        <a href="#how-it-works" class="font-mono text-[12px] uppercase tracking-[0.14em] text-muted hover:text-ink">How it Works</a>
        <a href="#features" class="font-mono text-[12px] uppercase tracking-[0.14em] text-muted hover:text-ink">Features</a>
        <a href="https://github.com/arach/amplink" target="_blank" rel="noopener noreferrer" class="font-mono text-[12px] uppercase tracking-[0.14em] text-muted hover:text-ink">GitHub</a>
      </div>
    </nav>

    <!-- Hero -->
    <section class="relative pt-32 pb-16 lg:pt-44 lg:pb-24 z-10">
      <div class="max-w-6xl mx-auto px-6 sm:px-8 lg:px-12">
        <div class="flex flex-col lg:grid lg:grid-cols-[1.3fr_0.7fr] gap-16 items-center">

          <div class="text-center lg:text-left">
            <div class="animate-fade-up">
              <div class="inline-flex items-center gap-2.5 px-3 py-1.5 rounded-full bg-wave border border-line text-accent font-mono text-[10px] uppercase tracking-[0.1em] mb-10">
                <span class="w-1.5 h-1.5 rounded-full bg-accent animate-pulse"></span>
                Cloudflare + ElevenLabs
              </div>
            </div>

            <h1 class="animate-fade-up delay-1 text-4xl sm:text-6xl lg:text-[5.4rem] font-display tracking-[-0.04em] leading-[1.05] mb-8 text-ink">
              Your local agents, <em class="text-accent">on your phone</em>
            </h1>

            <p class="animate-fade-up delay-2 text-[15px] leading-7 text-secondary max-w-xl mx-auto lg:mx-0 mb-10">
              Give your phone a live viewport into Claude Code, GPT, or any agent running on your machine. API keys stay local. Everything streams through an encrypted relay.
            </p>

            <div class="animate-fade-up delay-3 flex flex-col sm:flex-row items-center justify-center lg:justify-start gap-3">
              <a
                href="https://github.com/arach/amplink"
                target="_blank"
                rel="noopener noreferrer"
                class="group inline-flex h-11 items-center gap-2 rounded-lg bg-accent px-6 font-mono text-[12px] uppercase tracking-[0.1em] text-black transition-all hover:bg-accent-bright"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4"/><path d="M9 18c-4.51 2-5-2-7-2"/></svg>
                View on GitHub
              </a>
              <button
                onclick="navigator.clipboard.writeText('bun install && bun run desktop:up');this.querySelector('.copy-icon').classList.add('hidden');this.querySelector('.check-icon').classList.remove('hidden');setTimeout(()=>{this.querySelector('.copy-icon').classList.remove('hidden');this.querySelector('.check-icon').classList.add('hidden')},2000)"
                class="inline-flex h-11 items-center gap-3 rounded-lg border border-line-strong bg-panel px-5 font-mono text-[12px] text-secondary transition-colors hover:border-accent/30 hover:bg-canvas hover:text-ink"
              >
                <span class="text-muted select-none">$</span>
                <span>bun run desktop:up</span>
                <svg class="copy-icon text-muted ml-1" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>
                <svg class="check-icon hidden text-accent ml-1" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
              </button>
            </div>
          </div>

          <!-- Phone mockup with waveform -->
          <div class="animate-fade-up delay-4 w-full flex justify-center">
            <div class="relative">
              <!-- Phone frame -->
              <div class="w-[260px] rounded-[2.5rem] border-2 border-line-strong bg-canvas p-3 shadow-[0_24px_80px_rgba(0,0,0,0.4)]">
                <!-- Notch -->
                <div class="absolute top-0 left-1/2 -translate-x-1/2 w-28 h-6 bg-canvas rounded-b-2xl border-x-2 border-b-2 border-line-strong z-10"></div>
                <!-- Screen -->
                <div class="rounded-[2rem] bg-panel overflow-hidden">
                  <!-- Status bar -->
                  <div class="px-6 pt-8 pb-3 flex items-center justify-between">
                    <span class="font-mono text-[9px] text-muted">9:41</span>
                    <div class="flex items-center gap-1">
                      <span class="w-1.5 h-1.5 rounded-full bg-accent animate-pulse"></span>
                      <span class="font-mono text-[9px] text-accent">live</span>
                    </div>
                  </div>

                  <!-- Session info -->
                  <div class="px-6 pb-4">
                    <div class="text-[11px] text-muted font-mono uppercase tracking-wider mb-1">Session</div>
                    <div class="text-[14px] text-ink font-medium">Claude Code</div>
                    <div class="text-[11px] text-secondary mt-0.5">~/dev/amplink</div>
                  </div>

                  <!-- Chat bubbles -->
                  <div class="px-4 space-y-3 pb-4">
                    <div class="bg-wave rounded-xl rounded-tl-sm px-3.5 py-2.5 max-w-[85%]">
                      <p class="text-[12px] text-ink leading-5">Add error handling to the WebSocket relay</p>
                    </div>
                    <div class="bg-canvas/60 rounded-xl rounded-tr-sm px-3.5 py-2.5 max-w-[85%] ml-auto border border-line">
                      <p class="text-[12px] text-secondary leading-5">Done. Added reconnect with exponential backoff and graceful shutdown.</p>
                    </div>
                  </div>

                  <!-- Waveform area -->
                  <div class="px-6 py-6 flex flex-col items-center gap-4">
                    <div class="flex items-end gap-[3px] h-8">
                      <span class="waveform-bar"></span>
                      <span class="waveform-bar"></span>
                      <span class="waveform-bar"></span>
                      <span class="waveform-bar"></span>
                      <span class="waveform-bar"></span>
                      <span class="waveform-bar"></span>
                      <span class="waveform-bar"></span>
                    </div>
                    <div class="font-mono text-[10px] text-muted uppercase tracking-wider">Listening...</div>
                  </div>

                  <!-- Bottom bar -->
                  <div class="px-4 pb-5 pt-2">
                    <div class="flex items-center gap-3 rounded-full bg-canvas border border-line px-4 py-2.5">
                      <div class="w-7 h-7 rounded-full bg-accent/20 flex items-center justify-center">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#38bdf8" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/></svg>
                      </div>
                      <span class="text-[12px] text-muted flex-1">Ask anything...</span>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#737373" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" x2="11" y1="2" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
                    </div>
                  </div>
                </div>
              </div>

              <!-- Floating badges -->
              <div class="absolute -left-16 top-16 float" style="animation-delay: 0.5s;">
                <div class="rounded-lg border border-line bg-canvas/90 backdrop-blur px-3 py-2 flex items-center gap-2 shadow-lg">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#38bdf8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                  <span class="font-mono text-[10px] text-accent">encrypted</span>
                </div>
              </div>
              <div class="absolute -right-14 top-36 float" style="animation-delay: 1.5s;">
                <div class="rounded-lg border border-line bg-canvas/90 backdrop-blur px-3 py-2 flex items-center gap-2 shadow-lg">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#38bdf8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/></svg>
                  <span class="font-mono text-[10px] text-accent">voice</span>
                </div>
              </div>
              <div class="absolute -left-12 bottom-20 float" style="animation-delay: 2.5s;">
                <div class="rounded-lg border border-line bg-canvas/90 backdrop-blur px-3 py-2 flex items-center gap-2 shadow-lg">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#38bdf8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2"/></svg>
                  <span class="font-mono text-[10px] text-accent">realtime</span>
                </div>
              </div>
            </div>
          </div>

        </div>
      </div>
    </section>

    <!-- Tech stack logos -->
    <section class="py-12 border-y border-line bg-panel px-6 sm:px-8 lg:px-12 relative z-10">
      <div class="max-w-6xl mx-auto mb-8 text-center">
        <p class="font-mono text-[10px] text-muted uppercase tracking-[0.14em]">Built with</p>
      </div>
      <div class="w-full flex justify-center">
        <div class="flex items-center gap-12 md:gap-20">
          <div class="flex items-center gap-2.5 opacity-40 hover:opacity-100 transition-opacity duration-300">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" stroke="#e5e5e5" stroke-width="1.5" fill="none"/>
              <path d="M14 2v6h6" stroke="#e5e5e5" stroke-width="1.5" fill="none"/>
            </svg>
            <span class="font-mono text-[13px] text-ink hidden md:block">Cloudflare Workers</span>
          </div>
          <div class="flex items-center gap-2.5 opacity-40 hover:opacity-100 transition-opacity duration-300">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#e5e5e5" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/>
              <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
              <line x1="12" x2="12" y1="19" y2="22"/>
            </svg>
            <span class="font-mono text-[13px] text-ink hidden md:block">ElevenLabs</span>
          </div>
          <div class="flex items-center gap-2.5 opacity-40 hover:opacity-100 transition-opacity duration-300">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#e5e5e5" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <rect width="18" height="11" x="3" y="11" rx="2" ry="2"/>
              <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
            </svg>
            <span class="font-mono text-[13px] text-ink hidden md:block">Noise Protocol</span>
          </div>
          <div class="flex items-center gap-2.5 opacity-40 hover:opacity-100 transition-opacity duration-300">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#e5e5e5" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <rect x="5" y="2" width="14" height="20" rx="2" ry="2"/>
              <path d="M12 18h.01"/>
            </svg>
            <span class="font-mono text-[13px] text-ink hidden md:block">iOS / Swift</span>
          </div>
        </div>
      </div>
    </section>

    <!-- Features -->
    <section id="features" class="py-24 px-6 sm:px-8 lg:px-12 relative z-10">
      <div class="max-w-6xl mx-auto">
        <div class="mb-16">
          <h2 class="text-3xl sm:text-5xl font-display italic tracking-[-0.03em] mb-5 text-ink">
            Your phone becomes the viewport.
          </h2>
          <p class="text-[15px] leading-7 text-secondary max-w-2xl">
            One app on your phone connects to any number of AI agents running on your desktop. Voice in, voice out, fully encrypted.
          </p>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-px bg-line rounded-xl overflow-hidden border border-line">
          <div class="group bg-canvas p-8 transition-colors hover:bg-panel">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#38bdf8" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="mb-5"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/></svg>
            <h3 class="font-mono text-[13px] uppercase tracking-[0.08em] text-ink mb-3">Voice First</h3>
            <p class="text-[15px] leading-7 text-secondary">Talk to your agents naturally. ElevenLabs handles speech synthesis with low-latency streaming. Speak, listen, iterate.</p>
          </div>
          <div class="group bg-canvas p-8 transition-colors hover:bg-panel">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#38bdf8" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="mb-5"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
            <h3 class="font-mono text-[13px] uppercase tracking-[0.08em] text-ink mb-3">End-to-End Encrypted</h3>
            <p class="text-[15px] leading-7 text-secondary">Noise Protocol XX handshake with X25519, AES-256-GCM, SHA-256. The relay forwards opaque bytes it can never read.</p>
          </div>
          <div class="group bg-canvas p-8 transition-colors hover:bg-panel">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#38bdf8" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="mb-5"><path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2"/></svg>
            <h3 class="font-mono text-[13px] uppercase tracking-[0.08em] text-ink mb-3">Realtime Streaming</h3>
            <p class="text-[15px] leading-7 text-secondary">Agent responses stream block-by-block as they generate. See text, reasoning, actions, and file changes live on your phone.</p>
          </div>
          <div class="group bg-canvas p-8 transition-colors hover:bg-panel">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#38bdf8" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="mb-5"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>
            <h3 class="font-mono text-[13px] uppercase tracking-[0.08em] text-ink mb-3">Multi-Agent</h3>
            <p class="text-[15px] leading-7 text-secondary">Connect to Claude Code, GPT via OpenAI-compat, Codex, or any custom adapter. One phone, as many agents as you need.</p>
          </div>
          <div class="group bg-canvas p-8 transition-colors hover:bg-panel">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#38bdf8" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="mb-5"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10"/></svg>
            <h3 class="font-mono text-[13px] uppercase tracking-[0.08em] text-ink mb-3">Zero Credentials</h3>
            <p class="text-[15px] leading-7 text-secondary">API keys and tokens stay on your desktop. The bridge runs locally. Amplink is a viewport, never a credential store.</p>
          </div>
          <div class="group bg-canvas p-8 transition-colors hover:bg-panel">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#38bdf8" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="mb-5"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/></svg>
            <h3 class="font-mono text-[13px] uppercase tracking-[0.08em] text-ink mb-3">Cloudflare Edge</h3>
            <p class="text-[15px] leading-7 text-secondary">Relay runs on Cloudflare Durable Objects. Globally distributed, low-latency, with D1 for session persistence.</p>
          </div>
        </div>
      </div>
    </section>

    <!-- How it Works -->
    <section id="how-it-works" class="border-y border-line bg-panel px-6 sm:px-8 lg:px-12 py-24 relative z-10">
      <div class="max-w-6xl mx-auto">
        <div class="mb-16">
          <h2 class="text-3xl sm:text-5xl font-display italic tracking-[-0.03em] mb-5 text-ink">
            Three hops. Full encryption.
          </h2>
          <p class="text-[15px] leading-7 text-secondary max-w-2xl">
            Your voice goes from phone to relay to bridge &mdash; each hop encrypted, the relay zero-knowledge.
          </p>
        </div>

        <div class="flex flex-col lg:flex-row gap-16">
          <!-- Steps -->
          <div class="lg:w-1/2 space-y-10">
            <div class="flex gap-5">
              <div class="flex-shrink-0 w-8 h-8 rounded-full border border-accent/30 bg-wave flex items-center justify-center font-mono text-[12px] text-accent">1</div>
              <div>
                <h4 class="font-mono text-[13px] uppercase tracking-[0.08em] text-ink mb-2">Start the desktop stack</h4>
                <p class="text-[15px] leading-7 text-secondary mb-3">
                  Run the bridge and desktop listener on your machine. It spawns adapters for each agent you configure &mdash; Claude Code, OpenAI-compat, or your own.
                </p>
                <code class="inline-block rounded-md border border-line-strong bg-canvas px-3 py-1.5 font-mono text-[12px] text-secondary">
                  bun run desktop:up
                </code>
              </div>
            </div>

            <div class="flex gap-5">
              <div class="flex-shrink-0 w-8 h-8 rounded-full border border-accent/30 bg-wave flex items-center justify-center font-mono text-[12px] text-accent">2</div>
              <div>
                <h4 class="font-mono text-[13px] uppercase tracking-[0.08em] text-ink mb-2">Scan the QR code</h4>
                <p class="text-[15px] leading-7 text-secondary mb-3">
                  The bridge prints a QR code with the relay URL and session key. Scan it with the iOS app to pair. Noise XX handshake completes in milliseconds.
                </p>
                <div class="rounded-lg border border-line bg-canvas p-5">
                  <p class="font-mono text-[10px] uppercase tracking-[0.14em] text-muted mb-3">Handshake</p>
                  <ul class="space-y-2">
                    <li class="flex items-start gap-2.5 text-[13px] text-secondary">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#38bdf8" stroke-width="2" class="mt-1 flex-shrink-0"><path d="M20 6 9 17l-5-5"/></svg>
                      <span>X25519 key exchange over Noise XX</span>
                    </li>
                    <li class="flex items-start gap-2.5 text-[13px] text-secondary">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#38bdf8" stroke-width="2" class="mt-1 flex-shrink-0"><path d="M20 6 9 17l-5-5"/></svg>
                      <span>AES-256-GCM for all session traffic</span>
                    </li>
                    <li class="flex items-start gap-2.5 text-[13px] text-secondary">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#38bdf8" stroke-width="2" class="mt-1 flex-shrink-0"><path d="M20 6 9 17l-5-5"/></svg>
                      <span>Relay sees only opaque ciphertext</span>
                    </li>
                    <li class="flex items-start gap-2.5 text-[13px] text-secondary">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#38bdf8" stroke-width="2" class="mt-1 flex-shrink-0"><path d="M20 6 9 17l-5-5"/></svg>
                      <span>Session keys rotated per connection</span>
                    </li>
                  </ul>
                </div>
              </div>
            </div>

            <div class="flex gap-5">
              <div class="flex-shrink-0 w-8 h-8 rounded-full border border-accent/30 bg-wave flex items-center justify-center font-mono text-[12px] text-accent">3</div>
              <div>
                <h4 class="font-mono text-[13px] uppercase tracking-[0.08em] text-ink mb-2">Talk to your agents</h4>
                <p class="text-[15px] leading-7 text-secondary mb-3">
                  Voice or text, your prompts flow to the bridge. Responses stream back as blocks &mdash; text, reasoning, tool calls, file edits &mdash; rendered live on your phone.
                </p>
                <code class="inline-block rounded-md border border-line-strong bg-canvas px-3 py-1.5 font-mono text-[12px] text-secondary">
                  "Add tests for the relay module"
                </code>
              </div>
            </div>
          </div>

          <!-- Visual diagram -->
          <div class="lg:w-1/2 lg:sticky lg:top-32 self-start">
            <div class="relative">
              <!-- Connection line -->
              <div class="absolute top-1/2 left-0 w-full h-px bg-gradient-to-r from-accent/20 via-accent/10 to-accent/20 -translate-y-1/2 hidden md:block"></div>

              <div class="grid grid-cols-1 md:grid-cols-3 gap-6 md:gap-0 relative z-10">
                <div class="flex flex-col items-center">
                  <div class="w-20 h-20 rounded-xl border border-line-strong bg-canvas flex items-center justify-center mb-4 transition-transform duration-300 hover:-translate-y-1">
                    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#38bdf8" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="2" width="14" height="20" rx="2" ry="2"/><path d="M12 18h.01"/></svg>
                  </div>
                  <span class="font-mono text-[12px] uppercase tracking-[0.08em] text-ink">Phone</span>
                  <span class="text-[12px] text-muted mt-1">voice + text</span>
                  <div class="md:hidden mt-4 text-muted">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="transform:rotate(90deg)"><path d="m5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
                  </div>
                </div>

                <div class="flex flex-col items-center">
                  <div class="w-20 h-20 rounded-xl border border-line-strong bg-canvas flex items-center justify-center mb-4 transition-transform duration-300 hover:-translate-y-1">
                    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#38bdf8" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/></svg>
                  </div>
                  <span class="font-mono text-[12px] uppercase tracking-[0.08em] text-ink">Relay</span>
                  <span class="text-[12px] text-muted mt-1">Cloudflare edge</span>
                  <div class="md:hidden mt-4 text-muted">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="transform:rotate(90deg)"><path d="m5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
                  </div>
                </div>

                <div class="flex flex-col items-center">
                  <div class="w-20 h-20 rounded-xl border border-line-strong bg-canvas flex items-center justify-center mb-4 transition-transform duration-300 hover:-translate-y-1">
                    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#38bdf8" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" x2="16" y1="21" y2="21"/><line x1="12" x2="12" y1="17" y2="21"/></svg>
                  </div>
                  <span class="font-mono text-[12px] uppercase tracking-[0.08em] text-ink">Bridge</span>
                  <span class="text-[12px] text-muted mt-1">your machine</span>
                </div>
              </div>
            </div>

            <!-- Status card -->
            <div class="mt-10 rounded-lg border border-line-strong bg-canvas p-5 font-mono text-[12px] leading-6 text-secondary">
              <div class="signal-bar mb-4 rounded-full"></div>
              <div class="flex justify-between mb-1.5">
                <span class="text-muted">session</span>
                <span class="text-ink">claude-code-01</span>
              </div>
              <div class="flex justify-between mb-1.5">
                <span class="text-muted">adapter</span>
                <span class="text-accent flex items-center gap-1.5">
                  <span class="w-1.5 h-1.5 rounded-full bg-accent animate-pulse"></span>
                  claude-code
                </span>
              </div>
              <div class="flex justify-between mb-1.5">
                <span class="text-muted">encryption</span>
                <span class="text-secondary">noise-xx / aes-256-gcm</span>
              </div>
              <div class="flex justify-between">
                <span class="text-muted">voice</span>
                <span class="text-secondary">elevenlabs streaming</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- Architecture CTA -->
    <section class="py-28 relative z-10">
      <div class="max-w-3xl mx-auto px-6 text-center">
        <h2 class="text-3xl sm:text-5xl font-display italic tracking-[-0.03em] mb-6 text-ink">
          Your agents. Your voice. Your machine.
        </h2>
        <p class="text-[15px] leading-7 text-secondary mb-10 max-w-lg mx-auto">
          Amplink is a viewport, not a platform. It never touches your API keys, never stores your conversations, and the relay can't read your data.
        </p>
        <div class="flex flex-col sm:flex-row items-center justify-center gap-3">
          <a
            href="https://github.com/arach/amplink"
            target="_blank"
            rel="noopener noreferrer"
            class="group inline-flex h-11 items-center gap-2 rounded-lg bg-ink px-6 font-mono text-[12px] uppercase tracking-[0.1em] text-canvas transition-all hover:opacity-90"
          >
            View on GitHub
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="transition-transform group-hover:-translate-y-px group-hover:translate-x-px"><path d="m5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
          </a>
          <a
            href="https://github.com/arach/amplink#readme"
            target="_blank"
            rel="noopener noreferrer"
            class="inline-flex h-11 items-center gap-2 rounded-lg border border-line-strong px-6 font-mono text-[12px] uppercase tracking-[0.1em] text-secondary transition-colors hover:border-accent/50 hover:text-ink hover:bg-wave"
          >
            Read the Docs
          </a>
        </div>
      </div>
    </section>

    <!-- Footer -->
    <footer class="border-t border-line px-6 sm:px-8 lg:px-12 py-12 relative z-10">
      <div class="max-w-6xl mx-auto flex flex-col sm:flex-row justify-between items-start sm:items-center gap-6">
        <div class="flex items-center gap-4">
          <span class="font-mono text-[12px] uppercase tracking-[0.14em] text-ink">amplink</span>
          <span class="text-line-strong">|</span>
          <span class="text-[13px] text-muted">MIT License</span>
        </div>

        <div class="flex items-center gap-1">
          <a href="https://github.com/arach/amplink" target="_blank" rel="noopener noreferrer" class="rounded-md px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.08em] text-muted hover:bg-wave hover:text-ink transition-colors flex items-center gap-1.5">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4"/><path d="M9 18c-4.51 2-5-2-7-2"/></svg>
            GitHub
          </a>
          <a href="https://x.com/ArachAhmadi" target="_blank" rel="noopener noreferrer" class="rounded-md px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.08em] text-muted hover:bg-wave hover:text-ink transition-colors flex items-center gap-1.5">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 4s-.7 2.1-2 3.4c1.6 10-9.4 17.3-18 11.6 2.2.1 4.4-.6 6-2C3 15.5.5 9.6 3 5c2.2 2.6 5.6 4.1 9 4-.9-4.2 4-6.6 7-3.8 1.1 0 3-1.2 3-1.2z"/></svg>
            Twitter
          </a>
        </div>
      </div>
    </footer>

    <script>
      // Scroll-triggered navbar blur
      window.addEventListener('scroll', () => {
        const nav = document.getElementById('navbar');
        if (window.scrollY > 20) {
          nav.classList.add('bg-canvas/92', 'backdrop-blur-xl', 'border-line');
          nav.classList.remove('border-transparent');
        } else {
          nav.classList.remove('bg-canvas/92', 'backdrop-blur-xl', 'border-line');
          nav.classList.add('border-transparent');
        }
      });

      // Smooth scroll for hash links
      document.querySelectorAll('a[href^="#"]').forEach(a => {
        a.addEventListener('click', e => {
          e.preventDefault();
          const el = document.getElementById(a.getAttribute('href').slice(1));
          if (el) el.scrollIntoView({ behavior: 'smooth' });
          document.getElementById('mobile-menu').classList.add('hidden');
        });
      });
    </script>
  </body>
</html>`;
}
