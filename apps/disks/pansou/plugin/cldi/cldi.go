// Package cldi 磁力帝（DHT 磁力搜索）插件。
//
// 磁力帝是轮换域名的 DHT 磁力引擎（zsky 模板），入口域名不定期失效，
// 官方提供「御选入口」落地页发布当前有效地址：
//
//   - 落地页 https://cldcld.cc/（长期入口；旧入口 cm7jll1f.1122137.xyz
//     失效时返回 410 并 meta-refresh 指向当前落地页，可作回退）
//   - 落地页内嵌 JS：CONFIG={domains:[...], intervalMinutes:30, codeLength:8,
//     salt:"..."}，当前入口由确定性算法生成（每 30 分钟轮换）：
//     slot = unix毫秒 / (intervalMinutes*60000)
//     seed = salt + "|" + host + "|" + slot + "|" + index
//     code = xorshift32(FNV-1a(seed)) 逐字符映射 [a-z0-9]
//     入口 = https://<code>.<host>
//
// 搜索接口（2026-09-08 实测）：
//   - GET /search-<keyword>-0-<sort>-<page>.html（sort 0=相关 2=时间）
//   - 结果卡 <article class="resource"> 内 <h2><a href="/hash/<40位hash>.html">
//   - href 中的 hash 即 btih，直接构造 magnet 链接，无需请求详情页
package cldi

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

	"pansou/model"
	"pansou/plugin"
)

type CldiPlugin struct {
	*plugin.BaseAsyncPlugin
}

const (
	// 并发数限制
	MaxConcurrency = 10

	// 最大搜索页数
	MaxPages = 5
)

var (
	// 广告清理正则表达式
	adRegex = regexp.MustCompile(`【[^】]*】`)

	// 文件大小和名称分离正则
	fileSizeRegex = regexp.MustCompile(`^(.+?)&nbsp;<span class="lightColor">([^<]+)</span>$`)

	// 各种数字提取正则
	numberRegex   = regexp.MustCompile(`\d+`)
	hashPathRegex = regexp.MustCompile(`(?i)/hash/([a-f0-9]{40})\.html`)

	// 落地页 CONFIG 解析
	configRegex = regexp.MustCompile(`CONFIG=\{domains:\[([^\]]*)\],intervalMinutes:(\d+),codeLength:(\d+),salt:"([^"]*)"\}`)
	// 旧入口 410 页的 meta refresh 跳转目标
	metaRefreshRegex = regexp.MustCompile(`(?i)url=(https?://[^"'>\s]+)`)
)

// 落地页（御选入口）。cldcld.cc 为当前长期落地页；1122137.xyz 根域在入口
// 失效后会 410 并 meta-refresh 到新落地页，作为第二引导源。
var landingPages = []string{
	"https://cldcld.cc/",
	"https://cm7jll1f.1122137.xyz/",
}

// defaultConfig 落地页不可用时的兜底（2026-09-08 实测值）。
var defaultConfig = rotationConfig{
	Domains:         []string{"1122137.xyz", "1122138.xyz", "cld142.buzz"},
	IntervalMinutes: 30,
	CodeLength:      8,
	Salt:            "address-page-2026",
}

// resolvedEntries 缓存的当前入口候选列表。
type resolvedEntries struct {
	bases   []string
	expires time.Time
}

var (
	entryMu       sync.Mutex
	cachedEntries *resolvedEntries
	lastReResolve time.Time // 上次强制重解析时间（限频）
)

// rotationConfig 落地页内嵌的轮换配置。
type rotationConfig struct {
	Domains         []string
	IntervalMinutes int64
	CodeLength      int
	Salt            string
}

func init() {
	p := &CldiPlugin{
		BaseAsyncPlugin: plugin.NewBaseAsyncPluginWithFilter("cldi", 3, true), // 磁力搜索插件，跳过Service层过滤
	}
	plugin.RegisterGlobalPlugin(p)
}

// Search 执行搜索并返回结果
func (p *CldiPlugin) Search(keyword string, ext map[string]interface{}) ([]model.SearchResult, error) {
	result, err := p.SearchWithResult(keyword, ext)
	if err != nil {
		return nil, err
	}
	return result.Results, nil
}

// SearchWithResult 执行搜索并返回包含IsFinal标记的结果
func (p *CldiPlugin) SearchWithResult(keyword string, ext map[string]interface{}) (model.PluginSearchResult, error) {
	return p.AsyncSearchWithResult(keyword, p.searchImpl, p.MainCacheKey, ext)
}

// currentBases 返回当前候选入口列表（带缓存与轮换解析）。
// 候选按落地页顺序排列，同 slot 内域名可用性不同，由调用方逐个尝试。
func currentBases(client *http.Client) ([]string, error) {
	entryMu.Lock()
	cached := cachedEntries
	entryMu.Unlock()
	if cached != nil && time.Now().Before(cached.expires) {
		return cached.bases, nil
	}

	bases := resolveBases(client)
	if len(bases) == 0 {
		if cached != nil {
			// 解析失败时沿用旧候选碰运气（可能只是落地页抖动）
			return cached.bases, nil
		}
		return nil, fmt.Errorf("[cldi] 无法解析入口域名")
	}

	entryMu.Lock()
	cachedEntries = &resolvedEntries{bases: bases, expires: time.Now().Add(20 * time.Minute)}
	entryMu.Unlock()
	return bases, nil
}

// invalidateEntries 入口请求失败时清除缓存，允许下次搜索立刻重解析。
func invalidateEntries() {
	entryMu.Lock()
	cachedEntries = nil
	entryMu.Unlock()
}

// resolveBases 从落地页解析当前候选入口；落地页全挂时用兜底配置计算。
func resolveBases(client *http.Client) []string {
	cfg := defaultConfig
	for _, landing := range landingPages {
		cfgBytes, err := fetchLanding(client, landing)
		if err != nil {
			continue
		}
		if parsed, ok := parseConfig(string(cfgBytes)); ok {
			cfg = parsed
			break
		}
	}
	return computeEntries(cfg)
}

// computeEntries 按落地页算法生成全部候选入口（顺序即优先级）。
func computeEntries(cfg rotationConfig) []string {
	if cfg.IntervalMinutes <= 0 {
		cfg.IntervalMinutes = 30
	}
	if cfg.CodeLength <= 0 {
		cfg.CodeLength = 8
	}
	slot := time.Now().UnixMilli() / (cfg.IntervalMinutes * 60000)
	entries := make([]string, 0, len(cfg.Domains))
	for i, host := range cfg.Domains {
		host = strings.Trim(strings.TrimSpace(host), "./")
		if host == "" {
			continue
		}
		seed := fmt.Sprintf("%s|%s|%d|%d", cfg.Salt, host, slot, i)
		code := seededCode(seed, cfg.CodeLength)
		entries = append(entries, "https://"+code+"."+host)
	}
	return entries
}

const codeAlphabet = "abcdefghijklmnopqrstuvwxyz0123456789"

// hash32 FNV-1a 32 位哈希（与落地页 JS 的 hash32 一致，种子全 ASCII）。
func hash32(text string) uint32 {
	var hash uint32 = 2166136261
	for i := 0; i < len(text); i++ {
		hash ^= uint32(text[i])
		hash *= 16777619
	}
	return hash
}

// seededCode xorshift32 伪随机序列生成入口前缀（与落地页 JS 一致）。
func seededCode(seedText string, length int) string {
	state := hash32(seedText)
	if state == 0 {
		state = 1
	}
	var b strings.Builder
	for i := 0; i < length; i++ {
		state ^= state << 13
		state ^= state >> 17
		state ^= state << 5
		b.WriteByte(codeAlphabet[state%uint32(len(codeAlphabet))])
	}
	return b.String()
}

// fetchLanding 抓取落地页（跟随旧入口的 meta refresh）。
func fetchLanding(client *http.Client, landing string) ([]byte, error) {
	body, err := simpleGet(client, landing)
	if err != nil {
		return nil, err
	}
	return body, nil
}

// parseConfig 解析落地页内嵌的 CONFIG。
func parseConfig(page string) (rotationConfig, bool) {
	m := configRegex.FindStringSubmatch(page)
	if len(m) != 5 {
		return rotationConfig{}, false
	}
	interval, err1 := strconv.ParseInt(m[2], 10, 64)
	codeLen, err2 := strconv.Atoi(m[3])
	if err1 != nil || err2 != nil || codeLen <= 0 || interval <= 0 {
		return rotationConfig{}, false
	}
	var domains []string
	for _, d := range strings.Split(m[1], ",") {
		d = strings.Trim(strings.TrimSpace(d), `"`)
		if d != "" {
			domains = append(domains, d)
		}
	}
	if len(domains) == 0 {
		return rotationConfig{}, false
	}
	return rotationConfig{Domains: domains, IntervalMinutes: interval, CodeLength: codeLen, Salt: m[4]}, true
}

// simpleGet 最小化 GET（不重试，调用方容错）。
func simpleGet(client *http.Client, target string) ([]byte, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, target, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36")
	req.Header.Set("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8")
	req.Header.Set("Accept-Language", "zh-CN,zh;q=0.9")
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("HTTP %d", resp.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if err != nil {
		return nil, err
	}
	// 旧入口 410 页面通过 meta refresh 指向新落地页，跟进一层
	page := string(body)
	if m := metaRefreshRegex.FindStringSubmatch(page); len(m) == 2 && strings.Contains(page, "http-equiv=refresh") {
		if next, err2 := simpleGet(client, m[1]); err2 == nil {
			return next, nil
		}
	}
	return body, nil
}

// searchImpl 实际的搜索实现
func (p *CldiPlugin) searchImpl(client *http.Client, keyword string, ext map[string]interface{}) ([]model.SearchResult, error) {
	bases, err := currentBases(client)
	if err != nil {
		return nil, err
	}

	results := p.searchAllPages(client, bases, keyword)
	if len(results) > 0 {
		return plugin.FilterResultsByKeyword(results, keyword), nil
	}

	// 无结果可能是入口刚好轮换（30 分钟周期），限频强制重解析一次
	entryMu.Lock()
	recent := time.Since(lastReResolve) < time.Minute
	entryMu.Unlock()
	if !recent {
		entryMu.Lock()
		lastReResolve = time.Now()
		entryMu.Unlock()
		invalidateEntries()
		if newBases, err2 := currentBases(client); err2 == nil {
			if retry := p.searchAllPages(client, newBases, keyword); len(retry) > 0 {
				return plugin.FilterResultsByKeyword(retry, keyword), nil
			}
		}
	}
	return nil, nil
}

// searchAllPages 依次尝试候选入口，首个成功者完成全部页码搜索并合并。
func (p *CldiPlugin) searchAllPages(client *http.Client, bases []string, keyword string) []model.SearchResult {
	for _, base := range bases {
		// 1. 首先搜索第一页（入口探活：请求成功或拿到结果都算可用）
		firstPageResults, err := p.searchPage(client, base, keyword, 1)
		if err != nil {
			continue // 换下一个候选入口
		}
		if len(firstPageResults) == 0 {
			return nil // 入口可用但无结果，无需换域名
		}

		// 存储所有结果
		var allResults []model.SearchResult
		allResults = append(allResults, firstPageResults...)

		// 2. 并发搜索其他页面（第2页到第5页）
		if MaxPages > 1 {
			var wg sync.WaitGroup
			var mu sync.Mutex

			// 使用信号量控制并发数
			semaphore := make(chan struct{}, MaxConcurrency)

			// 存储每页结果
			pageResults := make(map[int][]model.SearchResult)

			for page := 2; page <= MaxPages; page++ {
				wg.Add(1)
				go func(pageNum int) {
					defer wg.Done()

					// 获取信号量
					semaphore <- struct{}{}
					defer func() { <-semaphore }()

					// 添加小延迟避免过于频繁的请求
					time.Sleep(time.Duration(pageNum%3) * 100 * time.Millisecond)

					currentPageResults, err := p.searchPage(client, base, keyword, pageNum)
					if err == nil && len(currentPageResults) > 0 {
						mu.Lock()
						pageResults[pageNum] = currentPageResults
						mu.Unlock()
					}
				}(page)
			}

			wg.Wait()

			// 按页码顺序合并所有页面的结果
			for page := 2; page <= MaxPages; page++ {
				if results, exists := pageResults[page]; exists {
					allResults = append(allResults, results...)
				}
			}
		}

		return allResults
	}
	return nil
}

// searchPage 搜索指定页面
func (p *CldiPlugin) searchPage(client *http.Client, base string, keyword string, page int) ([]model.SearchResult, error) {
	// 构建搜索URL (分类=0全部, 排序=2按添加时间)
	searchURL := fmt.Sprintf("%s/search-%s-0-2-%d.html", base, url.QueryEscape(keyword), page)

	// 创建带超时的上下文
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	// 创建请求
	req, err := http.NewRequestWithContext(ctx, "GET", searchURL, nil)
	if err != nil {
		return nil, fmt.Errorf("[%s] 创建请求失败: %w", p.Name(), err)
	}

	// 设置请求头
	p.setRequestHeaders(req, base)

	// 发送请求
	resp, err := p.doRequestWithRetry(req, client)
	if err != nil {
		return nil, fmt.Errorf("[cldi] 搜索请求失败: %w", err)
	}
	defer resp.Body.Close()

	// 检查状态码
	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("[cldi] 请求返回状态码: %d", resp.StatusCode)
	}

	// 读取响应
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("[cldi] 读取响应失败: %w", err)
	}

	// 解析HTML（模板为 UTF-8）
	doc, err := goquery.NewDocumentFromReader(strings.NewReader(string(body)))
	if err != nil {
		return nil, fmt.Errorf("[cldi] HTML解析失败: %w", err)
	}

	// 提取搜索结果
	return p.extractSearchResults(doc), nil
}

// setRequestHeaders 设置请求头
func (p *CldiPlugin) setRequestHeaders(req *http.Request, base string) {
	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36")
	req.Header.Set("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8")
	req.Header.Set("Accept-Language", "zh-CN,zh;q=0.9,en;q=0.8")
	req.Header.Set("Connection", "keep-alive")
	req.Header.Set("Cache-Control", "no-cache")
	req.Header.Set("Pragma", "no-cache")
	req.Header.Set("Referer", base+"/")
}

// doRequestWithRetry 带重试机制的HTTP请求
func (p *CldiPlugin) doRequestWithRetry(req *http.Request, client *http.Client) (*http.Response, error) {
	maxRetries := 3
	var lastErr error

	for i := 0; i < maxRetries; i++ {
		if i > 0 {
			// 指数退避重试
			backoff := time.Duration(1<<uint(i-1)) * 200 * time.Millisecond
			time.Sleep(backoff)
		}

		// 克隆请求
		reqClone := req.Clone(req.Context())

		resp, err := client.Do(reqClone)
		if err == nil && resp.StatusCode == 200 {
			return resp, nil
		}

		if resp != nil {
			resp.Body.Close()
		}
		lastErr = err
	}

	return nil, fmt.Errorf("重试 %d 次后仍然失败: %w", maxRetries, lastErr)
}

// extractSearchResults 提取搜索结果
func (p *CldiPlugin) extractSearchResults(doc *goquery.Document) []model.SearchResult {
	var results []model.SearchResult

	// New cldi releases use article.resource cards and expose the BT hash in
	// /hash/<40-hex>.html links. The hash itself is a valid magnet identifier,
	// so no browser-only "copy magnet" action is required.
	doc.Find("article.resource").Each(func(_ int, article *goquery.Selection) {
		anchor := article.Find("h2 a[href]").First()
		href, _ := anchor.Attr("href")
		href = strings.TrimSpace(href)
		match := hashPathRegex.FindStringSubmatch(href)
		if len(match) < 2 {
			return
		}
		title := p.cleanTitle(anchor.Text())
		if title == "" {
			return
		}
		content := strings.TrimSpace(article.Find(".meta").Text())
		result := model.SearchResult{
			UniqueID:  fmt.Sprintf("%s-%s", p.Name(), strings.ToLower(match[1])),
			MessageID: fmt.Sprintf("%s-%s", p.Name(), strings.ToLower(match[1])),
			Channel:   "",
			Datetime:  time.Now(),
			Title:     title,
			Content:   content,
			Links: []model.Link{{
				Type:      "magnet",
				URL:       "magnet:?xt=urn:btih:" + strings.ToLower(match[1]),
				WorkTitle: title,
			}},
		}
		if dateMatch := regexp.MustCompile(`添加时间[:：]\s*(\d{4}-\d{2}-\d{2})`).FindStringSubmatch(content); len(dateMatch) > 1 {
			if parsed, err := time.ParseInLocation("2006-01-02", dateMatch[1], time.Local); err == nil {
				result.Datetime = parsed
			}
		}
		results = append(results, result)
	})
	if len(results) > 0 {
		return results
	}

	// 查找所有搜索结果
	doc.Find(".tbox .ssbox").Each(func(i int, s *goquery.Selection) {
		result := p.parseSearchResult(s)
		if result.Title != "" && len(result.Links) > 0 {
			results = append(results, result)
		}
	})

	return results
}

// parseSearchResult 解析单个搜索结果
func (p *CldiPlugin) parseSearchResult(s *goquery.Selection) model.SearchResult {
	result := model.SearchResult{
		Channel:  "", // 插件搜索结果必须为空字符串
		Datetime: time.Now(),
	}

	// 提取标题和分类
	titleSection := s.Find(".title h3")

	// 提取分类
	category := strings.TrimSpace(titleSection.Find("span").First().Text())
	if category != "" {
		result.Tags = []string{p.mapCategory(category)}
	}

	// 提取标题
	titleLink := titleSection.Find("a")
	title := strings.TrimSpace(titleLink.Text())
	result.Title = p.cleanTitle(title)

	// 提取磁力链接和元数据
	p.extractMagnetInfo(s, &result)

	// 提取文件列表作为内容
	p.extractFileList(s, &result)

	// 生成唯一ID
	result.UniqueID = fmt.Sprintf("%s-%d", p.Name(), time.Now().UnixNano())

	return result
}

// extractMagnetInfo 提取磁力链接和元数据
func (p *CldiPlugin) extractMagnetInfo(s *goquery.Selection, result *model.SearchResult) {
	sbar := s.Find(".sbar")

	// 提取磁力链接
	magnetLink, exists := sbar.Find("a[href^='magnet:']").Attr("href")
	if exists && magnetLink != "" {
		result.Links = []model.Link{{
			Type: "magnet",
			URL:  magnetLink,
		}}
	}

	// 提取添加时间
	sbar.Find("span").Each(func(i int, span *goquery.Selection) {
		text := span.Text()
		if strings.Contains(text, "添加时间:") {
			timeStr := strings.TrimSpace(span.Find("b").Text())
			if timeStr != "" {
				if parsedTime, err := time.Parse("2006-01-02", timeStr); err == nil {
					result.Datetime = parsedTime
				}
			}
		}
	})
}

// extractFileList 提取文件列表
func (p *CldiPlugin) extractFileList(s *goquery.Selection, result *model.SearchResult) {
	var fileList []string

	s.Find(".slist ul li").Each(func(i int, li *goquery.Selection) {
		// 获取原始HTML以解析文件名和大小
		html, _ := li.Html()

		// 使用正则表达式分离文件名和大小
		if matches := fileSizeRegex.FindStringSubmatch(html); len(matches) == 3 {
			fileName := strings.TrimSpace(matches[1])
			fileSize := strings.TrimSpace(matches[2])
			if fileName != "" && fileSize != "" {
				fileList = append(fileList, fmt.Sprintf("%s (%s)", fileName, fileSize))
			}
		} else {
			// 回退方案：直接使用文本内容
			text := strings.TrimSpace(li.Text())
			if text != "" {
				fileList = append(fileList, text)
			}
		}
	})

	if len(fileList) > 0 {
		result.Content = strings.Join(fileList, "\n")
	}
}

// mapCategory 映射分类
func (p *CldiPlugin) mapCategory(category string) string {
	// 移除方括号
	category = strings.Trim(category, "[]")

	switch category {
	case "影视":
		return "影视"
	case "音乐":
		return "音乐"
	case "图像":
		return "图像"
	case "文档书籍":
		return "文档"
	case "压缩文件":
		return "压缩包"
	case "安装包":
		return "软件"
	case "其他":
		return "其他"
	default:
		return "其他"
	}
}

// cleanTitle 清理标题中的广告内容
func (p *CldiPlugin) cleanTitle(title string) string {
	// 移除【】内的广告内容
	cleaned := adRegex.ReplaceAllString(title, "")

	// 清理多余的空格
	cleaned = strings.TrimSpace(cleaned)
	cleaned = regexp.MustCompile(`\s+`).ReplaceAllString(cleaned, " ")

	return cleaned
}
