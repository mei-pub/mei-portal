package main

import (
	"fmt"
	"io"
	"strings"

	cloudscraper "github.com/Advik-B/cloudscraper/lib"
)

func main() {
	s, err := cloudscraper.New()
	if err != nil {
		fmt.Println("scraper init err:", err)
		return
	}
	targets := []string{
		"https://xiongmaogb.top/search?keyword=%E9%98%BF%E5%87%A1%E8%BE%BE",
		"https://lemonuo.top/search?keyword=%E9%98%BF%E5%87%A1%E8%BE%BE",
		"https://laowangso.top/search?keyword=%E9%98%BF%E5%87%A1%E8%BE%BE",
		"https://skrbtso.top/search?keyword=%E9%98%BF%E5%87%A1%E8%BE%BE&sos=date&sofs=all&sot=all&soft",
	}
	for _, t := range targets {
		resp, err := s.Get(t)
		if err != nil {
			fmt.Println(t[:40], "ERR:", err)
			continue
		}
		body, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		content := string(body)
		cf := strings.Contains(content, "Just a moment")
		btih := strings.Count(content, "btih")
		magnet := strings.Count(content, "magnet:")
		fmt.Printf("%-42s status=%d len=%d cf=%v btih=%d magnet=%d\n", t[:42], resp.StatusCode, len(body), cf, btih, magnet)
	}
}
