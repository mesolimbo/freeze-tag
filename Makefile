.DEFAULT_GOAL := help
.PHONY: help install serve build preview package

help:
	@echo "Park Freeze Tag"
	@echo ""
	@echo "  make install   Install the game's dependencies"
	@echo "  make serve     Start the game server with live reload"
	@echo "  make build     Build the game into game/dist"
	@echo "  make preview   Serve the built game from game/dist"
	@echo "  make package   Build and zip the game for itch.io"

install:
	npm --prefix game install

game/node_modules: game/package.json game/package-lock.json
	npm --prefix game install
	@touch $@

serve: game/node_modules
	npm --prefix game run dev

build: game/node_modules
	npm --prefix game run build

preview: build
	npm --prefix game run preview

package: build
	python tools/package_itch.py
