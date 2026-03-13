// @ts-ignore
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
// @ts-ignore
import { encodeBase64 } from "https://deno.land/std@0.203.0/encoding/base64.ts"

declare const Deno: any;

export const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

async function getSolapiSignature(apiSecret: string, date: string, salt: string) {
    const encoder = new TextEncoder()
    const key = await crypto.subtle.importKey(
        'raw',
        encoder.encode(apiSecret),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
    )
    const signatureBuffer = await crypto.subtle.sign(
        'HMAC',
        key,
        encoder.encode(date + salt)
    )
    const hashArray = Array.from(new Uint8Array(signatureBuffer))
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
}

async function uploadToSolapi(apiKey: string, apiSecret: string, imageUrl: string) {
    console.log(`[Solapi] Uploading image: ${imageUrl.substring(0, 50)}...`)
    const response = await fetch(imageUrl)

    // 1. 저장소(Bucket) 접근 권한 문제 확인
    if (!response.ok) {
        const errText = await response.text();
        throw new Error(`이미지 다운로드 실패 (${response.status}). 수파베이스 Storage가 Public 상태인지 확인하세요. 상세: ${errText.substring(0, 50)}`);
    }

    const arrayBuffer = await response.arrayBuffer()
    const base64 = encodeBase64(new Uint8Array(arrayBuffer))

    const date = new Date().toISOString()
    const salt = crypto.randomUUID().replace(/-/g, '')
    const signature = await getSolapiSignature(apiSecret, date, salt)
    const authHeader = `HMAC-SHA256 apiKey=${apiKey}, date=${date}, salt=${salt}, signature=${signature}`

    // 2. 솔라피 업로드 요청
    const uploadResponse = await fetch('https://api.solapi.com/storage/v1/files', {
        method: 'POST',
        headers: {
            'Authorization': authHeader,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            file: base64,
            type: 'MMS'
        })
    })

    const result = await uploadResponse.json()
    if (!uploadResponse.ok) {
        console.error('Solapi Upload error:', JSON.stringify(result))
        throw new Error(`이미지를 솔라피에 등록하는데 실패했습니다: ${result.errorMessage || result.message || JSON.stringify(result)}`);
    }
    return result.fileId
}

async function sendSms(apiKey: string, apiSecret: string, fromNumber: string, to: string, text: string, imageId?: string) {
    const date = new Date().toISOString()
    const salt = crypto.randomUUID().replace(/-/g, '')
    const signature = await getSolapiSignature(apiSecret, date, salt)

    const authHeader = `HMAC-SHA256 apiKey=${apiKey}, date=${date}, salt=${salt}, signature=${signature}`

    const cleanTo = to.replace(/[^0-9]/g, '')
    const cleanFrom = fromNumber.replace(/[^0-9]/g, '')
    console.log(`[Solapi] Sending request: From=${cleanFrom}, To=${cleanTo}, TextLength=${text.length}, hasImage=${!!imageId}`)

    const response = await fetch('https://api.solapi.com/messages/v4/send', {
        method: 'POST',
        headers: {
            'Authorization': authHeader,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            message: {
                to: cleanTo,
                from: cleanFrom,
                text,
                imageId: imageId
            }
        })
    })

    const result = await response.json()
    if (!response.ok || (result.statusCode && ![2000, '2000'].includes(result.statusCode))) {
        console.error('Solapi Error RESPONSE:', JSON.stringify(result))
        const errorMsg = result.errorMessage ||
            result.message ||
            (result.messages && result.messages[0]?.reason) ||
            `Solapi Error ${result.statusCode || response.status}`;
        throw new Error(errorMsg)
    }
    return result
}

Deno.serve(async (req: any) => {
    // Handle CORS pre-flight requests
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders })
    }

    try {
        const payload = await req.json()
        console.log('Received payload action:', payload.action || payload.type || 'unknown')

        // Supabase Admin Client
        const supabase = createClient(
            Deno.env.get('SUPABASE_URL')!,
            Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
        )

        // 1. Webhook (insert) 모드: 예약 즉시 안내 문자 발송 (프론트엔드에서도 처리할 수 있지만 백업/웹훅용으로 유지)
        if (payload.type === 'INSERT' && payload.table === 'bookings' && payload.record) {
            const { id, customer_name, book_date, book_time_type, book_time_custom, assignee, phone, business_id, user_id } = payload.record

            if (!phone || phone.length < 10) {
                return new Response(JSON.stringify({ error: 'No valid phone number' }), {
                    status: 400,
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                })
            }

            // DB에서 업체 정보 및 템플릿 가져오기
            const { data: business } = await supabase.from('businesses').select('*').eq('id', business_id).single()
            const { data: profile } = await supabase.from('profiles').select('*').eq('id', user_id).single()

            if (!business?.auto_confirm_sms) {
                return new Response(JSON.stringify({ message: 'Auto confirm SMS is disabled for this business' }), {
                    status: 200,
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                })
            }

            const confirmedTpl = business?.confirmed_template || `[예약 확정] [일시]에 방문 예정입니다. - 클린브로 ([파트너전화번호])`
            const timeVal = book_time_type === '직접입력' ? book_time_custom : book_time_type
            const dateTimeStr = `${book_date} ${timeVal}`

            const senderPhone = profile?.solapi_from_number || profile?.sender_number || business?.solapi_from_number || business?.phone || ''
            const apiKey = profile?.solapi_api_key || business?.solapi_api_key || Deno.env.get('SOLAPI_API_KEY')
            const apiSecret = profile?.solapi_api_secret || business?.solapi_api_secret || Deno.env.get('SOLAPI_API_SECRET')

            const text = confirmedTpl
                .replace(/\[고객명\]/g, customer_name || '고객')
                .replace(/\[일시\]/g, dateTimeStr)
                .replace(/\[시간\]/g, timeVal || '')
                .replace(/\[파트너전화번호\]/g, senderPhone)

            if (apiKey && apiSecret && senderPhone) {
                console.log('Attempting to send initial confirmed text to', phone)
                try {
                    const result = await sendSms(apiKey, apiSecret, senderPhone, phone, text)
                    console.log('SMS sent successfully:', result)
                    await supabase.from('bookings').update({ sms_sent_initial: true }).eq('id', id)
                } catch (err: any) {
                    console.error('Failed to send initial SMS:', err.message)
                }
            } else {
                console.warn('Skipping SMS: Missing credentials or sender phone.', { hasApiKey: !!apiKey, hasApiSecret: !!apiSecret, senderPhone })
            }

            return new Response(JSON.stringify({ message: 'Initial SMS processed' }), {
                status: 200,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            })
        }

        // 2. Cron (스케줄러) 모드: 오늘 예약자 아침 8시 알림
        if (payload.action === 'send_morning_reminders' || (!payload.type && !payload.action)) {
            const today = new Date()
            // Supabase Edge Function은 UTC이므로 한국 시간(KST)으로 수동 변환 (+9시간)
            const kstTime = new Date(today.getTime() + (9 * 60 * 60 * 1000))
            const todayStr = kstTime.toISOString().split('T')[0]

            // 먼저 자동 발송이 활성화된 업체 리스트 가져오기
            const { data: activeBusinesses } = await supabase.from('businesses').select('id').eq('auto_morning_reminders', true)
            if (!activeBusinesses || activeBusinesses.length === 0) {
                return new Response(JSON.stringify({ message: 'No businesses with auto_morning_reminders enabled' }), {
                    status: 200,
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                })
            }
            const activeBusinessIds = activeBusinesses.map((b: any) => b.id)

            const { data: bookings, error } = await supabase
                .from('bookings')
                .select('*')
                .eq('book_date', todayStr)
                .in('business_id', activeBusinessIds)
                .or('sms_sent_reminder.is.null,sms_sent_reminder.eq.false')

            if (error) throw error

            let sentCount = 0
            for (const b of bookings) {
                if (!b.phone || b.phone.length < 10) continue

                // 해당 업체의 템플릿 및 파트너(담당자) 정보 획득
                const { data: business } = await supabase.from('businesses').select('*').eq('id', b.business_id).single()
                const { data: profile } = await supabase.from('profiles').select('*').eq('id', b.user_id).single()

                const reminderTpl = business?.morning_reminder_template || `[알림] 오늘 [시간]에 방문 예정입니다. 뵙겠습니다! - 클린브로 ([파트너전화번호])`
                const timeVal = b.book_time_type === '직접입력' ? b.book_time_custom : b.book_time_type
                const dateTimeStr = `${b.book_date} ${timeVal}`

                const senderPhone = profile?.solapi_from_number || profile?.sender_number || business?.solapi_from_number || business?.phone || ''
                const apiKey = profile?.solapi_api_key || business?.solapi_api_key || Deno.env.get('SOLAPI_API_KEY')
                const apiSecret = profile?.solapi_api_secret || business?.solapi_api_secret || Deno.env.get('SOLAPI_API_SECRET')

                const text = reminderTpl
                    .replace(/\[고객명\]/g, b.customer_name || '고객')
                    .replace(/\[일시\]/g, dateTimeStr)
                    .replace(/\[시간\]/g, timeVal || '')
                    .replace(/\[파트너전화번호\]/g, senderPhone)

                if (apiKey && apiSecret && senderPhone) {
                    await sendSms(apiKey, apiSecret, senderPhone, b.phone, text)
                    await supabase.from('bookings').update({ sms_sent_reminder: true }).eq('id', b.id)
                    sentCount++
                }
            }

            return new Response(JSON.stringify({ message: `Sent ${sentCount} reminders for ${todayStr}` }), {
                status: 200,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            })
        }

        // 3. 직접 발송 모드: 프론트엔드에서 수동 호출 (CORS 우회 용도)
        if (payload.action === 'send_custom_sms') {
            const { apiKey, apiSecret, fromNumber, to, text, imageUrls } = payload;
            console.log(`[send_custom_sms] To: ${to}, From: ${fromNumber}, Text preview: ${text?.substring(0, 10)}..., Images: ${imageUrls?.length || 0}`)

            if (!apiKey || !apiSecret || !fromNumber || !to || !text) {
                return new Response(JSON.stringify({ error: 'Missing required parameters for send_custom_sms' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
            }

            try {
                let imageId: string | undefined = undefined;
                if (imageUrls && imageUrls.length > 0) {
                    try {
                        imageId = await uploadToSolapi(apiKey, apiSecret, imageUrls[0]);
                    } catch (uploadErr: any) {
                        console.warn(`[send_custom_sms] Image upload skipped: ${uploadErr.message}`);
                    }
                }

                const result = await sendSms(apiKey, apiSecret, fromNumber, to, text, imageId);
                console.log('Custom SMS sent successfully:', result);
                return new Response(JSON.stringify(result), {
                    status: 200,
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                });
            } catch (err: any) {
                console.error('Custom SMS send failed:', err.message);
                return new Response(JSON.stringify({ error: err.message }), {
                    status: 500,
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                });
            }
        }

        return new Response(JSON.stringify({ message: 'No valid action performed' }), {
            status: 200,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
    } catch (error: any) {
        console.error(error)
        return new Response(JSON.stringify({ error: error.message }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
    }
})
