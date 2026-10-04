Remove-Item -Recurse -Force node_modules, apps\*\node_modules, packages\*\node_modules -ErrorAction SilentlyContinue
pnpm install