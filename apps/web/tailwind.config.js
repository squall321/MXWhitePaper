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
            },
        },
    },
    plugins: [],
};
