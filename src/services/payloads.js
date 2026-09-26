/**
 * Model forms also contain display-only and verification fields. Send only write fields.
 * @param {import('../../packages/api/index.js').ModelProfileInput} form
 * @param {'keep' | 'replace' | 'clear'} [action]
 * @returns {import('../../packages/api/index.js').ModelProfileInput}
 */
export function modelProfileInput(form, action) {
  const api_key = form.api_key?.trim() || '';
  return {
    name: form.name,
    provider: form.provider,
    protocol: form.protocol,
    base_url: form.base_url,
    model: form.model,
    parameters: form.parameters,
    consent: form.consent,
    api_key,
    api_key_action: action || (api_key ? 'replace' : 'keep'),
  };
}
