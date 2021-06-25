// +build !ui_server

package uiserver

import (
	"net/http"
)

var assets http.FileSystem = nil
