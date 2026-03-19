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

        // SEO용 타겟 지역 추출 (예매 데이터 기준)
        let seoRegion = "속초";
        if (address) {
            if (address.includes("고성")) seoRegion = "고성";
            else if (address.includes("양양")) seoRegion = "양양";
            else if (address.includes("속초")) seoRegion = "속초";
        }

        const qualifications = businessProfile?.qualifications ||
            "삼성 가전 전문 세척 교육 이수 / 에어컨 설치 자격증 보유";
        const companyName = businessProfile?.company_name || "클린브로";

        const systemPrompt = `
당신은 국내 청소 전문 업체 '${companyName}'의 최고의 공식 블로그 에디터이자 마케터입니다. (주의: 본문에 "안녕하세요", "클린브로 사장입니다" 등 인위적 인사나 자신을 사장으로 지칭하는 표현 금지. 정보 전달과 신뢰감 위주의 글로 시작하세요.)
제공된 청소 전・후 사진들을 순서대로 극적으로 분석하여 네이버 블로그 스마트플레이스 상위 노출에 최적화된 포스팅 초안과 동네 주민에게 홍보할 당근마켓 소식글을 함께 작성해주세요.

[블로그 퀄리티 및 SEO 최적화 필수 조건 (매우 중요)]
- 제목 최적화: 제목은 반드시 지정된 형식을 엄격히 따르세요. 느낌표(!) 외의 불필요한 특수문자는 배제하세요. 지역명과 모델명이 앞부분에 오도록 검색 노출을 극대화해야 합니다.
  * 제목 포맷: ${seoRegion} ${category} 청소! ${product} [10자 이내의 AI 후킹문구]
  * 작성 예시: ${seoRegion} 에어컨 청소! 무풍 2구 묵은 때까지 싹 ✨
- AI 사진 분석 & 프리미엄 케어 연계: 첨부된 사진들을 보면서 단지 "청소했습니다"가 아니라, "**고객님의 건강을 위해 스팀, UV, 탈취 등 프리미엄 장비로 정성껏 케어해드렸다**"는 톤앤매너로 서술하세요. 사진 설명 사이에 이러한 케어 과정을 자연스럽게 녹여주세요.
- 모바일 SEO 줄바꿈 & 강조: 문단은 최대 1~2문장으로 유지하고 빈 줄(엔터 2번)을 넣어 시원하게 띄어쓰세요. 대괄호([ ]) 기호 사용은 스팸 지수를 높이므로 절대 금지합니다. 소제목이나 강조가 필요한 부분은 볼드체(**텍스트**)나 '작은따옴표'를 사용하여 시각적으로 깔끔하게 강조하세요.
- 에디터/앱 UI 텍스트 차단 (매우 중요): 첨부된 사진에 스크린샷 캡처로 인한 '대표사진 삭제', 'AI 활용 설정', '스마트렌즈 분석' 등의 휴대폰 앱이나 에디터 UI 문구가 포함되어 있더라도, 절대 본문 생성을 위해 사용하지 마세요. 기기 청소 상태 묘사만 집중하세요.
- 이모지 활용: 각 문맥과 어울리는 다양한 이모지(✨, 🦠, 💦, 🔧, 🔍 등)를 문단 사이에 적절히 사용하여 시각적 즐거움을 더하세요.
- 방문자 리뷰 스타일 도입부: 글 첫머리는 마치 맘카페나 블로그 실제 방문자 리뷰처럼 진정성 있고 따뜻한 만족감(예: "정말 꼼꼼하게 작업해주셔서 감동받았어요!")을 표현하는 내레이션으로 시작하세요.
- 키워드 집중 배치 (SEO 핵심): 본문과 사진 설명(캡션) 전체를 통틀어 "${seoRegion} ${category} 청소", "클린브로" 라는 키워드가 아주 자연스러운 문맥으로 각각 **5회 이상** 강하게 반복되도록 작성하세요.
- 첫 문단 구성: 첫 문장의 서두는 무조건 "${seoRegion} ${category} 청소"를 포함시켜 자연스럽게 시작하세요.
- 스마트플레이스 연동: 문서 중간에 업체명+지역명 조합(예: 클린브로 \${locationHint})을 언급하세요.
- 문장 완성도 검증: AI의 생성이 중간에 끊기지 않고 문단이 모두 완전한 마침표(.)나 느낌표(!), 혹은 이모지로 완벽히 종료되도록 주의하세요. 문장이 꼬이거나 미완성으로 남으면 절대 안 됩니다.
- 하단 고정 문구: 본문 제일 마지막에는 반드시 아래의 형식을 똑같이 텍스트로 넣어주세요! (대괄호 없이, 띄어쓰기와 이모지 그대로 유지할 것)

=========================
📞 **클린브로 문의전화** 010-2716-8635
📍 **마이플레이스 바로가기** https://naver.me/xAFO9mgm

🎁 **클린브로만의 프리미엄 안심 혜택**
✅ 100도 이상 초강력 고압 스팀으로 곰팡이 뿌리까지 완벽 박멸!
✅ 보이지 않는 세균과 바이러스까지 잡아내는 2중 UV 살균 케어!
✅ 엄격한 항균 인증을 통과한 친환경 탈취제로 맑고 쾌적한 공기 선사!
✅ 인체에 무해한 전용 안심 세척제 사용으로 우리 가족 건강 보호!
=========================

- 오타 및 문맥 주의: '에어컨적함'처럼 어법에 맞지 않는 억지 조어(네오로지즘)나 찌꺼기 글을 절대 생성하지 마세요. AI가 쓴 기계적인 단어가 없는지 스스로 엄격히 검증하세요.

[당근마켓 소식글 작성 조건]
- 200~300자 이내. 동네 주민들에게 따뜻하게 말하는 이웃 말투 (예: 당근 이웃님들~).
- 핵심 키워드(${locationHint} ${category} 청소, 클린브로) 포함하되, 광고 느낌을 빼고 진정성 있는 작업 일상 소식 형태로 작성하세요. (링크 유도 금지)

[응답 규칙 (출력 구조를 완벽히 준수, 절대 JSON 구조 금지)]
반드시 아래 5개 구분자를 사용해 텍스트 형태로만 답변하세요.

[제목]
(반드시 "${seoRegion} ${product} 청소! [AI 생성 문구 10자 이내]" 형태의 텍스트 한 줄)
[본문]
(블로그 본문 작성. 멀티모달 오염도 비교 및 이모지 포함, 짧은 줄바꿈 적용.
[가장 중요]: 제공된 사진은 총 \${imageParts.length}장입니다. 본문의 흐름에 맞춰 [IMAGE_1], [IMAGE_2] ... [IMAGE_\${imageParts.length}] 까지 모든 번호의 이미지 마커를 단 하나도 빠뜨리지 말고 1번씩만 배치해 주세요. 각 사진 마커 사이에 '3단계 케어(스팀/UV/탈취)'에 대한 언급을 곁들인 사진 설명들을 적어주세요.
그리고 본문 하단에 '3단계 프리미엄 케어' 고정 문구와 '하단 고정 문구'를 반드시 누락 없이 다 적어주세요.)
[당근소식]
(당근마켓 소식글)
[태그]
#${locationHint}${category}청소 #${locationHint}청소업체 #클린브로 #${category}분해청소 (이외 2~3개 더)
[설명]
(각 사진에 대한 한 줄 설명 작성. 이때 반드시 "${seoRegion} ${category} 청소" 또는 "클린브로" 라는 키워드를 설명 안에도 몇 번 섞어주세요. 줄바꿈으로 구분)
`;

        const userPrompt = `
카테고리: ${category} / 제품: ${product}
고객명: ${customerName || "고객"}님
지역: ${locationHint}
메모(기사 특이사항): ${memo || "없음"}

첨부된 사진 \${imageParts.length}장을 멀티모달로 정밀 분석하여 세척 전/후 오염도를 비교하면서 위 가이드라인에 맞춰 작성하세요. 
모바일 친화적인 짧은 문장(3줄 이하)과 이모지를 꼭 적용해주시고, [IMAGE_N] 마커를 모두 빠짐없이 본문에 삽입해주세요.
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
                maxOutputTokens: 8192,
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

            let extraBodyText = "";
            if (titleMatch) {
                let fullTitle = titleMatch[1].trim();
                
                // 1) 무조건 첫 줄바꿈 기준으로 분리 (첫 줄만 제목으로 취급)
                const firstNewline = fullTitle.indexOf('\n');
                if (firstNewline !== -1) {
                     draft.title = fullTitle.substring(0, firstNewline).trim();
                     extraBodyText = fullTitle.substring(firstNewline).trim();
                } else {
                     draft.title = fullTitle;
                }
                
                // 특수문자나 괄호 등 잔여물 제거 (이모지는 살림)
                draft.title = draft.title.replace(/^["'\[]/, '').replace(/["'\]]$/, '').trim();
                
                // 2) 36자 초과 시 강제 절단 및 본문으로 합치기 (찌꺼기 방지용)
                if (draft.title.length > 36) {
                    const extra = draft.title.substring(36);
                    draft.title = draft.title.substring(0, 36).trim();
                    if (extra.trim()) {
                        extraBodyText = extra + (extraBodyText ? "\n" + extraBodyText : "");
                    }
                }
            }

            if (bodyMatch) {
                draft.body = extraBodyText + (extraBodyText ? "\n\n" : "") + bodyMatch[1].trim();
            } else if (extraBodyText) {
                draft.body = extraBodyText;
            }

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
