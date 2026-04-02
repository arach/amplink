export function renderDemoPage(): string {
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Amplink | Setup Guide</title>
    <meta name="title" content="Amplink | Setup Guide" />
    <meta name="description" content="Get Amplink running in minutes. Bridge, relay, phone — see the full setup flow." />
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
      ::selection { background: rgba(56,189,248,0.3); color: white; }
    </style>
  </head>
  <body>
    <!-- Navbar -->
    <nav class="fixed top-0 left-0 right-0 z-50 bg-canvas/92 backdrop-blur-xl border-b border-line">
      <div class="max-w-6xl mx-auto px-6 sm:px-8 lg:px-12 h-14 flex items-center justify-between">
        <a href="/" class="flex items-center gap-2.5 group">
          <img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACgAAAAoCAYAAACM/rhtAAAACXBIWXMAAAsTAAALEwEAmpwYAAACz0lEQVR4nO2Y63LaQAyFeQRLuwZ8wdgEAjRpQp6qk759+wLqHC3X9QUGL4VO82PHZhecL5LOkWAQReZnFPFvIiOPtCLH9Dl4RDjaQ5pfg3tD0Jn1BUhfEaQHrkFmW1tt+7w9O3fe9blggES4XgdIdEPAywBMw/7pmQ8ZELA9CuwB+u95SlmqlOVbQTLPWc+XOclLQWI4AGD9vF5bdAJ4eM88Y5mnJOWYZZaSxMbKLGVZFySLrAdgiJUNjYIVY5ZxbGRsjV4dLOtrvjbFuwgc15C/zy1RxuvYWlnlpKksE1Kw2BiZJSSrCckipX412KTWdiXaWmmgvt6mJM85iWUjydDIc0byVpLW4k1tpk3JzFassfJ9SvJRkSwnqDGIhGSWOJFgL4iKT4VQN1vyhII1io28Tkk2pYsczha5SylUDLH8BaNutpLpmOUpI3kvo32U1ojkLNI6TIfdHnk1YJOl+GtZkFpIlZLMM9I0w0IQTUQP4tipNRjgQShd+1YjB7B8xGorsTV6P88d7NBaz0rOgwUDHFqraS1TUrgkxp6RMmGtPdgLN9hUEEA/FX4NWmO1G2zKSCOFyAEOYFAxbKbLAfxnBhMJrsZYWRVbAUxczRXbVKPuAN72j91cxegQ8LOPygnA9VvSyMFaAOd3m11KuyzqKkDfSlBnaF+b6mAlK6S5coCIYJuBH6c4GODxw+Ypa/HD09CyDFuN2Hvl6m00tLrXHKVmi+rtg7t7zHNII+psmrD21iphTbHzuYOVHP5wPcWnz+3d6txCBwDUfmSKnZ1UKWt/Rdq7RqY+62wEdWSakKwnpIY8shiZrKb4dTtw1muprtr2FPcEBBjGIwgAVoLIYZ6DlbwcqfWclVwyaFwtknoxtwFYr+baB42gPniJ2XIrVPckFGSaaUsTd0S4+/tvoAg+whrcG4C+AOl/j2D0D/yI/ombe8M0wRGZH38A/umWrP4/vy4AAAAASUVORK5CYII=" class="w-6 h-6 rounded-lg">
          <span class="font-mono text-[12px] uppercase tracking-[0.14em] text-ink">amplink</span>
        </a>
        <div class="flex items-center gap-1">
          <a href="/" class="rounded-md px-3.5 py-1.5 font-mono text-[12px] uppercase tracking-[0.14em] text-muted hover:bg-wave hover:text-ink transition-colors">Home</a>
          <a href="https://github.com/arach/amplink" target="_blank" rel="noopener noreferrer" class="rounded-md px-3.5 py-1.5 font-mono text-[12px] uppercase tracking-[0.14em] text-muted hover:bg-wave hover:text-ink transition-colors flex items-center gap-2">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4"/><path d="M9 18c-4.51 2-5-2-7-2"/></svg>
            GitHub
          </a>
        </div>
      </div>
    </nav>

    <!-- Demo -->
    <section class="relative pt-28 pb-24 z-10">
      <div class="max-w-4xl mx-auto px-6 sm:px-8 lg:px-12">
        <div class="text-center mb-12">
          <h1 class="text-3xl sm:text-5xl font-display italic tracking-[-0.03em] mb-5 text-ink">
            Setup Guide
          </h1>
          <p class="text-[15px] leading-7 text-secondary max-w-xl mx-auto">
            Get Amplink running in minutes. Bridge, relay, phone — see the full setup flow.
          </p>
        </div>

        <!-- Video -->
        <div class="relative aspect-video rounded-2xl border border-line-strong bg-panel overflow-hidden">
          <video
            class="w-full h-full object-contain"
            controls
            playsinline
            preload="metadata"
          >
            <source src="/amp-001-setup.mp4" type="video/mp4" />
            Your browser does not support the video tag.
          </video>
        </div>

        <!-- Back link -->
        <div class="mt-10 text-center">
          <a href="/" class="inline-flex items-center gap-2 font-mono text-[12px] uppercase tracking-[0.14em] text-muted hover:text-ink transition-colors">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 19-7-7 7-7"/><path d="M19 12H5"/></svg>
            Back to home
          </a>
        </div>
      </div>
    </section>
  </body>
</html>`;
}
