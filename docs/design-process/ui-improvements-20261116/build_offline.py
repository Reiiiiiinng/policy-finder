"""Build the self-contained, illustrated report using only the standard library."""

import base64
from pathlib import Path
import re


ROOT = Path(__file__).resolve().parent


def embed_image(match):
    tag = match.group(0)
    source = re.search(r'\bsrc="([^"]+)"', tag)
    if not source:
        return tag
    path = (ROOT / source.group(1)).resolve()
    if not path.is_relative_to(ROOT) or not path.is_file():
        raise ValueError(f"Missing local report image: {source.group(1)}")
    encoded = base64.b64encode(path.read_bytes()).decode("ascii")
    return tag.replace(source.group(0), f'src="data:image/jpeg;base64,{encoded}"')


def main():
    document = (ROOT / "review.html").read_text(encoding="utf-8")
    document = re.sub(r"<img\b[^>]*>", embed_image, document)
    document = document.replace(
        '<a href="offline.html" download>单文件离线版</a>',
        '<span>图片已内嵌 · 可离线查看</span>',
    )
    document = re.sub(r'href="index\.html#(\d{2})"', r'href="#state-\1"', document)
    document = document.replace('href="review.html"', 'href="#overview"')
    document = document.replace('href="mine.html"', 'href="#state-01"')
    document = document.replace(
        "查看该界面的完整对比", "本组图片已内嵌，可点击放大"
    )
    document = document.replace(
        "<title>政策找人 · 当前版本界面改进说明</title>",
        "<title>政策找人 · 界面改进说明（单文件离线版）</title>",
    )
    (ROOT / "offline.html").write_text(document, encoding="utf-8")
    images = re.findall(r'<img\b[^>]*\bsrc="([^"]+)"', document)
    assert len(images) == 67 and all(url.startswith("data:image/jpeg;base64,") for url in images)
    print(f"Built offline.html with {len(images)} embedded screenshots.")


if __name__ == "__main__":
    main()
