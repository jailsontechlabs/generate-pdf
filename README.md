# 📄 generate-pdf

API de geração de PDF via HTML — construída com Node.js, Playwright e Fastify. Roda **de graça** no Hugging Face Spaces.

> Enquanto o mercado cobra até $99/mês por isso, você pode hospedar o seu em minutos.

---

## Como funciona

Você manda um HTML via `POST /render` e recebe um PDF binário de volta.

```
HTML com Google Fonts, CSS vars, dark bg
          ↓
    Playwright / Chromium
          ↓
     PDF pixel-perfect
```

Tempo médio de geração: **~1.8s**

---

## Deploy no Hugging Face (gratuito)

### 1. Crie uma conta no Hugging Face

Acesse [huggingface.co](https://huggingface.co) e crie sua conta gratuitamente.

### 2. Crie um novo Space

- Clique em **New Space**
- Escolha **Docker** como SDK
- Deixe como **Public**

### 3. Suba os arquivos

Faça upload de todos os arquivos deste repositório no seu Space:

```
assets/fonts/
src/
Dockerfile
package.json
```

Ou clone e faça push via Git:

```bash
git clone https://github.com/jailsontechlabs/generate-pdf
cd generate-pdf
git remote set-url origin https://huggingface.co/spaces/SEU_USER/SEU_SPACE
git push
```

### 4. Configure as variáveis de ambiente

No seu Space, vá em **Settings → Variables and Secrets** e adicione:

| Variável | Valor | Descrição |
|---|---|---|
| `API_SECRET` | `sk-suachave123` | Token de autenticação da sua API |
| `SKIP_HTML_SANITIZE` | `1` | Preserva HTML completo sem sanitização |

> Escolha um token seguro para `API_SECRET` — você vai usar ele em todas as requisições.

### 5. Aguarde o build

O Hugging Face vai fazer o build automaticamente. Demora ~2 minutos na primeira vez.

Quando aparecer **Running**, sua API está no ar em:
```
https://SEU_USER-SEU_SPACE.hf.space
```

---

## Como usar

### Requisição básica

```bash
curl -X POST https://SEU_USER-SEU_SPACE.hf.space/render \
  -H "Authorization: Bearer SUA_API_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"html": "<!DOCTYPE html><html><body><h1>Ola</h1></body></html>", "filename": "meu-pdf"}' \
  --output meu-pdf.pdf
```

### Exemplo com HTML completo (dark background, fontes Google)

```bash
curl -X POST https://SEU_USER-SEU_SPACE.hf.space/render \
  -H "Authorization: Bearer SUA_API_SECRET" \
  -H "Content-Type: application/json" \
  -d @- << 'EOF'
{
  "html": "<!DOCTYPE html><html lang=\"pt-BR\"><head><meta charset=\"UTF-8\"><link href=\"https://fonts.googleapis.com/css2?family=Inter:wght@400;700&display=swap\" rel=\"stylesheet\"><style>*{-webkit-print-color-adjust:exact;print-color-adjust:exact}body{background:#0a0a0a;color:#fff;font-family:Inter,sans-serif;padding:40mm}</style></head><body><h1 style=\"color:#f97316\">Seu Título</h1><p>Conteúdo do documento aqui.</p></body></html>",
  "filename": "documento-dark",
  "marginTop": "15mm",
  "marginBottom": "15mm",
  "marginLeft": "15mm",
  "marginRight": "15mm"
}
EOF
  --output documento-dark.pdf
```

### No N8N

Use um node **HTTP Request** com:

| Campo | Valor |
|---|---|
| Method | `POST` |
| URL | `https://SEU_USER-SEU_SPACE.hf.space/render` |
| Authentication | Header Auth |
| Header Name | `Authorization` |
| Header Value | `Bearer sk-suachave123` |
| Body | JSON com campo `html` |
| Response Format | `File` |

### Parâmetros aceitos

```json
{
  "html": "<!DOCTYPE html>...",
  "filename": "nome-do-arquivo",
  "marginTop": "15mm",
  "marginBottom": "15mm",
  "marginLeft": "15mm",
  "marginRight": "15mm",
  "displayHeaderFooter": false
}
```

---

## Endpoints

| Método | Rota | Descrição |
|---|---|---|
| `GET` | `/health` | Status da API |
| `GET` | `/ready` | Engine Playwright pronta? |
| `POST` | `/render` | Gera PDF a partir de HTML |

---

## Dicas de HTML

O Playwright renderiza com suporte completo a:

- Google Fonts (`<link href="https://fonts.googleapis.com/...">`)
- CSS variables (`--cor: #fff`)
- Dark backgrounds (cores preservadas)
- Flexbox e Grid
- `print-color-adjust: exact`

Para garantir que as cores fiquem fieis no PDF, adicione no CSS:

```css
*, *::before, *::after {
  -webkit-print-color-adjust: exact !important;
  print-color-adjust: exact !important;
}
```

---

## Keep-alive (recomendado)

O Hugging Face hiberna Spaces gratuitos após inatividade. Para manter sempre ativo, crie uma automação no Make.com ou N8N que faça um `GET /health` a cada 4 minutos.

---

## Stack

- **Node.js** + **Fastify** — servidor HTTP
- **Playwright** — Chromium headless para renderização
- **Handlebars** — templates HTML opcionais
- **Docker** — containerizado para o Hugging Face

---

Construído por [@jailsontech](https://instagram.com/jailsontech)  
Duvidas? Chama no direct.
