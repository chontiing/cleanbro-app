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

                // 다운로드 모드 (receipts 버킷 하드코딩)
                try {
                    let filePath = url;
                    if (url.includes("receipts/")) {
                        filePath = url.substring(url.indexOf("receipts/") + 9);
                        if (filePath.includes("?")) {
                            filePath = filePath.split("?")[0];
                        }
                    }
                    filePath = decodeURIComponent(filePath);

                    console.log(`[generate-blog-draft] SDK 직접 다운로드 시도: 버킷 'receipts', 경로 '${filePath}'`);
                    const { data, error } = await supabase.storage.from('receipts').download(filePath);

                    if (!error && data) {
                        arrayBuffer = await data.arrayBuffer();
                        mimeType = data.type || mimeType;
                        console.log(`[generate-blog-draft] SDK 다운로드 성공 (${arrayBuffer?.byteLength} bytes)`);
                    } else {
                        console.warn(`[generate-blog-draft] SDK 에러 발생. Fallback Fetch 시도합니다. URL: ${url}`);
                        // fallback
                        const fallbackRes = await fetch(url);
                        if (!fallbackRes.ok) throw new Error(`SDK 및 Fallback Fetch 모두 실패 (HTTP ${fallbackRes.status})`);
                        arrayBuffer = await fallbackRes.arrayBuffer();
                        mimeType = fallbackRes.headers.get('content-type') || mimeType;
                        console.log(`[generate-blog-draft] Fallback Fetch 다운로드 성공`);
                    }
                } catch (e: any) {
                    console.error(`[generate-blog-draft] 이미지 추출 에러:`, e);
                    throw new Error(`이미지를 가져오는데 실패했습니다 (${url}): SDK 다운로드 실패: ${JSON.stringify(e)} (또는 ${e.message})`);
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
당신은 국내 청소 전문 업체 '${companyName}'의 공식 블로그 에디터입니다. (주의: 본문에 "안녕하세요", "클린브로 사장입니다" 같은 인위적인 인사말이나 자신을 사장으로 지칭하는 표현은 절대 쓰지 마세요. 무조건 본론 형태의 정보 전달과 신뢰감 주는 글로만 바로 시작하세요.)
제공된 청소 전・후 사진들을 분석하여 네이버 블로그 상위 노출에 최적화된 포스팅 초안을 작성해주세요.
주 독자층은 신생아가 있는 집부터 노인까지 전 연령대이므로, 누구나 읽기 쉽도록 친절하면서도 전문적인 말투를 유지해주세요.
모든 이미지는 9:16 세로 비율(Mobile-friendly)로 촬영된 것을 가정하고, 이에 맞춰 9:16 모바일 화면에 꽉 차고 가독성이 좋은 숏폼 형태의 문체나 짧고 강렬한 단락으로 구성해주세요.

[타겟별 소구점 강조 (본문에 자연스럽게 녹여주세요)]
- 신생아/영유아 집: 면역력이 약한 아기를 위한 '무균 세척'과 '친환경 세제' 강조. ("우리 아이 첫 숨결, 곰팡이 섞인 에어컨 바람에 맡길 수 없죠.")
- 노인/환자 집: 호흡기 질환 예방을 위한 전문적인 가전 살균 강조. ("부모님 댁 효도 선물, 쾌적한 실내 공기로 건강을 선물하세요.")
- 일반 가정/전문성: 꼼꼼한 분해 세척과 가전 수명 연장 강조. ("삼성 가전 교육을 수료한 전문가가 속초 전 지역 어디든 달려갑니다.")

[규칙]
1. 제목: 첨부된 사용자의 기존 블로그 썸네일 제목 스타일을 완벽하게 따라하세요. (예: "속초 에어컨 청소 삼성 시스템 분해 [1]", "속초에어컨청소 업체 가격 [2]"). 반드시 띄어쓰기나 대괄호 숫자 패턴을 유사하게 맞춰 적당한 번호를 붙여주세요.
2. 본문: 2000자 내외. 청소 전 오염 상태(사진에서 시각적으로 확인된 구체적 묘사 필수) → 청소 과정 → 청소 후 결과 순서. (쌍따옴표 등 특수문자 사용 시 반드시 이스케이프(\\") 처리할 것)
3. 단락마다 소제목(##) 사용. 글머리 기호(-)로 핵심 포인트 정리.
4. 전문성/문의 안내(필수): 본문 제일 마지막 하단에 "${qualifications}" 자구를 언급하고, 이어서 예약 문의 번호 "010-2716-8635" 및 스마트플레이스 링크 "https://naver.me/xAFO9mgm" 를 꼭 포함시키세요.
5. 태그: #지역 #제품종류 #${companyName} 조합으로 10개 이내.
6. 각 사진에 대한 한 줄 설명(alt 텍스트 역할) 배열도 반환.
7. 이미지 배치(매우 중요): 제공된 사진 ${imageParts.length}장에 대응하여, 본문 글의 문맥에 맞게 가장 적절한 위치에 \`[IMAGE_1]\`, \`[IMAGE_2]\` ... 형식의 마커를 삽입하세요. 마커는 반드시 1부터 사진 총 개수까지 빠짐없이 들어가야 합니다. (예: "청소 전 모습입니다. \\n[IMAGE_1]\\n정말 심각하죠?")
8. 출력 형식 (JSON 절대 금지): 반드시 아래의 구분자를 사용해 텍스트 형태로 답변하세요.
[제목]
(여기에 제목 작성)
[본문]
(여기에 본문 전체 작성, 자연스러운 실제 줄바꿈(엔터) 사용 가능, 중간에 [IMAGE_1] 마커 삽입)
[태그]
(여기에 태그 목록 작성, 쉼표로 구분. 예: #속초,#에어컨청소)
[설명]
(여기에 각 사진에 대한 한 줄 설명 작성, 실제 줄바꿈으로 구분)
★완전 초집중 주의사항★: 절대 JSON 구조({ })나 마크다운(\`\`\`)으로 답변하지 마세요. 반드시 위 4개의 구분자([제목], [본문], [태그], [설명])를 기준으로 작성하세요.
`;

        const userPrompt = `
카테고리: ${category} / 제품: ${product}
지역: ${locationHint}
메모(기사 특이사항): ${memo || "없음"}

사진 ${imageParts.length}장을 보고 위 규칙에 따라 블로그 초안을 작성해주세요. 내용의 형태가 9:16 세로 사진 특유의 모바일 숏폼 규격에 완전히 어울리도록 배치해주세요. 다시 한 번 강조하지만 절대 JSON 형식으로 답하지 말고 [제목], [본문], [태그], [설명] 구분자를 사용해 텍스트로만 응답하세요.
`;

        // ─── 3. Call Gemini 2.5 Flash ───
        const reqBody = {
            contents: [
                {
                    role: "user",
                    parts: [
                        { text: `[지시사항]\n${systemPrompt} \n\n[사용자 요청]\n${userPrompt} ` },
                        ...imageParts,
                    ],
                },
            ],
            generationConfig: {
                temperature: 0.8,
                maxOutputTokens: 4096,
            },
        };

        const geminiRes = await fetch(
            `https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`,
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
        const rawText = geminiJson.candidates?.[0]?.content?.parts?.[0]?.text ?? "";

        // JSON 파싱 방식을 완전히 버리고 일반 텍스트 분리 방식으로 우회
        let draft: Record<string, unknown> = {
            title: "",
            body: "",
            tags: [],
            photoAltTexts: []
        };

        try {
            const titleMatch = rawText.match(/\[제목\]([\s\S]*?)\[본문\]/i);
            const bodyMatch = rawText.match(/\[본문\]([\s\S]*?)\[태그\]/i);
            const tagsMatch = rawText.match(/\[태그\]([\s\S]*?)\[설명\]/i);
            const descMatch = rawText.match(/\[설명\]([\s\S]*)$/i);

            if (titleMatch) draft.title = titleMatch[1].trim();
            if (bodyMatch) draft.body = bodyMatch[1].trim();

            if (tagsMatch) {
                draft.tags = tagsMatch[1]
                    .split(/[,#\n]/)
                    .map((t: string) => t.trim())
                    .filter((t: string) => t.length > 0)
                    .map((t: string) => t.startsWith('#') ? t : `#${t}`);
            }
            if (descMatch) {
                draft.photoAltTexts = descMatch[1]
                    .split('\n')
                    .map((t: string) => t.trim())
                    .filter((t: string) => t.length > 0);
            }

            if (!draft.title && !draft.body) {
                throw new Error("응답에서 [제목]이나 [본문] 구분자를 찾을 수 없습니다.");
            }
        } catch (err: any) {
            throw new Error(`텍스트 파싱 실패: ${err.message}\n파싱 시도된 원본:\n${rawText.slice(0, 500)}`);
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
