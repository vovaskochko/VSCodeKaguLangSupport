# https://code.visualstudio.com/api/working-with-extensions/publishing-extension
npm install -g @vscode/vsce
# npm run compile # If extension contains TypeScript sources
vsce package
vsce publish
