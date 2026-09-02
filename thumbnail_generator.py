import os
from PIL import Image, ImageDraw, ImageFont

def create_thumbnail(service_type: str, model_name: str, region: str = "속초", output_path: str = "temp_thumbnail.jpg", before_img_path: str = None, after_img_path: str = None) -> str:
    """
    비포/애프터 이미지가 있으면 두 이미지를 좌우로 합성하여 썸네일을 생성하고,
    없으면 기존 템플릿 이미지를 불러와 중앙에 텍스트를 그립니다.
    """
    base_dir = os.path.dirname(os.path.abspath(__file__))
    assets_dir = os.path.join(base_dir, "app", "server", "assets")
    font_path = os.path.join(assets_dir, "fonts", "D2CodingBold-Ver1.3.2-20180524.ttf")
    
    print(f"[Debug] 썸네일 생성 시작. {assets_dir} 탐색 중...")
    if not os.path.exists(font_path):
        print(f"[경고] 폰트 파일이 없습니다: {font_path}")
        return ""

    try:
        # 비포/애프터 합성 로직
        if before_img_path and after_img_path and os.path.exists(before_img_path) and os.path.exists(after_img_path):
            b_img = Image.open(before_img_path).convert("RGB")
            a_img = Image.open(after_img_path).convert("RGB")
            
            w, h = 1080, 1080
            img = Image.new("RGB", (w, h))
            
            # 크롭 및 리사이즈 헬퍼 (540x1080)
            def crop_and_resize(im, target_w, target_h):
                im_w, im_h = im.size
                target_ratio = target_w / target_h
                im_ratio = im_w / im_h
                if im_ratio > target_ratio:
                    new_w = int(im_h * target_ratio)
                    offset = (im_w - new_w) // 2
                    im = im.crop((offset, 0, offset + new_w, im_h))
                else:
                    new_h = int(im_w / target_ratio)
                    offset = (im_h - new_h) // 2
                    im = im.crop((0, offset, im_w, offset + new_h))
                # Image.Resampling.LANCZOS for newer Pillow, Image.LANCZOS for older
                resample_filter = getattr(Image, 'Resampling', Image).LANCZOS
                return im.resize((target_w, target_h), resample_filter)
            
            b_resized = crop_and_resize(b_img, 540, 1080)
            a_resized = crop_and_resize(a_img, 540, 1080)
            
            img.paste(b_resized, (0, 0))
            img.paste(a_resized, (540, 0))
            
            draw = ImageDraw.Draw(img, "RGBA")
            
            # 중앙선
            draw.line([(540, 0), (540, 1080)], fill=(255, 255, 255, 255), width=6)
            
            # 하단 텍스트 딤 레이어 (그라데이션 대신 심플한 반투명 박스)
            draw.rectangle([(0, 680), (1080, 1080)], fill=(0, 0, 0, 180))
            
            # 중앙 정렬 텍스트 렌더링 헬퍼
            def draw_centered_text(draw_obj, text, x_center, y_center, font, fill):
                bbox = draw_obj.textbbox((0, 0), text, font=font)
                tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
                draw_obj.text((x_center - tw//2, y_center - th//2), text, fill=fill, font=font)

            badge_font = ImageFont.truetype(font_path, 40)
            
            # 비포 라벨 (빨강)
            draw.rectangle([(20, 20), (220, 90)], fill=(220, 53, 69, 230))
            draw_centered_text(draw, "청소 전", 120, 55, badge_font, "white")
            
            # 애프터 라벨 (초록)
            draw.rectangle([(560, 20), (760, 90)], fill=(40, 167, 69, 230))
            draw_centered_text(draw, "청소 후", 660, 55, badge_font, "white")
            
            # 메인 타이틀
            text1 = f"{region} {service_type} 청소!"
            text2 = f"{model_name}"
            
            font1 = ImageFont.truetype(font_path, 80)
            font2 = ImageFont.truetype(font_path, 60)
            
            draw_centered_text(draw, text1, 540, 780, font1, "white")
            draw_centered_text(draw, text2, 540, 900, font2, (255, 200, 50, 255)) # 포인트 컬러 (노란빛)
            
        else:
            # 템플릿 합성(Fallback)
            template_path = ""
            for fname in ["clean_template.png", "clean_template.PNG", "clean_template.png.png"]:
                p = os.path.join(assets_dir, fname)
                if os.path.exists(p):
                    template_path = p
                    break
                    
            if not template_path:
                print(f"[경고] 썸네일 템플릿 이미지를 찾을 수 없습니다. (assets 폴더 안의 clean_template.png)")
                return ""

            img = Image.open(template_path).convert("RGB")
            draw = ImageDraw.Draw(img)
            
            text1 = f"{region} {service_type} 청소!"
            text2 = f"{model_name}"
            
            img_w, img_h = img.size
            font1_size = int(img_w * 0.08)
            font2_size = int(img_w * 0.08)
            font1 = ImageFont.truetype(font_path, font1_size)
            font2 = ImageFont.truetype(font_path, font2_size)
            
            bbox1 = draw.textbbox((0, 0), text1, font=font1)
            tw1, th1 = bbox1[2] - bbox1[0], bbox1[3] - bbox1[1]
            bbox2 = draw.textbbox((0, 0), text2, font=font2)
            tw2, th2 = bbox2[2] - bbox2[0], bbox2[3] - bbox2[1]

            x1 = (img_w - tw1) // 2
            x2 = (img_w - tw2) // 2
            
            box_top = int(img_h * 0.44)
            box_bottom = int(img_h * 0.88)
            box_center = (box_top + box_bottom) // 2
            
            line_spacing = int(font1_size * 0.4)
            total_text_height = th1 + line_spacing + th2
            
            y_start = box_center - (total_text_height // 2)
            
            draw.text((x1, y_start), text1, fill="white", font=font1)
            draw.text((x2, y_start + th1 + line_spacing), text2, fill="white", font=font2)
            
        img.save(output_path, "JPEG", quality=95)
        print(f"[Thumbnail] 썸네일 생성 완료: {output_path}")
        return output_path
    except Exception as e:
        print(f"[경고] 썸네일 생성 중 에러 발생: {e}")
        return ""

if __name__ == "__main__":
    # 단독 실행 시 테스트 (템플릿 Fallback)
    path = create_thumbnail("에어컨", "LG 손연재 모델")
    print(f"생성 결과 경로: {path}")
