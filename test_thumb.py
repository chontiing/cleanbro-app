from PIL import Image

img = Image.open('base_thumbnail.png').convert("RGB")
w, h = img.size
print(f"Size: {w}x{h}")

# Check the color around the middle-bottom to find the background color of the dark blue box
# Let's say we check at w/2, h/2 + 50
color1 = img.getpixel((w//2, h//2 + 20))
color2 = img.getpixel((100, h - 100))
print(f"Color middle: {color1}")
print(f"Color bottom-left: {color2}")
