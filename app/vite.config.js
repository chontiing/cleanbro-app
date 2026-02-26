import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  base: './', // 빌드 시 파일 경로가 상대 경로로 잡히도록 설정 (Github Pages 등 대비)
})
