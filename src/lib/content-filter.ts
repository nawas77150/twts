// ============================================================
// content-filter.ts — Barrel re-export for backward compatibility
//
// All implementation moved to domain-specific modules:
//   - content-filter-normalize.ts  (text normalization + sanitization)
//   - content-filter-blocked.ts    (blocked word lists + word matching)
//   - content-filter-checks.ts     (7 individual checks + duplicate)
//   - content-filter-engine.ts     (types, rule table, main filter, display helpers)
//
// This barrel ensures all existing imports from '@/lib/content-filter'
// continue working without any changes to consumer files.
//
// Consumer files:
//   - src/app/api/submissions/route.ts        (10 symbols)
//   - src/app/api/submissions/[id]/route.ts   (decodeHtmlEntities)
//   - src/app/api/submissions/[id]/post/route.ts (decodeHtmlEntities)
//   - src/app/api/autopost/route.ts           (decodeHtmlEntities)
//   - src/app/api/admin/filter-settings/route.ts (4 symbols)
//   - src/lib/filter-settings.ts              (4 symbols)
//   - src/hooks/use-filter-settings.ts        (2 symbols)
//   - src/app/admin/settings/page.tsx         (2 symbols)
// ============================================================

// --- From normalize ---
export {
  sanitizeInput,
  decodeHtmlEntities,
  normalizeText,
} from './content-filter-normalize'

// --- From blocked ---
export {
  DEFAULT_BLOCKED_WORDS,
  DEFAULT_NSFW_WORDS,
} from './content-filter-blocked'

// --- From checks ---
export {
  checkDuplicate24h,
  type DuplicateCheckResult,
} from './content-filter-checks'

// --- From engine ---
export {
  type FilterRules,
  type FilterResult,
  type FilterSeverity,
  DEFAULT_FILTER_RULES,
  ALWAYS_ON_REASONS,
  runContentFilter,
  hasAlwaysOnReason,
  getRejectionMessage,
  getFilterReasonColor,
} from './content-filter-engine'
