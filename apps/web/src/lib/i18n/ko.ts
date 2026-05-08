/**
 * Korean (default) UI strings. Anchor for the i18n skeleton — every key in
 * this file MUST also exist in `en.ts`. The runtime `t()` falls back to ko
 * when an English string is missing, so it's safe (but suboptimal) to leave
 * an English value blank during translation.
 */
export const ko = {
  // Top bar / nav
  'topbar.search.placeholder': '검색 (⌘K)',
  'topbar.search.label': '검색',
  'topbar.menu.label': '메뉴 열기',
  'topbar.newDoc': '+ 새 문서',
  'topbar.newDoc.aria': '새 문서 작성',
  'topbar.more': '더 보기',
  'topbar.org': '조직',
  'topbar.recent': '최근',
  'topbar.adminOrgs': '⚙ 조직',
  'topbar.login': '로그인',
  'topbar.profile.label': '프로필 메뉴',

  // Home page
  'home.hero.title': '최근 업데이트된 문서',
  'home.hero.subtitle': '가장 최근에 갱신된 백서 12건입니다.',
  'home.hero.viewAll': '전체 보기 →',
  'home.hero.newDoc': '+ 새 문서 작성',
  'home.filter': '필터',
  'home.filter.all': '전체',

  // Login page
  'login.title': 'White Paper',
  'login.subtitle': '사내 백서 시스템',
  'login.heading': '로그인',
  'login.helper': '사내 계정으로 로그인하세요.',
  'login.email': '이메일',
  'login.password': '비밀번호',
  'login.remember': '최근 로그인 ID 기억',
  'login.forgot': '비밀번호를 잊으셨나요?',
  'login.submit': '로그인',
  'login.submitting': '로그인 중…',

  // Settings page
  'settings.title': '환경설정',
  'settings.subtitle': '이 브라우저에만 저장되는 표시 설정입니다.',
  'settings.notifications': '알림',
  'settings.notifications.help': '저장/오류 알림 토스트를 표시합니다.',
  'settings.autoSave': '자동 저장',
  'settings.autoSave.help': '편집 중 변경사항을 주기적으로 자동 저장합니다.',
  'settings.codeFade': '코드블록 fade',
  'settings.codeFade.help': '긴 코드블록의 하단을 흐리게 표시합니다.',
  'settings.theme': '테마',
  'settings.theme.help': '라이트 / 다크 / 시스템 중에서 선택합니다.',
  'settings.theme.light': '라이트',
  'settings.theme.dark': '다크',
  'settings.theme.system': '시스템',
  'settings.language': '언어',
  'settings.language.help': '인터페이스 언어를 전환합니다.',
  'settings.language.ko': '한국어',
  'settings.language.en': 'English',
  'settings.reset': '기본값으로 되돌리기',

  // Generic
  'common.loading': '불러오는 중…',
  'common.close': '닫기',
} as const

export type LocaleKey = keyof typeof ko
