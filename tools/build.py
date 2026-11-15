#!/usr/bin/env python3
"""打包 DaphileTouch 插件。

版本号只在根目录 VERSION 里改一处，本脚本会：
  1. 把版本号同步到 web/index.html（左下角 v 号、?v= 缓存参数）和 plugin/install.xml；
  2. 生成 dist/DaphileTouch-<版本>.zip（install.xml 在 zip 根目录，网页在 HTML/EN/plugins/DaphileTouch/）；
  3. 生成 dist/repo.xml（LMS「插件仓库地址」用，含 zip 的 SHA1 和 GitHub Releases 下载地址）。

用法：python3 tools/build.py            只同步版本号并打包
      python3 tools/build.py --check    只检查版本号是否一致，不改文件
"""
import hashlib
import os
import re
import sys
import zipfile

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), os.pardir))
NAME = "DaphileTouch"
REPO = "https://github.com/giiganet/DaphileTouch"
WEB_FILES = ("index.html", "style.css", "api.js", "views.js", "app.js")
PLUGIN_FILES = ("install.xml", "Plugin.pm", "strings.txt")
VER_RE = r"\d+\.\d+\.\d+"


def read(p):
    with open(os.path.join(ROOT, p), encoding="utf-8") as f:
        return f.read()


def write(p, s):
    with open(os.path.join(ROOT, p), "w", encoding="utf-8") as f:
        f.write(s)


def sync(version, check):
    """把 VERSION 写进页面和 install.xml；返回不一致的地方。"""
    rules = {
        "web/index.html": [
            (r'(id="app-ver"[^>]*>v)' + VER_RE, r"\g<1>" + version),
            (r'(\.(?:css|js)\?v=)' + VER_RE, r"\g<1>" + version),
        ],
        "plugin/install.xml": [
            (r"(<version>)" + VER_RE, r"\g<1>" + version),
        ],
    }
    bad = []
    for path, subs in rules.items():
        s = read(path)
        new = s
        for pat, rep in subs:
            if not re.search(pat, new):
                sys.exit(f"{path} 里找不到版本号位置：{pat}")
            new = re.sub(pat, rep, new)
        if new != s:
            bad.append(path)
            if not check:
                write(path, new)
    return bad


def build(version):
    dist = os.path.join(ROOT, "dist")
    os.makedirs(dist, exist_ok=True)
    zpath = os.path.join(dist, f"{NAME}-{version}.zip")
    with zipfile.ZipFile(zpath, "w", zipfile.ZIP_DEFLATED) as z:
        for f in PLUGIN_FILES:
            z.write(os.path.join(ROOT, "plugin", f), f)
        for f in WEB_FILES:
            z.write(os.path.join(ROOT, "web", f), f"HTML/EN/plugins/{NAME}/{f}")
    sha = hashlib.sha1(open(zpath, "rb").read()).hexdigest()
    changes = changelog(version)
    repo = f"""<?xml version="1.0" encoding="utf-8"?>
<extensions>
  <details>
    <title lang="EN">{NAME}</title>
  </details>
  <plugins>
    <plugin name="{NAME}" version="{version}" minTarget="8.0" maxTarget="*">
      <title lang="EN">{NAME}</title>
      <desc lang="EN">Touch-friendly web player for tablets, styled after Apple Music. Open /plugins/{NAME}/index.html on your LMS server.</desc>
      <changes lang="EN">{changes}</changes>
      <url>{REPO}/releases/download/v{version}/{NAME}-{version}.zip</url>
      <sha>{sha}</sha>
      <link>{REPO}</link>
      <creator>giiganet</creator>
    </plugin>
  </plugins>
</extensions>
"""
    with open(os.path.join(dist, "repo.xml"), "w", encoding="utf-8") as f:
        f.write(repo)
    return zpath, sha


def changelog(version):
    """取 CHANGELOG.md 里该版本那一节，作为 repo.xml 的更新说明。"""
    try:
        s = read("CHANGELOG.md")
    except FileNotFoundError:
        return ""
    m = re.search(r"^## \[?" + re.escape(version) + r"\]?.*?\n(.*?)(?=^## |\Z)", s, re.S | re.M)
    text = m.group(1).strip() if m else ""
    return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def main():
    check = "--check" in sys.argv
    version = read("VERSION").strip()
    if not re.fullmatch(VER_RE, version):
        sys.exit(f"VERSION 格式不对：{version!r}，应为 x.y.z")
    bad = sync(version, check)
    if check:
        if bad:
            sys.exit(f"版本号与 VERSION（{version}）不一致：{', '.join(bad)}")
        print(f"版本号一致：{version}")
        return
    if bad:
        print(f"已把版本号 {version} 同步到：{', '.join(bad)}")
    zpath, sha = build(version)
    print(f"已生成 {os.path.relpath(zpath, ROOT)}  SHA1 {sha}")
    print("已生成 dist/repo.xml")


if __name__ == "__main__":
    main()
