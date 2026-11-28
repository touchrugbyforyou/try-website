#!/usr/bin/env python3
"""Build TRY's Updates pages from Markdown posts.

Posts live in _updates/YYYY-MM-DD-slug.md with a short header:

    ---
    title: Post title
    slug: url-slug
    date: 2026-11-28
    description: One sentence for search results and link previews.
    ---

Run from the repo root:  python3 _tools/build_updates.py
It writes updates/index.html, updates/<slug>/index.html, feed.xml and
sitemap.xml, and refreshes the "Latest updates" block on the homepage.
"""
import datetime
import glob
import html
import os
import re

import markdown

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SITE = "https://touchrugbyforyou.org"
GIVEBUTTER = "https://givebutter.com/touch-rugby-for-you"


def read_posts():
    posts = []
    for path in sorted(glob.glob(os.path.join(ROOT, "_updates", "*.md"))):
        text = open(path, encoding="utf-8").read()
        m = re.match(r"---\n(.*?)\n---\n(.*)", text, re.S)
        if not m:
            raise SystemExit(f"{path}: missing --- header")
        meta = {}
        for line in m.group(1).splitlines():
            if ":" in line:
                k, v = line.split(":", 1)
                meta[k.strip()] = v.strip()
        for key in ("title", "slug", "date", "description"):
            if key not in meta:
                raise SystemExit(f"{path}: header needs '{key}'")
        meta["date_obj"] = datetime.date.fromisoformat(meta["date"])
        meta["body"] = markdown.markdown(m.group(2), extensions=["extra"])
        posts.append(meta)
    posts.sort(key=lambda p: p["date_obj"], reverse=True)
    return posts


def nice_date(d):
    return d.strftime("%B %-d, %Y")


def css_version():
    idx = open(os.path.join(ROOT, "index.html"), encoding="utf-8").read()
    m = re.search(r'styles\.css\?v=([\w]+)', idx)
    return m.group(1) if m else "1"


def page(title, description, canonical, body, og_type="website"):
    t, d = html.escape(title), html.escape(description)
    return f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{t}</title>
  <meta name="description" content="{d}">
  <link rel="canonical" href="{canonical}">
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="apple-touch-icon" href="/apple-touch-icon.png">
  <meta name="theme-color" content="#123F2A">
  <meta property="og:type" content="{og_type}">
  <meta property="og:site_name" content="Touch Rugby for You">
  <meta property="og:title" content="{t}">
  <meta property="og:description" content="{d}">
  <meta property="og:url" content="{canonical}">
  <meta property="og:image" content="{SITE}/og-image.png">
  <meta name="twitter:card" content="summary_large_image">
  <link rel="alternate" type="application/rss+xml" title="TRY updates" href="/feed.xml">
  <link rel="preload" href="/fonts/bricolage-grotesque.woff2" as="font" type="font/woff2" crossorigin>
  <link rel="preload" href="/fonts/figtree.woff2" as="font" type="font/woff2" crossorigin>
  <link rel="stylesheet" href="/styles.css?v={css_version()}">
</head>
<body>
  <a class="skip" href="#main">Skip to content</a>
  <header class="site-header">
    <div class="wrap header-inner">
      <a class="brand" href="/" aria-label="Touch Rugby for You, home">
        <img src="/favicon.svg" alt="" width="32" height="32">
        <span>Touch Rugby for You</span>
      </a>
      <nav aria-label="Main">
        <ul>
          <li><a href="/#why">Why</a></li>
          <li><a href="/#scholarships">Scholarships</a></li>
          <li><a href="/updates/">Updates</a></li>
          <li><a href="/#faq">FAQ</a></li>
          <li><a class="nav-donate" href="{GIVEBUTTER}" rel="noopener" data-goatcounter-click="donate-nav-updates" data-goatcounter-title="Clicked Donate (updates nav)">Donate</a></li>
        </ul>
      </nav>
    </div>
  </header>
  <main id="main">
{body}
  </main>
  <footer class="site-footer">
    <div class="wrap">
      <p>Touch Rugby for You is a California nonprofit public benefit corporation and a 501(c)(3) tax-exempt organization. EIN 43-2815674.</p>
      <p><a class="footer-link" href="https://www.instagram.com/touchrugbyforyou/" rel="noopener">@touchrugbyforyou</a> &middot; <a class="footer-link" href="/feed.xml">RSS</a></p>
      <p>&copy; {datetime.date.today().year} Touch Rugby for You</p>
    </div>
  </footer>
  <script data-goatcounter="https://touchrugbyforyou.goatcounter.com/count" async src="https://gc.zgo.at/count.js"></script>
</body>
</html>
"""


def write(rel, content):
    path = os.path.join(ROOT, rel)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        f.write(content)


def build():
    posts = read_posts()

    for p in posts:
        url = f"{SITE}/updates/{p['slug']}/"
        body = f"""    <article class="band post">
      <div class="wrap post-wrap">
        <p class="post-meta"><a href="/updates/">Updates</a> &middot; <time datetime="{p['date']}">{nice_date(p['date_obj'])}</time></p>
        <h1>{html.escape(p['title'])}</h1>
        <div class="post-body">
{p['body']}
        </div>
        <p class="post-cta"><a class="btn btn-primary" href="{GIVEBUTTER}" rel="noopener" data-goatcounter-click="donate-post-{p['slug']}" data-goatcounter-title="Clicked Donate (post: {html.escape(p['slug'])})">Donate to TRY</a></p>
      </div>
    </article>"""
        write(f"updates/{p['slug']}/index.html",
              page(f"{p['title']} | Touch Rugby for You", p["description"], url, body, "article"))

    items = "\n".join(
        f"""          <li>
            <time datetime="{p['date']}">{nice_date(p['date_obj'])}</time>
            <h2><a href="/updates/{p['slug']}/">{html.escape(p['title'])}</a></h2>
            <p>{html.escape(p['description'])}</p>
          </li>""" for p in posts)
    body = f"""    <section class="band post">
      <div class="wrap post-wrap">
        <h1>Updates</h1>
        <p class="lede-dark">News from Touch Rugby for You: scholarships, fundraising, and what we're working on.</p>
        <ul class="post-list">
{items}
        </ul>
      </div>
    </section>"""
    write("updates/index.html",
          page("Updates | Touch Rugby for You",
               "News from Touch Rugby for You: scholarships, fundraising, and what we're working on.",
               f"{SITE}/updates/", body))

    # RSS feed
    def rfc822(d):
        return datetime.datetime(d.year, d.month, d.day, 12).strftime("%a, %d %b %Y %H:%M:%S +0000")
    feed_items = "\n".join(
        f"""    <item>
      <title>{html.escape(p['title'])}</title>
      <link>{SITE}/updates/{p['slug']}/</link>
      <guid>{SITE}/updates/{p['slug']}/</guid>
      <pubDate>{rfc822(p['date_obj'])}</pubDate>
      <description>{html.escape(p['description'])}</description>
    </item>""" for p in posts)
    write("feed.xml", f"""<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Touch Rugby for You: Updates</title>
    <link>{SITE}/updates/</link>
    <description>News from Touch Rugby for You.</description>
{feed_items}
  </channel>
</rss>
""")

    # Sitemap
    today = datetime.date.today().isoformat()
    newest = posts[0]["date"] if posts else today
    urls = [(f"{SITE}/", today), (f"{SITE}/updates/", newest)]
    urls += [(f"{SITE}/updates/{p['slug']}/", p["date"]) for p in posts]
    write("sitemap.xml", '<?xml version="1.0" encoding="UTF-8"?>\n'
          '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
          + "".join(f"  <url>\n    <loc>{u}</loc>\n    <lastmod>{d}</lastmod>\n  </url>\n" for u, d in urls)
          + "</urlset>\n")

    # Homepage "Latest updates" block (between the markers)
    idx_path = os.path.join(ROOT, "index.html")
    idx = open(idx_path, encoding="utf-8").read()
    cards = "\n".join(
        f"""            <li>
              <time datetime="{p['date']}">{nice_date(p['date_obj'])}</time>
              <h3><a href="/updates/{p['slug']}/">{html.escape(p['title'])}</a></h3>
              <p>{html.escape(p['description'])}</p>
            </li>""" for p in posts[:3])
    block = f"""<!-- updates:start -->
    <section class="band band-chalk" id="updates">
      <div class="wrap two-col">
        <h2>Latest updates</h2>
        <div>
          <ul class="post-list">
{cards}
          </ul>
          <p><a href="/updates/">All updates</a></p>
        </div>
      </div>
    </section>
    <!-- updates:end -->"""
    new_idx, n = re.subn(r"<!-- updates:start -->.*?<!-- updates:end -->", block, idx, flags=re.S)
    if n != 1:
        raise SystemExit("index.html needs one <!-- updates:start --> ... <!-- updates:end --> block")
    with open(idx_path, "w", encoding="utf-8") as f:
        f.write(new_idx)

    print(f"Built {len(posts)} post(s).")


if __name__ == "__main__":
    build()
