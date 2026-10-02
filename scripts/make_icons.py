"""Generates the placeholder app icon set (neutral until the app is named).
Mark: a white heart (mother) holding a small circle (baby) on the rose → lavender gradient."""
from PIL import Image, ImageDraw

S = 4  # supersampling factor for anti-aliasing
ROSE_TOP = (246, 184, 207)
ROSE = (224, 112, 154)
LAV = (185, 166, 238)


def gradient(size):
    img = Image.new("RGB", (size, size))
    px = img.load()
    for y in range(size):
        for x in range(size):
            t = (x * 0.35 + y * 0.65) / size
            if t < 0.5:
                a, b, k = ROSE_TOP, ROSE, t / 0.5
            else:
                a, b, k = ROSE, LAV, (t - 0.5) / 0.5
            px[x, y] = tuple(int(a[i] + (b[i] - a[i]) * k) for i in range(3))
    return img


def mark(size, scale=1.0, baby=(224, 112, 154, 255), hole=False):
    """Heart + baby circle on a transparent canvas; geometry on a 1000-unit grid."""
    big = size * S
    img = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    u = lambda v: (500 + (v - 500) * scale) * big / 1000  # noqa: E731
    white = (255, 255, 255, 255)
    # Classic parametric heart: x = 16 sin^3 t, y = 13 cos t - 5 cos 2t - 2 cos 3t - cos 4t
    import math
    pts = []
    for i in range(720):
        t = 2 * math.pi * i / 720
        x = 16 * math.sin(t) ** 3
        y = 13 * math.cos(t) - 5 * math.cos(2 * t) - 2 * math.cos(3 * t) - math.cos(4 * t)
        pts.append((u(500 + x * 19.5), u(505 - y * 19.5)))
    d.polygon(pts, fill=white)
    br = 88 * scale * big / 1000
    d.ellipse([u(500) - br, u(555) - br, u(500) + br, u(555) + br], fill=(0, 0, 0, 0) if hole else baby)
    return img.resize((size, size), Image.LANCZOS)


def main():
    out = "assets/images/"
    icon = gradient(1024).convert("RGBA")
    icon.alpha_composite(mark(1024, 0.78))
    icon.convert("RGB").save(out + "icon.png")

    gradient(512).save(out + "android-icon-background.png")
    mark(512, 0.52).save(out + "android-icon-foreground.png")  # inside the 66% safe zone
    mark(432, 0.6, hole=True).save(out + "android-icon-monochrome.png")
    mark(400, 0.9, baby=(201, 85, 127, 255)).save(out + "splash-icon.png")

    fav = gradient(48).convert("RGBA")
    fav.alpha_composite(mark(48, 0.8))
    fav.convert("RGB").save(out + "favicon.png")
    print("icons written")


if __name__ == "__main__":
    main()
