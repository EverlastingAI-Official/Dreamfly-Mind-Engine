import { reactive } from 'vue'

export const auth = reactive({ user: null, csrf: '' })
const base = import.meta.env.VITE_API_BASE_URL || '/api/v1'
export async function api(path, options = {}) {
  const headers = { ...options.headers }
  if (!(options.body instanceof FormData) && options.body !== undefined) headers['Content-Type'] = 'application/json'
  if (auth.csrf) headers['X-CSRF-Token'] = auth.csrf
  const response = await fetch(`${base}${path}`, {
    ...options, credentials: 'same-origin', headers,
    body: options.body === undefined ? undefined : options.body instanceof FormData ? options.body : JSON.stringify(options.body)
  })
  if (options.download && response.ok) return response.blob()
  const result = await response.json()
  if (!response.ok) {
    if (response.status === 401) { auth.user = null; auth.csrf = '' }
    const error = new Error(result.error?.message || '请求失败')
    error.code = result.error?.code; error.details = result.error?.details
    throw error
  }
  return result.data
}
export async function restoreSession() {
  try { const state = await api('/auth/me'); Object.assign(auth, state) } catch (error) { if (error.code !== 'LOGIN_REQUIRED') throw error }
}
export async function sendMessage(conversation, content, onEvent) {
  const response = await fetch(`${base}/conversations/${conversation}/messages`, {
    method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': auth.csrf },
    body: JSON.stringify({ content, client_request_id: crypto.randomUUID() })
  })
  if (!response.ok) { const e = await response.json(); throw new Error(e.error?.message || '无法生成回复') }
  if (!response.headers.get('content-type')?.includes('text/event-stream')) return response.json()
  const reader = response.body.getReader(), decoder = new TextDecoder(); let buffer = ''
  try {
    while (true) {
      const { value, done } = await reader.read(); if (done) break
      buffer += decoder.decode(value, { stream: true }); let match
      while ((match = /\r?\n\r?\n/.exec(buffer))) {
        const block = buffer.slice(0, match.index); buffer = buffer.slice(match.index + match[0].length)
        const event = block.split(/\r?\n/).find(x => x.startsWith('event:'))?.slice(6).trim()
        const data = block.split(/\r?\n/).filter(x => x.startsWith('data:')).map(x => x.slice(5).trim()).join('\n')
        if (event && data) onEvent(event, JSON.parse(data))
      }
    }
  } finally { reader.releaseLock() }
}
export function chooseFile(accept) {
  return new Promise(resolve => {
    const input = document.createElement('input'); input.type = 'file'; input.accept = accept
    input.onchange = () => resolve(input.files?.[0]); input.oncancel = () => resolve(null); input.click()
  })
}
