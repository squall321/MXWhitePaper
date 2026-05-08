import type { LocaleKey } from './ko'

/**
 * English UI strings. Must mirror the keys in `ko.ts`. Missing keys are
 * fine at runtime — `t()` falls back to ko — but TypeScript enforces the
 * shape so a key rename in ko surfaces here.
 */
export const en: Record<LocaleKey, string> = {
  'topbar.search.placeholder': 'Search (⌘K)',
  'topbar.search.label': 'Search',
  'topbar.menu.label': 'Open menu',
  'topbar.newDoc': '+ New doc',
  'topbar.newDoc.aria': 'Create new document',
  'topbar.more': 'More',
  'topbar.org': 'Org',
  'topbar.recent': 'Recent',
  'topbar.adminOrgs': '⚙ Org admin',
  'topbar.login': 'Sign in',
  'topbar.profile.label': 'Profile menu',

  'home.hero.title': 'Recently updated',
  'home.hero.subtitle': 'The 12 most recently edited white papers.',
  'home.hero.viewAll': 'View all →',
  'home.hero.newDoc': '+ New document',
  'home.filter': 'Filter',
  'home.filter.all': 'All',

  'login.title': 'White Paper',
  'login.subtitle': 'Internal knowledge base',
  'login.heading': 'Sign in',
  'login.helper': 'Use your company account to sign in.',
  'login.email': 'Email',
  'login.password': 'Password',
  'login.remember': 'Remember last sign-in',
  'login.forgot': 'Forgot password?',
  'login.submit': 'Sign in',
  'login.submitting': 'Signing in…',

  'settings.title': 'Settings',
  'settings.subtitle': 'Display preferences saved to this browser only.',
  'settings.notifications': 'Notifications',
  'settings.notifications.help': 'Show save / error toast notifications.',
  'settings.autoSave': 'Auto-save',
  'settings.autoSave.help': 'Periodically auto-save while editing.',
  'settings.codeFade': 'Code block fade',
  'settings.codeFade.help': 'Fade out the bottom of long code blocks.',
  'settings.theme': 'Theme',
  'settings.theme.help': 'Choose Light, Dark, or System.',
  'settings.theme.light': 'Light',
  'settings.theme.dark': 'Dark',
  'settings.theme.system': 'System',
  'settings.language': 'Language',
  'settings.language.help': 'Switch the interface language.',
  'settings.language.ko': '한국어',
  'settings.language.en': 'English',
  'settings.reset': 'Reset to defaults',

  'common.loading': 'Loading…',
  'common.close': 'Close',
}
