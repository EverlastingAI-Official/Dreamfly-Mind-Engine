import definitions from './errors.json' with { type: 'json' };

export { definitions as errorDefinitions };
export function errorInfo(code) {
  return Object.hasOwn(definitions, code) ? definitions[code] : definitions.INTERNAL_ERROR;
}
export function isErrorCode(code) {
  return typeof code === 'string' && Object.hasOwn(definitions, code);
}
