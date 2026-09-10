package middleware

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

	"caorushizi.cn/mediago/internal/api/dto"
	"caorushizi.cn/mediago/internal/api/handler"
	"caorushizi.cn/mediago/internal/i18n"
	"caorushizi.cn/mediago/internal/logger"
	"github.com/gin-gonic/gin"
	"go.uber.org/zap"
)

// mei-allin 统一身份：本应用不再有独立账户体系。
// 鉴权 = 校验主应用会话令牌（门户 mei-auth cookie / Bearer / X-API-Key 均可携带）。
// 令牌即主应用 user.json 的 sha256(username:hash)，本地重算校验（单镜像同文件系统），
// 并带 30s 缓存避免每次读文件。门户改密后令牌立即轮换，全部子应用同步失效。
const shellDataDir = "/data/shell"

var portalTokenCache struct {
	sync.Mutex
	value  string
	expires time.Time
}

func portalSessionToken() string {
	portalTokenCache.Lock()
	defer portalTokenCache.Unlock()
	if time.Now().Before(portalTokenCache.expires) {
		return portalTokenCache.value
	}
	raw, err := os.ReadFile(shellDataDir + "/user.json")
	if err != nil {
		portalTokenCache.expires = time.Now().Add(5 * time.Second)
		portalTokenCache.value = ""
		return ""
	}
	var user struct {
		Username string `json:"username"`
		Hash     string `json:"hash"`
	}
	if err := json.Unmarshal(raw, &user); err != nil || user.Username == "" || user.Hash == "" {
		portalTokenCache.expires = time.Now().Add(5 * time.Second)
		portalTokenCache.value = ""
		return ""
	}
	sum := sha256.Sum256([]byte(user.Username + ":" + user.Hash))
	portalTokenCache.value = hex.EncodeToString(sum[:])
	portalTokenCache.expires = time.Now().Add(30 * time.Second)
	return portalTokenCache.value
}

func isPortalSession(c *gin.Context) bool {
	expected := portalSessionToken()
	if expected == "" {
		return false
	}
	if key := c.GetHeader("X-API-Key"); key == expected {
		return true
	}
	if auth := c.GetHeader("Authorization"); strings.HasPrefix(auth, "Bearer ") && strings.TrimPrefix(auth, "Bearer ") == expected {
		return true
	}
	for _, part := range strings.Split(c.GetHeader("Cookie"), ";") {
		part = strings.TrimSpace(part)
		if strings.HasPrefix(part, "mei-auth=") && strings.TrimPrefix(part, "mei-auth=") == expected {
			return true
		}
	}
	return false
}

// AuthMiddleware creates a Gin middleware that validates the portal session.
// Whitelisted paths bypass authentication.
func AuthMiddleware(confStore handler.ConfigStore) gin.HandlerFunc {
	whitelist := map[string]bool{
		"/healthy":          true,
		"/api/auth/setup":   true,
		"/api/auth/signin":  true,
		"/api/auth/status":  true,
	}

	return func(c *gin.Context) {
		path := c.Request.URL.Path

		// Whitelist check
		if whitelist[path] || strings.HasPrefix(path, "/swagger/") ||
			strings.HasPrefix(path, "/player") ||
			strings.HasPrefix(path, "/api/v1/") ||
			strings.HasPrefix(path, "/videos/") ||
			strings.HasPrefix(path, "/assets/") ||
			path == "/favicon.ico" ||
			path == "/" {
			c.Next()
			return
		}

		// SPA frontend routes (non-API paths without dots are likely client-side routes)
		if !strings.HasPrefix(path, "/api/") && !strings.Contains(path, ".") {
			c.Next()
			return
		}

		if isPortalSession(c) {
			c.Next()
			return
		}

		logger.Warn("Auth: missing or invalid portal session", zap.String("path", path), zap.String("clientIP", c.ClientIP()))
		c.AbortWithStatusJSON(http.StatusUnauthorized, dto.ErrorResponse{
			Success: false,
			Code:    http.StatusUnauthorized,
			Message: i18n.T(c, i18n.MsgUnauthorized),
		})
	}
}