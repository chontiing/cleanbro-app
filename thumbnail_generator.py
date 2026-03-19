import os
from PIL import Image, ImageDraw, ImageFont

def create_thumbnail(service_type: str, model_name: str, output_path: str = "temp_thumbnail.jpg") -> str:
    """
    템플릿 이미지를 불러와 중앙에 서비스 타입과 모델명을 그려 썸네일을 생성합니다.
    생성된 이미지의 경로를 반환합니다.
    """
    base_dir = os.path.dirname(os.path.abspath(__file__))
    assets_dir = os.path.join(base_dir, "app", "server", "assets")
    
    print(f"[Debug] 썸네일 생성 시작. {assets_dir} 탐색 중...")
    if os.path.exists(assets_dir):
        print(f"[Debug] 폴더 내부 파일 목록: {os.listdir(assets_dir)}")
    else:
        print("[경고] assets 폴더를 찾을 수 없습니다!")

    # 여러 확장자 및 실수로 생성된 파일명 대응
    template_path = ""
    for fname in ["clean_template.png", "clean_template.PNG", "clean_template.png.png"]:
        p = os.path.join(assets_dir, fname)
        if os.path.exists(p):
            template_path = p
            break
            
    font_path = os.path.join(assets_dir, "fonts", "D2CodingBold-Ver1.3.2-20180524.ttf")
    
    if not template_path:
        print(f"[경고] 썸네일 템플릿 이미지를 찾을 수 없습니다. (assets 폴더 안의 clean_template.png)")
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

        # 가로 해상도 및 텍스트 높이 계산
        bbox1 = draw.textbbox((0, 0), text1, font=font1)
        tw1, th1 = bbox1[2] - bbox1[0], bbox1[3] - bbox1[1]
        
        bbox2 = draw.textbbox((0, 0), text2, font=font2)
        tw2, th2 = bbox2[2] - bbox2[0], bbox2[3] - bbox2[1]

        x1 = (img_w - tw1) // 2
        x2 = (img_w - tw2) // 2
        
        # 하단 짙은 파란색 박스 영역 계산 (대략 y=450~900px, 비율상 44%~88% 구간)
        box_top = int(img_h * 0.44)
        box_bottom = int(img_h * 0.88)
        box_center = (box_top + box_bottom) // 2
        
        line_spacing = int(font1_size * 0.4)
        total_text_height = th1 + line_spacing + th2
        
        y_start = box_center - (total_text_height // 2)
        
        # 설정한 흰색(White) 폰트로 직사각형 박스 중앙에 출력
        draw.text((x1, y_start), text1, fill="white", font=font1)
        draw.text((x2, y_start + th1 + line_spacing), text2, fill="white", font=font2)
        
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
