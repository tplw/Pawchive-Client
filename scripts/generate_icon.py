import math, struct, zlib
from pathlib import Path

W = H = 1024
buf = bytearray(W * H * 4)

def blend(x, y, r, g, b, a):
    if x < 0 or y < 0 or x >= W or y >= H or a <= 0:
        return
    i = (y * W + x) * 4
    sa = a
    da = buf[i + 3] / 255.0
    oa = sa + da * (1 - sa)
    if oa <= 0:
        return
    for k, c in enumerate((r, g, b)):
        buf[i + k] = int((c * sa + buf[i + k] * da * (1 - sa)) / oa)
    buf[i + 3] = int(oa * 255)

def rounded_rect(x0, y0, x1, y1, radius, color):
    r, g, b = color
    for y in range(y0, y1):
        for x in range(x0, x1):
            dx = max(x0 + radius - x, 0, x - (x1 - radius))
            dy = max(y0 + radius - y, 0, y - (y1 - radius))
            d = math.hypot(dx, dy)
            a = min(1.0, max(0.0, radius - d + 0.5))
            if a > 0:
                blend(x, y, r, g, b, a)

def ellipse(cx, cy, rx, ry, color_fn):
    for y in range(int(cy - ry - 2), int(cy + ry + 3)):
        for x in range(int(cx - rx - 2), int(cx + rx + 3)):
            d = math.hypot((x - cx) / rx, (y - cy) / ry)
            a = min(1.0, max(0.0, (1.0 - d) * rx + 0.5))
            if a > 0:
                t = max(0.0, min(1.0, (y - (cy - ry)) / (2 * ry)))
                r, g, b = color_fn(t)
                blend(x, y, r, g, b, a)

# Background: deep charcoal rounded square with a subtle vertical gradient.
rounded_rect(0, 0, W, H, 224, (27, 23, 37))
for y in range(H):
    t = y / H
    a = 0.35 * (1 - abs(t - 0.35) * 1.6)
    if a > 0:
        for x in range(0, W, 2):
            blend(x, y, 124, 92, 255, a * 0.06)

# Soft glow behind the paw.
for y in range(220, 900):
    for x in range(180, 850):
        d = math.hypot(x - 512, y - 560) / 380
        if d < 1:
            blend(x, y, 167, 139, 250, (1 - d) ** 2 * 0.18)

def accent(t):
    top = (216, 205, 255)
    bottom = (139, 92, 246)
    return tuple(int(top[i] + (bottom[i] - top[i]) * t) for i in range(3))

# Paw pad and toes.
ellipse(512, 665, 205, 172, accent)
ellipse(320, 432, 112, 132, accent)
ellipse(455, 336, 116, 138, accent)
ellipse(585, 336, 116, 138, accent)
ellipse(716, 432, 112, 132, accent)

# A small heart cut-out in the pad for a distinctive mark.
for y in range(560, 720):
    for x in range(420, 610):
        nx = (x - 515) / 86
        ny = (y - 640) / 82
        heart = (nx * nx + ny * ny - 1) ** 3 - nx * nx * ny * ny * ny
        if heart < 0:
            i = (y * W + x) * 4
            buf[i] = 27
            buf[i + 1] = 23
            buf[i + 2] = 37
            buf[i + 3] = 255

raw = bytearray()
for y in range(H):
    raw.append(0)
    raw.extend(buf[y * W * 4:(y + 1) * W * 4])

def chunk(tag, data):
    return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

png = b"\x89PNG\r\n\x1a\n"
png += chunk(b"IHDR", struct.pack(">IIBBBBB", W, H, 8, 6, 0, 0, 0))
png += chunk(b"IDAT", zlib.compress(bytes(raw), 9))
png += chunk(b"IEND", b"")

output = Path(__file__).resolve().parent.parent / "src-tauri/icons/source.png"
output.write_bytes(png)
print("wrote", output, len(png))
