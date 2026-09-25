import { requestFailure } from './errors.js';
// Keep stack locations and machine-readable codes, never provider bodies, SQL or credentials.
export function errorDiagnostic(error: unknown) {
  const details = requestFailure(error);
  return {
    type: error instanceof Error ? error.name : typeof error,
    code: details.code,
    status: details.statusCode || details.status,
    stack: (error instanceof Error ? error.stack : undefined)
      ?.split('\n')
      .filter((line) => /^\s+at /.test(line))
      .join('\n'),
  };
}
