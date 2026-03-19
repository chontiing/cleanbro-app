-- 클린브로 앱: 지출 관리 테이블에 '세금계산서', '현금영수증' 발급 여부 컬럼 추가
-- 이 스크립트를 Supabase Dashboard -> SQL Editor 에서 복사하여 실행해주세요!

ALTER TABLE public.expenses 
ADD COLUMN IF NOT EXISTS has_tax_invoice BOOLEAN DEFAULT false;

ALTER TABLE public.expenses 
ADD COLUMN IF NOT EXISTS has_cash_receipt BOOLEAN DEFAULT false;
