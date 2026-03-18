import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import legacy from '@vitejs/plugin-legacy'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    legacy({
      targets: ['defaults', 'not IE 11', 'Android >= 5'],
      additionalLegacyPolyfills: ['regenerator-runtime/runtime']
    })
  ],
  base: './', // 빌드 시 파일 경로가 상대 경로로 잡히도록 설정 (Github Pages 등 대비)
  server: {
    host: true, // 로컬망 내 휴대폰 등에서 접속 가능하게 설정
  },
})
