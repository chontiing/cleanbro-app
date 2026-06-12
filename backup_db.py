import os
import sys
import csv
from datetime import datetime

# 로컬의 'supabase' 폴더와 가상환경의 'supabase' 패키지 충돌 방지
current_dir = os.path.abspath(os.path.dirname(__file__))
original_sys_path = sys.path.copy()
if current_dir in sys.path:
    sys.path.remove(current_dir)
if '' in sys.path:
    sys.path.remove('')

from supabase import create_client, Client
from dotenv import load_dotenv

# 임포트 후 원래 sys.path 복구
sys.path = original_sys_path


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
        
        # 5년(1825일) 경과된 오래된 백업 파일 정리 정책 적용
        import glob
        from datetime import timedelta
        
        print("\n[Retention Policy] 오래된 백업 데이터를 검사 중입니다 (보존 기간: 5년)...")
        now_time = datetime.now()
        retention_days = 1825
        deleted_count = 0
        
        backup_files = glob.glob(os.path.join(backup_dir, "bookings_backup_*.csv"))
        for bf in backup_files:
            try:
                file_mtime = datetime.fromtimestamp(os.path.getmtime(bf))
                if now_time - file_mtime > timedelta(days=retention_days):
                    os.remove(bf)
                    print(f" -> 오래된 백업 파일 자동 삭제 완료: {os.path.basename(bf)}")
                    deleted_count += 1
            except Exception as ex:
                print(f" -> 파일 삭제 처리 실패 ({os.path.basename(bf)}): {ex}")
                
        if deleted_count > 0:
            print(f"[INFO] 총 {deleted_count}개의 5년 초과된 백업 파일이 자동 정리되었습니다.")
        else:
            print("[INFO] 5년 이상 경과된 백업 파일이 없습니다. 안전한 상태입니다.")
except Exception as e:
    print(f"\n[ERROR] 백업 중 치명적 오류 발생: {e}")
