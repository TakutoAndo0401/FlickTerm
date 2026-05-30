.PHONY: setup install check

setup: install check

install:
	mise install
	mise exec -- pnpm install

check:
	mise exec -- pnpm typecheck
	mise exec -- pnpm build:renderer
	mise exec -- cargo test --manifest-path src-tauri/Cargo.toml
