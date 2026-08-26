// Supabase Edge Function: publish-instagram
// Publishes an image (or carousel of images) to Instagram via the official
// Meta Graph API (Content Publishing API) — no browser automation involved.
// Requires INSTAGRAM_ACCESS_TOKEN and INSTAGRAM_BUSINESS_ACCOUNT_ID secrets.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const GRAPH_API = "https://graph.facebook.com/v19.0";

serve(async (req: Request) => {
    if (req.method === "OPTIONS") {
        return new Response("ok", { headers: corsHeaders });
    }

    try {
        const { imageUrls, caption } = await req.json();

        const ACCESS_TOKEN = Deno.env.get("INSTAGRAM_ACCESS_TOKEN");
        const IG_USER_ID = Deno.env.get("INSTAGRAM_BUSINESS_ACCOUNT_ID");
        if (!ACCESS_TOKEN || !IG_USER_ID) {
            throw new Error("INSTAGRAM_ACCESS_TOKEN / INSTAGRAM_BUSINESS_ACCOUNT_ID가 설정되지 않았습니다.");
        }

        const urls: string[] = (imageUrls || []).filter(Boolean).slice(0, 10);
        if (urls.length === 0) throw new Error("게시할 이미지가 없습니다.");

        const graphPost = async (path: string, params: Record<string, string>) => {
            const res = await fetch(`${GRAPH_API}/${path}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ ...params, access_token: ACCESS_TOKEN }),
            });
            const json = await res.json();
            if (!res.ok || json.error) {
                throw new Error(`Instagram Graph API 오류: ${json.error?.message || res.statusText}`);
            }
            return json;
        };

        let creationId: string;

        if (urls.length === 1) {
            const media = await graphPost(`${IG_USER_ID}/media`, {
                image_url: urls[0],
                caption: caption || "",
            });
            creationId = media.id;
        } else {
            // 캐러셀: 이미지별 자식 컨테이너 생성 후 하나의 캐러셀 컨테이너로 묶음
            const childIds: string[] = [];
            for (const url of urls) {
                const child = await graphPost(`${IG_USER_ID}/media`, {
                    image_url: url,
                    is_carousel_item: "true",
                });
                childIds.push(child.id);
            }
            const carousel = await graphPost(`${IG_USER_ID}/media`, {
                media_type: "CAROUSEL",
                children: childIds.join(","),
                caption: caption || "",
            });
            creationId = carousel.id;
        }

        const published = await graphPost(`${IG_USER_ID}/media_publish`, {
            creation_id: creationId,
        });

        return new Response(JSON.stringify({ success: true, mediaId: published.id }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    } catch (err: any) {
        console.error("[publish-instagram] Error:", err);
        return new Response(
            JSON.stringify({ success: false, error: err.message || String(err) }),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
    }
});
