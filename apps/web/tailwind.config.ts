import type { Config } from 'tailwindcss'

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        smsg: {
          // Samsung Blue palette (Design §5.7)
          900: '#0A1F8F',
          700: '#1428A0',
          500: '#2E5BFF',
          300: '#5C7CFF',
          100: '#E8EEFF',
          50:  '#F5F7FF',
        },
        link: {
          DEFAULT: '#2E5BFF',
          missing: '#CC0000',
        },
      },
      fontFamily: {
        sans: ['"Pretendard Variable"', 'Pretendard', 'system-ui', 'sans-serif'],
      },
      maxWidth: {
        prose: '880px',
        readable: '760px',
      },
      borderRadius: {
        sm: '4px',
        md: '8px',
        lg: '12px',
        xl: '16px',
      },
      boxShadow: {
        sm: '0 1px 2px rgba(15, 23, 42, .05)',
        md: '0 4px 12px rgba(15, 23, 42, .08)',
        lg: '0 10px 32px rgba(15, 23, 42, .12)',
        focus: '0 0 0 3px rgba(46, 91, 255, .25)',
      },
      zIndex: {
        // Library portals (Mantine/BlockNote/Recharts/Tippy) freely stomp on
        // 1000~5000. Our TopBar/Breadcrumb must NEVER let body content bleed
        // above them, so we live at 9000+.
        content: '0',
        sticky:  '9000',  // TopBar / Breadcrumb / EditorToolbar
        drawer:  '9100',
        modal:   '9200',
        popover: '9300',
        toast:   '9400',
      },
      transitionDuration: {
        fast: '120ms',
        base: '200ms',
        slow: '320ms',
      },
      transitionTimingFunction: {
        'out-soft': 'cubic-bezier(.2,.8,.2,1)',
      },
      keyframes: {
        slideUp: {
          from: { transform: 'translateY(8px)', opacity: '0' },
          to:   { transform: 'translateY(0)',   opacity: '1' },
        },
      },
      animation: {
        'slide-up': 'slideUp 200ms cubic-bezier(.2,.8,.2,1)',
      },
    },
  },
  plugins: [],
} satisfies Config
