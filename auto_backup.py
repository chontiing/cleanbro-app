import os
import time
import subprocess
import hashlib
import json
from supabase import create_client, Client
from dotenv import load_dotenv

load_dotenv()
url = os.environ.get("VITE_SUPABASE_URL")
key = os.environ.get("VITE_SUPABASE_ANON_KEY")
supabase: Client = create_client(url, key)

print("================================================================")
print("[INFO] 클린브로 실시간 든든 백업 시스템 가동 완료!")
print("앱에서 예약을 추가/수정/취소할 때마다 즉시 파악하여 자동으로 백업합니다.")
print("(창을 끄지 말고 최소화 해두시면 알아서 계속 백업됩니다)")
print("================================================================")

last_hash = ""

while True:
    try:
        # 데이터가 많지 않으므로 id, memo, book_date 등 변동이 잦은 일부 필드만 빠르게 조회
        res = supabase.table("bookings").select("id, created_at, memo, book_date, final_price, status, customer_name, is_completed").order("id", desc=True).execute()
        data = res.data
        
        # 데이터 해시 계산 (변동 여부 파악)
        data_str = json.dumps(data, sort_keys=True, ensure_ascii=False)
        current_hash = hashlib.md5(data_str.encode('utf-8')).hexdigest()
        
        if last_hash != "" and current_hash != last_hash:
            print("\n[알림] 누군가 예약을 추가/수정/삭제한 것을 감지했습니다! 자동 백업을 시작합니다...")
            subprocess.run(["python", "backup_db.py"])
            print("[OK] 자동 백업 완료. 다음 변동을 대기합니다...\n")
            
        last_hash = current_hash
            
    except Exception as e:
        # 일시적 네트워크 오류 등은 무시
        pass
        
    time.sleep(10) # 10초 주기
