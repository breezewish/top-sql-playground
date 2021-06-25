.PHONY: yarn_dependencies ui server run

BUILD_TAGS ?=

ifeq ($(UI),1)
	BUILD_TAGS += ui_server
endif

default: server

yarn_dependencies:
	cd ui &&\
	yarn install --frozen-lockfile

ui: yarn_dependencies
	cd ui &&\
	yarn build

server:
ifeq ($(UI),1)
	scripts/embed_ui_assets.sh
endif
	go build -o bin/topsql-play -tags "${BUILD_TAGS}" main.go

run:
	bin/topsql-play
