'use strict'

const fs = require('fs-extra')
const path = require('path')
const Handlebars = require('handlebars')
const createDOMPurify = require('dompurify')
const { JSDOM } = require('jsdom')

const window = new JSDOM('').window
const dompurify = createDOMPurify(window)

const templatesDir = path.join(__dirname, '..', 'templates')
const stylesPath = path.join(templatesDir, 'styles', 'main.css')
let stylesCache = null
const templateCache = new Map()
const allowedTemplates = ['report', 'contract', 'invoice', 'call_summary']

/**
 * sanitizeHtml — para USO INTERNO nos templates .hbs
 * Limpa fragmentos HTML (ex: campos de texto) sem destruir a estrutura do documento.
 */
function sanitizeHtml (html) {
  return dompurify.sanitize(String(html), {
    ALLOWED_TAGS: ['b', 'i', 'em', 'strong', 'u', 's', 'br', 'p', 'span', 'ul', 'ol', 'li', 'a', 'code', 'pre'],
    ALLOWED_ATTR: ['href', 'target', 'style', 'class']
  })
}

/**
 * sanitizeFullHtml — para documentos HTML completos recebidos via API (campo "html")
 *
 * DOMPurify com WHOLE_DOCUMENT=true preserva a estrutura <!DOCTYPE><html><head><body>
 * incluindo <link> de fontes, <style>, <meta charset> etc.
 *
 * Mantém os recursos que fazem um PDF bonito:
 *  - Google Fonts (<link href="https://fonts.googleapis.com/...">)
 *  - CSS variables, gradients, backgrounds (-webkit-print-color-adjust)
 *  - Imagens via <img src>
 *
 * Remove apenas scripts inline e atributos on* para segurança mínima.
 */
function sanitizeFullHtml (html) {
  return dompurify.sanitize(String(html), {
    WHOLE_DOCUMENT: true,
    FORCE_BODY: false,
    // Mantém tags estruturais e de estilo
    ADD_TAGS: ['html', 'head', 'body', 'meta', 'link', 'style', 'title', 'base'],
    ADD_ATTR: [
      // <link>
      'href', 'rel', 'type', 'media', 'crossorigin',
      // <meta>
      'charset', 'name', 'content', 'http-equiv',
      // gerais
      'class', 'id', 'style', 'lang', 'dir',
      // <a>
      'target',
      // <img>
      'src', 'alt', 'width', 'height', 'loading',
      // <table>
      'colspan', 'rowspan', 'scope',
      // viewport / print
      'viewport'
    ],
    // Remove apenas o que é perigoso
    FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form', 'input', 'button'],
    FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover', 'onfocus', 'onblur']
  })
}

async function renderTemplate (name, data) {
  if (!allowedTemplates.includes(name)) throw new Error('Template não permitido')
  const tplPath = path.join(templatesDir, `${name}.hbs`)

  let tpl = templateCache.get(name)
  if (!tpl) {
    const raw = fs.readFileSync(tplPath, 'utf8')
    tpl = Handlebars.compile(raw)
    templateCache.set(name, tpl)
  }

  if (!stylesCache && fs.existsSync(stylesPath)) {
    stylesCache = fs.readFileSync(stylesPath, 'utf8')
  }

  const payload = Object.assign({}, data, {
    _styles: stylesCache || '',
    generatedAt: new Date().toISOString()
  })

  return tpl(payload)
}

module.exports = { renderTemplate, sanitizeHtml, sanitizeFullHtml, allowedTemplates }
