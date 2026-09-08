// Package ciligou 磁力狗/磁力猫 DHT 磁力搜索插件。
//
// 站点族：磁力狗（cdn.ciligou.in:39520）与磁力猫（cdn.cilimao.fun:39520）
// 是同族 DHT 磁力引擎的不同部署（对外域名经过 iframe 壳跳转，直连 CDN
// 通道无 Cloudflare 盾）。两站索引各有侧重，聚合后去重输出。
//
// 接口契约（2026-09-08 实测）：
//   - 列表：GET /search?word=<关键词>&sort=rel&page=N（15 条/页，最多 10 页）
//   - 结果项：<a class="SearchListTitle_result_title" href="/information/<40位hash>">
//     href 中的 hash 即 btih，直接构造 magnet 链接，无需请求详情页
//   - 元数据：同 li 内 .Search_list_info 文本含 文件大小/创建时间/文件格式，
//     .Search_result_type 内含热度值
//   - SkrBT/磁力熊猫/磁力柠檬的正式域名全部套 Cloudflare Managed Challenge
//     （Go 客户端无法通过），同族接口但不可接入。
package ciligou

import (
	"fmt"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/PuerkitoBio/goquery"

	"pansou/model"
	"pansou/plugin"
)

const (
	pluginName = "ciligou"

	// defaultPriority 2 与 clxiong 等纯磁力引擎同级：插件等级分（500）
	// 高于等级 3，避免被混合源（网盘+磁力）的大量结果挤压到深页。
	defaultPriority = 2
	searchTimeout  = 15 * time.Second
	maxPages       = 2 // 每站抓 2 页（30 条），磁力结果按相关性已排序
)

// 站点列表：磁力狗在前（数据量更大），磁力猫补充。
var sites = []string{
	"https://cdn.ciligou.in:39520",
	"https://cdn.cilimao.fun:39520",
}

var (
	informationRegex = regexp.MustCompile(`/information/([0-9a-fA-F]{40})`)
	dateRegex        = regexp.MustCompile(`创建时间[：:]\s*([0-9]{4}-[0-9]{2}-[0-9]{2})`)
	sizeRegex        = regexp.MustCompile(`文件大小[：:]\s*([0-9.]+\s*[KMG]?B)`)
	formatRegex      = regexp.MustCompile(`文件格式[：:]\s*(\S+)`)
	hotRegex         = regexp.MustCompile(`^\s*([0-9]+)\s*$`)
)

type CiligouPlugin struct {
	*plugin.BaseAsyncPlugin
	client *http.Client
}

var _ plugin.AsyncSearchPlugin = (*CiligouPlugin)(nil)

func init() {
	plugin.RegisterGlobalPlugin(NewCiligouPlugin())
}

func NewCiligouPlugin() *CiligouPlugin {
	return &CiligouPlugin{
		BaseAsyncPlugin: plugin.NewBaseAsyncPluginWithFilter(pluginName, defaultPriority, true),
		client: &http.Client{
			Timeout: searchTimeout,
			Transport: &http.Transport{
				MaxIdleConns:        16,
				MaxIdleConnsPerHost: 8,
				IdleConnTimeout:     60 * time.Second,
			},
		},
	}
}

func (p *CiligouPlugin) Search(keyword string, ext map[string]interface{}) ([]model.SearchResult, error) {
	result, err := p.SearchWithResult(keyword, ext)
	if err != nil {
		return nil, err
	}
	return result.Results, nil
}

func (p *CiligouPlugin) SearchWithResult(keyword string, ext map[string]interface{}) (model.PluginSearchResult, error) {
	return p.AsyncSearchWithResult(keyword, p.searchImpl, p.MainCacheKey, ext)
}

func (p *CiligouPlugin) searchImpl(client *http.Client, keyword string, ext map[string]interface{}) ([]model.SearchResult, error) {
	if p.client != nil {
		client = p.client
	}

	type siteResults struct {
		results []model.SearchResult
		err     error
	}
	out := make([]siteResults, len(sites))
	var wg sync.WaitGroup
	for i, site := range sites {
		wg.Add(1)
		go func(idx int, base string) {
			defer wg.Done()
			items, err := p.searchSite(client, base, keyword)
			out[idx] = siteResults{results: items, err: err}
		}(i, site)
	}
	wg.Wait()

	// 跨站去重（同 hash 只保留首次出现），任一站有结果即成功。
	seen := make(map[string]bool)
	results := make([]model.SearchResult, 0)
	var firstErr error
	for _, entry := range out {
		if entry.err != nil && firstErr == nil {
			firstErr = entry.err
		}
		for _, item := range entry.results {
			hash := item.UniqueID
			if seen[hash] {
				continue
			}
			seen[hash] = true
			results = append(results, item)
		}
	}
	if len(results) == 0 && firstErr != nil {
		return nil, fmt.Errorf("[%s] all sites failed: %w", pluginName, firstErr)
	}

	filtered := plugin.FilterResultsByKeyword(results, keyword)
	return filtered, nil
}

// searchSite 抓取单个站点的搜索结果页（sort=rel 按相关性，翻 maxPages 页）。
func (p *CiligouPlugin) searchSite(client *http.Client, base string, keyword string) ([]model.SearchResult, error) {
	var results []model.SearchResult
	seen := make(map[string]bool)

	for page := 1; page <= maxPages; page++ {
		searchURL := fmt.Sprintf("%s/search?word=%s&sort=rel&page=%d", base, url.QueryEscape(keyword), page)
		req, err := http.NewRequest("GET", searchURL, nil)
		if err != nil {
			return results, err
		}
		req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36")
		req.Header.Set("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8")
		req.Header.Set("Accept-Language", "zh-CN,zh;q=0.9")

		resp, err := client.Do(req)
		if err != nil {
			return results, fmt.Errorf("request page %d failed: %w", page, err)
		}
		if resp.StatusCode != http.StatusOK {
			resp.Body.Close()
			return results, fmt.Errorf("unexpected status %d on page %d", resp.StatusCode, page)
		}

		doc, err := goquery.NewDocumentFromReader(resp.Body)
		resp.Body.Close()
		if err != nil {
			return results, fmt.Errorf("parse page %d failed: %w", page, err)
		}

		pageItems := p.parseResults(doc, base)
		if len(pageItems) == 0 {
			break // 无更多结果（空页或超末页）
		}
		for _, item := range pageItems {
			if seen[item.UniqueID] {
				continue
			}
			seen[item.UniqueID] = true
			results = append(results, item)
		}
	}
	return results, nil
}

// parseResults 解析结果列表：标题 + hash（构造 magnet）+ 大小/日期/格式/热度。
func (p *CiligouPlugin) parseResults(doc *goquery.Document, base string) []model.SearchResult {
	items := make([]model.SearchResult, 0)

	doc.Find("a.SearchListTitle_result_title").Each(func(_ int, a *goquery.Selection) {
		href, exists := a.Attr("href")
		if !exists {
			return
		}
		match := informationRegex.FindStringSubmatch(href)
		if len(match) != 2 {
			return
		}
		hash := strings.ToLower(match[1])

		title := strings.TrimSpace(a.Text())
		if title == "" {
			return
		}

		// 元数据在同一个列表项内：向上找 .Search_list_info
		infoText := ""
		if listInfo := a.ParentsFiltered("li").First().Find(".Search_list_info"); listInfo.Length() > 0 {
			infoText = strings.TrimSpace(listInfo.Text())
		}
		hotness := ""
		if hot := a.ParentsFiltered("li").First().Find(".Search_result_type"); hot.Length() > 0 {
			if m := hotRegex.FindStringSubmatch(strings.TrimSpace(hot.Text())); len(m) == 2 {
				hotness = m[1]
			}
		}

		magnet := fmt.Sprintf("magnet:?xt=urn:btih:%s", hash)

		contentParts := make([]string, 0, 4)
		if m := sizeRegex.FindStringSubmatch(infoText); len(m) == 2 {
			contentParts = append(contentParts, "大小: "+m[1])
		}
		if m := formatRegex.FindStringSubmatch(infoText); len(m) == 2 {
			contentParts = append(contentParts, "格式: "+m[1])
		}
		if hotness != "" {
			contentParts = append(contentParts, "热度: "+hotness)
		}

		var datetime time.Time
		if m := dateRegex.FindStringSubmatch(infoText); len(m) == 2 {
			if parsed, err := time.Parse("2006-01-02", m[1]); err == nil {
				datetime = parsed
			}
		}

		items = append(items, model.SearchResult{
			UniqueID: fmt.Sprintf("%s-%s", pluginName, hash),
			Title:    title,
			Content:  strings.Join(contentParts, " | "),
			Datetime: datetime,
			Links: []model.Link{
				{
					URL:  magnet,
					Type: "magnet",
				},
			},
		})
	})

	return items
}
