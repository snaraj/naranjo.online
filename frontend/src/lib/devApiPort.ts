// validatedDevApiPort validates DEV_API_PORT for vite.config.ts's dev-only
// `/api` proxy target. It is the AUTHORITATIVE boundary for that URL, not a
// defensive echo of the Makefile's own validate-port gate: `npm run dev` can
// be invoked directly with an arbitrary DEV_API_PORT, bypassing the Makefile
// entirely, so this is the one place that actually protects the string
// vite.config.ts concatenates into a URL. An unvalidated value can move the
// proxy target off 127.0.0.1 entirely — a value containing "@" is parsed by
// `new URL` as userinfo, moving whatever follows it into hostname position
// (`new URL('http://127.0.0.1:' + '80@evil.example')` resolves hostname to
// "evil.example", not "127.0.0.1"; see tests/dev-api-port.test.mjs for the
// reproduction). Validating strictly, BEFORE any URL is ever built, closes
// that regardless of how the value is later used.
export function validatedDevApiPort(raw: string): string {
  if (!/^[0-9]{1,5}$/.test(raw)) {
    throw new Error(`DEV_API_PORT must be a decimal integer 1-65535 (got '${raw}')`);
  }
  const parsed = Number(raw);
  if (parsed < 1 || parsed > 65535) {
    throw new Error(`DEV_API_PORT must be a decimal integer 1-65535 (got '${raw}')`);
  }
  return raw;
}
