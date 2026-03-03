const rawText = "```json\n{\n  \"title\": \"강원특별자치도 속초 통돌이 세탁기 곰팡이 찌든 때 청소 완벽 후기 | 클린브로\",\n  \"body\": \"안녕하세요, 속초 클린브로 사장입니다! 🚀 \\n\\n오늘은 강원특별자치도 속초에서 만난 '통돌이 세탁기' 청소 후기를 생생하게 전해드리려 해요. 겉으로 보기엔 멀쩡해 보여도, 세탁기 속은 정말 상상 이상으로 오염되어 있는 경우가 많답니다! 우리 가족의 건강과 직결되는 세탁기 과연 괜찮을까요?\\n\\n## 세탁기 청소 왜\"\n}\n```";

let jsonStr = rawText.trim();
jsonStr = jsonStr.replace(/```json/gi, '').replace(/```/g, '').trim();

const firstBrace = jsonStr.indexOf('{');
const lastBrace = jsonStr.lastIndexOf('}');
if (firstBrace !== -1 && lastBrace !== -1) {
  jsonStr = jsonStr.substring(firstBrace, lastBrace + 1);
}

// simulate the replacement from my current code
jsonStr = jsonStr.replace(/[\n\r\t]+/g, ' ');

try {
  console.log("Parsing...");
  JSON.parse(jsonStr);
  console.log("Success");
} catch (e) {
  console.log("Error:", e.message);
  console.log("String was:");
  console.log(jsonStr);
}
