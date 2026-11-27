// What a request to verify.hamapps.dev looks like, and the simple pages Cici shows in the browser.
// Used by the Hamilton sign-in (src/verify.ts) and the GitHub org sign-in (src/github.ts).

export interface UrlEvent {
  rawPath: string
  body?: string
  isBase64Encoded?: boolean
  headers?: Record<string, string | undefined>
  queryStringParameters?: Record<string, string | undefined>
  cookies?: string[]
  requestContext?: { http?: { method?: string } }
}
export interface UrlResult {
  statusCode: number
  headers?: Record<string, string>
  cookies?: string[]
  body?: string
}

export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)
export const redirect = (to: string): UrlResult => ({ statusCode: 302, headers: { Location: to } })

/** The value of one cookie from the request, or undefined. */
export const readCookie = (event: UrlEvent, name: string) =>
  event.cookies?.map((c) => c.trim()).find((c) => c.startsWith(`${name}=`))?.slice(name.length + 1)

export function page(status: number, title: string, html: string, cookies?: string[]): UrlResult {
  return {
    statusCode: status,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' },
    cookies,
    body: `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} · HamApps</title><link rel="icon" href="https://hamapps.dev/favicon.ico">
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#102e64;color:#f8f4ee;font:17px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:480px;padding:32px 24px;text-align:center}img{width:120px;height:120px}h1{font-size:1.8rem;margin:12px 0}
a{color:#e3c06f}.btn{display:inline-block;margin:6px;padding:10px 18px;border-radius:999px;background:#e3c06f;color:#102e64;font-weight:700;text-decoration:none}
.ghost{background:transparent;color:#f8f4ee;border:2px solid #f8f4ee}</style></head>
<body><main><img src="https://hamapps.dev/hamapps-logo-white.png" alt="Cici, the HamApps mascot"><h1>${title}</h1>${html}</main></body></html>`,
  }
}
