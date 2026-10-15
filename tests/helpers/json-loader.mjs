/**
 * ESM loader hooks for the headless test harness:
 *  - serve *.json modules without the `with { type: 'json' }` attribute
 *    (the game's JSON imports follow the Vite/browser convention);
 *  - replace the Vite-only `import.meta.env` expression with a plain object
 *    so js/systems/BackgroundManager.js can load under Node unmodified.
 */
export async function resolve(specifier, context, next) {
  return next(specifier, context);
}

export async function load(url, context, next) {
  if (url.endsWith('.json')) {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(new URL(url), 'utf8');
    return { format: 'json', shortCircuit: true, source };
  }
  if (url.includes('/js/') && url.endsWith('.js')) {
    const { readFileSync } = await import('node:fs');
    let source = readFileSync(new URL(url), 'utf8');
    if (source.includes('import.meta.env')) {
      source = source.replaceAll('import.meta.env', "({ BASE_URL: '/' })");
    }
    return { format: 'module', shortCircuit: true, source };
  }
  return next(url, context);
}
