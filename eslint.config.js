import js from '@eslint/js'
import html from 'eslint-plugin-html'
import globals from 'globals'

export default [
    js.configs.recommended,
    {
        files: ['ui/**/*.{js,html}'],
        plugins: {
            html,
        },
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'module',
            globals: {
                ...globals.browser,
                invoke: 'readonly',
                open: 'readonly',
                save: 'readonly',
                getCurrentWindow: 'readonly',
                listen: 'readonly',
            },
        },
        rules: {
            indent: ['error', 4],
            quotes: ['error', 'single', { avoidEscape: true }],
            semi: ['error', 'never'],
            'no-unused-vars': [
                'warn',
                {
                    argsIgnorePattern: '^_',
                    varsIgnorePattern: '^currentUpdateInfo_$',
                },
            ],
            'no-constant-condition': ['warn', { checkLoops: false }],
            'no-console': 'off',
        },
    },
    {
        ignores: [
            'node_modules/**',
            'src-tauri/**',
            'upx/**',
            'icons/**',
            'img/**',
            '*.min.js',
            '*.min.css',
            'dist/**',
            'target/**',
        ],
    },
]
