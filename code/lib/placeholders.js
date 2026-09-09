// lib/placeholders.js
// Small placeholder-resolver registry. v1 only ships {{first_name}}, but the
// registry shape is built so Phase 2 (last_name, full_name, company_name, etc.)
// is additive — just more entries in RESOLVERS, no rewrite.
// Exposes a single global: TemplatePlaceholders

(function (global) {
  // Each resolver receives a `ctx` object and returns a string, or null/undefined
  // if it can't resolve (the token is then left as a safe generic fallback).
  const RESOLVERS = {
    first_name: (ctx) => ctx.recipientFirstName || null,
  };

  const FALLBACKS = {
    first_name: 'there',
  };

  const TOKEN_RE = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

  function resolveBody(body, ctx) {
    return String(body || '').replace(TOKEN_RE, (match, key) => {
      const resolver = RESOLVERS[key];
      if (!resolver) return match; // unknown placeholder: leave as-is
      const value = resolver(ctx || {});
      if (value) return value;
      return key in FALLBACKS ? FALLBACKS[key] : match;
    });
  }

  global.TemplatePlaceholders = { resolveBody, RESOLVERS, FALLBACKS };
})(typeof window !== 'undefined' ? window : self);
