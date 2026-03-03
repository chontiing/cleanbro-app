require('dotenv').config({ path: 'blog_publisher/.env' });
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'AIzaSy...'; // Can't easily use .env unless I know it, but user has it stored in Supabase secrets.

async function test() {
    const reqBody = {
        contents: [{ role: "user", parts: [{ text: "Write {\"status\": \"ok\"}" }] }],
        generationConfig: {
            temperature: 0.8,
            responseMimeType: "application/json"
        }
    };

    const geminiRes = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${process.env.TEST_API_KEY}`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(reqBody) }
    );
    const text = await geminiRes.text();
    console.log(text);
}
test();
