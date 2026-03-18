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
            geminiApiKey,    // [Optional] Fallback API key from client
        } = await req.json();

        const GEMINI_API_KEY = geminiApiKey || Deno.env.get("GEMINI_API_KEY");
        if (!GEMINI_API_KEY) {
            throw new Error("GEMINI_API_KEY가 설정되지 않았습니다. (Env or Client)");
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
                    throw new Error(`이미지를 가져오는데 실패했        // ─── 2. Build prompt ──────────────────────────────────────────────────────
        const locationHint = address
            ? address.split(" ").slice(0, 2).join(" ")
            : "해당 지역";

        const qualifications = businessProfile?.qualifications ||
            "삼성 가전 전문 세척 교육 이수 / 에어컨 설치 자격증 보유";
        const companyName = businessProfile?.company_name || "클린브로";

        const systemPrompt = `
당신은 국내 청소 전문 업체 '${companyName}'의 최고의 공식 블로그 에디터이자 마케터입니다. (주의: 본문에 "안녕하세요", "클린브로 사장입니다" 등 인위적 인사나 자신을 사장으로 지칭하는 표현 금지. 정보 전달과 신뢰감 위주의 글로 시작하세요.)
제공된 청소 전・후 사진들을 분석하여 네이버 블로그 상위 노출에 최적화된 포스팅 초안과 동네 주민에게 홍보할 당근마켓 소식글을 함께 작성해주세요.
모든 이미지는 9:16 세로 비율을 가정하고 숏폼 형태의 문체나 짧고 강렬한 단락으로 구성해주세요. 가독성을 위해 한 줄에 너무 긴 내용이 들어가지 않도록, 모바일 화면을 고려하여 문장마다 자주 줄바꿈(\\n)을 적극적으로 적용해주세요.

[블로그 SEO 최적화 및 작성 필수 조건 (매우 중요)]
- 제목 최적화: 네이버 SEO 및 썸네일에 노출하기 좋도록, 제목을 최대 20~25자 내외로 매우 간결하고 임팩트 있게 작성하세요. 불필요하게 긴 제목은 안 됩니다.
- 업체 정보 및 키워드: 본문 내에 "${locationHint} ${category} 청소", "클린브로" 키워드를 가장 자연스럽게 3~4회 포함하세요. (주의: 절대 요청된 '${category}' 외에 다른 가전제품(예: 세탁기, 에어컨 등)을 언급하지 마세요! 글이 중구난방이 되지 않도록 하나의 주제만 다루세요)
- 첫 문단: 첫 문단에는 반드시 "${locationHint} ${category} 청소"를 명시하여 시작하세요.
- 계절감: 현재 계절 혹은 다가올 계절에 맞는 공감형 멘트를 자연스럽게 본문에 넣어주세요.
- 네이버 스마트플레이스 SEO: 문서 중간중간 업체명+지역명 조합(예: 클린브로 ${locationHint})을 2~3회 언급하세요.
- 마무리 멘트: 본문 제일 마지막 하단에는 반드시 "${qualifications}" 자구와 예약 문의 번호 "010-2716-8635" 및 스마트플레이스 링크 "https://naver.me/xAFO9mgm" 를 표기하고, 바로 다음 줄에 "클린브로를 이용하신 후 네이버 플레이스에 소감을 남겨주시면 감사하겠습니다 😊" 라는 문장을 필수로 넣으세요.
 
[당근마켓 소식글 작성 조건 (블로그와 별도로 작성)]
- 분량 및 말투: 200~300자 이내. 동네 주민들에게 말하는 따뜻하고 자연스러운 이웃 말투 (예: 당근 이웃님들~).
- 내용 구성: 핵심 키워드(${locationHint} ${category} 청소, 클린브로)를 문장 앞쪽에 자연스럽게 배치하고 홍보 느낌을 최소화한 진정성 있는 후기나 작업 소식 형태로 작성.
- 금지 사항: 홈페이지/블로그 링크 유도 문구를 일절 적지 마세요.

[응답 규칙 (출력 구조를 완벽히 준수할 것)]
반드시 아래의 5개 구분자를 사용해 텍스트 형태로만 답변하세요 (절대 JSON 구조나 마크다운 블록 금지).

[제목]
(25자 이내의 간결하고 임팩트 있는 SEO 최적화된 제목)
[본문]
(블로그 본문 전체 작성. 모바일 가독성을 위해 수시로 줄바꿈 적용. [중요]: 제공된 사진 ${imageParts.length}장에 대하여 [IMAGE_1]부터 [IMAGE_${imageParts.length}]까지 사진 개수만큼 단 하나도 빠짐없이 순서대로 모든 이미지 삽입 마커를 문맥에 맞게 반드시 전부 삽입할 것.)
[당근소식]
(당근마켓용 따뜻한 소식글 200~300자 작성)
[태그]
#${locationHint}${category}청소 #${locationHint}청소업체 #클린브로 #${category}분해청소 (이외에 작업과 관련된 2~3개 태그 추가)
[설명]
(각 사진에 대한 한 줄 설명 작성, 줄바꿈으로 구분)
`;

        const userPrompt = `
카테고리: ${category} / 제품: ${product}
지역: ${locationHint}
메모(기사 특이사항): ${memo || "없음"}

사진 ${imageParts.length}장을 보고 위 규칙에 따라 블로그 초안과 당근마켓 소식을 작성해주세요. 절대 JSON 반환 금지. 반드시 5개의 구분자([제목], [본문], [당근소식], [태그], [설명])를 기준으로 텍스트로만 응답하세요.
다시 한번 강조합니다. 본문 작성 시 [IMAGE_1] 부터 [IMAGE_${imageParts.length}] 까지의 이미지 마커를 단 하나도 빠짐없이 전부 사용하세요!
`;

        // ─── 3. Call Gemini 2.5 Flash ───
        const reqBody = {
            contents: [
                {
                    role: "user",
                    parts: [
                        { text: `[지시사항]\n${systemPrompt} \n\n[사용자 요청]\n${userPrompt} ` },
                        ...imageParts,
                    ], 다음 줄에 "클린브로를 이용하신 후 네이버 플레이스에 소감을 남겨주시면 감사하겠습니다 😊" 라는 문장을 필수로 넣으세요.
 
[당근마켓 소식글 작성 조건 (블로그와 별도로 작성)]
- 분량 및 말투: 200~300자 이내. 동네 주민들에게 말하는 따뜻하고 자연스러운 이웃 말투 (예: 당근 이웃님들~).
- 내용 구성: 핵심 키워드(${locationHint} ${category} 청소, 클린브로)를 문장 앞쪽에 자연스럽게 배치하고 홍보 느낌을 최소화한 진정성 있는 후기나 작업 소식 형태로 작성.
- 금지 사항: 홈페이지/블로그 링크 유도 문구를 일절 적지 마세요.

[응답 규칙 (출력 구조를 완벽히 준수할 것)]
반드시 아래의 5개 구분자를 사용해 텍스트 형태로만 답변하세요 (절대 JSON 구조나 마크다운 블록 금지).

[제목]
(25자 이내의 간결하고 임팩트 있는 SEO 최적화된 제목)
[본문]
(블로그 본문 전체 작성. 모바일 가독성을 위해 수시로 줄바꿈 적용. [중요]: 제공된 사진 \${imageParts.length}장에 대하여 [IMAGE_1]부터 [IMAGE_\${imageParts.length}]까지 사진 개수만큼 단 하나도 빠짐없이 순서대로 모든 이미지 삽입 마커를 문맥에 맞게 반드시 전부 삽입할 것.)
[당근소식]
(당근마켓용 따뜻한 소식글 200~300자 작성)
[태그]
#${locationHint}${category}청소 #${locationHint}청소업체 #클린브로 #${category}분해청소 (이외에 작업과 관련된 2~3개 태그 추가)
[설명]
(각 사진에 대한 한 줄 설명 작성, 줄바꿈으로 구분)
\`;

        const userPrompt = \`
카테고리: \${category} / 제품: \${product}
지역: \${locationHint}
메모(기사 특이사항): \${memo || "없음"}

사진 \${imageParts.length}장을 보고 위 규칙에 따라 블로그 초안과 당근마켓 소식을 작성해주세요. 절대 JSON 반환 금지. 반드시 5개의 구분자([제목], [본문], [당근소식], [태그], [설명])를 기준으로 텍스트로만 응답하세요.
다시 한번 강조합니다. 본문 작성 시 [IMAGE_1] 부터 [IMAGE_\${imageParts.length}] 까지의 이미지 마커를 단 하나도 빠짐없이 전부 사용하세요!
\`;

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
            const titleMatch = rawText.match(/\[제목\]([\s\S]*?)(?:\[본문\]|\[당근소식\]|\[태그\]|\[설명\]|$)/i);
            const bodyMatch = rawText.match(/\[본문\]([\s\S]*?)(?:\[당근소식\]|\[태그\]|\[설명\]|$)/i);
            const karrotMatch = rawText.match(/\[당근소식\]([\s\S]*?)(?:\[태그\]|\[설명\]|$)/i);
            const tagsMatch = rawText.match(/\[태그\]([\s\S]*?)(?:\[설명\]|$)/i);
            const descMatch = rawText.match(/\[설명\]([\s\S]*)$/i);

            if (titleMatch) draft.title = titleMatch[1].trim();
            if (bodyMatch) draft.body = bodyMatch[1].trim();
            if (karrotMatch) draft.karrotText = karrotMatch[1].trim();

            const tagsText = tagsMatch ? tagsMatch[1] : null;
            const descText = descMatch ? descMatch[1] : null;

            if (tagsText) {
                draft.tags = tagsText
                    .split(/[,#\n]/)
                    .map((t: string) => t.trim())
                    .filter((t: string) => t.length > 0)
                    .map((t: string) => t.startsWith('#') ? t : `#${t}`);
            }
            if (descText) {
                draft.photoAltTexts = descText
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
