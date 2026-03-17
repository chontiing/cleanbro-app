/** @type {import('tailwindcss').Config} */
export default {
    content: [
        "./index.html",
        "./src/**/*.{js,ts,jsx,tsx}",
    ],
    darkMode: "class",
    theme: {
        extend: {
            colors: {
                "primary": "#2463eb",
                "background-light": "#f1f5f9",
                "background-dark": "#0f172a",
                "ai-bubble": "#ffffff",
                "user-bubble": "#dbeafe",
            },
            fontFamily: {
                "display": ["Inter", "sans-serif"]
            },
            borderRadius: {
                "DEFAULT": "0.5rem",
                "lg": "1rem",
                "xl": "1.5rem",
                "full": "9999px"
            },
        },
    },
    plugins: [
        // Tailwind v4 uses @tailwindcss/forms differently or through CSS, 
        // but for config based approach with Vite:
    ],
}
