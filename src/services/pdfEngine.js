'use strict'

const { chromium } = require('playwright')

let browser = null
let browserLaunching = null

const LAUNCH_RETRIES = Number(process.env.PLAYWRIGHT_LAUNCH_RETRIES || 3)
const LAUNCH_RETRY_DELAY_MS = Number(process.env.PLAYWRIGHT_LAUNCH_RETRY_DELAY_MS || 2000)
// Tempo extra após networkidle para garantir render de fontes/animações CSS
const FONT_SETTLE_MS = Number(process.env.FONT_SETTLE_MS || 400)

function sleep (ms) {
  return new Promise((r) => setTimeout(r, ms))
}

async function initPdfEngine () {
  if (browser) return browser
  if (browserLaunching) return browserLaunching

  browserLaunching = (async () => {
    let lastErr = null

    for (let attempt = 1; attempt <= LAUNCH_RETRIES; attempt++) {
      try {
        console.log(`chromium.launch attempt ${attempt}/${LAUNCH_RETRIES}`)

        browser = await chromium.launch({
          headless: true,
          args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--no-zygote',
            '--single-process',
            // Garante que fontes web (Google Fonts etc.) carregam corretamente
            '--disable-font-subpixel-positioning'
          ]
        })

        browser.on('disconnected', () => {
          console.warn('Playwright browser disconnected; resetting instance')
          browser = null
        })

        console.log('Playwright browser launched')
        lastErr = null
        break
      } catch (err) {
        lastErr = err
        console.error(`Playwright launch attempt ${attempt} failed:`, err && (err.message || err))
        if (attempt < LAUNCH_RETRIES) await sleep(LAUNCH_RETRY_DELAY_MS)
      }
    }

    if (!browser && lastErr) throw lastErr
    browserLaunching = null
    return browser
  })()

  return browserLaunching
}

async function isReady () {
  try {
    if (!browser) return false
    const version = await browser.version()
    return !!version
  } catch (err) {
    console.error('isReady error:', err)
    return false
  }
}

async function generatePdf (htmlContent, opts = {}) {
  if (!htmlContent) throw new Error('HTML content is empty')

  if (!browser) await initPdfEngine()

  let context = null
  let page = null

  try {
    context = await browser.newContext({
      viewport: { width: 1200, height: 800 },
      // Permite carregar recursos externos (Google Fonts, imagens etc.)
      bypassCSP: true
    })

    page = await context.newPage()

    // IMPORTANTE: emulateMedia ANTES de setContent
    // Garante que -webkit-print-color-adjust e print-color-adjust sejam respeitados
    await page.emulateMedia({ media: 'screen', colorScheme: 'dark' })

    const setContentTimeout = Number(opts.setContentTimeout || 45000)

    // networkidle = espera todas as requests de rede terminarem (fontes, imagens)
    // Muito melhor que domcontentloaded para HTMLs com Google Fonts
    await page.setContent(htmlContent, {
      waitUntil: 'networkidle',
      timeout: setContentTimeout
    })

    // Aguarda fontes web terminarem de renderizar no layout
    if (FONT_SETTLE_MS > 0) {
      await page.waitForTimeout(FONT_SETTLE_MS)
    }

    const pdfTimeout = Number(opts.timeout || 60000)

    const pdfOptions = {
      format: 'A4',
      printBackground: true,
      timeout: pdfTimeout,
      margin: {
        top: opts.marginTop || '15mm',
        bottom: opts.marginBottom || '15mm',
        left: opts.marginLeft || '15mm',
        right: opts.marginRight || '15mm'
      },
      displayHeaderFooter: !!opts.displayHeaderFooter,
      headerTemplate: opts.headerTemplate || `<div style="font-size:10px;width:100%;text-align:left;padding-left:10mm;color:#A0A0A0;font-family:sans-serif">AI Dealt Global</div>`,
      footerTemplate: opts.footerTemplate || `<div style="font-size:10px;width:100%;text-align:center;color:#A0A0A0;font-family:sans-serif">Page <span class="pageNumber"></span> of <span class="totalPages"></span></div>`
    }

    const pdfBuffer = await page.pdf(pdfOptions)
    return pdfBuffer

  } catch (err) {
    console.error('PDF generation error:', err && (err.stack || err.message || err))

    if (err && String(err).toLowerCase().includes('browser')) {
      try { if (browser) await browser.close() } catch (_) {}
      browser = null
    }

    throw err
  } finally {
    if (page) { try { await page.close() } catch (_) {} }
    if (context) { try { await context.close() } catch (_) {} }
  }
}

async function closeEngine () {
  if (browser) {
    try { await browser.close() } catch (err) {
      console.error('Error closing browser:', err)
    }
    browser = null
  }
}

module.exports = { initPdfEngine, generatePdf, closeEngine, isReady }
