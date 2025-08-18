## Deploy to GitHub Pages

1. Create a repository and push all files at the repo root (no build step required).
2. In repository settings, enable GitHub Pages with branch `main` (or `master`) and folder `/root`.
3. Ensure `index.html`, `404.html`, `sw.js`, `manifest.webmanifest`, `styles.css`, `app.js`, and the `icons/` folder are all at the repository root.
4. Access your site at `https://<user>.github.io/<repo>/`.

Notes:
- All asset and SW paths are relative, so the app works from any subpath.
- If you change the repo name (thus the subpath), no code change is needed.
- After deployment, do a hard refresh to let the new service worker take control.

