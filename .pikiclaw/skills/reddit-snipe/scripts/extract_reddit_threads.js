/**
 * 提取当前 Reddit 页面上可见的帖子条目（sub 列表 / 搜索结果 / hot / new）。
 * 通过 browser_evaluate 注入执行，返回 JSON 字符串。
 *
 * 主路径：现代 Reddit 的 <shreddit-post> Web Component，其属性已暴露所有元数据。
 * 兜底路径：旧版 <article> / <div data-testid="post-container">。
 *
 * 返回字段：subreddit, author, title, body_preview, url, score, comments,
 *          age_hours, post_type, external_url, has_product_signal, lang, raw_score
 */
(() => {
  const PRODUCT_SIGNALS = [
    /github\.com\//i,
    /npx\s+\S+/i,
    /npm\s+(install|i)\s+\S+/i,
    /pip\s+install\s+\S+/i,
    /brew\s+install\s+\S+/i,
    /cargo\s+install\s+\S+/i,
    /\b\w+\.dev\b/i,
    /\b\w+\.ai\b/i,
    /\b\w+\.app\b/i,
    /https?:\/\/\S+/i,
  ];

  const PIKICLAW_SIGNALS = [
    /claude\s*code/i,
    /\bcodex\b/i,
    /gemini\s*cli/i,
    /coding\s+agent/i,
    /ai\s+(coding|dev)\s+(agent|tool|assistant)/i,
    /(agent|claude)\s+(dashboard|orchestrator)/i,
    /\bmcp\b/i,
    /telegram|feishu|wechat|whatsapp|discord/i,
    /multi[\s-]?agent/i,
    /remote\s+(coding|claude|agent)/i,
    /mobile\s+claude/i,
    /\bcursor\b/i,
    /\baider\b/i,
    /\bcline\b/i,
    /vibe\s+coding/i,
  ];

  const toInt = (s) => {
    if (s == null) return 0;
    s = String(s).trim().replace(/,/g, "");
    if (/^-?\d+(\.\d+)?$/.test(s)) return Math.round(parseFloat(s));
    const m = s.match(/(-?\d+(\.\d+)?)\s*([KkMm])?/);
    if (!m) return 0;
    const n = parseFloat(m[1]);
    const suffix = (m[3] || "").toLowerCase();
    if (suffix === "k") return Math.round(n * 1000);
    if (suffix === "m") return Math.round(n * 1000000);
    return Math.round(n);
  };

  const ageHours = (iso) => {
    if (!iso) return null;
    const t = Date.parse(iso);
    if (isNaN(t)) return null;
    return Math.round((Date.now() - t) / 36e5 * 10) / 10;
  };

  // 极简语言判定：英文字母占比 + 常见英文 stopwords。
  // 不求精确，仅用于过滤明显非英文帖（如中日韩）。
  const detectLang = (text) => {
    if (!text) return "unknown";
    const t = text.slice(0, 600);
    const total = t.length || 1;
    const cjk = (t.match(/[一-鿿぀-ヿ가-힯]/g) || []).length;
    if (cjk / total > 0.1) return "cjk";
    const latin = (t.match(/[A-Za-z]/g) || []).length;
    if (latin / total < 0.4) return "other";
    const stop = ["the ", " and ", " is ", " to ", " of ", " a ", " in ", " that "];
    const hits = stop.filter((s) => t.toLowerCase().includes(s)).length;
    return hits >= 2 ? "en" : "en_maybe";
  };

  const hasProductSignal = (text) =>
    PRODUCT_SIGNALS.some((re) => re.test(text || ""));

  const hasPikiclawSignal = (text) =>
    PIKICLAW_SIGNALS.some((re) => re.test(text || ""));

  const absUrl = (href) => {
    if (!href) return "";
    if (href.startsWith("http")) return href;
    if (href.startsWith("/")) return "https://www.reddit.com" + href;
    return href;
  };

  const seen = new Set();
  const threads = [];

  // ── 主路径：<shreddit-post> ────────────────────────────
  const shrPosts = document.querySelectorAll("shreddit-post");
  for (const el of shrPosts) {
    try {
      const permalink = el.getAttribute("permalink") || "";
      const url = absUrl(permalink);
      if (!url) continue;
      if (seen.has(url)) continue;
      seen.add(url);

      const subreddit =
        el.getAttribute("subreddit-prefixed-name") ||
        (el.getAttribute("subreddit-name")
          ? "r/" + el.getAttribute("subreddit-name")
          : "");
      const author = el.getAttribute("author") || "";
      const title = el.getAttribute("post-title") || "";
      const score = toInt(el.getAttribute("score"));
      const comments = toInt(el.getAttribute("comment-count"));
      const created = el.getAttribute("created-timestamp") || "";
      const postType = el.getAttribute("post-type") || "";
      const externalUrl = el.getAttribute("content-href") || "";

      // 帖子正文预览（如果是 self post）
      let bodyPreview = "";
      const bodyEl = el.querySelector('[slot="text-body"], [data-post-click-location="text-body"]');
      if (bodyEl) {
        bodyPreview = bodyEl.innerText.trim().slice(0, 400);
      }

      // mod-locked / removed 标记
      const isLocked =
        el.hasAttribute("is-locked") ||
        el.getAttribute("post-content-state") === "REMOVED" ||
        el.innerText.includes("[removed]") ||
        el.innerText.includes("[deleted]");

      const allText = [title, bodyPreview, externalUrl].join(" ");

      threads.push({
        subreddit,
        author: author ? "u/" + author.replace(/^u\//, "") : "",
        title: title.slice(0, 300),
        body_preview: bodyPreview,
        url,
        score,
        comments,
        age_hours: ageHours(created),
        created_at: created,
        post_type: postType,
        external_url: externalUrl,
        has_product_signal: hasProductSignal(allText) || !!externalUrl,
        has_pikiclaw_signal: hasPikiclawSignal(allText),
        lang: detectLang(title + " " + bodyPreview),
        is_locked: isLocked,
        source: "shreddit-post",
      });
    } catch (e) {
      // skip malformed
    }
  }

  // ── 路径 B：搜索结果页 (data-testid="post-title" 链接) ──
  // Reddit 搜索结果不渲染 <shreddit-post>，但每条结果有 <a data-testid="post-title">。
  // 从 title-link 向上 walk 找包含 "votes·comments" 元数据的容器。
  const parseSearchAge = (s) => {
    const m = s.match(/(\d+)\s*([smhd])\s*ago/i);
    if (!m) return null;
    const n = parseInt(m[1], 10);
    const u = m[2].toLowerCase();
    if (u === "s") return n / 3600;
    if (u === "m") return n / 60;
    if (u === "h") return n;
    if (u === "d") return n * 24;
    return null;
  };
  const parseSearchVotes = (s) => {
    const m = s.match(/(\d+(?:\.\d+)?[KkMm]?)\s*votes?[^·\n]*[·\n]\s*(\d+(?:\.\d+)?[KkMm]?)\s*comments?/i);
    if (!m) return { score: 0, comments: 0 };
    return { score: toInt(m[1]), comments: toInt(m[2]) };
  };

  const titleLinks = document.querySelectorAll('a[data-testid="post-title"]');
  for (const a of titleLinks) {
    try {
      const href = a.getAttribute("href") || "";
      const url = absUrl(href);
      if (!url || seen.has(url)) continue;
      seen.add(url);

      const title = a.getAttribute("aria-label") || a.innerText.trim();
      const subMatch = url.match(/\/r\/([^/]+)\//);
      const subreddit = subMatch ? "r/" + subMatch[1] : "";

      // Walk up to find container with vote/comment metadata
      let container = a;
      for (let i = 0; i < 8 && container; i++) {
        if (container.innerText && /votes?[^·\n]*[·\n]\s*\d/i.test(container.innerText)) break;
        container = container.parentElement;
      }
      const text = container ? container.innerText : "";
      const age_hours = parseSearchAge(text);
      const { score, comments } = parseSearchVotes(text);

      threads.push({
        subreddit,
        author: "",
        title: title.slice(0, 300),
        body_preview: "",
        url,
        score,
        comments,
        age_hours,
        created_at: "",
        post_type: "",
        external_url: "",
        has_product_signal: hasProductSignal(title),
        has_pikiclaw_signal: hasPikiclawSignal(title),
        lang: detectLang(title),
        is_locked: false,
        source: "search-title-link",
      });
    } catch (e) {
      // skip
    }
  }

  // ── 兜底路径：旧版 <article> / data-testid="post-container" ──
  if (threads.length === 0) {
    const articles = document.querySelectorAll(
      'article, [data-testid="post-container"], [data-click-id="body"]'
    );
    for (const a of articles) {
      try {
        const link = a.querySelector('a[href*="/comments/"], a[data-click-id="body"]');
        if (!link) continue;
        const url = absUrl(link.getAttribute("href"));
        if (!url || seen.has(url)) continue;
        seen.add(url);

        const title =
          a.querySelector('h3, [slot="title"], [data-adclicklocation="title"]')?.innerText.trim() ||
          link.innerText.trim();

        const subMatch = url.match(/\/r\/([^/]+)\//);
        const subreddit = subMatch ? "r/" + subMatch[1] : "";

        const authorEl = a.querySelector('a[href*="/user/"], a[href*="/u/"]');
        const author = authorEl ? authorEl.innerText.trim() : "";

        const ageEl = a.querySelector("time, faceplate-timeago, [data-testid='post_timestamp']");
        const created = ageEl?.getAttribute("datetime") || ageEl?.getAttribute("ts") || "";

        const scoreEl = a.querySelector("[id^='vote-arrows'] span, [data-testid='vote-arrows'] span");
        const score = scoreEl ? toInt(scoreEl.innerText) : 0;

        const commentEl = a.querySelector("a[href*='/comments/'] span, [data-test-id='comments-page-link-num-comments']");
        const comments = commentEl ? toInt(commentEl.innerText) : 0;

        const fullText = a.innerText || "";
        threads.push({
          subreddit,
          author: author ? (author.startsWith("u/") ? author : "u/" + author) : "",
          title: (title || "").slice(0, 300),
          body_preview: "",
          url,
          score,
          comments,
          age_hours: ageHours(created),
          created_at: created,
          post_type: "",
          external_url: "",
          has_product_signal: hasProductSignal(fullText),
          has_pikiclaw_signal: hasPikiclawSignal(fullText),
          lang: detectLang(title),
          is_locked: false,
          source: "article-fallback",
        });
      } catch (e) {
        // skip
      }
    }
  }

  return JSON.stringify(threads);
})();
