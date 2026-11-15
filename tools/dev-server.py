#!/usr/bin/env python3
"""DaphileTouch 开发用本地服务：/ 提供 web/ 静态页面，/lms/ 反向代理到 LMS。

只用 Python 标准库，默认只监听本机 127.0.0.1:8765。
LMS 地址用 --lms 或环境变量 LMS_HOST 指定，例如：
    python3 tools/dev-server.py --lms 192.168.1.20
正式使用时不需要它：安装成 LMS 插件后，网页由 LMS 自己提供。
"""
import argparse
import http.client
import os
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

PREFIX = "/lms/"
WEB_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), os.pardir, "web")
PASS_HEADERS = ("Content-Type", "Content-Length", "Cache-Control", "ETag",
                "Last-Modified", "Expires", "Content-Range", "Accept-Ranges")


class Handler(SimpleHTTPRequestHandler):
    lms_host = "127.0.0.1"
    lms_port = 9000

    def do_GET(self):
        if self.path.startswith(PREFIX):
            return self.proxy("GET")
        return super().do_GET()

    def do_POST(self):
        if self.path.startswith(PREFIX):
            return self.proxy("POST")
        self.send_error(405)

    def end_headers(self):
        # 开发阶段：页面和脚本不缓存，改完刷新即生效
        if not self.path.startswith(PREFIX):
            self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def proxy(self, method):
        target = "/" + self.path[len(PREFIX):]
        length = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(length) if length else None
        headers = {}
        for name in ("Content-Type", "Range"):    # Range：节奏灯分段读音频文件
            if self.headers.get(name):
                headers[name] = self.headers[name]
        conn = http.client.HTTPConnection(self.lms_host, self.lms_port, timeout=10)
        try:
            conn.request(method, target, body=body, headers=headers)
            resp = conn.getresponse()
            data = resp.read()
        except OSError as e:
            self.send_error(502, f"LMS unreachable: {e}")
            return
        finally:
            conn.close()
        self.send_response(resp.status)
        for name in PASS_HEADERS:
            value = resp.getheader(name)
            if value and name != "Content-Length":
                self.send_header(name, value)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, fmt, *args):
        # 只记录出错的请求，避免每秒轮询刷屏
        if args and str(args[1])[:1] in ("4", "5"):
            super().log_message(fmt, *args)


def main():
    ap = argparse.ArgumentParser(description="DaphileTouch dev server")
    ap.add_argument("--host", default="127.0.0.1", help="监听地址（默认只本机）")
    ap.add_argument("--port", type=int, default=8765, help="监听端口")
    ap.add_argument("--lms", default=os.environ.get("LMS_HOST"),
                    help="LMS 地址，也可用环境变量 LMS_HOST")
    ap.add_argument("--lms-port", type=int,
                    default=int(os.environ.get("LMS_PORT", "9000")))
    a = ap.parse_args()
    if not a.lms:
        ap.error("请用 --lms 或环境变量 LMS_HOST 指定 LMS 地址")
    Handler.lms_host, Handler.lms_port = a.lms, a.lms_port
    srv = ThreadingHTTPServer((a.host, a.port),
                              partial(Handler, directory=os.path.normpath(WEB_DIR)))
    print(f"DaphileTouch: http://{a.host}:{a.port}/  ->  LMS {a.lms}:{a.lms_port}")
    srv.serve_forever()


if __name__ == "__main__":
    main()
