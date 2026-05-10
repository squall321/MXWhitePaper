export default {
    content: ['./index.html', './src/**/*.{ts,tsx}'],
    theme: {
        extend: {
            colors: {
                smsg: {
                    // Samsung Blue palette (Design §5.7)
                    900: '#0A1F8F',
                    700: '#1428A0',
                    500: '#2E5BFF',
                    100: '#E8EEFF',
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
                readable: '960px',
            },
            zIndex: {
                // Map Tailwind z-* utilities to the CSS custom-property tokens
                // defined in tokens.css. Without these extends, `z-sticky` /
                // `z-drawer` / `z-modal` / `z-popover` / `z-toast` produce no
                // CSS — every chrome element (TopBar/Breadcrumb) silently
                // fell back to z-index:auto, letting body content paint above
                // the bar. Using `var(...)` keeps a single source of truth in
                // tokens.css.
                content: 'var(--z-content)',
                sticky: 'var(--z-sticky)',
                drawer: 'var(--z-drawer)',
                modal: 'var(--z-modal)',
                popover: 'var(--z-popover)',
                toast: 'var(--z-toast)',
            },
        },
    },
    plugins: [],
};
