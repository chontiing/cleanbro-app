import os
import csv
from datetime import datetime
from supabase import create_client, Client
from dotenv import load_dotenv

# 환경변수 로딩
load_dotenv()
url = os.environ.get("VITE_SUPABASE_URL")
key = os.environ.get("VITE_SUPABASE_ANON_KEY")
supabase: Client = create_client(url, key)

backup_dir = "backups"
if not os.path.exists(backup_dir):
    os.makedirs(backup_dir)

print("클린브로 통합 데이터베이스 안전 백업을 시작합니다...")

try:
    all_bookings = []
    limit = 1000
    offset = 0
    print("클라우드 서버에서 데이터를 다운로드 중입니다. 잠시만 기다려주세요...")
    
    while True:
        response = supabase.table("bookings").select("*").order("id", desc=True).range(offset, offset + limit - 1).execute()
        data = response.data
        if not data:
            break
            
        all_bookings.extend(data)
        if len(data) < limit:
            break
        offset += limit
    
    if not all_bookings:
        print("백업할 데이터가 없습니다.")
    else:
        today_str = datetime.now().strftime("%Y%m%d_%H%M%S")
        filepath = os.path.join(backup_dir, f"bookings_backup_{today_str}.csv")
        
        # 필드(컬럼) 이름 수집
        keys = set()
        for b in all_bookings:
            keys.update(b.keys())
        keys = list(keys)
        
        # 엑셀에서 바로 열릴 수 있도록 utf-8-sig로 저장 (한글 깨짐 방지)
        with open(filepath, 'w', encoding='utf-8-sig', newline='') as f:
            dict_writer = csv.DictWriter(f, fieldnames=keys, extrasaction='ignore')
            dict_writer.writeheader()
            dict_writer.writerows(all_bookings)
            
        print(f"\n=============================================")
        print(f"[OK] 백업 완벽 성공!")
        print(f"[DIR] 저장 위치: {os.path.abspath(filepath)}")
        print(f"[INFO] 총 영구 보존된 데이터: {len(all_bookings)}건의 예약")
        print(f"[TIP] 해당 폴더에 가시면 언제든지 엑셀 파일 형태로 데이터를 조회할 수 있습니다.")
        print(f"=============================================")
except Exception as e:
    print(f"\n[ERROR] 백업 중 치명적 오류 발생: {e}")
