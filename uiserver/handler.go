package uiserver

import (
	"io"
	"net/http"

	"github.com/shurcooL/httpgzip"
)

func Handler() http.Handler {
	root := assets
	if root != nil {
		return httpgzip.FileServer(root, httpgzip.FileServerOptions{IndexHTML: true})
	}

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.WriteString(w, "UI is not built. Use `UI=1 make`.\n")
	})
}
