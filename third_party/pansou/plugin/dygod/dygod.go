// Package dygod 电影天堂（DYGOD）磁力搜索插件。
//
// 站点：www.dygod.vip（主域 dygod.net 跳转至此），备用镜像 www.dytt8899.com
// （dy2018.com 跳转至此），同库双域名。页面为 GB2312 编码的帝国 CMS。
//
// 接口契约（2026-09-08 实测）：
//   - 搜索：POST /e/search/index.php，表单 classid=0&show=title,smalltext&tempid=1
//     &keyboard=<GB2312 编码关键词>；302 跳转到 /e/search/result/?searchid=N
//   - 结果列表：<a class="ulink" href="/html/<分类>/<日期>/<ID>.html" title="标题">
//   - 详情页：GET /html/...html，页面内直接含 magnet:?xt=urn:btih:<40位>（带 dn）
//     与 ed2k:// 链接（迅雷资源区，每条重复出现两次，需去重）
//   - 详情页正文含 ◎译名/◎年代 等别名信息，放入 Content 供关键词过滤匹配英文片名
//
// 注意：keyword 必须编码为 GB2312 后再表单提交，UTF-8 会搜不到内容。
package dygod

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/PuerkitoBio/goquery"
	"golang.org/x/text/encoding/simplifiedchinese"

	"pansou/model"
	"pansou/plugin"
)

const (
	pluginName = "dygod"

	// defaultPriority 2 与 ciligou 等纯磁力引擎同级：经典影视站资源质量高，
	// 提升排序避免被混合源（网盘+磁力）挤压到深页。
	defaultPriority = 2
	searchTimeout   = 20 * time.Second
	maxResponse     = 6 << 20
	// 结果列表最多取多少条详情（列表按相关度排序，深列表老资源居多）
	maxDetailItems = 10
	// 详情页抓取并发上限（老站带宽有限，克制）
	detailConcurrency = 4
)

// mirrors 同库镜像，主域失败时依次回退。
var mirrors = []string{
	"https://www.dygod.vip",
	"https://www.dytt8899.com",
}

var (
	// 详情链接 /html/gndy/dyzz/20230103/118592.html
	detailHrefRegex = regexp.MustCompile(`^/html/[a-z0-9/]+/(\d+)\.html$`)
	// 详情页磁力链接（含 dn 等参数，止于引号/空白）
	magnetRegex = regexp.MustCompile(`magnet:\?xt=urn:btih:[0-9a-fA-F]{32,40}[^"'\s<>]*`)
	ed2kRegex   = regexp.MustCompile(`ed2k://\|file\|[^"'\s<>]+`)
	// 列表/详情元信息
	dateFromHrefRegex = regexp.MustCompile(`/html/[a-z0-9/]+/(\d{8})/\d+\.html$`)
	aliasRegex        = regexp.MustCompile(`◎(?:译\s*名|片\s*名)\s*([^/\n]+)`)
	yearRegex         = regexp.MustCompile(`◎年\s*代\s*(\d{4})`)
)

type DygodPlugin struct {
	*plugin.BaseAsyncPlugin
}

var _ plugin.AsyncSearchPlugin = (*DygodPlugin)(nil)

func init() {
	plugin.RegisterGlobalPlugin(NewDygodPlugin())
}

func NewDygodPlugin() *DygodPlugin {
	return &DygodPlugin{
		BaseAsyncPlugin: plugin.NewBaseAsyncPluginWithFilter(pluginName, defaultPriority, true),
	}
}

func (p *DygodPlugin) Search(keyword string, ext map[string]interface{}) ([]model.SearchResult, error) {
	result, err := p.SearchWithResult(keyword, ext)
	if err != nil {
		return nil, err
	}
	return result.Results, nil
}

func (p *DygodPlugin) SearchWithResult(keyword string, ext map[string]interface{}) (model.PluginSearchResult, error) {
	return p.AsyncSearchWithResult(keyword, p.searchImpl, p.MainCacheKey, ext)
}

type detailItem struct {
	href   string
	title  string
	date   string // YYYYMMDD（来自 URL 路径）
	detail string // 列表页摘要
}

func (p *DygodPlugin) searchImpl(client *http.Client, keyword string, ext map[string]interface{}) ([]model.SearchResult, error) {
	keyword = strings.TrimSpace(keyword)
	if keyword == "" {
		return nil, nil
	}

	// 1. 逐镜像提交搜索表单，取回结果列表页
	var items []detailItem
	var lastErr error
	for _, base := range mirrors {
		items, lastErr = p.searchMirror(client, base, keyword)
		if lastErr == nil && len(items) > 0 {
			break
		}
	}
	if lastErr != nil && len(items) == 0 {
		return nil, fmt.Errorf("[%s] all mirrors failed: %w", pluginName, lastErr)
	}
	if len(items) == 0 {
		return nil, nil
	}
	if len(items) > maxDetailItems {
		items = items[:maxDetailItems]
	}

	// 2. 并发抓详情页，提取磁力/电驴链接
	results := make([]model.SearchResult, len(items))
	valid := make([]bool, len(items))
	sem := make(chan struct{}, detailConcurrency)
	var wg sync.WaitGroup
	for i, item := range items {
		wg.Add(1)
		go func(idx int, it detailItem) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()
			result, ok := p.fetchDetail(client, it)
			if ok {
				results[idx] = result
				valid[idx] = true
			}
		}(i, item)
	}
	wg.Wait()

	merged := make([]model.SearchResult, 0, len(results))
	for i, r := range results {
		if valid[i] {
			merged = append(merged, r)
		}
	}

	// 磁力源：跳过 Service 层过滤，插件内部按关键词过滤
	// （Content 含 ◎译名 别名，英文片名也能匹配）
	return plugin.FilterResultsByKeyword(merged, keyword), nil
}

// searchMirror 提交 GB2312 表单搜索并解析结果列表。
func (p *DygodPlugin) searchMirror(client *http.Client, base, keyword string) ([]detailItem, error) {
	// keyword -> GB2312（GBK 超集兼容），再 url-encode
	encoded, err := simplifiedchinese.GBK.NewEncoder().Bytes([]byte(keyword))
	if err != nil {
		encoded = []byte(keyword)
	}
	form := url.Values{}
	form.Set("classid", "0")
	form.Set("show", "title,smalltext")
	form.Set("tempid", "1")
	form.Set("keyboard", string(encoded))

	ctx, cancel := context.WithTimeout(context.Background(), searchTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost,
		base+"/e/search/index.php", strings.NewReader(form.Encode()))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	p.setRequestHeaders(req, base)

	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("search request failed: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("unexpected status %d", resp.StatusCode)
	}

	// 页面是 GB2312，先解码再交给 goquery
	decoded, err := io.ReadAll(io.LimitReader(resp.Body, maxResponse))
	if err != nil {
		return nil, err
	}
	utf8Body, err := simplifiedchinese.GBK.NewDecoder().Bytes(decoded)
	if err != nil {
		utf8Body = decoded
	}
	doc, err := goquery.NewDocumentFromReader(strings.NewReader(string(utf8Body)))
	if err != nil {
		return nil, err
	}

	items := make([]detailItem, 0, 16)
	seen := make(map[string]bool)
	doc.Find("a.ulink[href]").Each(func(_ int, a *goquery.Selection) {
		href, _ := a.Attr("href")
		href = strings.TrimSpace(href)
		if !detailHrefRegex.MatchString(href) {
			return
		}
		if seen[href] {
			return
		}
		seen[href] = true
		title := strings.TrimSpace(a.AttrOr("title", ""))
		if title == "" {
			title = strings.TrimSpace(a.Text())
		}
		if title == "" {
			return
		}
		date := ""
		if m := dateFromHrefRegex.FindStringSubmatch(href); len(m) == 2 {
			date = m[1]
		}
		items = append(items, detailItem{href: href, title: title, date: date})
	})
	return items, nil
}

// fetchDetail 抓取详情页，提取 magnet/ed2k 链接与别名信息。
func (p *DygodPlugin) fetchDetail(client *http.Client, item detailItem) (model.SearchResult, bool) {
	// 详情链接可能带主站绝对地址（http://www.dygod.net/...），统一改走当前镜像
	href := item.href
	if strings.HasPrefix(href, "http") {
		if u, err := url.Parse(href); err == nil {
			href = u.Path
		}
	}
	// 镜像轮流尝试
	var raw []byte
	var ok bool
	for _, base := range mirrors {
		b, err := p.fetchPage(client, base+href, base+"/")
		if err == nil {
			raw, ok = b, true
			break
		}
	}
	if !ok {
		return model.SearchResult{}, false
	}
	utf8Body, err := simplifiedchinese.GBK.NewDecoder().Bytes(raw)
	if err != nil {
		utf8Body = raw
	}
	page := string(utf8Body)

	links := make([]model.Link, 0, 4)
	seenLink := make(map[string]bool)
	for _, m := range magnetRegex.FindAllString(page, -1) {
		if seenLink[m] {
			continue
		}
		seenLink[m] = true
		links = append(links, model.Link{Type: "magnet", URL: m, WorkTitle: item.title})
	}
	for _, e := range ed2kRegex.FindAllString(page, -1) {
		if seenLink[e] {
			continue
		}
		seenLink[e] = true
		links = append(links, model.Link{Type: "ed2k", URL: e, WorkTitle: item.title})
	}
	if len(links) == 0 {
		return model.SearchResult{}, false
	}

	// 别名与年代放入 Content，让英文片名/年份也能命中关键词过滤
	contentParts := make([]string, 0, 3)
	if m := aliasRegex.FindStringSubmatch(page); len(m) == 2 {
		contentParts = append(contentParts, "别名: "+strings.TrimSpace(m[1]))
	}
	if m := yearRegex.FindStringSubmatch(page); len(m) == 2 {
		contentParts = append(contentParts, "年代: "+m[1])
	}
	content := strings.Join(contentParts, " | ")
	if content == "" {
		content = "来源: 电影天堂"
	}

	var datetime time.Time
	if item.date != "" && len(item.date) == 8 {
		if parsed, err := time.Parse("20060102", item.date); err == nil {
			datetime = parsed
		}
	}

	return model.SearchResult{
		UniqueID:  fmt.Sprintf("%s-%s", pluginName, detailID(item.href)),
		MessageID: fmt.Sprintf("%s-%s", pluginName, detailID(item.href)),
		Channel:   "",
		Datetime:  datetime,
		Title:     item.title,
		Content:   content,
		Links:     links,
	}, true
}

// fetchPage 抓取单个 GB2312 页面的原始字节。
func (p *DygodPlugin) fetchPage(client *http.Client, target, referer string) ([]byte, error) {
	ctx, cancel := context.WithTimeout(context.Background(), searchTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, target, nil)
	if err != nil {
		return nil, err
	}
	p.setRequestHeaders(req, referer)
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("HTTP %d", resp.StatusCode)
	}
	return io.ReadAll(io.LimitReader(resp.Body, maxResponse))
}

func (p *DygodPlugin) setRequestHeaders(req *http.Request, base string) {
	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36")
	req.Header.Set("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8")
	req.Header.Set("Accept-Language", "zh-CN,zh;q=0.9")
	req.Header.Set("Referer", base)
}

// detailID 从 /html/.../<ID>.html 提取数字 ID 作唯一键。
func detailID(href string) string {
	if u, err := url.Parse(href); err == nil {
		href = u.Path
	}
	m := regexp.MustCompile(`(\d+)\.html$`).FindStringSubmatch(href)
	if len(m) == 2 {
		return m[1]
	}
	return strconv.FormatInt(time.Now().UnixNano(), 10)
}
