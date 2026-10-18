/**
 * Importers for the help desks people move from (MG-01): Zendesk, Intercom,
 * Help Scout, Freshdesk, Document360 and Crisp. They live in core
 * (`@helpwell/core/import`), where the dashboard reads a public Zendesk help
 * centre with the same code; each reads its key from the environment it is
 * given, and nothing stores or prints one.
 */

export {
  importFromPlatform,
  isPlatform,
  PLATFORM_KEYS,
  PLATFORMS,
  type Platform,
  type PlatformOptions,
} from '@helpwell/core/import';
