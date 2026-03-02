// Supabase Edge Function: generate-blog-draft
// Receives image URLs + booking info, calls Gemini Vision API,
// and returns a full SEO blog post draft (title, body, tags).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { encodeBase64 } from "https://deno.land/std@0.203.0/encoding/base64.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req: Request) => {
    if (req.method === "OPTIONS") {
        return new Response("ok", { headers: corsHeaders });
    }

    try {
        const {
            imageUrls,       // string[] — before/after photo public URLs
            category,        // e.g. '에어컨'
            product,         // e.g. '벽걸이'
            address,         // e.g. '강원도 속초시 OO아파트'
            customerName,    // optional
            memo,            // optional technician notes
            businessProfile, // { company_name, qualifications }
        } = await req.json();

        const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
        if (!GEMINI_API_KEY) {
            throw new Error("GEMINI_API_KEY 환경변수가 설정되지 않았습니다.");
        }

        const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
        const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
        const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

        // ─── 1. Build vision parts from image URLs ────────────────────────────────
        const imageParts = await Promise.all(
            (imageUrls || []).slice(0, 10).map(async (url: string) => {
                let arrayBuffer: ArrayBuffer | null = null;
                let mimeType = "image/jpeg";

                // 1) SDK 직결 다운로드 전용 (502 통신오류 원천 차단, 외부 Fetch 금지)
                try {
                    if (url.includes("/storage/v1/object/public/")) {
                        // ex) .../storage/v1/object/public/receipts/a3999.../after_...jpg
                        const prefixIndex = url.indexOf("/storage/v1/object/public/") + "/storage/v1/object/public/".length;
                        const remainder = url.substring(prefixIndex); // e.g., "receipts/a3999.../after_...jpg"

                        const firstSlashIdx = remainder.indexOf("/");
                        const bucket = remainder.substring(0, firstSlashIdx); // "receipts"
                        let path = remainder.substring(firstSlashIdx + 1);    // "a3999.../after_...jpg"

                        // query string 제거 (?t=... 등)
                        if (path.includes("?")) {
                            path = path.split("?")[0];
                        }

                        console.log(`[generate-blog-draft] SDK 직접 다운로드 시도: 버킷 '${bucket}', 경로 '${decodeURIComponent(path)}'`);
                        const { data, error } = await supabase.storage.from(bucket).download(decodeURIComponent(path));

                        if (!error && data) {
                            arrayBuffer = await data.arrayBuffer();
                            mimeType = data.type || mimeType;
                            console.log(`[generate-blog-draft] SDK 다운로드 성공 (${arrayBuffer?.byteLength} bytes)`);
                        } else {
                            // 에러 객체가 비어보이는 현상 방지: JSON 파싱이 안되는 고유 객체일 수 있으므로 명시적 속성 추출
                            const errDesc = error ? (error.message || error.name || JSON.stringify(error)) : "Unknown unknown SDK error";
                            console.error(`[generate-blog-draft] SDK 에러 상세:`, error);
                            throw new Error(`SDK 다운로드 실패: ${errDesc}`);
                        }
                    } else {
                        throw new Error(`Supabase Storage URL 형식이 아닙니다: ${url}`);
                    }
                } catch (e: any) {
                    console.error(`[generate-blog-draft] 이미지 추출 에러:`, e);
                    throw new Error(`이미지를 가져오는데 실패했습니다 (${url}): ${e.message || String(e)}`);
                }

                const base64 = encodeBase64(arrayBuffer!);
                return { inline_data: { mime_type: mimeType, data: base64 } };
            })
        );

        // ─── 2. Build prompt ──────────────────────────────────────────────────────
        const locationHint = address
            ? address.split(" ").slice(0, 2).join(" ")
            : "해당 지역";

        const qualifications = businessProfile?.qualifications ||
            "삼성 가전 전문 세척 교육 이수 / 에어컨 설치 자격증 보유";
        const companyName = businessProfile?.company_name || "클린브로";

        const systemPrompt = `
당신은 국내 청소 전문 업체의 공식 블로그 에디터입니다.
제공된 청소 전・후 사진들을 분석하여 네이버 블로그 상위 노출에 최적화된 포스팅 초안을 작성해주세요.
모든 이미지는 9:16 세로 비율(Mobile-friendly)로 촬영된 것을 가정하고, 이에 맞춰 모바일 가독성이 좋은 숏폼 형태의 문체나 짧고 강렬한 단락으로 구성해주세요.

[규칙]
1. 제목: 지역명, 제품 브랜드/모델, 오염 증상, 업체명을 포함. 예) "속초 삼성 무풍 에어컨 곰팡이 청소 완료 후기 | ${companyName}"
2. 본문: 2000자 내외. 청소 전 오염 상태(사진에서 시각적으로 확인된 구체적 묘사 필수) → 청소 과정 → 청소 후 결과 순서.
3. 단락마다 소제목(##) 사용. 글머리 기호(-)로 핵심 포인트 정리.
4. 전문성 강조 문단: 본문 하단에 "${qualifications}" 등 자격을 언급.
5. 태그: #지역 #제품종류 #${companyName} 조합으로 10개 이내.
6. 각 사진에 대한 한 줄 설명(alt 텍스트 역할) 배열도 반환.
7. 반드시 JSON 형식으로만 응답: { "title": "...", "body": "...", "tags": ["..."], "photoAltTexts": ["..."] }
`;

        const userPrompt = `
카테고리: ${category} / 제품: ${product}
지역: ${locationHint}
메모(기사 특이사항): ${memo || "없음"}

사진 ${imageParts.length}장을 보고 위 규칙에 따라 블로그 초안을 JSON으로 작성해주세요. 특히 9:16 세로 사진의 특징을 잘 살려 모바일 친화적으로 작성 바랍니다.
`;

        // ─── 3. Call Gemini 1.5 Flash (v1 default, fallback to v1 flash-latest) ───
        const reqBody = {
            contents: [
                {
                    role: "user",
                    parts: [
                        { text: `[지시사항]\n${systemPrompt}\n\n[사용자 요청]\n${userPrompt}` },
                        ...imageParts,
                    ],
                },
            ],
            generationConfig: {
                temperature: 0.8,
                maxOutputTokens: 4096,
            },
        };

        let geminiRes = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${GEMINI_API_KEY}`,
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(reqBody),
            }
        );

        if (!geminiRes.ok) {
            const errText = await geminiRes.text();
            throw new Error(`Gemini API 오류 (${geminiRes.status}): ${errText}`);
        }

        const geminiJson = await geminiRes.json();
        const rawText =
            geminiJson.candidates?.[0]?.content?.parts?.[0]?.text ?? "";

        let draft: Record<string, unknown>;
        try {
            let jsonStr = rawText.trim();
            if (jsonStr.startsWith('```json')) {
                jsonStr = jsonStr.replace(/^```json/, '').replace(/```$/, '').trim();
            } else if (jsonStr.startsWith('```')) {
                jsonStr = jsonStr.replace(/^```/, '').replace(/```$/, '').trim();
            }
            draft = JSON.parse(jsonStr);
        } catch {
            throw new Error("Gemini 응답 파싱 실패: " + rawText.slice(0, 300));
        }

        return new Response(JSON.stringify({ draft }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    } catch (err: any) {
        console.error("[generate-blog-draft] Final Error:", err);
        return new Response(
            JSON.stringify({ error: err.message || String(err) }),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
    }
});
