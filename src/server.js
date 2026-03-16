'use strict'

console.log('BOOT: starting server.js [MicroSaaS mode]')

require('dotenv').config()

const fastify = require('fastify')({
  logger: true,
  bodyLimit: Number(process.env.BODY_LIMIT_BYTES || 20 * 1024 * 1024)
})

const crypto = require('crypto')
const { initPdfEngine, generatePdf, closeEngine, isReady } = require('./services/pdfEngine')
const { renderTemplate, sanitizeFullHtml } = require('./services/templateEngine')
const { KeyStore, PLANS } = require('./services/keyStore')

const PORT             = Number(process.env.PORT || 7860)
const PDF_TIMEOUT      = Number(process.env.PDF_TIMEOUT_MS || 120000)
const STARTUP_RETRIES  = Number(process.env.STARTUP_RETRIES || 5)
const STARTUP_RETRY_MS = Number(process.env.STARTUP_RETRY_DELAY_MS || 3000)
const MAX_CONCURRENT   = Number(process.env.MAX_CONCURRENT_PDFS || 5)
const KEEP_ALIVE       = String(process.env.KEEP_BROWSER_ALIVE || '0') === '1'
const SKIP_SANITIZE    = String(process.env.SKIP_HTML_SANITIZE || '0') === '1'
const ADMIN_SECRET     = process.env.ADMIN_SECRET
const UPGRADE_URL      = process.env.UPGRADE_URL || ''

if (!process.env.API_SECRET && !ADMIN_SECRET) {
  console.error('Defina API_SECRET ou ADMIN_SECRET no Settings -> Variables.')
  process.exit(1)
}

const keyStore = new KeyStore(process.env.API_SECRET)

const jobs = new Map()
const JOB_TTL_MS = 30 * 60 * 1000

let activeJobs = 0

// ─── LANDING PAGE ─────────────────────────────────────────────────────────────

const LANDING_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>PDF Generator API</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Syne:wght@400;700;800&family=DM+Sans:wght@300;400;500;600&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
  :root {
    --bg:#09090b; --s1:#111115; --s2:#18181e; --s3:#202028;
    --border:#2c2c38; --text:#e2e2f0; --muted:#7c7c96; --dim:#4a4a62;
    --orange:#f97316; --green:#22c55e; --blue:#60a5fa;
    --mono:'JetBrains Mono',monospace; --display:'Syne',sans-serif; --body:'DM Sans',sans-serif;
  }
  *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
  html{scroll-behavior:smooth}
  body{background:var(--bg);color:var(--text);font-family:var(--body);font-size:15px;line-height:1.7}

  /* NAV */
  nav{
    position:sticky;top:0;z-index:100;
    background:rgba(9,9,11,0.85);backdrop-filter:blur(16px);
    border-bottom:1px solid var(--border);
    padding:0 48px;height:60px;
    display:flex;align-items:center;justify-content:space-between;
  }
  .nav-logo{font-family:var(--display);font-weight:800;font-size:16px;color:var(--orange)}
  .nav-links{display:flex;gap:32px}
  .nav-links a{font-size:13px;color:var(--muted);text-decoration:none;transition:color .15s}
  .nav-links a:hover{color:var(--text)}
  .nav-cta{
    font-family:var(--mono);font-size:12px;
    background:var(--orange);color:#fff;
    border:none;padding:8px 18px;border-radius:5px;
    cursor:pointer;text-decoration:none;
  }

  /* HERO */
  .hero{
    max-width:860px;margin:0 auto;
    padding:80px 48px 60px;
    text-align:center;
  }
  .hero-tag{
    font-family:var(--mono);font-size:11px;color:var(--orange);
    letter-spacing:3px;text-transform:uppercase;
    margin-bottom:20px;display:block;opacity:.8;
  }
  .hero-title{
    font-family:var(--display);font-size:clamp(38px,6vw,64px);
    font-weight:800;letter-spacing:-2.5px;line-height:1.05;
    margin-bottom:20px;
  }
  .hero-title span{color:var(--orange)}
  .hero-sub{color:var(--muted);font-size:16px;max-width:520px;margin:0 auto 36px}
  .hero-actions{display:flex;gap:12px;justify-content:center;flex-wrap:wrap}
  .btn-primary{
    font-family:var(--mono);font-size:13px;
    background:var(--orange);color:#fff;
    border:none;padding:12px 28px;border-radius:5px;
    cursor:pointer;text-decoration:none;
  }
  .btn-secondary{
    font-family:var(--mono);font-size:13px;
    background:transparent;color:var(--text);
    border:1px solid var(--border);padding:12px 28px;border-radius:5px;
    cursor:pointer;text-decoration:none;
  }

  /* CODE DEMO */
  .demo{max-width:760px;margin:0 auto 80px;padding:0 48px}
  .demo-block{
    background:#06060a;border:1px solid var(--border);border-radius:8px;overflow:hidden;
  }
  .demo-header{
    background:var(--s3);padding:8px 16px;
    display:flex;align-items:center;gap:8px;
    border-bottom:1px solid var(--border);
  }
  .dot{width:10px;height:10px;border-radius:50%}
  .dot-r{background:#ff5f57}.dot-y{background:#febc2e}.dot-g{background:#28c840}
  .demo-label{font-family:var(--mono);font-size:10px;color:var(--muted);margin-left:auto}
  .demo-block pre{
    padding:20px 24px;
    font-family:var(--mono);font-size:12.5px;line-height:1.75;color:#b8b8d0;
    overflow-x:auto;white-space:pre;
  }
  .kw{color:var(--orange)} .str{color:var(--green)} .cm{color:var(--dim)} .prop{color:var(--blue)}

  /* STATS */
  .stats{
    border-top:1px solid var(--border);border-bottom:1px solid var(--border);
    display:flex;justify-content:center;gap:0;
    margin-bottom:80px;
  }
  .stat{
    flex:1;max-width:240px;text-align:center;
    padding:32px 20px;border-right:1px solid var(--border);
  }
  .stat:last-child{border-right:none}
  .stat-num{
    font-family:var(--display);font-size:36px;font-weight:800;
    color:var(--orange);letter-spacing:-1px;
  }
  .stat-label{font-size:12px;color:var(--muted);margin-top:4px}

  /* FEATURES */
  .section{max-width:960px;margin:0 auto;padding:0 48px 80px}
  .section-title{
    font-family:var(--display);font-size:28px;font-weight:800;
    letter-spacing:-1px;margin-bottom:8px;
  }
  .section-sub{color:var(--muted);font-size:14px;margin-bottom:40px}
  .features{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}
  .feature{
    background:var(--s1);border:1px solid var(--border);
    border-radius:8px;padding:20px 22px;
  }
  .feature-icon{font-size:22px;margin-bottom:12px}
  .feature-title{
    font-family:var(--display);font-size:14px;font-weight:700;
    margin-bottom:6px;
  }
  .feature-desc{font-size:12.5px;color:var(--muted);line-height:1.6}

  /* PRICING */
  .pricing-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:16px}
  .plan{
    background:var(--s1);border:1px solid var(--border);
    border-radius:8px;padding:24px 20px;position:relative;
  }
  .plan.popular{
    border-color:var(--orange);
    background:linear-gradient(180deg,rgba(249,115,22,0.06) 0%,var(--s1) 60%);
  }
  .popular-badge{
    position:absolute;top:-12px;left:50%;transform:translateX(-50%);
    background:var(--orange);color:#fff;
    font-family:var(--mono);font-size:9px;letter-spacing:1px;text-transform:uppercase;
    padding:3px 12px;border-radius:20px;white-space:nowrap;
  }
  .plan-name{
    font-family:var(--display);font-size:13px;font-weight:700;
    color:var(--muted);letter-spacing:1px;text-transform:uppercase;
    margin-bottom:12px;
  }
  .plan-price{
    font-family:var(--display);font-size:36px;font-weight:800;
    letter-spacing:-1.5px;margin-bottom:4px;
  }
  .plan.popular .plan-price{color:var(--orange)}
  .plan-period{font-size:12px;color:var(--muted);margin-bottom:20px}
  .plan-features{list-style:none;margin-bottom:24px}
  .plan-features li{
    font-size:12.5px;color:var(--muted);
    padding:5px 0;border-bottom:1px solid var(--border);
    display:flex;align-items:center;gap:8px;
  }
  .plan-features li:last-child{border-bottom:none}
  .plan-features li::before{content:'✓';color:var(--green);font-size:11px;flex-shrink:0}
  .plan-features li.no::before{content:'✗';color:var(--dim)}
  .plan-features li.no{color:var(--dim)}
  .plan-btn{
    display:block;width:100%;text-align:center;
    font-family:var(--mono);font-size:12px;
    padding:10px;border-radius:5px;
    text-decoration:none;cursor:pointer;border:none;
  }
  .plan-btn-primary{background:var(--orange);color:#fff}
  .plan-btn-secondary{background:transparent;color:var(--text);border:1px solid var(--border)}

  /* ENDPOINTS */
  .endpoints{display:flex;flex-direction:column;gap:10px}
  .endpoint{
    background:var(--s1);border:1px solid var(--border);
    border-radius:6px;padding:14px 18px;
    display:flex;align-items:flex-start;gap:16px;
  }
  .method{
    font-family:var(--mono);font-size:10px;font-weight:600;
    padding:3px 8px;border-radius:3px;flex-shrink:0;margin-top:1px;
  }
  .method-post{background:rgba(249,115,22,0.15);color:var(--orange)}
  .method-get{background:rgba(34,197,94,0.15);color:var(--green)}
  .method-del{background:rgba(239,68,68,0.15);color:#ef4444}
  .ep-path{font-family:var(--mono);font-size:12px;color:var(--text);margin-bottom:3px}
  .ep-desc{font-size:12px;color:var(--muted)}
  .ep-badge{
    margin-left:auto;flex-shrink:0;
    font-family:var(--mono);font-size:9px;
    padding:2px 8px;border-radius:3px;
    border:1px solid var(--border);color:var(--muted);
  }

  /* FOOTER */
  footer{
    border-top:1px solid var(--border);
    padding:32px 48px;
    display:flex;align-items:center;justify-content:space-between;
    font-family:var(--mono);font-size:11px;color:var(--dim);
  }
  footer a{color:var(--orange);text-decoration:none}

  @media(max-width:768px){
    nav{padding:0 20px}
    .hero,.demo,.section{padding-left:20px;padding-right:20px}
    .features,.pricing-grid{grid-template-columns:1fr}
    .stats{flex-direction:column}
    .stat{border-right:none;border-bottom:1px solid var(--border)}
    .stat:last-child{border-bottom:none}
    .nav-links{display:none}
  }
</style>
</head>
<body>

<nav>
  <div class="nav-logo">PDF Generator API</div>
  <div class="nav-links">
    <a href="#features">Features</a>
    <a href="#pricing">Pricing</a>
    <a href="#endpoints">API</a>
  </div>
  <a href="#pricing" class="nav-cta">Get API Key →</a>
</nav>

<section class="hero">
  <span class="hero-tag">// HTML → PDF · REST API</span>
  <h1 class="hero-title">
    Beautiful PDFs<br>from <span>any HTML</span>
  </h1>
  <p class="hero-sub">
    Send any HTML — with Google Fonts, CSS variables, dark backgrounds, gradients —
    and get a pixel-perfect PDF back. Powered by Playwright/Chromium.
  </p>
  <div class="hero-actions">
    <a href="#pricing" class="btn-primary">Start Free →</a>
    <a href="#endpoints" class="btn-secondary">View API Docs</a>
  </div>
</section>

<div class="demo">
  <div class="demo-block">
    <div class="demo-header">
      <div class="dot dot-r"></div>
      <div class="dot dot-y"></div>
      <div class="dot dot-g"></div>
      <span class="demo-label">POST /render</span>
    </div>
    <pre><span class="cm">// Send HTML, get PDF in ~1-2s</span>
<span class="kw">const</span> response = <span class="kw">await</span> fetch(<span class="str">'https://your-space.hf.space/render'</span>, {
  <span class="prop">method</span>: <span class="str">'POST'</span>,
  <span class="prop">headers</span>: {
    <span class="prop">'Authorization'</span>: <span class="str">'Bearer sk-your-api-key'</span>,
    <span class="prop">'Content-Type'</span>: <span class="str">'application/json'</span>
  },
  <span class="prop">body</span>: JSON.stringify({
    <span class="prop">html</span>: <span class="str">'&lt;!DOCTYPE html&gt;&lt;html&gt;...your full HTML...&lt;/html&gt;'</span>,
    <span class="prop">filename</span>: <span class="str">'invoice-2025-01'</span>
  })
})

<span class="kw">const</span> pdfBuffer = <span class="kw">await</span> response.arrayBuffer() <span class="cm">// → save or stream</span></pre>
  </div>
</div>

<div class="stats">
  <div class="stat">
    <div class="stat-num">~1.8s</div>
    <div class="stat-label">Avg generation time</div>
  </div>
  <div class="stat">
    <div class="stat-num">A4</div>
    <div class="stat-label">Print-perfect output</div>
  </div>
  <div class="stat">
    <div class="stat-num">100%</div>
    <div class="stat-label">CSS + Google Fonts support</div>
  </div>
  <div class="stat">
    <div class="stat-num">0</div>
    <div class="stat-label">File storage — streamed direct</div>
  </div>
</div>

<!-- FEATURES -->
<section class="section" id="features">
  <h2 class="section-title">Everything you need</h2>
  <p class="section-sub">No flaky wkhtmltopdf. No puppeteer regressions. Real Chromium, every time.</p>
  <div class="features">
    <div class="feature">
      <div class="feature-icon">🎨</div>
      <div class="feature-title">Full CSS Support</div>
      <div class="feature-desc">CSS variables, gradients, dark backgrounds, Google Fonts — all rendered faithfully. <code>print-color-adjust: exact</code> enforced.</div>
    </div>
    <div class="feature">
      <div class="feature-icon">⚡</div>
      <div class="feature-title">Sync + Async</div>
      <div class="feature-desc">Need it now? Use <code>/render</code>. Heavy doc? Use <code>/render/async</code> with webhook callback — perfect for N8N.</div>
    </div>
    <div class="feature">
      <div class="feature-icon">🔑</div>
      <div class="feature-title">Per-Key Rate Limits</div>
      <div class="feature-desc">Each API key has its own plan, daily and monthly limits. Upgrade or downgrade any key via the Admin API.</div>
    </div>
    <div class="feature">
      <div class="feature-icon">📊</div>
      <div class="feature-title">Usage Tracking</div>
      <div class="feature-desc">Every key tracks daily and monthly PDF counts. Call <code>/usage</code> anytime to see current consumption vs limits.</div>
    </div>
    <div class="feature">
      <div class="feature-icon">🔔</div>
      <div class="feature-title">Webhooks</div>
      <div class="feature-desc">Configure a webhook URL per key. When async jobs finish, we POST the result (including base64 PDF) straight to your endpoint.</div>
    </div>
    <div class="feature">
      <div class="feature-icon">🛡️</div>
      <div class="feature-title">Secure by Default</div>
      <div class="feature-desc">Bearer token auth on every route. HTML sanitization with DOMPurify (WHOLE_DOCUMENT mode). Admin routes behind separate secret.</div>
    </div>
  </div>
</section>

<!-- PRICING -->
<section class="section" id="pricing">
  <h2 class="section-title">Simple pricing</h2>
  <p class="section-sub">Start free. Upgrade when you need more.</p>
  <div class="pricing-grid">

    <div class="plan">
      <div class="plan-name">Free</div>
      <div class="plan-price">$0</div>
      <div class="plan-period">forever</div>
      <ul class="plan-features">
        <li>5 PDFs / day</li>
        <li>30 PDFs / month</li>
        <li>2 MB max HTML</li>
        <li>Sync only</li>
        <li class="no">No webhooks</li>
        <li class="no">No async jobs</li>
      </ul>
      <a href="mailto:contact@yoursite.com?subject=Free API Key" class="plan-btn plan-btn-secondary">Get Free Key</a>
    </div>

    <div class="plan popular">
      <div class="popular-badge">Most Popular</div>
      <div class="plan-name">Pro</div>
      <div class="plan-price">$19</div>
      <div class="plan-period">/ month</div>
      <ul class="plan-features">
        <li>500 PDFs / day</li>
        <li>5,000 PDFs / month</li>
        <li>10 MB max HTML</li>
        <li>Sync + Async</li>
        <li>Webhooks included</li>
        <li>3 concurrent jobs</li>
      </ul>
      <a href="mailto:contact@yoursite.com?subject=Pro API Key" class="plan-btn plan-btn-primary">Get Pro Key →</a>
    </div>

    <div class="plan">
      <div class="plan-name">Starter</div>
      <div class="plan-price">$9</div>
      <div class="plan-period">/ month</div>
      <ul class="plan-features">
        <li>50 PDFs / day</li>
        <li>500 PDFs / month</li>
        <li>5 MB max HTML</li>
        <li>Sync + Async</li>
        <li class="no">No webhooks</li>
        <li>2 concurrent jobs</li>
      </ul>
      <a href="mailto:contact@yoursite.com?subject=Starter API Key" class="plan-btn plan-btn-secondary">Get Starter Key</a>
    </div>

    <div class="plan">
      <div class="plan-name">Unlimited</div>
      <div class="plan-price">$49</div>
      <div class="plan-period">/ month</div>
      <ul class="plan-features">
        <li>Unlimited PDFs</li>
        <li>No monthly cap</li>
        <li>20 MB max HTML</li>
        <li>Sync + Async</li>
        <li>Webhooks included</li>
        <li>5 concurrent jobs</li>
      </ul>
      <a href="mailto:contact@yoursite.com?subject=Unlimited API Key" class="plan-btn plan-btn-secondary">Get Unlimited Key</a>
    </div>

  </div>
</section>

<!-- API ENDPOINTS -->
<section class="section" id="endpoints">
  <h2 class="section-title">API Reference</h2>
  <p class="section-sub">All endpoints require <code style="font-family:var(--mono);font-size:12px;color:var(--orange)">Authorization: Bearer sk-your-key</code></p>
  <div class="endpoints">
    <div class="endpoint">
      <span class="method method-post">POST</span>
      <div>
        <div class="ep-path">/render</div>
        <div class="ep-desc">Sync PDF generation. Returns binary PDF directly. Body: <code>{ html, filename, marginTop, ... }</code></div>
      </div>
      <span class="ep-badge">all plans</span>
    </div>
    <div class="endpoint">
      <span class="method method-post">POST</span>
      <div>
        <div class="ep-path">/render/async</div>
        <div class="ep-desc">Async PDF generation. Returns <code>{ job_id }</code> immediately. Optionally fires webhook on completion.</div>
      </div>
      <span class="ep-badge">starter+</span>
    </div>
    <div class="endpoint">
      <span class="method method-get">GET</span>
      <div>
        <div class="ep-path">/render/async/:job_id</div>
        <div class="ep-desc">Poll job status. Returns PDF binary when done (one-shot download).</div>
      </div>
      <span class="ep-badge">starter+</span>
    </div>
    <div class="endpoint">
      <span class="method method-get">GET</span>
      <div>
        <div class="ep-path">/usage</div>
        <div class="ep-desc">Returns current plan, today's count, monthly count and limits for your key.</div>
      </div>
      <span class="ep-badge">all plans</span>
    </div>
    <div class="endpoint">
      <span class="method method-post">POST</span>
      <div>
        <div class="ep-path">/admin/keys</div>
        <div class="ep-desc">Create new API key. Body: <code>{ label, plan, webhookUrl }</code>. Requires <code>X-Admin-Secret</code> header.</div>
      </div>
      <span class="ep-badge">admin</span>
    </div>
    <div class="endpoint">
      <span class="method method-del">DEL</span>
      <div>
        <div class="ep-path">/admin/keys/:token</div>
        <div class="ep-desc">Revoke an API key immediately.</div>
      </div>
      <span class="ep-badge">admin</span>
    </div>
  </div>
</section>

<footer>
  <span>PDF Generator API — Powered by Playwright/Chromium</span>
  <span>Built with ♥ by <a href="https://jailsontech.com.br">JailsonTech</a></span>
</footer>

</body>
</html>`

// ─── HEALTH ───────────────────────────────────────────────────────────────────

fastify.get('/', async (req, reply) => {
  reply.type('text/html')
  return LANDING_HTML
})

fastify.get('/health', async () => ({ status: 'ok' }))
fastify.get('/ready',  async () => ({ ready: await isReady() }))
fastify.get('/ping',   async () => 'pong')

// ─── AUTH ─────────────────────────────────────────────────────────────────────

async function auth (request, reply) {
  const header = request.headers['authorization'] || ''
  const parts  = header.split(' ')
  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    return reply.code(401).send({ error: 'missing or malformed authorization header' })
  }
  const key = keyStore.validate(parts[1])
  if (!key) return reply.code(401).send({ error: 'invalid token' })

  // Rate limit por key
  const now    = Date.now()
  const window = key.planMeta.rateWindow || 60_000
  const limit  = key.planMeta.rateLimit  || 60
  if (!key._rl) key._rl = { count: 0, reset: now + window }
  if (now > key._rl.reset) { key._rl.count = 0; key._rl.reset = now + window }
  key._rl.count++
  if (key._rl.count > limit) {
    const retryAfter = Math.ceil((key._rl.reset - now) / 1000)
    reply.header('Retry-After', retryAfter)
    return reply.code(429).send({ error: 'rate_limit_exceeded', retry_after: retryAfter })
  }

  request.apiKey = key
}

async function adminAuth (request, reply) {
  if (!ADMIN_SECRET) return reply.code(403).send({ error: 'admin not enabled' })
  if (request.headers['x-admin-secret'] !== ADMIN_SECRET) {
    return reply.code(401).send({ error: 'invalid admin secret' })
  }
}

// ─── USAGE ────────────────────────────────────────────────────────────────────

fastify.get('/usage', { preHandler: auth }, async (req) => {
  return {
    key:   req.apiKey.label,
    usage: keyStore.getUsageInfo(req.apiKey),
    upgrade: UPGRADE_URL || undefined
  }
})

// ─── ADMIN ────────────────────────────────────────────────────────────────────

fastify.get('/admin/keys', { preHandler: adminAuth }, async () => ({
  keys: keyStore.list()
}))

fastify.get('/admin/plans', { preHandler: adminAuth }, async () => ({
  plans: Object.entries(PLANS).map(([id, p]) => ({ id, ...p, monthlyLimit: p.monthlyLimit === Infinity ? null : p.monthlyLimit, dailyLimit: p.dailyLimit === Infinity ? null : p.dailyLimit }))
}))

fastify.post('/admin/keys', {
  preHandler: adminAuth,
  schema: {
    body: {
      type: 'object',
      properties: {
        label:      { type: 'string' },
        plan:       { type: 'string' },
        webhookUrl: { type: 'string' },
        disabled:   { type: 'boolean' }
      }
    }
  }
}, async (req) => {
  const key = keyStore.create(req.body || {})
  return { token: key.token, label: key.label, plan: key.plan }
})

fastify.patch('/admin/keys/:token/plan', {
  preHandler: adminAuth,
  schema: { body: { type: 'object', properties: { plan: { type: 'string' } }, required: ['plan'] } }
}, async (req, reply) => {
  const ok = keyStore.updatePlan(req.params.token, req.body.plan)
  if (!ok) return reply.code(404).send({ error: 'key not found or invalid plan' })
  return { updated: true, plan: req.body.plan }
})

fastify.delete('/admin/keys/:token', { preHandler: adminAuth }, async (req, reply) => {
  if (!keyStore.revoke(req.params.token)) return reply.code(404).send({ error: 'key not found' })
  return { revoked: req.params.token }
})

// ─── BUILD HTML ───────────────────────────────────────────────────────────────

async function buildHtml (body) {
  const { template, data, html: customHtml } = body
  if (customHtml) {
    return SKIP_SANITIZE ? String(customHtml) : sanitizeFullHtml(String(customHtml))
  }
  return renderTemplate(String(template || 'report'), data || {})
}

const PDF_OPTS_SCHEMA = {
  type: 'object',
  properties: {
    template:            { type: 'string' },
    data:                { type: 'object' },
    html:                { type: 'string' },
    filename:            { type: 'string' },
    webhookUrl:          { type: 'string' },
    marginTop:           { type: 'string' },
    marginBottom:        { type: 'string' },
    marginLeft:          { type: 'string' },
    marginRight:         { type: 'string' },
    displayHeaderFooter: { type: 'boolean' },
    headerTemplate:      { type: 'string' },
    footerTemplate:      { type: 'string' }
  }
}

function pdfOptions (body, key) {
  return {
    timeout:             PDF_TIMEOUT,
    displayHeaderFooter: !!body.displayHeaderFooter,
    headerTemplate:      body.headerTemplate,
    footerTemplate:      body.footerTemplate,
    marginTop:           body.marginTop    || '15mm',
    marginBottom:        body.marginBottom || '15mm',
    marginLeft:          body.marginLeft   || '15mm',
    marginRight:         body.marginRight  || '15mm'
  }
}

// ─── /render (SYNC) ───────────────────────────────────────────────────────────

fastify.post('/render', { preHandler: auth, schema: { body: PDF_OPTS_SCHEMA } }, async (req, reply) => {
  const key = req.apiKey

  // Verificar limite de uso
  const limitErr = keyStore.checkUsage(key)
  if (limitErr) return reply.code(402).send({ ...limitErr, message: `Plan limit reached. ${UPGRADE_URL ? 'Upgrade at: ' + UPGRADE_URL : ''}` })

  if (activeJobs >= Math.min(MAX_CONCURRENT, key.planMeta.concurrent)) {
    return reply.code(429).send({ error: 'server busy — try again shortly' })
  }

  activeJobs++
  try {
    const html      = await buildHtml(req.body || {})
    const pdfBuffer = await generatePdf(html, pdfOptions(req.body || {}, key))
    const safe      = ((req.body || {}).filename || 'document').replace(/[^a-zA-Z0-9._-]/g, '_')

    reply.header('Content-Type', 'application/pdf')
    reply.header('Content-Disposition', `attachment; filename="${safe}.pdf"`)
    reply.header('X-Plan', key.plan)
    reply.header('X-Usage-Today', keyStore.getUsageInfo(key).today)
    return reply.send(pdfBuffer)
  } catch (err) {
    req.log.error('Render error:', err && err.message)
    return reply.code(500).send({ error: 'pdf generation failed', detail: err && err.message })
  } finally {
    activeJobs--
  }
})

// ─── /render/async ────────────────────────────────────────────────────────────

fastify.post('/render/async', { preHandler: auth, schema: { body: PDF_OPTS_SCHEMA } }, async (req, reply) => {
  const key = req.apiKey

  if (!key.planMeta.async) {
    return reply.code(403).send({ error: 'async not available on your plan', upgrade: UPGRADE_URL || undefined })
  }

  const limitErr = keyStore.checkUsage(key)
  if (limitErr) return reply.code(402).send({ ...limitErr })

  const body    = req.body || {}
  const jobId   = crypto.randomUUID()
  const webhook = body.webhookUrl || key.webhookUrl || null

  const job = {
    id: jobId, status: 'pending', createdAt: Date.now(),
    filename: (body.filename || 'document').replace(/[^a-zA-Z0-9._-]/g, '_'),
    webhook, pdfBuffer: null, error: null
  }
  jobs.set(jobId, job)

  ;(async () => {
    // Aguarda slot
    while (activeJobs >= Math.min(MAX_CONCURRENT, key.planMeta.concurrent)) {
      await new Promise(r => setTimeout(r, 500))
    }
    activeJobs++
    job.status = 'processing'
    try {
      const html     = await buildHtml(body)
      job.pdfBuffer  = await generatePdf(html, pdfOptions(body, key))
      job.status     = 'done'
      job.finishedAt = Date.now()
    } catch (err) {
      job.status = 'error'
      job.error  = err && err.message
      fastify.log.error('Async render error:', job.error)
    } finally {
      activeJobs--
    }

    if (webhook) {
      try {
        await fetch(webhook, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            job_id:     jobId,
            status:     job.status,
            filename:   job.filename,
            error:      job.error || undefined,
            pdf_base64: job.pdfBuffer ? job.pdfBuffer.toString('base64') : undefined
          })
        }).catch(e => fastify.log.error('Webhook delivery failed:', e.message))
      } catch (e) {
        fastify.log.error('Webhook error:', e.message)
      }
    }

    setTimeout(() => jobs.delete(jobId), JOB_TTL_MS)
  })()

  reply.code(202)
  return { job_id: jobId, status: 'pending', poll: `/render/async/${jobId}` }
})

fastify.get('/render/async/:id', { preHandler: auth }, async (req, reply) => {
  const job = jobs.get(req.params.id)
  if (!job) return reply.code(404).send({ error: 'job not found or expired' })

  if (job.status === 'done') {
    reply.header('Content-Type', 'application/pdf')
    reply.header('Content-Disposition', `attachment; filename="${job.filename}.pdf"`)
    const buf = job.pdfBuffer
    job.pdfBuffer = null
    return reply.send(buf)
  }

  return { job_id: job.id, status: job.status, createdAt: job.createdAt, error: job.error || undefined }
})

// ─── START ────────────────────────────────────────────────────────────────────

async function start () {
  let started = false; let lastErr = null
  for (let i = 1; i <= STARTUP_RETRIES; i++) {
    try {
      console.log(`Playwright init attempt ${i}/${STARTUP_RETRIES}...`)
      await initPdfEngine()
      console.log('Playwright initialized')
      started = true; break
    } catch (e) {
      lastErr = e
      console.error(`Attempt ${i} failed:`, e && (e.message || e))
      if (i < STARTUP_RETRIES) await new Promise(r => setTimeout(r, STARTUP_RETRY_MS))
    }
  }

  if (!started) {
    console.error('Playwright init failed. Exiting.', lastErr)
    process.exit(1)
  }

  await fastify.listen({ port: PORT, host: '0.0.0.0' })
  fastify.log.info(`Server listening on port ${PORT}`)

  if (KEEP_ALIVE) {
    setInterval(() => initPdfEngine().catch(e => fastify.log.error('Keep-alive error:', e)), 60_000)
  }
}

start()

// ─── SHUTDOWN ─────────────────────────────────────────────────────────────────

async function shutdown () {
  try {
    await closeEngine()
    await fastify.close()
    process.exit(0)
  } catch (err) {
    fastify.log.error('Shutdown error', err)
    process.exit(1)
  }
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
