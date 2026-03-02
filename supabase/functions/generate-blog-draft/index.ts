// Supabase Edge Function: generate-blog-draft
// Receives image URLs + booking info, calls Gemini Vision API,
// and returns a full SEO blog post draft (title, body, tags).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

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

        // ─── 1. Build vision parts from image URLs ────────────────────────────────
        const imageParts = await Promise.all(
            (imageUrls || []).slice(0, 10).map(async (url: string) => {
                const res = await fetch(url);
                if (!res.ok) throw new Error(`이미지 다운로드 실패: ${url}`);
                const arrayBuffer = await res.arrayBuffer();
                const base64 = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)));
                const mimeType = res.headers.get("content-type") || "image/jpeg";
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

사진 ${imageParts.length}장을 보고 위 규칙에 따라 블로그 초안을 JSON으로 작성해주세요.
`;

        // ─── 3. Call Gemini 1.5 Flash (cheaper & fast, sufficient for this) ───────
        const geminiRes = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`,
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    system_instruction: { parts: [{ text: systemPrompt }] },
                    contents: [
                        {
                            role: "user",
                            parts: [
                                ...imageParts,
                                { text: userPrompt },
                            ],
                        },
                    ],
                    generationConfig: {
                        response_mime_type: "application/json",
                        temperature: 0.8,
                        maxOutputTokens: 4096,
                    },
                }),
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
            draft = JSON.parse(rawText);
        } catch {
            throw new Error("Gemini 응답 파싱 실패: " + rawText.slice(0, 300));
        }

        return new Response(JSON.stringify({ draft }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    } catch (err) {
        console.error("[generate-blog-draft] Error:", err);
        return new Response(
            JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
    }
});
