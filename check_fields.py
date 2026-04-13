import os
from supabase import create_client, Client
from dotenv import load_dotenv

load_dotenv()
url: str = os.environ.get("VITE_SUPABASE_URL")
key: str = os.environ.get("VITE_SUPABASE_ANON_KEY")
supabase: Client = create_client(url, key)

res = supabase.table("bookings").select("*").limit(1).execute()
print(res.data[0].keys())
