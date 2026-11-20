#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""增量同步：官网上了新剧/新集，就把新内容补进镜像。

流程：
  1. 重抓列表页（/es/browse/all/1..N），拿到全量剧集 id
  2. 对本地缺的剧集抓详情页 + 播放页
  3. 重新打包 site/data（供播放器/搜索/Function 使用）
  4. 重新生成静态页面 + 补齐图片资源

之后由 CI（GitHub Actions）提交并触发 Cloudflare Pages 重新构建。

用法:
    python tools/sync.py           # 本机（默认直连；需要代理时设 DB_PROXY=http://127.0.0.1:7890）
"""
import os, sys, json, glob

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "tools"))

import crawl          # noqa: E402
import crawl_video    # noqa: E402
import pack           # noqa: E402
import mirror         # noqa: E402


def count(pattern):
    return len(glob.glob(os.path.join(ROOT, pattern)))


def main():
    before_books = count("site/data/books/*.json")

    print("[1/5] 抓取列表页 ...", flush=True)
    crawl.stage_listing()
    listing = json.load(open(os.path.join(ROOT, "data", "listing.json"), encoding="utf-8"))
    all_ids = [b["bookId"] for b in listing["books"]]
    have = {os.path.splitext(os.path.basename(p))[0] for p in glob.glob(os.path.join(ROOT, "data", "books", "*.json"))}
    new_ids = [i for i in all_ids if i not in have]
    print(f"      官网 {len(all_ids)} 部 / 本地 {len(have)} 部 / 新增 {len(new_ids)} 部", flush=True)

    if new_ids:
        print("[2/5] 抓取新增剧集详情 ...", flush=True)
        crawl.stage_details()

    print("[3/5] 补齐播放页 ...", flush=True)
    crawl_video.main()

    print("[4/5] 重新打包数据 ...", flush=True)
    pack.main()

    print("[5/5] 重新生成页面 ...", flush=True)
    mirror.build_pages()
    mirror.build_assets()

    after_books = count("site/data/books/*.json")
    print(f"SYNC DONE books {before_books} -> {after_books} (+{after_books - before_books})")


if __name__ == "__main__":
    main()
