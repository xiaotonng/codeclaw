/**
 * 提取当前 Twitter 页面上可见推文的结构化数据。
 * 通过 browser_evaluate 注入执行，返回 JSON 数组。
 *
 * 提取字段：handle, name, text, likes, retweets, replies, views,
 *           timestamp, url, external_links, is_promoted
 */
(() => {
  const toInt = (s) => {
    if (!s) return 0;
    s = s.trim().replace(/,/g, "");
    if (/万$/.test(s)) return Math.round(parseFloat(s) * 10000);
    if (/[Kk]$/.test(s)) return Math.round(parseFloat(s) * 1000);
    if (/[Mm]$/.test(s)) return Math.round(parseFloat(s) * 1000000);
    return parseInt(s, 10) || 0;
  };

  const articles = document.querySelectorAll('article[data-testid="tweet"]');
  const tweets = [];
  const seen = new Set();

  for (const article of articles) {
    try {
      // Handle & Name
      const userLinks = article.querySelectorAll('a[role="link"]');
      let handle = "";
      let name = "";
      for (const link of userLinks) {
        const href = link.getAttribute("href") || "";
        if (href.match(/^\/[A-Za-z0-9_]+$/) && !href.includes("/status/")) {
          const spans = link.querySelectorAll("span");
          for (const span of spans) {
            const t = span.textContent.trim();
            if (t.startsWith("@")) handle = t;
            else if (!handle && t && !t.startsWith("@")) name = t;
          }
          if (handle) break;
        }
      }

      // Tweet text
      const textEl = article.querySelector('[data-testid="tweetText"]');
      const text = textEl ? textEl.innerText.trim() : "";

      // Skip if duplicate
      const key = (handle + text.slice(0, 80)).toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);

      // Timestamp & URL
      const timeEl = article.querySelector("time");
      const timestamp = timeEl ? timeEl.getAttribute("datetime") : "";
      const statusLink = article.querySelector('a[href*="/status/"]');
      let url = "";
      if (statusLink) {
        const href = statusLink.getAttribute("href");
        url = href.startsWith("http") ? href : "https://x.com" + href;
      }

      // Engagement metrics
      const metricsGroup = article.querySelector('[role="group"]');
      let replies = 0, retweets = 0, likes = 0, views = 0;
      if (metricsGroup) {
        const buttons = metricsGroup.querySelectorAll("button, a");
        for (const btn of buttons) {
          const label = btn.getAttribute("aria-label") || "";
          const numMatch = label.match(/(\d[\d,.KkMm万]*)/);
          const num = numMatch ? toInt(numMatch[1]) : 0;

          if (/repl|回复/i.test(label)) replies = num;
          else if (/repost|retweet|转帖/i.test(label)) retweets = num;
          else if (/like|喜欢/i.test(label)) likes = num;
          else if (/view|查看|观看/i.test(label)) views = num;
        }
      }

      // External links
      const links = article.querySelectorAll('a[href^="https://t.co/"]');
      const external_links = [];
      for (const link of links) {
        const display = link.textContent.trim();
        if (display && !display.startsWith("@") && !display.startsWith("#")) {
          external_links.push(display);
        }
      }

      // Is promoted?
      const isPromoted = !!article.querySelector('[data-testid="placementTracking"]')
        || article.innerText.includes("广告")
        || article.innerText.includes("Promoted");

      // Has product signals? (GitHub links, install commands, product URLs)
      const fullText = article.innerText;
      const hasProductSignal =
        /github\.com/i.test(fullText) ||
        /npx |npm install|pip install|brew install|cargo install/i.test(fullText) ||
        /\.sh$|\.dev|\.ai$|\.app$/im.test(fullText) ||
        external_links.length > 0;

      tweets.push({
        handle,
        name,
        text: text.slice(0, 500),
        likes,
        retweets,
        replies,
        views,
        timestamp,
        url,
        external_links,
        is_promoted: isPromoted,
        has_product_signal: hasProductSignal,
      });
    } catch (e) {
      // skip malformed tweet
    }
  }

  return JSON.stringify(tweets);
})();
