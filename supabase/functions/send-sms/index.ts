import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

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

async function sendSms(to: string, text: string) {
    const apiKey = Deno.env.get('SOLAPI_API_KEY')!
    const apiSecret = Deno.env.get('SOLAPI_API_SECRET')!
    const fromNumber = Deno.env.get('SOLAPI_FROM_NUMBER')!

    const date = new Date().toISOString()
    const salt = crypto.randomUUID().replace(/-/g, '')
    const signature = await getSolapiSignature(apiSecret, date, salt)

    const authHeader = `HMAC-SHA256 apiKey=${apiKey}, date=${date}, salt=${salt}, signature=${signature}`

    const response = await fetch('https://api.solapi.com/messages/v4/send', {
        method: 'POST',
        headers: {
            'Authorization': authHeader,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            message: {
                to,
                from: fromNumber,
                text
            }
        })
    })

    return response.json()
}

serve(async (req) => {
    try {
        const payload = await req.json()
        console.log('Received payload:', payload)

        // Supabase Admin Client
        const supabase = createClient(
            Deno.env.get('SUPABASE_URL')!,
            Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
        )

        // 1. Webhook (insert) 모드: 예약 즉시 안내 문자 발송
        if (payload.type === 'INSERT' && payload.table === 'bookings' && payload.record) {
            const { id, customer_name, book_date, book_time_type, assignee, phone } = payload.record

            if (!phone || phone.length < 10) {
                return new Response(JSON.stringify({ error: 'No valid phone number' }), { status: 400 })
            }

            const text = `[예약 안내]\n${customer_name}님 예약이 완료되었습니다.\n\n날짜: ${book_date}\n시간: ${book_time_type}\n담당자: ${assignee}`

            console.log('Sending initial DB text to', phone)
            await sendSms(phone, text)

            // DB 업데이트 (sms_sent_initial = true)
            await supabase.from('bookings').update({ sms_sent_initial: true }).eq('id', id)

            return new Response(JSON.stringify({ message: 'Initial SMS sent successfully' }), { status: 200 })
        }

        // 2. Cron (스케줄러) 모드: 오늘 예약자 아침 8시 알림
        if (payload.action === 'send_morning_reminders') {
            const today = new Date()
            // KST (UTC+9) Date string
            const offset = today.getTimezoneOffset() * 60000
            const localISOTime = (new Date(today.getTime() - offset)).toISOString()
            const todayStr = localISOTime.split('T')[0]

            // 오늘 날짜이면서 sms_sent_reminder 가 false이거나 없는 예약들 가져오기
            const { data: bookings, error } = await supabase
                .from('bookings')
                .select('*')
                .eq('book_date', todayStr)
                .or('sms_sent_reminder.is.null,sms_sent_reminder.eq.false')

            if (error) throw error

            let sentCount = 0
            for (const b of bookings) {
                if (!b.phone || b.phone.length < 10) continue

                const text = `[방문 알림]\n오늘 방문 예정입니다.\n\n시간: ${b.book_time_type}\n담당자: ${b.assignee}`
                await sendSms(b.phone, text)

                await supabase.from('bookings').update({ sms_sent_reminder: true }).eq('id', b.id)
                sentCount++
            }

            return new Response(JSON.stringify({ message: `Sent ${sentCount} reminders for ${todayStr}` }), { status: 200 })
        }

        return new Response(JSON.stringify({ message: 'Unknown action' }), { status: 400 })
    } catch (error) {
        console.error(error)
        return new Response(JSON.stringify({ error: error.message }), { status: 500 })
    }
})
