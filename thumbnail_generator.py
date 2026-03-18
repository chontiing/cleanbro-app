import os
from PIL import Image, ImageDraw, ImageFont

def create_thumbnail(service_type: str, model_name: str, output_path: str = "temp_thumbnail.jpg") -> str:
    """
    템플릿 이미지를 불러와 중앙에 서비스 타입과 모델명을 그려 썸네일을 생성합니다.
    생성된 이미지의 경로를 반환합니다.
    """
    # 템플릿과 폰트 경로 계산 (naver_blog_bot.py 기준 구동)
    base_dir = os.path.dirname(os.path.abspath(__file__))
    template_path = os.path.join(base_dir, "app", "server", "assets", "clean_template.png")
    font_path = os.path.join(base_dir, "app", "server", "assets", "fonts", "D2CodingBold-Ver1.3.2-20180524.ttf")
    
    if not os.path.exists(template_path):
        print(f"[경고] 썸네일 템플릿 파일이 없습니다: {template_path}")
        return ""
    if not os.path.exists(font_path):
        print(f"[경고] 폰트 파일이 없습니다: {font_path}")
        return ""

    try:
        img = Image.open(template_path).convert("RGB")
        draw = ImageDraw.Draw(img)
        
        # 텍스트 세팅
        text1 = f"속초 {service_type} 청소!"
        text2 = f"{model_name}"
        
        img_w, img_h = img.size
        
        # 제목이 박스를 넘지 않도록 크기 조절
        font1_size = int(img_w * 0.08) # 넓이의 8% 정도 크기
        font2_size = int(img_w * 0.06)
        try:
            font1 = ImageFont.truetype(font_path, font1_size)
            font2 = ImageFont.truetype(font_path, font2_size)
        except OSError:
            print("[경고] 폰트를 로드할 수 없습니다.")
            return ""

        # 가로 중앙 정렬 좌표 계산 (최신 PIL의 textbbox 사용)
        bbox1 = draw.textbbox((0, 0), text1, font=font1)
        tw1 = bbox1[2] - bbox1[0]
        
        bbox2 = draw.textbbox((0, 0), text2, font=font2)
        tw2 = bbox2[2] - bbox2[0]

        x1 = (img_w - tw1) // 2
        x2 = (img_w - tw2) // 2
        
        # 블루 박스 중앙 Y 좌표 가정 (정중앙 쯤 배치)
        y_start = (img_h // 2) - int(img_h * 0.05)
        
        draw.text((x1, y_start), text1, fill="white", font=font1)
        draw.text((x2, y_start + int(font1_size * 1.5)), text2, fill="white", font=font2)
        
        img.save(output_path, "JPEG", quality=95)
        print(f"[Thumbnail] 썸네일 생성 완료: {output_path}")
        return output_path
    except Exception as e:
        print(f"[경고] 썸네일 생성 중 에러 발생: {e}")
        return ""

if __name__ == "__main__":
    # 단독 실행 시 테스트
    path = create_thumbnail("에어컨", "LG 손연재 모델")
    print(f"생성 결과 경로: {path}")
