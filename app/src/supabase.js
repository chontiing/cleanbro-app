import { createClient } from '@supabase/supabase-js'

// 슈파베이스 프로젝트 URL과 API Key를 입력하세요.
// 루트 폴더의 .env 파일에 VITE_SUPABASE_URL 등 환경변수를 넣는 것이 가장 좋습니다.
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://INSERT_YOUR_PROJECT_URL.supabase.co';
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'INSERT_YOUR_ANON_KEY';

export const supabase = createClient(supabaseUrl, supabaseKey)
