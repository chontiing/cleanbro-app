import os, requests
from dotenv import load_dotenv
load_dotenv()

url = f"{os.getenv('VITE_SUPABASE_URL')}/rest/v1/bookings?category=eq.블로그자동화&product=eq.processing"
headers = {
    'apikey': os.getenv('VITE_SUPABASE_ANON_KEY'), 
    'Authorization': f"Bearer {os.getenv('VITE_SUPABASE_ANON_KEY')}", 
    'Content-Type': 'application/json', 
    'Prefer': 'return=representation'
}
payload = {'product': 'pending'}
res = requests.patch(url, headers=headers, json=payload)
print('Reverted processing tasks to pending:', res.json())
